"use client";

import { useEffect } from "react";
import { sessionEvents } from "@/lib/session-events";
import { useAuthStore } from "@/store/auth-store";
import { tokenManager } from "@/lib/secure-storage";

/**
 * Proactively refresh 5 minutes before exp while the user is active.
 */
export const useProactiveRefresh = () => {
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      const token = tokenManager.getAccessToken();
      if (!token) return;
      try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        const now = Date.now() / 1000;
        if (!payload.exp) return;
        const msUntilRefresh = Math.max((payload.exp - now - 300) * 1000, 0);
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
