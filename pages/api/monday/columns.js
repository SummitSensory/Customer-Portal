/**
 * GET /api/monday/columns — returns all column definitions for the board
 * Used by the admin column picker.
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { getBoardColumns } from '../../../lib/monday';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  if (req.method !== 'GET') return res.status(405).end();

  try {
    const columns = await getBoardColumns();
    // Filter out column types that don't have useful text values
    const filtered = columns.filter(c =>
      !['formula', 'subtasks', 'board_relation', 'dependency'].includes(c.type)
    );
    return res.status(200).json({ columns: filtered });
  } catch (err) {
    console.error('columns error:', err);
    return res.status(500).json({ error: 'Failed to load columns.' });
  }
}
