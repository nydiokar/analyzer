"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/auth-store";
import { useUIStore } from "@/store/ui-store";
import { createSecureStorage, TokenManager } from "@/lib/secure-storage";
import { toast } from "sonner";

// Local token manager instance pointing at the same underlying storage (cookies/local)
const proactiveTokenManager = new TokenManager(createSecureStorage());

/**
 * Proactively refresh 5 minutes before expiry while the user is active.
 * Industry standard: refresh tokens silently in the background without user interruption.
 */
export const useProactiveRefresh = () => {
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const leadSeconds = 300; // refresh 5 minutes before expiry (industry standard buffer)
    const minDelayMs = 15_000; // never schedule faster than 15s to avoid throttling

    const schedule = () => {
      const token = proactiveTokenManager.getAccessToken();
      if (!token) return;
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        const now = Date.now() / 1000;
        if (!payload.exp) return;
        const secondsUntilRefresh = payload.exp - now - leadSeconds;
        const msUntilRefresh = Math.max(secondsUntilRefresh * 1000, minDelayMs);
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(async () => {
          // Check if still authenticated before attempting refresh
          const authState = useAuthStore.getState();
          if (!authState.isAuthenticated || authState.isUsingApiKey) {
            return; // Skip proactive refresh if not authenticated or using API key
          }

          const ok = await authState.refreshToken();
          if (!ok) {
            // Only show error if refresh token is actually expired (not just network issues)
            const refreshToken = proactiveTokenManager.getRefreshToken();
            if (!refreshToken) {
              // Show auth modal instead of redirecting
              // Note: logout() is already called by refreshToken() when it gets 401
              const uiStore = useUIStore.getState();

              // Only show modal if not already showing
              if (!uiStore.showAuthModal) {
                uiStore.setShowAuthModal(true, 'session_expired');
                toast.error("Your session has expired. Please log in to continue.");
              }
            }
            // For network errors, we'll retry on next focus/visibility change
          } else {
            // Silent success - no toast needed for smooth UX
            schedule();
          }
        }, msUntilRefresh);
      } catch {
        // ignore malformed token
      }
    };

    // Schedule on mount and when tab regains focus
    schedule();
    const onFocus = () => schedule();
    const onVisibility = () => {
      if (document.visibilityState === "visible") schedule();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timeout) clearTimeout(timeout);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
};
