'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { AlertTriangle, Mail, Shield, X } from 'lucide-react';
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
    <Card className="border-orange-500/30 bg-orange-500/10 mb-4">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-400 mt-0.5 flex-shrink-0" />
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-orange-400">Email Verification Required</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsDismissed(true)}
                className="h-6 w-6 p-0 text-orange-400 hover:text-orange-300"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            <p className="text-sm text-orange-200 mb-3">
              Please verify your email address ({user.email}) to access full functionality. Until verified, you're in demo mode with limited features.
            </p>
            
            {!showTokenInput ? (
              <Button
                onClick={handleRequestVerification}
                disabled={loading}
                size="sm"
                className="bg-orange-600 hover:bg-orange-700 text-white"
              >
                <Mail className="w-4 h-4 mr-2" />
                {loading ? 'Sending...' : 'Send Verification Email'}
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-blue-500/20 border border-blue-500/30 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Mail className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-medium text-blue-400">Development Mode</span>
                  </div>
                  <p className="text-xs text-blue-200">
                    If email service is configured, check your email. Otherwise, check server console/logs for the verification token.
                  </p>
                </div>
                
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="Enter verification token (from server logs)"
                    value={verificationToken}
                    onChange={(e) => setVerificationToken(e.target.value)}
                    className="flex-1 h-9 text-sm bg-background/50"
                    disabled={isVerifying}
                  />
                  <Button
                    onClick={handleVerifyEmail}
                    disabled={isVerifying || !verificationToken.trim()}
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {isVerifying ? 'Verifying...' : 'Verify'}
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