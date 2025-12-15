"use client";

import { ReactNode, useEffect, useState } from "react";
import { SessionExpiredModal } from "@/components/shared/SessionExpiredModal";
import { sessionEvents } from "@/lib/session-events";

// Listens for session-expired events (emitted by fetcher) and shows a re-login modal.
export const SessionGuardProvider = ({ children }: { children: ReactNode }) => {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const unsubscribe = sessionEvents.onExpired(() => setExpired(true));
    return unsubscribe;
  }, []);

  return (
    <>
      {children}
      <SessionExpiredModal open={expired} onClose={() => setExpired(false)} />
    </>
  );
};
