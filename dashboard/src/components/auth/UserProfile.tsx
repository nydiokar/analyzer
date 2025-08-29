'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { UserIcon, Crown, Sparkles, Mail, Calendar, Shield, RefreshCw } from 'lucide-react';

interface UserProfileProps {
  className?: string;
}

export function UserProfile({ className }: UserProfileProps) {
  const { user, isDemoMode, refreshUserProfile, loading } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshProfile = async () => {
    setRefreshing(true);
    try {
      const success = await refreshUserProfile();
      if (success) {
        toast.success('Profile refreshed successfully');
      } else {
        toast.error('Failed to refresh profile');
      }
    } catch {
      toast.error('Failed to refresh profile');
    } finally {
      setRefreshing(false);
    }
  };

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!user) {
    return null;
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <UserIcon className="h-5 w-5" />
            User Profile
            <Badge 
              className={`ml-2 ${isDemoMode 
                ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' 
                : 'bg-purple-500/20 text-purple-400 border-purple-500/30'
              }`}
            >
              {isDemoMode ? (
                <>
                  <Sparkles className="w-3 h-3 mr-1" />
                  Demo Mode
                </>
              ) : (
                <>
                  <Crown className="w-3 h-3 mr-1" />
                  Full Access
                </>
              )}
            </Badge>
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshProfile}
            disabled={refreshing || loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        <CardDescription>
          Your account information and authentication status.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Basic Information */}
        <div className="grid gap-4">
          <div className="flex items-center gap-3">
            <Mail className="w-4 h-4 text-muted-foreground" />
            <div className="flex-1">
              <label className="text-sm font-medium text-muted-foreground">Email Address</label>
              <p className="text-sm font-mono">{user.email || 'Not provided'}</p>
            </div>
            {user.emailVerified && (
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                <Shield className="w-3 h-3 mr-1" />
                Verified
              </Badge>
            )}
          </div>

          <Separator />

          <div className="flex items-center gap-3">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <div className="flex-1">
              <label className="text-sm font-medium text-muted-foreground">Account Created</label>
              <p className="text-sm">{formatDate(user.createdAt)}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <div className="flex-1">
              <label className="text-sm font-medium text-muted-foreground">Last Login</label>
              <p className="text-sm">{formatDate(user.lastLoginAt)}</p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Account Status */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Account Status</h4>
          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Account Type</span>
              <span className="font-medium">
                {isDemoMode ? 'Demo Account' : 'Full Account'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Access Level</span>
              <span className="font-medium">
                {isDemoMode ? 'Limited (Demo Wallets Only)' : 'Unlimited'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Authentication Method</span>
              <span className="font-medium">JWT (Secure)</span>
            </div>
          </div>
        </div>

        {isDemoMode && (
          <>
            <Separator />
            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium text-blue-400">Demo Mode Active</span>
              </div>
              <p className="text-xs text-muted-foreground">
                You have access to curated demo wallets. Add your own API key in settings for full access to analyze any wallet.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}