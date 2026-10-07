import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { claimOnce, __resetAtomicClaimForTests } from './atomicClaim';

// AUDIT-2026-10-06 (follow-up): the claim is the only thing standing between
// two concurrent senders and a duplicate customer email, and it must never be
// the reason an email is NOT sent when the store is missing or down.

function fakeRedis() {
  const keys = new Map();
  return vi.fn(async (url, init) => {
    const [cmd, key, , nx] = JSON.parse(init.body);
    let result = null;
    if (cmd === 'SET' && nx === 'NX') {
      if (!keys.has(key)) { keys.set(key, true); result = 'OK'; }
    } else if (cmd === 'DEL') {
      result = keys.delete(key) ? 1 : 0;
    }
    return { ok: true, status: 200, json: async () => ({ result }) };
  });
}

describe('claimOnce', () => {
  const env = { ...process.env };
  beforeEach(() => {
    __resetAtomicClaimForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fails open (claimed, no-op release) when no store is configured', async () => {
    delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const claim = await claimOnce('k', 60);
    expect(claim).toMatchObject({ claimed: true, backend: 'none' });
    await claim.release();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lets exactly one of two concurrent callers win, and release frees it for a retry', async () => {
    process.env.KV_REST_API_URL = 'https://kv.example.com/';
    process.env.KV_REST_API_TOKEN = 'tok';
    const fetchSpy = fakeRedis();
    vi.stubGlobal('fetch', fetchSpy);

    const [a, b] = await Promise.all([claimOnce('reply-notify:1:message:9', 60), claimOnce('reply-notify:1:message:9', 60)]);
    expect([a.claimed, b.claimed].sort()).toEqual([false, true]);

    const winner = a.claimed ? a : b;
    await winner.release();
    expect((await claimOnce('reply-notify:1:message:9', 60)).claimed).toBe(true);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://kv.example.com');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body)).toEqual(['SET', 'portal:claim:reply-notify:1:message:9', expect.any(String), 'NX', 'EX', '60']);
  });

  it('fails open when the store errors', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://kv.example.com';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'tok';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const claim = await claimOnce('k', 60);
    expect(claim).toMatchObject({ claimed: true, backend: 'error' });
    await expect(claim.release()).resolves.toBeUndefined();
  });

  it('treats an error body from the store as unavailable, not as "already claimed"', async () => {
    process.env.KV_REST_API_URL = 'https://kv.example.com';
    process.env.KV_REST_API_TOKEN = 'tok';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'WRONGPASS' }) }));
    expect((await claimOnce('k', 60)).claimed).toBe(true);
  });
});
