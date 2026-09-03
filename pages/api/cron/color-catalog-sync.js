// GET /api/cron/color-catalog-sync
//
// Re-pulls Cardinal's live color-chart page on a schedule and reports any
// drift against lib/data/cardinalColors.json (added, removed, or renamed
// colors) — the repull requirement Bryan asked for directly (2026-09-01),
// since both catalogs are hand-maintained data with no live API (see
// lib/colorCatalogSync.js's header comment for the full detail, including
// why Prismatic is NOT covered by this job — its site changed to a
// client-rendered storefront a server fetch can't scrape).
//
// This job never auto-applies a detected change to lib/data/cardinalColors.json
// — a new color still needs its photo/hex sourced the same real way the
// original 131 were (pixel-sampled from Cardinal's own photo), which is a
// one-time data task, not something safe to infer blindly on a schedule.
// It only alerts a human when something changed, so nothing sits
// undetected between manual catalog refreshes.
//
// vercel.json schedule: daily (see §10 of the Implementation Plan — a
// default proposed for Bryan to confirm or adjust, not yet set in stone).

import { syncCardinalCatalog } from '../../../lib/colorCatalogSync';
import { reportCriticalFailure } from '../../../lib/monitoring';

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const result = await syncCardinalCatalog();
    const changed = result.added.length + result.removed.length + result.changed.length;

    console.log(
      `Color catalog sync summary: liveCount=${result.liveCount} storedCount=${result.storedCount} ` +
      `added=${result.added.length} removed=${result.removed.length} changed=${result.changed.length}`
    );

    // Only alert when there's actually something for a human to act on —
    // same "don't alert on a normal run" philosophy as
    // cron/accessory-tracking-sync.js and lib/monitoring.js generally.
    if (changed > 0) {
      await reportCriticalFailure(
        'cron/color-catalog-sync',
        `Cardinal's live color chart no longer matches the stored catalog: ` +
        `${result.added.length} new, ${result.removed.length} removed, ${result.changed.length} renamed. ` +
        `New colors need their photo/hex sourced (same pixel-sampling process as the original 131) before they can be added to lib/data/cardinalColors.json.`,
        { added: result.added, removed: result.removed, changed: result.changed }
      );
    }

    return res.status(200).json({
      ok: true,
      liveCount: result.liveCount,
      storedCount: result.storedCount,
      added: result.added.length,
      removed: result.removed.length,
      changed: result.changed.length,
      prismaticSynced: result.prismaticSynced,
      prismaticNote: result.prismaticNote,
    });
  } catch (err) {
    console.error('Color catalog sync failed:', err.message);
    await reportCriticalFailure(
      'cron/color-catalog-sync',
      'Color catalog sync run failed before completing — likely Cardinal\'s page structure changed, or the site is unreachable.',
      { error: err.message }
    );
    return res.status(500).json({ error: 'Sync failed.' });
  }
}
