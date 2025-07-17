'use client';

import { Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface WebSocketStatusProps {
  isConnected: boolean;
  error?: string | null;
  className?: string;
  variant?: 'badge' | 'icon' | 'full';
}

export function WebSocketStatus({ 
  isConnected, 
  error, 
  className = '',
  variant = 'icon'
}: WebSocketStatusProps) {
  const getStatusIcon = () => {
    if (error) {
      return <AlertTriangle className="h-3 w-3 text-red-500" />;
    }
    return isConnected ? 
      <Wifi className="h-3 w-3 text-green-500" /> : 
      <WifiOff className="h-3 w-3 text-orange-500" />;
  };

  const getStatusText = () => {
    if (error) return 'Connection Error';
    return isConnected ? 'Real-time' : 'Polling';
  };

  const getStatusColor = () => {
    if (error) return 'destructive';
    return isConnected ? 'default' : 'secondary';
  };

  const getTooltipText = () => {
    if (error) return `WebSocket Error: ${error}`;
    return isConnected ? 
      'Connected - Real-time updates enabled' : 
      'Disconnected - Using polling fallback';
  };

  if (variant === 'badge') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant={getStatusColor()} className={className}>
              <div className="flex items-center gap-1">
                {getStatusIcon()}
                <span>{getStatusText()}</span>
              </div>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>{getTooltipText()}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (variant === 'full') {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        {getStatusIcon()}
        <span className="text-xs text-muted-foreground">
          {getStatusText()}
        </span>
      </div>
    );
  }

  // Default icon variant
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={className}>
            {getStatusIcon()}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{getTooltipText()}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
} 