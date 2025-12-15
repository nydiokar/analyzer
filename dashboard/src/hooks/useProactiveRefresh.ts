"use client";

import { useEffect } from "react";
import { sessionEvents } from "@/lib/session-events";
import { useAuthStore } from "@/store/auth-store";
import { createSecureStorage, TokenManager } from "@/lib/secure-storage";

// Local token manager instance pointing at the same underlying storage (cookies/local)
const proactiveTokenManager = new TokenManager(createSecureStorage());

/**
 * Proactively refresh 5 minutes before exp while the user is active.
 */
export const useProactiveRefresh = () => {
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const leadSeconds = 60; // refresh 1 minute before expiry (avoids 0ms loops on very short TTLs)
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
          sessionEvents.emitPreRefresh();
          const ok = await useAuthStore.getState().refreshToken();
          sessionEvents.emitPostRefresh(ok);
          if (!ok) {
            sessionEvents.emitExpired();
          } else {
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
