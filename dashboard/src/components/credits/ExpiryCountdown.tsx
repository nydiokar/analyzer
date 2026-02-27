'use client';

import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface ExpiryCountdownProps {
  expiresAt: string;
  onExpired: () => void;
  /** If true, shows a larger/more prominent display */
  prominent?: boolean;
}

export function ExpiryCountdown({ expiresAt, onExpired, prominent = false }: ExpiryCountdownProps) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  );
  const onExpiredRef = React.useRef(onExpired);
  useEffect(() => { onExpiredRef.current = onExpired; }, [onExpired]);

  useEffect(() => {
    if (secondsLeft <= 0) {
      onExpiredRef.current();
      return;
    }
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          onExpiredRef.current();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const isUrgent = secondsLeft < 60;

  if (prominent) {
    return (
      <div className={`flex items-center gap-2 text-sm ${isUrgent ? 'text-orange-400' : 'text-muted-foreground'}`}>
        <Clock className="h-4 w-4" />
        <span>
          Session expires in{' '}
          <span className={`font-mono font-semibold ${isUrgent ? 'text-orange-400' : 'text-foreground'}`}>
            {mins}:{String(secs).padStart(2, '0')}
          </span>
        </span>
      </div>
    );
  }

  return (
    <p className="text-xs text-muted-foreground">
      Expires in{' '}
      <span className={isUrgent ? 'text-orange-400 font-mono' : 'font-mono'}>
        {mins}:{String(secs).padStart(2, '0')}
      </span>
    </p>
  );
}
