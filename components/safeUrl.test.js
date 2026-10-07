import { describe, it, expect } from 'vitest';
import { safeUrl } from './safeUrl';

// AUDIT-2026-10-06: staff-entered Monday URLs must only ever render as http(s).
describe('safeUrl', () => {
  it('passes through absolute http and https URLs (trimmed)', () => {
    expect(safeUrl('https://example.com/a.pdf')).toBe('https://example.com/a.pdf');
    expect(safeUrl('  http://example.com/x  ')).toBe('http://example.com/x');
  });

  it('rejects script-capable and non-web schemes', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl(' JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeUrl('vbscript:msgbox(1)')).toBeNull();
    expect(safeUrl('file:///etc/passwd')).toBeNull();
  });

  it('rejects relative, scheme-less, empty, and non-string values', () => {
    expect(safeUrl('/api/foo')).toBeNull();
    expect(safeUrl('www.example.com')).toBeNull();
    expect(safeUrl('')).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
    expect(safeUrl(42)).toBeNull();
  });
});
