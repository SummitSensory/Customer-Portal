/**
 * Native Color & Product Selections picker — Phase 1 of the color-selection
 * redesign (replaces the Jotform iframe for supported product types; see
 * lib/colorRequirements.js for exactly which ones). Code-split via
 * next/dynamic in pages/portal/index.js, same pattern as ShowcaseTab.
 *
 * Every color shown here comes from lib/colorCatalog.js's real, verified
 * datasets — nothing is fabricated client-side, and every save is
 * server-validated (pages/api/portal/color-selection.js) before it can be
 * confirmed complete.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  listCardinalColors, listPrismaticColors, listVinylColors,
  cardinalFinishes, prismaticFamilies, prismaticFinishes, resolveSelectedColor, computeLineItemPricing,
  displayColorName, standardDesignation, findOrphanedSelections,
} from '../../lib/colorCatalog';
import { COLOR_INPUT, PART_LABELS } from '../../lib/colorRequirements';
import { createSaveQueue } from '../../lib/saveQueue';

const DEFAULT_API_BASE = '/api/portal/color-selection';

// apiBase lets a demo/preview surface point this exact component at a
// sandboxed endpoint instead of the real customer API — no separate copy
// of the picker to keep in sync, no risk of drifting from what customers
// actually get. See pages/portal/color-preview.js.
async function fetchSelection(apiBase) {
  const res = await fetch(apiBase);
  if (!res.ok) throw new Error('Failed to load color selections.');
  return res.json();
}

async function saveSelection(apiBase, body) {
  const res = await fetch(apiBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error saving. Please try again.');
  return data;
}

function partIsFilled(selections, inputKey, part) {
  return !!selections?.[inputKey]?.[part]?.code;
}

function inputIsComplete(input, selections) {
  return input.parts.every((p) => partIsFilled(selections, input.input, p));
}

// Where "Select & continue" lands: the rest of the parts in the input just
// worked on (in order, wrapping past any earlier ones that got skipped),
// then the next input on the checklist that still has something unfilled.
// Doesn't scan backwards past the starting input — that's what the
// checklist itself is for — this is only forward progress from where the
// customer just was.
function findNextIncompletePart(requiredInputs, selections, fromInputKey, fromPart) {
  const inputIdx = requiredInputs.findIndex((i) => i.input === fromInputKey);
  if (inputIdx === -1) return null;
  const fromInput = requiredInputs[inputIdx];
  const partIdx = fromInput.parts.indexOf(fromPart);
  const rest = [...fromInput.parts.slice(partIdx + 1), ...fromInput.parts.slice(0, partIdx)];
  const nextPart = rest.find((p) => !partIsFilled(selections, fromInputKey, p));
  if (nextPart) return { input: fromInput, part: nextPart };

  for (let i = inputIdx + 1; i < requiredInputs.length; i++) {
    const candidate = requiredInputs[i];
    const part = candidate.parts.find((p) => !partIsFilled(selections, candidate.input, p));
    if (part) return { input: candidate, part };
  }
  return null;
}

// What's already been picked for the OTHER parts of this same input — e.g.
// while choosing Horizontal Beams, what Legs was already set to. Direct
// requirement (2026-09-02): "if they pick white for the legs, I want them
// to be able to see that they picked white when they move on to the
// horizontal beams... eliminate a possible mistake of choosing the wrong
// white by accident." Scoped to this one input (not every input on the
// order) — that's the comparison that actually matters; unrelated inputs
// like Mat & Pad Color aren't a "did I pick the same white" risk.
function getOtherPicks(input, selections, currentPart) {
  return input.parts
    .filter((p) => p !== currentPart)
    .map((p) => ({ part: p, color: resolveSelectedColor(selections?.[input.input]?.[p]) }))
    .filter((p) => p.color);
}

// ── Swatch grid (brand-aware: cardinal photos, prismatic/vinyl flat swatches) ──
// REDESIGNED (real customer feedback from the preview, 2026-09-01): swatches
// were too small, every card wasn't the same size, and the "view larger"
// icon was absolutely-positioned — which let it drift outside the card
// entirely on some entries (a real layout bug, not just a style complaint).
// Every card is now a fixed, uniform-height column (image, name, code, then
// a full-width "View Larger" button in normal document flow — it can never
// escape its own card because it's no longer position:absolute) so the
// zoom action is impossible to miss and impossible to lose track of.
function SwatchGrid({ colors, selected, onSelect, onInspect, otherPicks = [] }) {
  if (!colors.length) {
    return <div className="empty"><p>No colors match your search.</p></div>;
  }
  return (
    <div className="cs-grid" role="listbox" aria-label="Color options">
      {colors.map((c) => {
        const isSelected = selected?.code === (c.code || c.sku || c.name) && selected?.brand === c.brand;
        const id = c.code || c.sku || c.name;
        // Direct requirement (2026-09-02): flag a swatch here that's an
        // exact match (same catalog code, not just the same display name —
        // two different codes can share a name, see displayColorName's own
        // header) for a color already picked on another part of this
        // input, so "is this the same white as Legs?" doesn't require an
        // eyeballed comparison against the reference strip above.
        const reusedFor = otherPicks.filter((op) => (op.color.code || op.color.sku || op.color.name) === id);
        return (
          <div className={`cs-card${isSelected ? ' selected' : ''}`} key={`${c.brand}-${id}`}>
            <button
              type="button"
              className="cs-card-select"
              role="option"
              aria-selected={isSelected}
              aria-label={`Select ${displayColorName(c)}${c.code ? `, code ${c.code}` : ''}${c.sku ? `, SKU ${c.sku}` : ''}${isSelected ? ' (currently selected)' : ''}`}
              onClick={() => onSelect(c)}
            >
              <div className="cs-card-swatch">
                {c.photo
                  ? <img className="cs-card-img" src={c.photo} alt="" loading="lazy" />
                  : <div className="cs-card-color" style={{ background: c.hex }} />}
                {isSelected && <span className="cs-card-check" aria-hidden="true">✓ Selected</span>}
              </div>
              <div className="cs-card-body">
                <div className="cs-card-name">{displayColorName(c)}</div>
                {(c.code || c.sku) && <div className="cs-card-code">{c.code || c.sku}</div>}
                {reusedFor.length > 0 && (
                  <div className="cs-card-reuse">Also used for {reusedFor.map((r) => PART_LABELS[r.part] || r.part).join(', ')}</div>
                )}
              </div>
            </button>
            <button
              type="button"
              className="cs-card-inspect"
              aria-label={`View ${displayColorName(c)} larger`}
              onClick={() => onInspect(c)}
            >🔍 View Larger</button>
          </div>
        );
      })}
    </div>
  );
}

// Confirms a pick and offers a one-click path to the next part still
// needing a color. Direct customer feedback (2026-09-02): "once they select
// a color, maybe add a button that pops up... that says 'select and
// continue'... saves them from hitting the back button" — and separately,
// something on-screen confirming the pick actually saved, not just the
// small checkmark on the swatch itself. Shown fresh after every click (see
// justPicked in the pickers below); "Keep browsing" just dismisses it in
// case they want to compare against another color instead of moving on.
function ContinueBar({ color, onContinue, onDismiss }) {
  return (
    <div className="cs-continue-bar" role="status">
      <span className="cs-continue-msg">✓ <strong>{displayColorName(color)}</strong> selected — saved</span>
      <div className="cs-continue-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss}>Keep browsing</button>
        <button type="button" className="btn btn-sun btn-sm" onClick={onContinue}>Select &amp; continue →</button>
      </div>
    </div>
  );
}

// Reference strip of what's already been picked for the other parts of
// this same input — always visible while browsing this part's grid, so a
// customer never has to leave the screen (or trust memory) to compare "is
// this the same white I picked for Legs?" Direct requirement (2026-09-02).
function PriorPicksStrip({ otherPicks }) {
  if (!otherPicks.length) return null;
  return (
    <div className="cs-prior-picks">
      <span className="cs-prior-picks-label">Already chosen for this input</span>
      <div className="cs-prior-picks-list">
        {otherPicks.map(({ part, color }) => (
          <div className="cs-prior-pick" key={part}>
            {color.photo
              ? <img className="cs-prior-pick-img" src={color.photo} alt="" />
              : <span className="cs-prior-pick-dot" style={{ background: color.hex }} />}
            <span className="cs-prior-pick-text">
              <span className="cs-prior-pick-part">{PART_LABELS[part] || part}</span>
              <span className="cs-prior-pick-name">
                {displayColorName(color)}
                {(color.code || color.sku) && <span className="cs-prior-pick-code">{color.code || color.sku}</span>}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InspectModal({ color, onClose }) {
  // Closes on Escape and keeps focus trapped on the close button while open
  // — the modal has exactly one focusable element, so trapping focus is
  // just "keep it there" rather than a full focus-cycle implementation.
  const closeBtnRef = useRef(null);
  useEffect(() => {
    if (!color) return;
    closeBtnRef.current?.focus();
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Tab') e.preventDefault(); // single focusable element — Tab can't leave it
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [color, onClose]);

  if (!color) return null;
  return (
    <div className="cs-modal-overlay" onClick={onClose} role="presentation">
      <div className="cs-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={displayColorName(color)}>
        <div style={{ position: 'relative' }}>
          {color.photo
            ? <img className="cs-modal-img" src={color.photo} alt={displayColorName(color)} />
            : <div className="cs-modal-color" style={{ background: color.hex }} />}
          <button type="button" className="cs-modal-close" ref={closeBtnRef} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="cs-modal-body">
          <h3 style={{ fontSize: 20, marginBottom: 6 }}>{displayColorName(color)}</h3>
          <p style={{ fontSize: 13.5, color: 'var(--mut)' }}>
            {color.code || color.sku}{color.finish ? ` · ${color.finish} finish` : ''}{color.family ? ` · ${color.family}` : ''}
            {standardDesignation(color) ? ` · ${standardDesignation(color)}` : ''}
          </p>
          {!color.photo && (
            <p style={{ fontSize: 12.5, color: 'var(--mut)', marginTop: 10 }}>
              Shown as a verified color swatch — a physical sample can be requested before you confirm.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── One structural part's picker (Cardinal/Prismatic toggle + search) ──
function StructurePartPicker({ part, selection, onChange, onBack, onContinue, input, selections }) {
  const [brand, setBrand] = useState(selection?.brand || 'cardinal');
  const [search, setSearch] = useState('');
  const [finish, setFinish] = useState('');
  const [family, setFamily] = useState('');
  const [inspecting, setInspecting] = useState(null);
  const [justPicked, setJustPicked] = useState(null);

  function handleSelect(c) {
    onChange({ brand: c.brand, code: c.code || c.sku });
    setJustPicked(c);
  }

  const otherPicks = useMemo(() => getOtherPicks(input, selections, part), [input, selections, part]);
  const cardinal = useMemo(() => listCardinalColors(), []);
  const prismatic = useMemo(() => listPrismaticColors(), []);
  const cardinalFinishOptions = useMemo(() => cardinalFinishes(), []);
  const prismaticFinishOptions = useMemo(() => prismaticFinishes(), []);
  const families = useMemo(() => prismaticFamilies(), []);

  // Switching brand resets both filters rather than carrying a stale value
  // across — Cardinal and Prismatic have entirely different finish option
  // sets (and only Prismatic has a family filter at all), so a value picked
  // under one brand has no meaning under the other.
  function handleBrandChange(next) {
    setBrand(next);
    setFinish('');
    setFamily('');
  }

  const list = brand === 'cardinal' ? cardinal : prismatic;
  const finishOptions = brand === 'cardinal' ? cardinalFinishOptions : prismaticFinishOptions;
  const filtered = list.filter((c) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || c.name.toLowerCase().includes(q) || (c.code || c.sku || '').toLowerCase().includes(q);
    const matchesFinish = !finish || c.finish === finish;
    const matchesFamily = brand !== 'prismatic' || !family || c.family === family;
    return matchesSearch && matchesFinish && matchesFamily;
  });

  return (
    <>
      <button type="button" className="lk" style={{ marginBottom: 14 }} onClick={onBack}>← Back to parts</button>
      <h3 style={{ fontSize: 16, marginBottom: 10 }}>{PART_LABELS[part] || part}</h3>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button type="button" className={`chip${brand === 'cardinal' ? ' on' : ''}`} onClick={() => handleBrandChange('cardinal')}>Cardinal Powder Coat</button>
        <button type="button" className={`chip${brand === 'prismatic' ? ' on' : ''}`} onClick={() => handleBrandChange('prismatic')}>Prismatic (+$500 first / +$300 each additional)</button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder={`Search ${brand === 'cardinal' ? 'Cardinal' : 'Prismatic'} colors or code…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        {brand === 'prismatic' && (
          <select value={family} onChange={(e) => setFamily(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">All color families</option>
            {families.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        <select value={finish} onChange={(e) => setFinish(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="">All finishes</option>
          {finishOptions.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      <PriorPicksStrip otherPicks={otherPicks} />
      <SwatchGrid
        colors={filtered}
        selected={selection}
        onSelect={handleSelect}
        onInspect={setInspecting}
        otherPicks={otherPicks}
      />
      <InspectModal color={inspecting} onClose={() => setInspecting(null)} />
      {justPicked && (
        <ContinueBar color={justPicked} onContinue={onContinue} onDismiss={() => setJustPicked(null)} />
      )}
    </>
  );
}

function MatPadPartPicker({ part, selection, onChange, onBack, onContinue, input, selections }) {
  const [search, setSearch] = useState('');
  const [inspecting, setInspecting] = useState(null);
  const [justPicked, setJustPicked] = useState(null);
  const list = useMemo(() => listVinylColors(), []);
  const filtered = list.filter((c) => !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()));
  const otherPicks = useMemo(() => getOtherPicks(input, selections, part), [input, selections, part]);

  function handleSelect(c) {
    onChange({ brand: 'vinyl', code: c.name });
    setJustPicked(c);
  }

  return (
    <>
      <button type="button" className="lk" style={{ marginBottom: 14 }} onClick={onBack}>← Back</button>
      <h3 style={{ fontSize: 16, marginBottom: 10 }}>{PART_LABELS[part] || part}</h3>
      <input
        type="text"
        placeholder="Search mat/pad colors…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 14, maxWidth: 320 }}
      />
      <PriorPicksStrip otherPicks={otherPicks} />
      <SwatchGrid
        colors={filtered}
        selected={selection}
        onSelect={handleSelect}
        onInspect={setInspecting}
        otherPicks={otherPicks}
      />
      <InspectModal color={inspecting} onClose={() => setInspecting(null)} />
      {justPicked && (
        <ContinueBar color={justPicked} onContinue={onContinue} onDismiss={() => setJustPicked(null)} />
      )}
    </>
  );
}

// ── One input's part list (e.g. all 6 Structure & Frame Paint parts) ──
// requiredInputs is the FULL checklist, not just this one input — pricing
// (which Prismatic selection counts as "first" vs "additional") depends on
// order across the whole selection set, so the per-part amount shown here
// has to come from the same computeLineItemPricing() the summary uses,
// not a separately-derived number that could disagree with it.
function InputPartList({ input, requiredInputs, selections, onOpenPart, onBack }) {
  const lines = computeLineItemPricing(requiredInputs, selections);
  const lineFor = (part) => lines.find((l) => l.inputKey === input.input && l.part === part);

  return (
    <>
      <button type="button" className="lk" style={{ marginBottom: 14 }} onClick={onBack}>← Back to checklist</button>
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>{input.label}</h3>
      <p style={{ fontSize: 13, color: 'var(--mut)', marginBottom: 6 }}>
        Select a color for each part below. Your choices save automatically.
      </p>
      <div>
        {input.parts.map((part) => {
          const color = resolveSelectedColor(selections?.[input.input]?.[part]);
          const line = lineFor(part);
          return (
            <div className="cs-part-card" key={part}>
              <div className="cs-part-head">
                <div className="cs-part-title">{PART_LABELS[part] || part}</div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenPart(part)}>
                  {color ? 'Change color' : 'Choose a color →'}
                </button>
              </div>
              {color && (
                <div className="cs-part-selected">
                  {color.photo
                    ? <img src={color.photo} alt="" style={{ width: 28, height: 28, borderRadius: 5, objectFit: 'cover' }} />
                    : <span className="dot" style={{ background: color.hex, width: 20, height: 20 }} />}
                  {/* Direct customer feedback (2026-09-02): brand and any
                      added cost weren't showing on the same line as the
                      name — they're now all one row, with the code kept on
                      its own separate line underneath rather than folded
                      into the name string. */}
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                      <span className="cs-summary-brand" style={{ fontWeight: 600 }}>{line?.selection?.brand}</span>
                      <span style={{ fontWeight: 600 }}>{displayColorName(color)}</span>
                      {line?.amount > 0 && (
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--moss-dk)' }}>+${line.amount.toLocaleString()}</span>
                      )}
                    </span>
                    {(color.code || color.sku) && <span style={{ fontSize: 11.5, color: 'var(--mut)', fontFamily: 'monospace' }}>{color.code || color.sku}</span>}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Checklist (index screen) ──
function Checklist({ requiredInputs, selections, onOpenInput, onReview, allComplete }) {
  return (
    <>
      {/* Direct customer feedback (2026-09-01): "I need there to be a way
          for a customer to be confident that their color choices have been
          saved, in case they want to come back and complete the form at a
          later time." This banner states that plainly; the per-part "✓
          selected" state below it (and on return visits) is the actual
          proof, not just words. */}
      <div className="cs-saved-banner">
        <span>💾</span>
        <span>Your progress saves automatically as you go — you can leave and come back anytime before confirming.</span>
      </div>
      {requiredInputs.map((input) => {
        const done = inputIsComplete(input, selections);
        const filledCount = input.parts.filter((p) => partIsFilled(selections, input.input, p)).length;
        return (
          <button
            type="button"
            key={input.input}
            className={`cs-checklist-item${done ? ' done' : ''}`}
            onClick={() => onOpenInput(input)}
          >
            <span className="cs-ci-icon" aria-hidden="true">{done ? '✓' : '🎨'}</span>
            <span className="cs-ci-body">
              <span className="t">{input.label}</span>
              <span className="d">{done ? 'All colors selected' : `${filledCount} of ${input.parts.length} selected`}</span>
            </span>
            <span className="cs-ci-count">{filledCount}/{input.parts.length}</span>
          </button>
        );
      })}
      <div style={{ marginTop: 20 }}>
        <button type="button" className="btn btn-moss" disabled={!allComplete} onClick={onReview}>
          {allComplete ? 'Review & Confirm →' : 'Complete every input to continue'}
        </button>
      </div>
    </>
  );
}

// ── Summary / confirm screen ──
// REDESIGNED (real customer feedback, 2026-09-01): the summary now shows
// brand / name / code as distinct fields (not one blended string), a
// per-line dollar amount on the right, a running total, and a clear
// up-front warning that selections lock once confirmed — all directly
// requested, none of it guessed at.
function Summary({ requiredInputs, selections, onConfirm, onBack, confirming }) {
  const lines = computeLineItemPricing(requiredInputs, selections);
  const total = lines.reduce((sum, l) => sum + l.amount, 0);

  return (
    <>
      <button type="button" className="lk" style={{ marginBottom: 14 }} onClick={onBack}>← Back</button>
      <h3 style={{ fontSize: 17, marginBottom: 14 }}>Review your selections</h3>

      <div className="cs-lock-notice">
        <span>🔒</span>
        <span><b>Once confirmed, these selections cannot be changed</b> — please review every part carefully before confirming. Contact us if you need help.</span>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="cs-summary-header">
          <span>Part</span><span>Color</span><span>Code</span><span style={{ textAlign: 'right' }}>Amount</span>
        </div>
        {lines.map((line) => (
          <div className="cs-summary-row" key={`${line.inputKey}-${line.part}`}>
            <span className="cs-summary-part">{PART_LABELS[line.part] || line.part}</span>
            <span>
              {line.color ? (
                <>
                  <span className="cs-summary-brand">{line.selection.brand}</span> — {displayColorName(line.color)}
                </>
              ) : '—'}
            </span>
            <span className="cs-summary-code">{line.color ? (line.color.code || line.color.sku || '—') : '—'}</span>
            <span className="cs-summary-amount">{line.amount > 0 ? `$${line.amount.toLocaleString()}` : '—'}</span>
          </div>
        ))}
        <div className="cs-summary-total">
          <span>Total color upcharge</span>
          <span>${total.toLocaleString()}</span>
        </div>
      </div>
      <div className="alert info">
        <span>ℹ️</span>
        <span>Your selections will be reviewed by our team before manufacturing begins.</span>
      </div>
      <button type="button" className="btn btn-moss" disabled={confirming} onClick={onConfirm}>
        {confirming ? 'Confirming…' : 'Confirm Selections — This Cannot Be Undone'}
      </button>
    </>
  );
}

// ── Running total, visible the whole time selections are being made ──
// Direct customer feedback (2026-09-02): the running total only showed up
// on the final Review screen — customers need to see the additional cost
// building up AS they pick colors, not just at the very end. Rendered in
// the header (mounted for every screen except the final Summary/confirmed
// views, which already show the full breakdown), so it updates the instant
// a Prismatic selection is made — using the same computeLineItemPricing the
// Summary and ConfirmedView use, so it can never disagree with the real
// total.
function RunningTotal({ total }) {
  if (total <= 0) return null;
  return (
    <div className="cs-running-total">
      <span aria-hidden="true">💰</span>
      <span>Additional cost so far: <strong>${total.toLocaleString()}</strong></span>
    </div>
  );
}

// ── Locked, read-only view once selections are confirmed ──
// Direct customer requirement (2026-09-01): selections cannot be modified
// after submission. This is the client-side face of that — the server
// independently enforces the same rule (pages/api/portal/color-selection.js
// rejects any further write once confirmedAt is set), so this view can't
// drift into showing an editable UI the backend would just reject anyway.
function ConfirmedView({ requiredInputs, selections, confirmedAt }) {
  const lines = computeLineItemPricing(requiredInputs, selections);
  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  // Real bug found by independent code review (2026-09-02) — the exact same
  // gap already fixed on the admin side: requiredInputs reflects the
  // order's CURRENT productType only. If productType is edited on Monday
  // after a customer confirmed, their real selections are still sitting in
  // the snapshot under the OLD productType's part keys — `lines` above
  // would show every row as "—" and $0 total, making a customer's own paid,
  // confirmed order look like nothing was ever picked, on the one screen
  // that's supposed to be the permanent record of what they chose.
  const orphans = findOrphanedSelections(requiredInputs, selections);
  return (
    <>
      <div className="alert success" style={{ marginBottom: 16 }}>
        <span>✅</span>
        <span>Confirmed on {new Date(confirmedAt).toLocaleDateString()} — these selections are locked and can&apos;t be changed here. Contact us if you need help.</span>
      </div>
      <div className="card">
        <div className="cs-summary-header">
          <span>Part</span><span>Color</span><span>Code</span><span style={{ textAlign: 'right' }}>Amount</span>
        </div>
        {lines.map((line) => (
          <div className="cs-summary-row" key={`${line.inputKey}-${line.part}`}>
            <span className="cs-summary-part">{PART_LABELS[line.part] || line.part}</span>
            <span>{line.color ? (<><span className="cs-summary-brand">{line.selection.brand}</span> — {line.color.name}</>) : '—'}</span>
            <span className="cs-summary-code">{line.color ? (line.color.code || line.color.sku || '—') : '—'}</span>
            <span className="cs-summary-amount">{line.amount > 0 ? `$${line.amount.toLocaleString()}` : '—'}</span>
          </div>
        ))}
        <div className="cs-summary-total">
          <span>Total color upcharge</span>
          <span>${total.toLocaleString()}</span>
        </div>
      </div>
      {orphans.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="cs-summary-header">
            <span>Part</span><span>Color</span><span>Code</span><span></span>
          </div>
          {orphans.map(({ inputKey, partKey, color }) => (
            <div className="cs-summary-row" key={`${inputKey}-${partKey}`}>
              <span className="cs-summary-part">{PART_LABELS[partKey] || partKey}</span>
              <span>{displayColorName(color)}</span>
              <span className="cs-summary-code">{color.code || color.sku || '—'}</span>
              <span></span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function ColorSelectionTab({ order, completions, markComplete, showToast, onNext, onBack, apiBase = DEFAULT_API_BASE }) {
  const [loading, setLoading] = useState(true);
  // FIXED (real bug, found via a live report on the preview deployment
  // 2026-09-01): a failed initial fetch (e.g. a 500 from the API) left
  // requiredInputs at its default [] and silently fell into the exact same
  // "not yet available for your product type" card as a genuinely
  // unsupported productType — indistinguishable to whoever's looking at it.
  // The actual cause that day (NEXTAUTH_SECRET unset on that deployment,
  // confirmed via Vercel's real runtime logs) had nothing to do with
  // product-type support at all, but the UI had no way to say so. loadError
  // tracks that distinction explicitly now.
  const [loadError, setLoadError] = useState(false);
  const [requiredInputs, setRequiredInputs] = useState([]);
  const [selections, setSelections] = useState({});
  // Direct customer requirement (2026-09-01): "color selection changes are
  // unable to be modified once they have been submitted." confirmedAt
  // drives a read-only view once set — enforced server-side too (see
  // pages/api/portal/color-selection.js), this is the client-side half so
  // a customer sees a locked, informative screen instead of just having
  // their edits silently rejected.
  const [confirmedAt, setConfirmedAt] = useState(null);
  const [view, setView] = useState('checklist'); // 'checklist' | { input } | 'summary'
  const [activePart, setActivePart] = useState(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    // Deliberately depends only on order?.id, not showToast: showToast is a
    // plain function re-created on every render of the parent portal (it's
    // not wrapped in useCallback there), so including it here would refetch
    // — and flash the loading spinner over whatever the customer is
    // currently doing — on every unrelated parent re-render (a new message
    // arriving, the mobile nav toggling, etc.), not just when the order
    // actually changes. Caught in review before this shipped.
    let cancelled = false;
    setLoadError(false);
    fetchSelection(apiBase)
      .then((data) => {
        if (cancelled) return;
        setRequiredInputs(data.requiredInputs || []);
        const loaded = data.selections || {};
        latestSelectionsRef.current = loaded;
        setSelections(loaded);
        setConfirmedAt(data.confirmedAt || null);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        showToast('Could not load color selection data. Please refresh.');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  const allComplete = requiredInputs.length > 0 && requiredInputs.every((i) => inputIsComplete(i, selections));

  // Recomputed on every render from live `selections` state — no separate
  // running counter to keep in sync, so it can never drift from what the
  // Summary/ConfirmedView total says once the customer gets there.
  const runningTotal = useMemo(
    () => computeLineItemPricing(requiredInputs, selections).reduce((sum, l) => sum + l.amount, 0),
    [requiredInputs, selections]
  );

  // Saves are serialized through a ref-based queue: rapid sequential
  // selections (or a slow network) could otherwise let an older, in-flight
  // full-snapshot write resolve AFTER a newer one and silently overwrite it
  // — a real race caught in review, since the API always replaces the whole
  // snapshot rather than patching. This guarantees only one request is ever
  // in flight, and it always carries the latest selections at send time,
  // never a value captured from a stale closure.
  // Updated synchronously wherever selections change (never only from a
  // useEffect keyed on the `selections` state) — a ref refreshed via effect
  // lags one render behind a setState call, and the queue's getter can run
  // (as a microtask) before that lagged effect has caught up, sending a
  // stale snapshot on exactly the rapid-selection case this exists to fix.
  const latestSelectionsRef = useRef(selections);
  const enqueueSaveRef = useRef(null);
  if (!enqueueSaveRef.current) enqueueSaveRef.current = createSaveQueue((body) => saveSelection(apiBase, body));

  const queueSave = useCallback((confirm) => {
    return enqueueSaveRef.current(() => ({ selections: latestSelectionsRef.current, confirm }));
  }, []);

  const handlePartChange = useCallback(async (inputKey, part, value) => {
    // Real gap found by independent code review (2026-09-02): a failed
    // autosave only ever showed a toast — the optimistic UI update below
    // was never rolled back, so the swatch kept showing "✓ Selected" for a
    // pick the server never actually saved. Captured here so a failure can
    // revert JUST this one part back to what it was, not the customer's
    // whole selection set: a later, unrelated edit could already be sitting
    // in latestSelectionsRef by the time this save's failure is handled
    // (the queue serializes SAVES, not the instant optimistic UI update),
    // and reverting the entire snapshot would silently discard that too.
    const previousValue = latestSelectionsRef.current[inputKey]?.[part];
    const next = {
      ...latestSelectionsRef.current,
      [inputKey]: { ...latestSelectionsRef.current[inputKey], [part]: value },
    };
    latestSelectionsRef.current = next;
    setSelections(next);
    try {
      await queueSave(false);
    } catch (err) {
      const reverted = {
        ...latestSelectionsRef.current,
        [inputKey]: { ...latestSelectionsRef.current[inputKey], [part]: previousValue },
      };
      latestSelectionsRef.current = reverted;
      setSelections(reverted);
      showToast(err.message || 'Error saving — your last pick was not saved. Please try again.');
    }
  }, [queueSave, showToast]);

  // Drives "Select & continue" — jumps straight to the next part still
  // needing a color instead of leaving the customer to find their own way
  // back via Back → part list → next part. Reads latestSelectionsRef (not
  // the possibly-one-render-behind `selections` state) for the same
  // stale-snapshot reason queueSave does.
  const handleContinueAfterSelect = useCallback((inputKey, part) => {
    const snapshot = latestSelectionsRef.current;
    const next = findNextIncompletePart(requiredInputs, snapshot, inputKey, part);
    if (next) {
      setView(next.input);
      setActivePart(next.part);
      return;
    }
    if (requiredInputs.every((i) => inputIsComplete(i, snapshot))) {
      setView('summary');
      return;
    }
    setView(requiredInputs.find((i) => i.input === inputKey) || 'checklist');
    setActivePart(null);
  }, [requiredInputs]);

  async function handleConfirm() {
    setConfirming(true);
    try {
      // Goes through the same queue as autosave, not a separate direct
      // call — guarantees the confirm write can never race ahead of (or
      // behind) a still-in-flight autosave from a selection made moments
      // earlier.
      const result = await queueSave(true);
      markComplete('color', !result.checklistSyncPending);
      setConfirmedAt(new Date().toISOString());
      showToast(result.checklistSyncPending
        ? 'Saved — confirming with our system now. This may take a moment to show as complete.'
        : 'Color selections confirmed.');
      onNext();
    } catch (err) {
      showToast(err.message || 'Error saving. Please try again.');
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return <div className="card"><div className="empty"><div className="spin" style={{ margin: '0 auto' }} /></div></div>;
  }

  if (loadError) {
    return (
      <div className="card">
        <div className="empty">
          <div className="ei">⚠️</div>
          <h3>Couldn&apos;t load your color options</h3>
          <p>Something went wrong loading this page — not a sign your product type is unsupported. Please refresh, and contact us if it keeps happening.</p>
        </div>
      </div>
    );
  }

  if (!requiredInputs.length) {
    return (
      <div className="card">
        <div className="empty">
          <div className="ei">🎨</div>
          <h3>Color selection not yet available</h3>
          <p>Your product type isn&apos;t configured for the online color picker yet — our team will reach out with next steps.</p>
        </div>
      </div>
    );
  }

  let body;
  if (confirmedAt) {
    body = <ConfirmedView requiredInputs={requiredInputs} selections={selections} confirmedAt={confirmedAt} />;
  } else if (view === 'summary') {
    body = (
      <Summary
        requiredInputs={requiredInputs}
        selections={selections}
        onConfirm={handleConfirm}
        onBack={() => setView('checklist')}
        confirming={confirming}
      />
    );
  } else if (view !== 'checklist' && activePart) {
    const input = view;
    const PartPicker = input.input === COLOR_INPUT.MAT_PAD_COLOR ? MatPadPartPicker : StructurePartPicker;
    body = (
      <PartPicker
        key={`${input.input}-${activePart}`}
        part={activePart}
        input={input}
        selections={selections}
        selection={selections?.[input.input]?.[activePart]}
        onChange={(value) => handlePartChange(input.input, activePart, value)}
        onBack={() => setActivePart(null)}
        onContinue={() => handleContinueAfterSelect(input.input, activePart)}
      />
    );
  } else if (view !== 'checklist') {
    body = (
      <InputPartList
        input={view}
        requiredInputs={requiredInputs}
        selections={selections}
        onOpenPart={setActivePart}
        onBack={() => setView('checklist')}
      />
    );
  } else {
    body = (
      <Checklist
        requiredInputs={requiredInputs}
        selections={selections}
        onOpenInput={(input) => { setView(input); setActivePart(null); }}
        onReview={() => setView('summary')}
        allComplete={allComplete}
      />
    );
  }

  return (
    <>
      <div className="ph">
        <h2>Color & Product Selections</h2>
        <p>Choose your equipment colors and finishes — real colors, real photos where available.</p>
      </div>
      {/* Summary and the confirmed view already show the full priced
          breakdown, so the compact badge is redundant there — every other
          screen (checklist, an input's part list, an individual color
          picker) gets it. */}
      {!confirmedAt && view !== 'summary' && <RunningTotal total={runningTotal} />}
      {body}
      {(confirmedAt || view === 'checklist') && (
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        </div>
      )}
    </>
  );
}
