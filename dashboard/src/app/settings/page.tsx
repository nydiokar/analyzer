'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UserIcon, Shield, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';

const formatDate = (value?: string | null) => {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '--';
  }
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export default function SettingsPage() {
  const { user, isAuthenticated, isInitialized, logout, requestEmailVerification } = useAuth();
  const router = useRouter();
  const [resendingVerification, setResendingVerification] = useState(false);

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  const handleResendVerification = async () => {
    if (resendingVerification) return;
    setResendingVerification(true);
    try {
      const success = await requestEmailVerification();
      if (success) {
        toast.success('Verification email sent');
      } else {
        toast.error('Unable to send verification email. Please try again.');
      }
    } finally {
      setResendingVerification(false);
    }
  };

  if (!isAuthenticated && !isInitialized) {
    return <div className="p-6 text-sm text-slate-500">Loading settings...</div>;
  }

  if (!isAuthenticated) {
    return (
      <AppShell>
        <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
          <header className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground mt-1">
              Sign in to manage your Sova Intel account.
            </p>
          </header>

        <Card>
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>
              You need to be signed in to view or change account details.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row gap-3">
            <Button asChild className="w-full sm:w-auto">
              <Link href="/">Return to home</Link>
            </Button>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href="/help">Visit documentation</Link>
            </Button>
          </CardContent>
        </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">
            Review your account details and manage your current session.
          </p>
        </header>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserIcon className="h-5 w-5" />
              Account Details
            </CardTitle>
            <CardDescription>
              Basic information associated with your authenticated profile.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Email</p>
              <p className="text-base">{user?.email ?? '--'}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Member since</p>
                <p className="text-base">{formatDate(user?.createdAt)}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Last activity</p>
                <p className="text-base">{formatDate(user?.lastLoginAt)}</p>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Verification</p>
              <p className="text-base">
                {user?.emailVerified ? 'Email verified' : 'Pending verification'}
              </p>
              {!user?.emailVerified && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <p className="text-sm text-slate-400">
                    Check your inbox or resend a link to verify your account.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleResendVerification}
                    disabled={resendingVerification}
                  >
                    {resendingVerification ? 'Sending…' : 'Resend verification email'}
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Session & Security
            </CardTitle>
            <CardDescription>
              Manage this session. Password reset tools are coming soon.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Need to use a different account? Sign out below and return to the dashboard to log in
              again.
            </p>
            <Button onClick={handleLogout} variant="destructive" className="w-full sm:w-auto">
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
      </div>
    </AppShell>
  );
}
