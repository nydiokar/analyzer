'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Shield, Mail, X } from 'lucide-react';

export function EmailVerificationBanner() {
  const { user, isAuthenticated, requestEmailVerification, loading } = useAuth();
  const [isDismissed, setIsDismissed] = useState(false);

  // Only show for JWT authenticated users with unverified email
  if (!isAuthenticated || !user || user.emailVerified || isDismissed) {
    return null;
  }

  const handleRequestVerification = async () => {
    await requestEmailVerification();
  };

  return (
    <Card className="mb-4 border border-slate-800 bg-slate-900/80 shadow-sm">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-sky-300 mt-0.5 flex-shrink-0" />

          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-100">Email verification required</p>
                <p className="text-sm text-slate-400 mt-1">
                  Please check your email at <span className="font-medium text-slate-200">{user.email}</span> and click the verification link to unlock full access.
                </p>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsDismissed(true)}
                className="h-6 w-6 p-0 text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button
                onClick={handleRequestVerification}
                disabled={loading}
                size="sm"
                className="bg-sky-600 hover:bg-sky-500 text-white"
              >
                <Mail className="w-4 h-4 mr-2" />
                {loading ? 'Sending…' : 'Resend verification email'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
