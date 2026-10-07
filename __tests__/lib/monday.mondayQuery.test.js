import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mondayQuery } from '../../lib/monday';

// Transient Monday "Internal server error" responses (2026-10-07,
// message-reply-safety-net) should be retried for reads, never for mutations.

const okResponse = (data) => ({ ok: true, status: 200, json: async () => ({ data }) });
const gqlError = (message) => ({ ok: true, status: 200, json: async () => ({ errors: [{ message }] }) });
const http5xx = (status) => ({ ok: false, status, statusText: 'Server Error', text: async () => 'oops' });

describe('mondayQuery transient server errors', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function run(promise) {
    const settled = promise.then(v => ({ v }), e => ({ e }));
    await vi.runAllTimersAsync();
    return settled;
  }

  it('retries a read after a GraphQL "Internal server error"', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(gqlError('Internal server error'))
      .mockResolvedValueOnce(okResponse({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const { v } = await run(mondayQuery('query { items { id } }'));
    expect(v).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a read after an HTTP 5xx', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(http5xx(502))
      .mockResolvedValueOnce(okResponse({ ok: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const { v } = await run(mondayQuery('query { me { id } }'));
    expect(v).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the max retries on a persistent internal error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(gqlError('Internal server error'));
    vi.stubGlobal('fetch', fetchMock);
    const { e } = await run(mondayQuery('query { me { id } }'));
    expect(e.message).toMatch(/Internal server error/);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not retry a mutation after an internal error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(gqlError('Internal server error'));
    vi.stubGlobal('fetch', fetchMock);
    const { e } = await run(mondayQuery('mutation { create_update(item_id: 1, body: "x") { id } }'));
    expect(e.message).toMatch(/Internal server error/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a mutation after an HTTP 5xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(http5xx(500));
    vi.stubGlobal('fetch', fetchMock);
    const { e } = await run(mondayQuery('mutation { delete_item(item_id: 1) { id } }'));
    expect(e.message).toMatch(/500/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry ordinary GraphQL errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(gqlError('Column not found'));
    vi.stubGlobal('fetch', fetchMock);
    const { e } = await run(mondayQuery('query { me { id } }'));
    expect(e.message).toMatch(/Column not found/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
