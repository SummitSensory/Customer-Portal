// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { safeHref, normalizeContact } from '../../../pages/portal/index';

// Audit 2026-10-18: both regexes lost their backslashes in commit 7108871
// (2026-10-09). safeHref returned a RegExp for every input, so every invoice,
// payment, file and installation link in the portal pointed at "/^https?:/";
// normalizeContact stripped the letters "s" and "D" instead of whitespace
// and non-digits.
describe('safeHref', () => {
  it('passes through http(s) links unchanged', () => {
    expect(safeHref('https://example.com/invoice.pdf')).toBe('https://example.com/invoice.pdf');
    expect(safeHref('  http://example.com/a  ')).toBe('http://example.com/a');
  });

  it('rejects non-http(s) links', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('https:example.com')).toBeUndefined();
    expect(safeHref('')).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
  });
});

describe('normalizeContact', () => {
  it('ignores phone punctuation and extra whitespace', () => {
    expect(normalizeContact({ name: '  Jess   Smith ', phone: '(303) 555-0100', email: ' A@B.com ' }))
      .toEqual({ name: 'jess smith', phone: '3035550100', email: 'a@b.com' });
    expect(normalizeContact({ phone: '303-555-0100' }).phone).toBe('3035550100');
  });
});
