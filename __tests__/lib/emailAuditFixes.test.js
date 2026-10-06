import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';

// Fixes from the 2026-10-06 email audit that are pure functions.

vi.mock('resend', () => ({ Resend: vi.fn() }));

describe('customer-facing status emails', async () => {
  const { isCustomerFacingStatus } = await import('../../lib/email.js');

  it('only emails the three customer-facing phases', () => {
    for (const ok of ['Ready for Manufacturing', 'Shipped', 'Order Complete']) expect(isCustomerFacingStatus(ok)).toBe(true);
  });

  it('never emails internal pipeline phases', () => {
    for (const internal of ['GB Fab Details Sent', 'RES Order Submitted', 'Wait to Push Order', 'ORDER CANCELLED', 'No Action Needed', 'Incoming Order', '']) {
      expect(isCustomerFacingStatus(internal)).toBe(false);
    }
  });
});

describe('progress-bar stages from real Manufacturing Phase labels', async () => {
  const { stageIndexForPhase, STATUS_STAGES } = await import('../../lib/monday.js');
  const key = (phase) => STATUS_STAGES[stageIndexForPhase(phase)].key;

  it('maps real board labels onto the five stages', () => {
    expect(key('Incoming Order')).toBe('order_placed');
    expect(key('GB Fab Details Sent')).toBe('in_manufacturing');
    expect(key('Install Doc Sent')).toBe('ready_to_ship');
    expect(key('Shipped')).toBe('shipped');
    expect(key('Order Complete')).toBe('delivered');
  });

  it('leaves unknown/cancelled phases at the first stage', () => {
    expect(stageIndexForPhase('ORDER CANCELLED')).toBe(0);
    expect(stageIndexForPhase('')).toBe(0);
  });
});

describe('Resend webhook signature (Svix)', async () => {
  const { verifySvixSignature } = await import('../../pages/api/resend/webhook.js');
  const secretBytes = Buffer.from('supersecretkey123');
  const secret = `whsec_${secretBytes.toString('base64')}`;
  const body = '{"type":"email.bounced"}';
  const sign = (id, ts) => `v1,${crypto.createHmac('sha256', secretBytes).update(`${id}.${ts}.${body}`).digest('base64')}`;

  it('accepts a correctly signed request', () => {
    const ts = 1791300000;
    const headers = { 'svix-id': 'msg_1', 'svix-timestamp': String(ts), 'svix-signature': `v1,bogus ${sign('msg_1', ts)}` };
    expect(verifySvixSignature(secret, headers, body, ts)).toBe(true);
  });

  it('rejects a tampered body, a stale timestamp, or a missing secret', () => {
    const ts = 1791300000;
    const headers = { 'svix-id': 'msg_1', 'svix-timestamp': String(ts), 'svix-signature': sign('msg_1', ts) };
    expect(verifySvixSignature(secret, headers, body + ' ', ts)).toBe(false);
    expect(verifySvixSignature(secret, headers, body, ts + 3600)).toBe(false);
    expect(verifySvixSignature('', headers, body, ts)).toBe(false);
  });
});

describe('bounce records', async () => {
  const { hasBounced } = await import('../../lib/bounces.js');
  const updates = [{ body: '[PORTAL: Email Bounced]\nEmail to TJ@School.org bounced on 10/5/2026' }];

  it('matches the bounced address case-insensitively', () => {
    expect(hasBounced(updates, 'tj@school.org')).toBe(true);
  });

  it('no longer applies once the order has a different email', () => {
    expect(hasBounced(updates, 'new@school.org')).toBe(false);
  });
});

describe('Jotform multipart webhook body', async () => {
  const { parseMultipartFields, getFormMap } = await import('../../pages/api/jotform/webhook.js');

  it('reads the text fields Jotform posts as multipart/form-data', () => {
    const raw = [
      '--XyZ', 'Content-Disposition: form-data; name="formID"', '', '123',
      '--XyZ', 'Content-Disposition: form-data; name="rawRequest"', '', '{"q3_email":"a@b.com"}',
      '--XyZ--', '',
    ].join('\r\n');
    expect(parseMultipartFields(raw, 'multipart/form-data; boundary=XyZ')).toEqual({ formID: '123', rawRequest: '{"q3_email":"a@b.com"}' });
  });

  it('maps the Showcase form from its own env var when JOTFORM_FORM_MAP is unset', () => {
    process.env.JOTFORM_SHOWCASE_FORM_ID = '999';
    delete process.env.JOTFORM_FORM_MAP;
    expect(getFormMap()['999'].tab).toBe('showcase');
  });
});

describe('freight email ordering', async () => {
  const { isBackwardStep } = await import('../../pages/api/aftership/webhook.js');

  it('skips a step backwards after a newer status was emailed', () => {
    expect(isBackwardStep('Out for Delivery', 'In Transit')).toBe(true);
    expect(isBackwardStep('Delivered', 'Out for Delivery')).toBe(true);
  });

  it('allows forward steps and anything involving an exception', () => {
    expect(isBackwardStep('In Transit', 'Out for Delivery')).toBe(false);
    expect(isBackwardStep('Exception', 'In Transit')).toBe(false);
    expect(isBackwardStep('', 'In Transit')).toBe(false);
  });
});
