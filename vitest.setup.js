// lib/auth.js throws at import time if NEXTAUTH_SECRET is unset (a
// deliberate fail-loud safety check, not a bug — see PLAN-14 finding 001).
// Tests need *a* value to import anything that touches auth, but it must
// never be a real secret.
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-only-not-a-real-secret';

// Adds the jest-dom matchers (toBeInTheDocument, toHaveTextContent, etc.) to
// vitest's `expect` globally. Safe to import unconditionally even for the
// large majority of test files that never render anything — it only
// extends `expect`, and vitest.config.js's default `environment: 'node'`
// is unaffected (a component test opts into jsdom per-file via a
// `// @vitest-environment jsdom` docblock at the top of that one file, not
// globally, so every existing node-environment test is untouched).
import '@testing-library/jest-dom/vitest';
