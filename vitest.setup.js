// lib/auth.js throws at import time if NEXTAUTH_SECRET is unset (a
// deliberate fail-loud safety check, not a bug — see PLAN-14 finding 001).
// Tests need *a* value to import anything that touches auth, but it must
// never be a real secret.
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-only-not-a-real-secret';
