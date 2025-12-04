'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Shield, Mail, X, KeyRound } from 'lucide-react';
import { toast } from 'sonner';

export function EmailVerificationBanner() {
  const { user, isAuthenticated, requestEmailVerification, verifyEmail, loading } = useAuth();
  const [verificationToken, setVerificationToken] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Only show for JWT authenticated users with unverified email
  if (!isAuthenticated || !user || user.emailVerified || isDismissed) {
    return null;
  }

  const handleRequestVerification = async () => {
    const success = await requestEmailVerification();
    if (success) {
      setShowTokenInput(true);
    }
  };

  const handleVerifyEmail = async () => {
    if (!verificationToken.trim()) {
      toast.error('Please enter the verification token');
      return;
    }

    setIsVerifying(true);
    const success = await verifyEmail(verificationToken.trim());
    if (success) {
      setVerificationToken('');
      setShowTokenInput(false);
    }
    setIsVerifying(false);
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
                  We sent a verification link to <span className="font-medium text-slate-200">{user.email}</span>.
                  Verify your address to unlock full access.
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
                {loading ? 'Sending…' : 'Send verification email'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-300 hover:text-slate-100"
                onClick={() => setShowTokenInput(!showTokenInput)}
              >
                <KeyRound className="w-4 h-4 mr-2" />
                {showTokenInput ? 'Hide manual token entry' : 'Enter token manually'}
              </Button>
            </div>

            {showTokenInput && (
              <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <p className="text-xs text-slate-400">
                  If email delivery isn’t configured yet, copy the verification token from the server logs and paste it below.
                </p>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="Enter verification token"
                    value={verificationToken}
                    onChange={(e) => setVerificationToken(e.target.value)}
                    className="flex-1 h-9 text-sm"
                    disabled={isVerifying}
                  />
                  <Button
                    onClick={handleVerifyEmail}
                    disabled={isVerifying || !verificationToken.trim()}
                    size="sm"
                  >
                    {isVerifying ? 'Verifying…' : 'Verify'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
