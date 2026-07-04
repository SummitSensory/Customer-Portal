/**
 * GET /api/monday/debug-columns?orderId=...
 * Staff-only: returns raw column_values for an order so we can
 * inspect what Monday.com actually sends back for mirror/lookup columns.
 * Remove or gate this route once debugging is complete.
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

const MONDAY_API = 'https://api.monday.com/v2';

export default async function handler(req, res) {
  // Only available in development or when explicitly enabled
  if (process.env.NODE_ENV === 'production' && !process.env.ENABLE_DEBUG_ENDPOINTS) {
    return res.status(404).end();
  }

  // Staff only
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Staff auth required.' });

  const { orderId } = req.query;
  if (!orderId) return res.status(400).json({ error: 'orderId required.' });

  const query = `
    query($itemId: [ID!]) {
      items(ids: $itemId) {
        id name
        column_values {
          id
          text
          value
          type
        }
      }
    }
  `;

  const r = await fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MONDAY_API_TOKEN}`,
      'API-Version': '2024-04',
    },
    body: JSON.stringify({ query, variables: { itemId: [orderId] } }),
  });

  const json = await r.json();
  const columns = json.data?.items?.[0]?.column_values || [];

  // Focus on the color form column + all lookup_ columns for easy review
  const focusId = 'lookup_mm4xws1a';
  const colorFormCol = columns.find(c => c.id === focusId);
  const lookupCols = columns.filter(c => c.id.startsWith('lookup_'));

  return res.status(200).json({
    orderId,
    colorFormColumn: colorFormCol || null,
    allLookupColumns: lookupCols,
    allColumns: columns,
  });
}
