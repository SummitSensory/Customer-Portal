/**
 * Next.js middleware — protects /portal and /admin routes.
 * - /portal requires a valid customer session cookie
 * - /admin requires a valid NextAuth staff session
 */

import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  // ── Staff routes (/admin) ─────────────────────────────────────────────────
  if (pathname.startsWith('/admin')) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return NextResponse.next();
  }

  // ── Customer routes (/portal) ─────────────────────────────────────────────
  if (pathname.startsWith('/portal')) {
    const sessionCookie = req.cookies.get('summit_customer_session')?.value;
    if (!sessionCookie) {
      return NextResponse.redirect(new URL('/', req.url));
    }
    // Note: full JWT verification happens in the API route handlers.
    // Middleware just checks the cookie exists for a fast redirect.
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/portal/:path*'],
};
