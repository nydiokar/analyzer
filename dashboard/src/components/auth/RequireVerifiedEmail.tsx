'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Shield, Mail, Loader2 } from 'lucide-react';
import Link from 'next/link';

interface RequireVerifiedEmailProps {
  children: React.ReactNode;
  redirectTo?: string;
}

/**
 * Wrapper component that enforces email verification.
 * Shows a verification prompt if user is authenticated but not verified.
 * Redirects to home if user is not authenticated.
 */
export function RequireVerifiedEmail({ children, redirectTo = '/' }: RequireVerifiedEmailProps) {
  const { isAuthenticated, user, loading, requestEmailVerification } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push(redirectTo);
    }
  }, [isAuthenticated, loading, router, redirectTo]);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    return null; // Will redirect in useEffect
  }

  // Authenticated but not verified
  if (!user?.emailVerified) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4">
        <Card className="max-w-md w-full bg-slate-900/80 border-slate-800 backdrop-blur-sm">
          <div className="p-8 text-center space-y-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-blue-600/20 flex items-center justify-center">
              <Shield className="w-8 h-8 text-blue-400" />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-slate-100">
                Email Verification Required
              </h1>
              <p className="text-slate-400">
                Please verify your email address to access this feature. We sent a verification link to{' '}
                <span className="font-medium text-slate-200">{user?.email}</span>.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Button
                onClick={() => requestEmailVerification()}
                className="bg-blue-600 hover:bg-blue-500 text-white"
              >
                <Mail className="w-4 h-4 mr-2" />
                Resend Verification Email
              </Button>

              <Button
                asChild
                variant="ghost"
                className="text-slate-400 hover:text-slate-200"
              >
                <Link href="/">Back to Home</Link>
              </Button>
            </div>

            <p className="text-xs text-slate-500">
              Check your spam folder if you don't see the email.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  // Authenticated and verified - show the protected content
  return <>{children}</>;
}
