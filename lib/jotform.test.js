import { describe, it, expect } from 'vitest';
import { isValidJotformId, withOrderToken } from './jotform';

describe('withOrderToken', () => {
  it('appends the token as the first query parameter', () => {
    expect(withOrderToken('https://form.jotform.com/123456', 'a.b.c'))
      .toBe('https://form.jotform.com/123456?portal_order_token=a.b.c');
  });

  it('joins an existing query string with &', () => {
    expect(withOrderToken('https://form.jotform.com/123456?q3_email1=x%40y.com', 'tok'))
      .toBe('https://form.jotform.com/123456?q3_email1=x%40y.com&portal_order_token=tok');
  });

  it('URL-encodes the token', () => {
    expect(withOrderToken('https://form.jotform.com/1', 'a+b/c="'))
      .toBe('https://form.jotform.com/1?portal_order_token=a%2Bb%2Fc%3D%22');
  });

  it('leaves the URL unchanged without a token', () => {
    expect(withOrderToken('https://form.jotform.com/1', undefined)).toBe('https://form.jotform.com/1');
    expect(withOrderToken('https://form.jotform.com/1', '')).toBe('https://form.jotform.com/1');
  });
});

describe('isValidJotformId', () => {
  it('accepts numeric ids only', () => {
    expect(isValidJotformId('241234567890123')).toBe(true);
    expect(isValidJotformId('12"><script>')).toBe(false);
  });
});
