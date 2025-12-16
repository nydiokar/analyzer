'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { User, Mail, Calendar, Clock, Trash2 } from 'lucide-react';

interface AccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const formatDate = (value?: string | null) => {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const getRelativeTime = (value?: string | null) => {
  if (!value) return 'Unknown';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }
  const now = new Date();
  const diffMs = now.getTime() - parsed.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
};

export function AccountModal({ open, onOpenChange }: AccountModalProps) {
  const { user } = useAuth();

  const handleClearCache = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      toast.success('Cache cleared successfully');
      onOpenChange(false);
      window.location.reload();
    } catch {
      toast.error('Failed to clear cache');
    }
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Account</DialogTitle>
          <DialogDescription>
            Your account information and preferences
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* User ID */}
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
              <User className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-muted-foreground mb-1">User ID</p>
              <p className="text-sm font-mono bg-muted px-3 py-2 rounded-md break-all">
                {user.id}
              </p>
            </div>
          </div>

          {/* Email */}
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
              <Mail className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-muted-foreground mb-1">Email</p>
              <p className="text-sm font-medium">{user.email}</p>
            </div>
          </div>

          {/* Member Since */}
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-green-500/10 text-green-500">
              <Calendar className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-muted-foreground mb-1">Member Since</p>
              <p className="text-sm font-medium">{formatDate(user.createdAt)}</p>
            </div>
          </div>

          {/* Last Active */}
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
              <Clock className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-muted-foreground mb-1">Last Active</p>
              <p className="text-sm font-medium">{getRelativeTime(user.lastLoginAt)}</p>
            </div>
          </div>

          {/* Clear Cache */}
          <div className="pt-4 border-t">
            <Button
              onClick={handleClearCache}
              variant="destructive"
              className="w-full"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Local Cache
            </Button>
            <p className="text-xs text-muted-foreground text-center mt-2">
              This will log you out and clear all local data
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
