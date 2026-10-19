/**
 * QuickBooks Online — connection and the few API calls the portal needs
 * (lib/prismaticInvoicing.js adds Prismatic upcharges to invoices; Bryan,
 * 2026-10-19).
 *
 * Connection. A staff member connects once from Admin → Settings →
 * QuickBooks (OAuth 2, /api/admin/quickbooks/connect → callback). Intuit
 * hands back a refresh token that can change on every refresh and has to be
 * kept, and Monday is this app's only datastore — so the connection (company
 * id, tokens) is stored AES-256-GCM-encrypted, with a key that lives only in
 * Vercel (QBO_TOKEN_KEY), on one item of the private "Portal System Settings
 * (do not edit)" board. A text column, not long text: long text caps at
 * 2,000 characters and an encrypted access token can run past that.
 *
 * Env: QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_TOKEN_KEY (any long random
 * string), QBO_ENVIRONMENT ('production' default, or 'sandbox').
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { mondayQuery } from './monday';

const SETTINGS_BOARD_ID = process.env.QBO_SETTINGS_BOARD_ID || '18436103314';
const SETTINGS_ITEM_ID = process.env.QBO_SETTINGS_ITEM_ID || '13328467484';
const SETTINGS_COLUMN = process.env.QBO_SETTINGS_COLUMN || 'text_mm89em72';

// Holds the OAuth `state` between /api/admin/quickbooks/connect and callback.
export const OAUTH_STATE_COOKIE = 'qbo_oauth_state';

const AUTHORIZE_URL ='https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const SCOPE = 'com.intuit.quickbooks.accounting';
const MINOR_VERSION = '75';
const REQUEST_TIMEOUT_MS = 20_000;

function apiBase() {
  return process.env.QBO_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
}

export function redirectUri() {
  const base = process.env.NEXTAUTH_URL || 'https://portal.summitsensory.com';
  return `${base.replace(/\/$/, '')}/api/admin/quickbooks/callback`;
}

/** Client id/secret and the encryption key are all set. */
export function quickbooksConfigured() {
  return !!(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET && process.env.QBO_TOKEN_KEY);
}

// ── Encrypted storage ─────────────────────────────────────────────────────

function key() {
  if (!process.env.QBO_TOKEN_KEY) throw new Error('QBO_TOKEN_KEY is not set.');
  return createHash('sha256').update(process.env.QBO_TOKEN_KEY).digest();
}

export function encryptJson(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

export function decryptJson(text) {
  if (!text || !text.startsWith('v1.')) return null;
  const raw = Buffer.from(text.slice(3), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
}

/** The stored connection, or null when QuickBooks was never connected. */
export async function readConnection() {
  const data = await mondayQuery(`
    query($i: [ID!], $c: [String!]) { items(ids: $i) { column_values(ids: $c) { text } } }
  `, { i: [SETTINGS_ITEM_ID], c: [SETTINGS_COLUMN] });
  return decryptJson(data.items?.[0]?.column_values?.[0]?.text || '');
}

export async function writeConnection(connection) {
  await mondayQuery(`
    mutation($b: ID!, $i: ID!, $c: String!, $v: String) {
      change_simple_column_value(board_id: $b, item_id: $i, column_id: $c, value: $v) { id }
    }
  `, { b: SETTINGS_BOARD_ID, i: SETTINGS_ITEM_ID, c: SETTINGS_COLUMN, v: connection ? encryptJson(connection) : '' });
}

// ── OAuth ─────────────────────────────────────────────────────────────────

export function authorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: redirectUri(),
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

async function tokenRequest(form) {
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`QuickBooks token request failed (${res.status}): ${data.error || 'unknown error'}`);
    err.invalidGrant = data.error === 'invalid_grant';
    throw err;
  }
  return data;
}

function withTokens(connection, tokens, now = Date.now()) {
  return {
    ...connection,
    accessToken: tokens.access_token,
    accessExpiresAt: now + (tokens.expires_in || 3600) * 1000,
    refreshToken: tokens.refresh_token,
    refreshExpiresAt: now + (tokens.x_refresh_token_expires_in || 0) * 1000,
  };
}

/** Finish the OAuth flow: trade the code for tokens and store the connection. */
export async function completeConnection({ code, realmId, connectedBy }) {
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() });
  const connection = withTokens({ realmId: String(realmId), connectedBy, connectedAt: new Date().toISOString() }, tokens);
  await writeConnection(connection);
  return connection;
}

export async function disconnect() {
  const connection = await readConnection().catch(() => null);
  if (connection?.refreshToken) {
    const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: connection.refreshToken }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch((err) => console.warn('quickbooks: revoke failed (clearing the stored connection anyway):', err.message));
  }
  await writeConnection(null);
}

// One refresh at a time per instance: a refresh can rotate the refresh
// token, and two racing refreshes would store whichever finished last.
let refreshing = null;

async function currentConnection({ forceRefresh = false } = {}) {
  const connection = await readConnection();
  if (!connection?.refreshToken) throw new Error('QuickBooks is not connected (Admin → Settings → QuickBooks).');
  if (!forceRefresh && connection.accessToken && connection.accessExpiresAt - 60_000 > Date.now()) return connection;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: connection.refreshToken });
        const next = withTokens(connection, tokens);
        await writeConnection(next);
        return next;
      } catch (err) {
        if (err.invalidGrant) err.message = 'QuickBooks disconnected itself (the stored login expired or was revoked) — reconnect it in Admin → Settings → QuickBooks.';
        throw err;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

// ── API ───────────────────────────────────────────────────────────────────

function faultMessage(data) {
  const errors = data?.Fault?.Error || [];
  return errors.map((e) => [e.Message, e.Detail].filter(Boolean).join(': ')).join('; ');
}

async function apiRequest(method, path, body, { retried = false } = {}) {
  const connection = await currentConnection({ forceRefresh: retried });
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${apiBase()}/v3/company/${connection.realmId}/${path}${sep}minorversion=${MINOR_VERSION}`, {
    method,
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 401 && !retried) return apiRequest(method, path, body, { retried: true });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.Fault) {
    const err = new Error(`QuickBooks ${method} ${path.split('?')[0]} failed (${res.status}): ${faultMessage(data) || 'no detail'}`);
    // Updating from an out-of-date copy (another run changed it first).
    err.stale = /stale object/i.test(err.message) || (data?.Fault?.Error || []).some((e) => String(e.code) === '5010');
    throw err;
  }
  return data;
}

/** Quote a value for a QuickBooks query string. */
export function qbString(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export async function query(sql) {
  const data = await apiRequest('GET', `query?query=${encodeURIComponent(sql)}`);
  return data.QueryResponse || {};
}

export async function findCustomersByEmail(email) {
  return (await query(`select * from Customer where PrimaryEmailAddr = ${qbString(email)}`)).Customer || [];
}

export async function findCustomersByName(name) {
  return (await query(`select * from Customer where DisplayName = ${qbString(name)}`)).Customer || [];
}

export async function getCustomerInvoices(customerId) {
  return (await query(`select * from Invoice where CustomerRef = ${qbString(customerId)} ORDERBY TxnDate DESC MAXRESULTS 100`)).Invoice || [];
}

export async function getItem(itemId) {
  return (await query(`select * from Item where Id = ${qbString(itemId)}`)).Item?.[0] || null;
}

/**
 * Replace an invoice's lines (sparse update). `invoice` must be the copy just
 * read — its SyncToken makes QuickBooks refuse the write (err.stale) if the
 * invoice changed in between, so two runs can never both add a line.
 */
export async function updateInvoiceLines(invoice, lines) {
  const data = await apiRequest('POST', 'invoice', { Id: invoice.Id, SyncToken: invoice.SyncToken, sparse: true, Line: lines });
  return data.Invoice;
}

/** Connection summary for the admin settings screen (no secrets). */
export async function connectionStatus() {
  if (!quickbooksConfigured()) return { configured: false, connected: false };
  const connection = await readConnection();
  if (!connection?.refreshToken) return { configured: true, connected: false };
  let companyName = null;
  let error = null;
  try {
    const info = await apiRequest('GET', `companyinfo/${connection.realmId}`);
    companyName = info.CompanyInfo?.CompanyName || null;
  } catch (err) {
    error = err.message;
  }
  return {
    configured: true,
    connected: !error,
    error,
    companyName,
    realmId: connection.realmId,
    connectedBy: connection.connectedBy || null,
    connectedAt: connection.connectedAt || null,
    refreshExpiresAt: connection.refreshExpiresAt || null,
  };
}
