/**
 * Next.js instrumentation hook — wires every server error into
 * lib/errorAlerts.js (urgent email to Bryan). Node runtime only; the Edge
 * middleware has no Resend/util access and logs nothing worth alerting on.
 * Each import sits inside an `if (NEXT_RUNTIME === 'nodejs')` block so the
 * Edge build drops it entirely.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installConsoleCapture } = await import('./lib/errorAlerts');
    installConsoleCapture();
  }
}

export async function onRequestError(error, request, context) {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { reportError } = await import('./lib/errorAlerts');
    await reportError({
      source: `unhandled ${request.method} ${request.path}`,
      error,
      context: {
        route: context?.routePath,
        routeType: context?.routeType,
        digest: error?.digest,
      },
    });
  }
}
