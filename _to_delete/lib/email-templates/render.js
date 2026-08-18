/**
 * renderEmail(triggerKey, context) — the one new seam application code will
 * talk to once the migration (Phase 5) is complete. See
 * Email-Template-System-Design.md §B.5.
 *
 * NOT YET WIRED UP: lib/email.js's 17 functions still send their existing
 * hardcoded HTML directly and do not call this yet. That cutover happens
 * template-by-template, each verified with a real test send, once the
 * database exists and the 17 current templates have been seeded as published
 * v1s (see the migration plan). This file is foundation, ready for that step.
 */

import { getPrisma } from './db';
import { getTrigger } from './triggers';
import { compileBlocks } from './blocks';

export class EmailRenderError extends Error {}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function resolveVariables(trigger, context) {
  const out = {};
  for (const variable of trigger.variables) {
    out[variable.path] = getPath(context, variable.path);
  }
  return out;
}

function interpolate(str, vars, trigger) {
  return String(str || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path) => {
    const known = trigger.variables.some(v => v.path === path);
    if (!known) {
      throw new EmailRenderError(`Template references an unknown/unavailable variable "{{${path}}}" for trigger "${trigger.key}".`);
    }
    const value = vars[path];
    if (value === undefined || value === null) {
      throw new EmailRenderError(`Variable "{{${path}}}" resolved to no value for trigger "${trigger.key}".`);
    }
    return String(value);
  });
}

/**
 * @param {string} triggerKey - a key from lib/email-templates/triggers.js
 * @param {object} context - nested object matching the trigger's variable paths, e.g. { customer: { first_name }, order: { number } }
 * @returns {Promise<{ subject: string, preheader: string, html: string, fromName: string, replyTo: string|null }>}
 */
export async function renderEmail(triggerKey, context) {
  const trigger = getTrigger(triggerKey);
  if (!trigger) throw new EmailRenderError(`Unknown trigger key "${triggerKey}".`);

  // Validate required variables are present in context before ever touching the DB —
  // a caller passing incomplete context fails fast and clearly.
  const missing = trigger.variables.filter(v => v.required && getPath(context, v.path) === undefined);
  if (missing.length) {
    throw new EmailRenderError(`Missing required variable(s) for trigger "${triggerKey}": ${missing.map(v => v.path).join(', ')}`);
  }

  const prisma = getPrisma();
  const template = await prisma.emailTemplate.findFirst({
    where: { triggerKey, isActive: true, deletedAt: null },
    include: { published: true },
  });

  if (!template || !template.published) {
    throw new EmailRenderError(`No published template for trigger "${triggerKey}".`);
  }

  const version = template.published;
  const vars = resolveVariables(trigger, context);

  const subject = interpolate(version.subject, vars, trigger);
  const preheader = interpolate(version.preheader || '', vars, trigger);
  const html = compileBlocks(version.bodyBlocks, vars);

  return {
    subject,
    preheader,
    html,
    fromName: version.fromName || 'Summit Sensory Gym',
    replyTo: version.replyTo || null,
  };
}
