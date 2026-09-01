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
  cardinalFinishes, prismaticFamilies, prismaticUpcharge,
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

// ── Swatch grid (brand-aware: cardinal photos, prismatic/vinyl flat swatches) ──
function SwatchGrid({ colors, selected, onSelect, onInspect }) {
  if (!colors.length) {
    return <div className="empty"><p>No colors match your search.</p></div>;
  }
  return (
    <div className="cs-grid" role="listbox" aria-label="Color options">
      {colors.map((c) => {
        const isSelected = selected?.code === (c.code || c.sku || c.name) && selected?.brand === c.brand;
        const id = c.code || c.sku || c.name;
        return (
          <div className="cs-swatch-wrap" key={`${c.brand}-${id}`}>
            <button
              type="button"
              className={`cs-swatch${isSelected ? ' selected' : ''}`}
              role="option"
              aria-selected={isSelected}
              aria-label={`${c.name}${c.code ? `, code ${c.code}` : ''}${c.sku ? `, SKU ${c.sku}` : ''}${isSelected ? ', selected' : ''}`}
              onClick={() => onSelect(c)}
            >
              {c.photo
                ? <img className="cs-swatch-img" src={c.photo} alt="" />
                : <div className="cs-swatch-color" style={{ background: c.hex }} />}
              <div className="cs-swatch-body">
                <div className="cs-swatch-name">{c.name}</div>
                {(c.code || c.sku) && <div className="cs-swatch-code">{c.code || c.sku}</div>}
              </div>
            </button>
            {isSelected && <span className="cs-swatch-check" aria-hidden="true">✓</span>}
            <button
              type="button"
              className="cs-swatch-inspect"
              aria-label={`Inspect ${c.name} up close`}
              onClick={(e) => { e.stopPropagation(); onInspect(c); }}
            >🔍</button>
          </div>
        );
      })}
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
      <div className="cs-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={color.name}>
        <div style={{ position: 'relative' }}>
          {color.photo
            ? <img className="cs-modal-img" src={color.photo} alt={color.name} />
            : <div className="cs-modal-color" style={{ background: color.hex }} />}
          <button type="button" className="cs-modal-close" ref={closeBtnRef} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="cs-modal-body">
          <h3 style={{ fontSize: 16, marginBottom: 4 }}>{color.name}</h3>
          <p style={{ fontSize: 12.5, color: 'var(--mut)' }}>
            {color.code || color.sku}{color.finish ? ` · ${color.finish} finish` : ''}{color.family ? ` · ${color.family}` : ''}
          </p>
          {!color.photo && (
            <p style={{ fontSize: 12, color: 'var(--mut)', marginTop: 10 }}>
              Shown as a verified color swatch — a physical sample can be requested before you confirm.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── One structural part's picker (Cardinal/Prismatic toggle + search) ──
function StructurePartPicker({ part, selection, onChange, onBack }) {
  const [brand, setBrand] = useState(selection?.brand || 'cardinal');
  const [search, setSearch] = useState('');
  const [finish, setFinish] = useState('');
  const [family, setFamily] = useState('');
  const [inspecting, setInspecting] = useState(null);

  const cardinal = useMemo(() => listCardinalColors(), []);
  const prismatic = useMemo(() => listPrismaticColors(), []);
  const finishes = useMemo(() => cardinalFinishes(), []);
  const families = useMemo(() => prismaticFamilies(), []);

  const list = brand === 'cardinal' ? cardinal : prismatic;
  const filtered = list.filter((c) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || c.name.toLowerCase().includes(q) || (c.code || c.sku || '').toLowerCase().includes(q);
    const matchesFinish = brand !== 'cardinal' || !finish || c.finish === finish;
    const matchesFamily = brand !== 'prismatic' || !family || c.family === family;
    return matchesSearch && matchesFinish && matchesFamily;
  });

  return (
    <>
      <button type="button" className="lk" style={{ marginBottom: 14 }} onClick={onBack}>← Back to parts</button>
      <h3 style={{ fontSize: 16, marginBottom: 10 }}>{PART_LABELS[part] || part}</h3>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button type="button" className={`chip${brand === 'cardinal' ? ' on' : ''}`} onClick={() => setBrand('cardinal')}>Cardinal Powder Coat</button>
        <button type="button" className={`chip${brand === 'prismatic' ? ' on' : ''}`} onClick={() => setBrand('prismatic')}>Prismatic (+$500 first / +$300 each additional)</button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder={`Search ${brand === 'cardinal' ? 'Cardinal' : 'Prismatic'} colors or code…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        {brand === 'cardinal' && (
          <select value={finish} onChange={(e) => setFinish(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">All finishes</option>
            {finishes.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        {brand === 'prismatic' && (
          <select value={family} onChange={(e) => setFamily(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">All color families</option>
            {families.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
      </div>

      <SwatchGrid
        colors={filtered}
        selected={selection}
        onSelect={(c) => onChange({ brand: c.brand, code: c.code || c.sku })}
        onInspect={setInspecting}
      />
      <InspectModal color={inspecting} onClose={() => setInspecting(null)} />
    </>
  );
}

function MatPadPartPicker({ part, selection, onChange, onBack }) {
  const [search, setSearch] = useState('');
  const [inspecting, setInspecting] = useState(null);
  const list = useMemo(() => listVinylColors(), []);
  const filtered = list.filter((c) => !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()));

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
      <SwatchGrid
        colors={filtered}
        selected={selection}
        onSelect={(c) => onChange({ brand: 'vinyl', code: c.name })}
        onInspect={setInspecting}
      />
      <InspectModal color={inspecting} onClose={() => setInspecting(null)} />
    </>
  );
}

// ── One input's part list (e.g. all 6 Structure & Frame Paint parts) ──
function InputPartList({ input, selections, onOpenPart, onBack }) {
  const findColor = (part) => {
    const sel = selections?.[input.input]?.[part];
    if (!sel) return null;
    if (sel.brand === 'cardinal') return listCardinalColors().find((c) => c.code === sel.code);
    if (sel.brand === 'prismatic') return listPrismaticColors().find((c) => c.sku === sel.code);
    if (sel.brand === 'vinyl') return listVinylColors().find((c) => c.name === sel.code);
    return null;
  };

  return (
    <>
      <button type="button" className="lk" style={{ marginBottom: 14 }} onClick={onBack}>← Back to checklist</button>
      <h3 style={{ fontSize: 17, marginBottom: 4 }}>{input.label}</h3>
      <p style={{ fontSize: 13, color: 'var(--mut)', marginBottom: 6 }}>
        Select a color for each part below. Your choices save automatically.
      </p>
      <div>
        {input.parts.map((part) => {
          const color = findColor(part);
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
                    ? <img src={color.photo} alt="" style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} />
                    : <span className="dot" style={{ background: color.hex }} />}
                  <span>{color.name}{color.code || color.sku ? ` — ${color.code || color.sku}` : ''}</span>
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
function Summary({ requiredInputs, selections, onConfirm, onBack, confirming }) {
  const findColor = (inputKey, sel) => {
    if (!sel) return null;
    if (sel.brand === 'cardinal') return listCardinalColors().find((c) => c.code === sel.code);
    if (sel.brand === 'prismatic') return listPrismaticColors().find((c) => c.sku === sel.code);
    if (sel.brand === 'vinyl') return listVinylColors().find((c) => c.name === sel.code);
    return null;
  };

  let prismaticCount = 0;
  for (const input of requiredInputs) {
    if (input.input !== COLOR_INPUT.STRUCTURE_FRAME_PAINT) continue;
    for (const part of input.parts) {
      if (selections?.[input.input]?.[part]?.brand === 'prismatic') prismaticCount++;
    }
  }
  const total = prismaticUpcharge(prismaticCount);

  return (
    <>
      <button type="button" className="lk" style={{ marginBottom: 14 }} onClick={onBack}>← Back</button>
      <h3 style={{ fontSize: 17, marginBottom: 14 }}>Review your selections</h3>
      <div className="card" style={{ marginBottom: 16 }}>
        {requiredInputs.map((input) => (
          <div key={input.input}>
            <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: '.03em', color: 'var(--mut)', marginTop: 10, marginBottom: 4 }}>
              {input.label}
            </div>
            {input.parts.map((part) => {
              const color = findColor(input.input, selections?.[input.input]?.[part]);
              return (
                <div className="cs-summary-row" key={part}>
                  <span>{PART_LABELS[part] || part}</span>
                  <span>{color ? `${color.name}${color.code || color.sku ? ` (${color.code || color.sku})` : ''}` : '—'}</span>
                </div>
              );
            })}
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
        {confirming ? 'Confirming…' : 'Confirm Selections'}
      </button>
    </>
  );
}

export default function ColorSelectionTab({ order, completions, markComplete, showToast, onNext, onBack, apiBase = DEFAULT_API_BASE }) {
  const [loading, setLoading] = useState(true);
  const [requiredInputs, setRequiredInputs] = useState([]);
  const [selections, setSelections] = useState({});
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
    fetchSelection(apiBase)
      .then((data) => {
        if (cancelled) return;
        setRequiredInputs(data.requiredInputs || []);
        const loaded = data.selections || {};
        latestSelectionsRef.current = loaded;
        setSelections(loaded);
      })
      .catch(() => showToast('Could not load color selection data. Please refresh.'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  const allComplete = requiredInputs.length > 0 && requiredInputs.every((i) => inputIsComplete(i, selections));

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
    const next = {
      ...latestSelectionsRef.current,
      [inputKey]: { ...latestSelectionsRef.current[inputKey], [part]: value },
    };
    latestSelectionsRef.current = next;
    setSelections(next);
    try {
      await queueSave(false);
    } catch (err) {
      showToast(err.message || 'Error saving. Please try again.');
    }
  }, [queueSave, showToast]);

  async function handleConfirm() {
    setConfirming(true);
    try {
      // Goes through the same queue as autosave, not a separate direct
      // call — guarantees the confirm write can never race ahead of (or
      // behind) a still-in-flight autosave from a selection made moments
      // earlier.
      const result = await queueSave(true);
      markComplete('color', !result.checklistSyncPending);
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
  if (view === 'summary') {
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
        part={activePart}
        selection={selections?.[input.input]?.[activePart]}
        onChange={(value) => handlePartChange(input.input, activePart, value)}
        onBack={() => setActivePart(null)}
      />
    );
  } else if (view !== 'checklist') {
    body = (
      <InputPartList
        input={view}
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
      {completions.color && <div className="alert success" style={{ marginBottom: 16 }}>✅ Color selections submitted.</div>}
      {body}
      {view === 'checklist' && (
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}>← Back</button>
        </div>
      )}
    </>
  );
}
