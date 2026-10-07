import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendUrgentErrorAlert = vi.fn(() => Promise.resolve());
vi.mock('../../lib/email', () => ({ sendUrgentErrorAlert }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));

async function freshModule() {
  vi.resetModules();
  return import('../../lib/errorAlerts');
}

describe('reportError', () => {
  beforeEach(() => {
    sendUrgentErrorAlert.mockClear();
    vi.stubEnv('VERCEL_ENV', 'production');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('emails the error message, stack and context', async () => {
    const { reportError } = await freshModule();
    await reportError({ source: 'test', error: new Error('boom'), context: { page: '/portal' } });
    expect(sendUrgentErrorAlert).toHaveBeenCalledTimes(1);
    const arg = sendUrgentErrorAlert.mock.calls[0][0];
    expect(arg.source).toBe('test');
    expect(arg.message).toBe('Error: boom');
    expect(arg.stack).toContain('boom');
    expect(arg.context.page).toBe('/portal');
  });

  it('does not email outside production', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    const { reportError } = await freshModule();
    await reportError({ source: 'test', message: 'boom' });
    expect(sendUrgentErrorAlert).not.toHaveBeenCalled();
  });

  it('sends one email per distinct error per window, and counts the repeats', async () => {
    vi.useFakeTimers();
    try {
      const { reportError } = await freshModule();
      await reportError({ source: 'a', message: 'order 111 failed' });
      await reportError({ source: 'a', message: 'order 222 failed' }); // same error, different id
      await reportError({ source: 'a', message: 'something else' });
      expect(sendUrgentErrorAlert).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(16 * 60 * 1000);
      await reportError({ source: 'a', message: 'order 333 failed' });
      expect(sendUrgentErrorAlert).toHaveBeenCalledTimes(3);
      expect(sendUrgentErrorAlert.mock.calls[2][0].context.repeatsSinceLastEmail).toMatch(/^1 more/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps total emails per hour', async () => {
    const { reportError } = await freshModule();
    for (let i = 0; i < 40; i++) await reportError({ source: 'a', message: `distinct error ${'x'.repeat(i)}` });
    expect(sendUrgentErrorAlert).toHaveBeenCalledTimes(30);
  });

  it('never throws when the email send fails', async () => {
    sendUrgentErrorAlert.mockImplementationOnce(() => Promise.reject(new Error('resend down')));
    const { reportError } = await freshModule();
    await expect(reportError({ source: 'a', message: 'boom' })).resolves.toBeUndefined();
  });
});

describe('installConsoleCapture', () => {
  beforeEach(() => {
    sendUrgentErrorAlert.mockClear();
    vi.stubEnv('VERCEL_ENV', 'production');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('emails console.error calls but not Node process warnings', async () => {
    const realError = console.error;
    const flag = Symbol.for('summit.errorAlerts.installed');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      delete globalThis[flag];
      const { installConsoleCapture } = await freshModule();
      installConsoleCapture();
      console.error('(node:4) ExperimentalWarning: vm.USE_MAIN_CONTEXT_DEFAULT_LOADER is an experimental feature');
      console.error('(node:4) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.');
      expect(sendUrgentErrorAlert).not.toHaveBeenCalled();
      console.error('Update webhook error:', new Error('real failure'));
      expect(sendUrgentErrorAlert).toHaveBeenCalledTimes(1);
    } finally {
      console.error = realError;
      delete globalThis[flag];
    }
  });
});
