'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Loader2, Mail } from 'lucide-react';

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { verifyEmail, isAuthenticated, user } = useAuth();

  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'already-verified'>('verifying');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    const token = searchParams.get('token');

    // Check if already verified
    if (isAuthenticated && user?.emailVerified) {
      setStatus('already-verified');
      return;
    }

    // If no token, show error
    if (!token) {
      setStatus('error');
      setErrorMessage('Invalid verification link. Please check your email and try again.');
      return;
    }

    // If not authenticated, redirect to login with return URL
    if (!isAuthenticated) {
      router.push(`/?verify-token=${token}`);
      return;
    }

    // Verify the email
    const verify = async () => {
      try {
        const success = await verifyEmail(token);
        if (success) {
          setStatus('success');
          // Redirect to landing page after 2 seconds (will redirect to /discover if authenticated)
          setTimeout(() => {
            router.push('/');
          }, 2000);
        } else {
          setStatus('error');
          setErrorMessage('Invalid or expired verification link. Please request a new verification email.');
        }
      } catch (error) {
        setStatus('error');
        setErrorMessage('An error occurred during verification. Please try again.');
      }
    };

    verify();
  }, [searchParams, isAuthenticated, user, verifyEmail, router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
      <Card className="max-w-md w-full bg-slate-900/80 border-slate-800 backdrop-blur-sm">
        <div className="p-8 text-center space-y-6">
          {status === 'verifying' && (
            <>
              <div className="mx-auto w-16 h-16 rounded-full bg-blue-600/20 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold text-slate-100">
                  Verifying your email...
                </h1>
                <p className="text-slate-400">
                  Please wait while we verify your email address.
                </p>
              </div>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="mx-auto w-16 h-16 rounded-full bg-green-600/20 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-400" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold text-slate-100">
                  Email verified!
                </h1>
                <p className="text-slate-400">
                  Your email has been successfully verified. You now have full access to all features.
                </p>
              </div>
              <p className="text-sm text-slate-500">
                Redirecting to dashboard...
              </p>
            </>
          )}

          {status === 'already-verified' && (
            <>
              <div className="mx-auto w-16 h-16 rounded-full bg-blue-600/20 flex items-center justify-center">
                <Mail className="w-8 h-8 text-blue-400" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold text-slate-100">
                  Already verified
                </h1>
                <p className="text-slate-400">
                  Your email address is already verified. You have full access to all features.
                </p>
              </div>
              <Button
                onClick={() => router.push('/')}
                className="bg-blue-600 hover:bg-blue-500 text-white"
              >
                Go to Dashboard
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="mx-auto w-16 h-16 rounded-full bg-red-600/20 flex items-center justify-center">
                <XCircle className="w-8 h-8 text-red-400" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold text-slate-100">
                  Verification failed
                </h1>
                <p className="text-slate-400">
                  {errorMessage}
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <Button
                  onClick={() => router.push('/settings')}
                  className="bg-blue-600 hover:bg-blue-500 text-white"
                >
                  Go to Settings
                </Button>
                <Button
                  onClick={() => router.push('/')}
                  variant="ghost"
                  className="text-slate-400 hover:text-slate-200"
                >
                  Back to Landing Page
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center p-4">
        <Card className="max-w-md w-full bg-slate-900/80 border-slate-800 backdrop-blur-sm">
          <div className="p-8 text-center space-y-6">
            <div className="mx-auto w-16 h-16 rounded-full bg-blue-600/20 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-slate-100">
                Loading...
              </h1>
            </div>
          </div>
        </Card>
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
