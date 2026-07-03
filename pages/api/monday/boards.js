/**
 * GET /api/monday/boards         — list all boards (admin settings)
 * GET /api/monday/boards?columns=1&id=... — get columns for a specific board
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '../auth/[...nextauth]';
import { listBoards, getBoardColumns } from '../../../lib/monday';

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: 'Not authenticated.' });

  if (req.method !== 'GET') return res.status(405).end();

  try {
    if (req.query.columns) {
      const columns = await getBoardColumns(req.query.id);
      return res.status(200).json({ columns });
    }

    const boards = await listBoards();
    return res.status(200).json({ boards });
  } catch (err) {
    console.error('Boards API error:', err);
    return res.status(500).json({ error: 'Failed to connect to Monday.com.' });
  }
}
