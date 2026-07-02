/**
 * GET /api/settings/forms
 * Returns the Jotform form map for the current customer's product type.
 * The full map is stored in JOTFORM_FORM_MAP env var (JSON).
 *
 * Format of JOTFORM_FORM_MAP:
 * {
 *   "formId": {
 *     "name": "Site Assessment",
 *     "description": "Required before installation",
 *     "productTypes": ["Sensory Gym Package"],   // optional; omit = all products
 *     "completed": false   // runtime state — set via webhook
 *   }
 * }
 */

import { parse } from 'cookie';
import { verifyCustomerSession, SESSION_COOKIE } from '../../../lib/auth';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';

export default async function handler(req, res) {
  // Allow both customers and staff to read form config
  const cookies = parse(req.headers.cookie || '');
  const customerSession = await verifyCustomerSession(cookies[SESSION_COOKIE]);
  const staffSession = await getServerSession(req, res, authOptions);
  if (!customerSession && !staffSession) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    const map = JSON.parse(process.env.JOTFORM_FORM_MAP || '{}');
    return res.status(200).json(map);
  } catch {
    return res.status(200).json({});
  }
}
