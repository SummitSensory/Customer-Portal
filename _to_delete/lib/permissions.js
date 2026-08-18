/**
 * Permission checks for the Email Template Management System.
 * Integrates with the existing staff-auth model (lib/auth.js's isStaffEmail)
 * rather than building a parallel one — this only adds granularity on TOP of
 * "is this person staff at all," which is all the app has today.
 *
 * Four permissions: email_templates.view / .edit / .publish / .manage_system_templates.
 * view + edit are granted to every staff member by default (matches today's
 * "any staff can do everything" model for the rest of the app); publish and
 * manage_system_templates require an explicit grant in StaffPermission,
 * seeded for the initial admin(s) when Phase 0 setup runs.
 */

import { isStaffEmail } from './auth';
import { getPrisma } from './email-templates/db';

export const PERMISSIONS = {
  VIEW: 'EMAIL_TEMPLATES_VIEW',
  EDIT: 'EMAIL_TEMPLATES_EDIT',
  PUBLISH: 'EMAIL_TEMPLATES_PUBLISH',
  MANAGE_SYSTEM: 'EMAIL_TEMPLATES_MANAGE_SYSTEM',
};

const DEFAULT_GRANTED = new Set([PERMISSIONS.VIEW, PERMISSIONS.EDIT]);

export async function hasPermission(staffEmail, permission) {
  if (!isStaffEmail(staffEmail)) return false;
  if (DEFAULT_GRANTED.has(permission)) return true;

  try {
    const prisma = getPrisma();
    const grant = await prisma.staffPermission.findUnique({
      where: { staffEmail_permission: { staffEmail: staffEmail.toLowerCase(), permission } },
    });
    return Boolean(grant);
  } catch (err) {
    // Fail closed on publish/manage-system — a database hiccup should never
    // silently grant elevated access to templates that reach real customers.
    console.error('Permission check failed (failing closed):', err);
    return false;
  }
}
