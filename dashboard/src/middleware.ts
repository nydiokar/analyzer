import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that require authentication
const protectedRoutes = [
  '/wallets',
  '/similarity-lab',
  '/tools',
  '/admin',
  '/trackers',
  '/discover',
];

// Routes that require email verification
const verifiedOnlyRoutes = [
  '/wallets',
  '/similarity-lab',
  '/tools',
];

// Public routes (accessible without auth)
const publicRoutes = ['/', '/help', '/verify', '/settings', '/reset-password'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (publicRoutes.some((route) => pathname === route || pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Check if route requires authentication
  const isProtectedRoute = protectedRoutes.some((route) => pathname.startsWith(route));

  if (isProtectedRoute) {
    // Check for auth token in cookies (matches TokenManager cookie name)
    const authToken = request.cookies.get('analyzer.access_token')?.value;
    const authHeader = request.headers.get('authorization');

    // If no auth token, redirect to landing page with redirect parameter
    if (!authToken && !authHeader) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      url.searchParams.set('redirect', pathname);
      return NextResponse.redirect(url);
    }

    // Note: Email verification is not enforced at middleware level
    // Users can access protected routes even without verified email
    // EmailVerificationBanner in AppShell shows a reminder to verify
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
