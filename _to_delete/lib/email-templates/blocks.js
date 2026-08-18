/**
 * Compiles a template version's typed block list into email-safe HTML.
 *
 * Blocks are the ONLY way admin content becomes markup — this is what makes
 * sanitization structural rather than a scan-and-strip problem (see the
 * raw_html case below for the one deliberate, sanitizer-gated exception).
 * Conditions attach directly to a block and are evaluated against the
 * resolved variable bag with a small, allow-listed operator set — never
 * arbitrary expressions or code. See Email-Template-System-Design.md §B.3.
 */

import { sanitizeHtml, isSafeUrl } from './sanitize';

const C = {
  moss: '#475569', mossDark: '#334155', mossLt: '#F1F5F9',
  ink: '#111827', muted: '#6B7280', line: '#E5E7EB',
};
// NOTE: duplicated from lib/email.js's own C object rather than imported —
// that module's palette is private to its hand-built shell(). Worth unifying
// into one shared palette module during the Phase 5 cutover (see design doc).

function evalCondition(condition, vars) {
  if (!condition) return true;
  const value = vars[condition.field];
  switch (condition.operator) {
    case 'exists': return value !== undefined && value !== null && value !== '';
    case 'not_exists': return value === undefined || value === null || value === '';
    case 'truthy': return Boolean(value);
    case 'equals': return String(value) === String(condition.value);
    case 'not_equals': return String(value) !== String(condition.value);
    default: return true; // unknown operator — fail open to "show" rather than silently hiding content
  }
}

function fill(text, vars) {
  return String(text || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, path) => (vars[path] !== undefined && vars[path] !== null ? vars[path] : m));
}

function renderBlock(block, vars) {
  if (!evalCondition(block.condition, vars)) return '';

  switch (block.type) {
    case 'heading':
      return `<h2 style="font-family:Arial,sans-serif;font-size:20px;font-weight:800;color:${C.ink};margin:0 0 12px">${fill(block.text, vars)}</h2>`;

    case 'paragraph':
      return `<p style="font-family:Arial,sans-serif;font-size:15px;color:${C.ink};line-height:1.65;margin:0 0 14px">${fill(block.text, vars)}</p>`;

    case 'button': {
      const rawHref = fill(block.href, vars);
      const href = isSafeUrl(rawHref) ? rawHref : '#';
      return `<table cellpadding="0" cellspacing="0" border="0" style="margin:20px 0"><tr><td style="background:${C.moss};border-radius:10px"><a href="${href}" style="display:inline-block;padding:14px 28px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#fff;text-decoration:none">${fill(block.label, vars)} &rarr;</a></td></tr></table>`;
    }

    case 'divider':
      return `<div style="border-top:1px solid ${C.line};margin:24px 0"></div>`;

    case 'spacer': {
      const h = Number(block.height) || 16;
      return `<div style="height:${h}px;line-height:${h}px;font-size:0">&nbsp;</div>`;
    }

    case 'image': {
      const src = isSafeUrl(block.src) ? block.src : '';
      if (!src) return '';
      const alt = String(block.alt || '').replace(/"/g, '');
      return `<img src="${src}" alt="${alt}" style="max-width:100%;border-radius:8px;display:block;margin:0 0 14px" />`;
    }

    case 'list':
      return `<ul style="font-family:Arial,sans-serif;font-size:15px;color:${C.ink};line-height:1.65;margin:0 0 14px;padding-left:20px">${(block.items || []).map(i => `<li>${fill(i, vars)}</li>`).join('')}</ul>`;

    case 'callout':
      return `<div style="background:${C.mossLt};border-left:4px solid ${C.moss};border-radius:0 10px 10px 0;padding:14px 16px;margin:20px 0;font-family:Arial,sans-serif;font-size:14px;color:${C.ink}">${fill(block.text, vars)}</div>`;

    case 'component_ref':
      // Resolved by the caller (render.js) before compileBlocks runs, by
      // looking up the referenced EmailComponent and splicing its own
      // compiled blocks in as `resolvedHtml`.
      return block.resolvedHtml || '';

    case 'raw_html':
      // The one deliberate escape hatch (advanced mode). Sanitized here on
      // every render, in addition to sanitization at save time — never trust
      // a single pass.
      return sanitizeHtml(block.html || '');

    default:
      return '';
  }
}

export function compileBlocks(blocks, vars) {
  return (blocks || []).map(b => renderBlock(b, vars)).join('\n');
}
