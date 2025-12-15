import { useAuthStore } from "@/store/auth-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";
import { replayLastFailedRequest } from "@/lib/fetcher";
import { sessionEvents } from "@/lib/session-events";

interface SessionExpiredModalProps {
  open: boolean;
  onClose: () => void;
}

// Simple modal prompting re-login without forcing navigation
export function SessionExpiredModal({ open, onClose }: SessionExpiredModalProps) {
  const authStore = useAuthStore();
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState(authStore.user?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preRefreshing, setPreRefreshing] = useState(false);

  useEffect(() => {
    // Listen for proactive refreshes to surface a lightweight spinner if desired
    const unsubPre = sessionEvents.onPreRefresh(() => setPreRefreshing(true));
    const unsubPost = sessionEvents.onPostRefresh((ok) => setPreRefreshing(false));
    if (!open) {
      setLoading(false);
      setError(null);
      setPassword("");
      setPreRefreshing(false);
    }
    return () => {
      unsubPre();
      unsubPost();
    };
  }, [open]);

  const handleReauth = async () => {
    setLoading(true);
    setError(null);
    const success = await login({ email, password });
    setLoading(false);
    if (success) {
      onClose();
      // Replay the last failed request if available
      try {
        await replayLastFailedRequest();
      } catch {
        // If replay fails, we silently ignore; user can retry action manually.
      }
    } else {
      setError("Sign-in failed. Please check your credentials.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Session expired</DialogTitle>
          <DialogDescription>
            Your login session ended. Please sign in again to continue where you left off.
          </DialogDescription>
        </DialogHeader>
        {preRefreshing && (
          <div className="rounded-md bg-accent/30 border border-border/50 px-3 py-2 text-sm text-muted-foreground">
            Attempting to refresh your session…
          </div>
        )}
        <div className="space-y-3">
          <Input
            autoFocus
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
          />
          <Input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-3">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Keep browsing
          </Button>
          <Button onClick={handleReauth} disabled={loading || !email || !password}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
