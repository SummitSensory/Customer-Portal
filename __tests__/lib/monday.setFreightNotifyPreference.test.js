import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setFreightNotifyPreference, COLS } from '../../lib/monday';

// Regression: turning "Freight Email Alerts" OFF sent `{}` to the checkbox
// column, which Monday rejects ("Invalid column type value"). Unchecking must
// send a null value for the column instead.

function ok(data) {
  return { ok: true, status: 200, json: async () => ({ data }) };
}

describe('setFreightNotifyPreference', () => {
  let calls;
  beforeEach(() => {
    calls = [];
    process.env.MONDAY_BOARD_ID = '6533700776';
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      return ok({ change_column_value: { id: 'i1' }, change_multiple_column_values: { id: 'i1' } });
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('checks the box when enabling', async () => {
    await setFreightNotifyPreference('i1', true);
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain('change_column_value');
    expect(calls[0].variables.columnId).toBe(COLS.freightNotifyPref);
    expect(JSON.parse(calls[0].variables.value)).toEqual({ checked: 'true' });
  });

  it('clears the box with a null column value when disabling (never `{}`)', async () => {
    await setFreightNotifyPreference('i1', false);
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain('change_multiple_column_values');
    expect(calls[0].variables.boardId).toBe('6533700776');
    expect(calls[0].variables.itemId).toBe('i1');
    expect(JSON.parse(calls[0].variables.values)).toEqual({ [COLS.freightNotifyPref]: null });
  });
});
