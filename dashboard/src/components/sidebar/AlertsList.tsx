"use client";

import { useAlerts, useNotifications, deleteAlert, markAllNotificationsRead } from '@/hooks/useAlerts';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { AlertCreator } from '@/components/alerts/AlertCreator';
import { TokenBadge } from '@/components/shared/TokenBadge';
import { Button } from '@/components/ui/button';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bell, BellOff, Trash2, Loader2, Info, AlertTriangle, TrendingUp, TrendingDown, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface AlertsListProps {
  isCollapsed: boolean;
}

export function AlertsList({ isCollapsed }: AlertsListProps) {
  const { userId, isLoading: userLoading } = useCurrentUser();
  const { data: alerts, error, isLoading, mutate } = useAlerts(userId || '');
  const { data: notifications, mutate: mutateNotifications } = useNotifications(userId || '');

  const [alertToDelete, setAlertToDelete] = useState<string | null>(null);
  const [showCreator, setShowCreator] = useState(false);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  const unreadCount = notifications?.filter(n => !n.isRead).length || 0;

  // Mark all notifications as read when popover opens
  useEffect(() => {
    if (isPopoverOpen && userId && unreadCount > 0) {
      markAllNotificationsRead(userId)
        .then(() => {
          mutateNotifications(); // Refresh notifications list
        })
        .catch((error) => {
          console.error('Failed to mark notifications as read:', error);
        });
    }
  }, [isPopoverOpen, userId, unreadCount, mutateNotifications]);

  // Group alerts by token address
  const groupedAlerts = useMemo(() => {
    const groups = new Map<string, any[]>();

    for (const alert of alerts || []) {
      const existing = groups.get(alert.tokenAddress) || [];
      existing.push(alert);
      groups.set(alert.tokenAddress, existing);
    }

    return Array.from(groups.entries()).map(([tokenAddress, tokenAlerts]) => ({
      tokenAddress,
      alerts: tokenAlerts,
      tokenInfo: tokenAlerts[0]?.TokenInfo,
      totalTriggers: tokenAlerts.reduce((sum, a) => sum + a.triggerCount, 0),
    }));
  }, [alerts]);

  const handleDelete = async (alertId: string) => {
    try {
      await deleteAlert(alertId);
      toast.success("Alert deleted");
      mutate();
      setAlertToDelete(null);
    } catch (error) {
      toast.error("Failed to delete alert");
    }
  };

  const renderAlertCondition = (alert: any) => {
    const condition = alert.condition;
    const currentPrice = alert.TokenInfo?.priceUsd;
    const targetValue = condition?.value;
    const isAbove = condition?.operator === 'gt';
    const isPercentage = condition?.type === 'percentage';

    // Calculate trigger price for percentage alerts
    let triggerPrice: string | null = null;
    if (isPercentage && alert.baselinePrice) {
      const baseline = parseFloat(alert.baselinePrice);
      const multiplier = isAbove ? (1 + targetValue / 100) : (1 - targetValue / 100);
      triggerPrice = (baseline * multiplier).toFixed(baseline >= 1 ? 2 : baseline >= 0.01 ? 4 : 6);
    }

    return (
      <div className="flex items-center justify-between p-2 rounded bg-muted/30 group/alert">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isAbove ? (
            <TrendingUp className="h-3 w-3 text-green-500 flex-shrink-0" />
          ) : (
            <TrendingDown className="h-3 w-3 text-red-500 flex-shrink-0" />
          )}
          <div className="flex flex-col min-w-0 text-xs flex-1">
            <span className="font-medium truncate">
              {isPercentage ? (
                <>
                  {isAbove ? '+' : '-'}<span className="text-primary font-bold">{targetValue}%</span>
                  {triggerPrice && (
                    <span className="text-muted-foreground ml-1">(${triggerPrice})</span>
                  )}
                </>
              ) : (
                <>
                  {isAbove ? '>' : '<'} <span className="text-primary font-bold">${targetValue}</span>
                </>
              )}
            </span>
            {currentPrice && (
              <span className="text-muted-foreground font-mono text-[10px]">
                Now: ${currentPrice}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {alert.triggerCount > 0 && (
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="secondary" className="text-xs px-2 py-0 h-4 gap-1">
                    <Zap className="h-2.5 w-2.5" />
                    {alert.triggerCount}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent><p>Triggered {alert.triggerCount} time{alert.triggerCount > 1 ? 's' : ''}</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 text-muted-foreground hover:text-destructive flex-shrink-0 opacity-0 group-hover/alert:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAlertToDelete(alert.id);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>Delete</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    );
  };

  const renderTokenGroup = (group: any) => {
    const { tokenAddress, alerts: tokenAlerts, tokenInfo, totalTriggers } = group;
    const symbol = tokenInfo?.symbol || 'Unknown';
    const name = tokenInfo?.name || 'Unknown Token';

    // Single alert - render inline
    if (tokenAlerts.length === 1) {
      const alert = tokenAlerts[0];
      const condition = alert.condition;
      const currentPrice = alert.TokenInfo?.priceUsd;
      const targetValue = condition?.value;
      const isAbove = condition?.operator === 'gt';
      const isPercentage = condition?.type === 'percentage';

      return (
        <div
          key={tokenAddress}
          className="group relative grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 p-3 rounded-md border bg-background/95 hover:bg-accent/30 transition-all duration-150"
        >
          {/* Left column: Token Badge + Price info */}
          <div className="flex items-center gap-2 min-w-0">
            <TokenBadge
              mint={tokenAddress}
              size="sm"
              metadata={{
                symbol: tokenInfo?.symbol,
                name: tokenInfo?.name,
                imageUrl: tokenInfo?.imageUrl,
              }}
            />
            <div className="flex flex-col min-w-0 text-xs">
              <div className="flex items-center gap-1">
                {isAbove ? (
                  <TrendingUp className="h-3 w-3 text-green-500 flex-shrink-0" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-red-500 flex-shrink-0" />
                )}
                <span className="font-medium truncate">
                  {isPercentage ? (
                    <>
                      {isAbove ? '+' : '-'}<span className="text-primary font-bold">{targetValue}%</span>
                    </>
                  ) : (
                    <>
                      {isAbove ? '>' : '<'} <span className="text-primary font-bold">${targetValue}</span>
                    </>
                  )}
                </span>
              </div>
              {currentPrice && (
                <span className="text-muted-foreground font-mono">
                  Now: ${currentPrice}
                </span>
              )}
            </div>
          </div>

          {/* Right column: Trigger count + Delete button */}
          <div className="flex items-center gap-2">
            {alert.triggerCount > 0 && (
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="secondary" className="text-xs px-2 py-0 h-5 gap-1">
                      <Zap className="h-3 w-3" />
                      {alert.triggerCount}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent><p>Triggered {alert.triggerCount} time{alert.triggerCount > 1 ? 's' : ''}</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => setAlertToDelete(alert.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>Delete</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      );
    }

    // Multiple alerts - use accordion
    return (
      <Accordion type="single" collapsible key={tokenAddress} className="border rounded-md bg-background/95">
        <AccordionItem value={tokenAddress} className="border-0">
          <AccordionTrigger className="px-3 py-2 hover:bg-accent/30 hover:no-underline rounded-md">
            <div className="flex items-center justify-between min-w-0 flex-1 pr-2">
              <div className="flex items-center gap-2 min-w-0">
                <TokenBadge
                  mint={tokenAddress}
                  size="sm"
                  metadata={{
                    symbol: tokenInfo?.symbol,
                    name: tokenInfo?.name,
                    imageUrl: tokenInfo?.imageUrl,
                  }}
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {tokenAlerts.length} alert{tokenAlerts.length > 1 ? 's' : ''}
                </span>
              </div>
              {totalTriggers > 0 && (
                <Badge variant="secondary" className="text-xs px-2 py-0 h-4 gap-1 flex-shrink-0">
                  <Zap className="h-2.5 w-2.5" />
                  {totalTriggers}
                </Badge>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-2 space-y-1">
            {tokenAlerts.map((alert: any) => (
              <div key={alert.id}>{renderAlertCondition(alert)}</div>
            ))}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    );
  };

  const renderContent = () => {
    if (userLoading || isLoading) {
      return (
        <div className="p-6 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">Loading alerts...</p>
        </div>
      );
    }

    if (!userId) {
      return (
        <div className="p-6 text-center">
          <Info className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-2">Please add an API Key</p>
          <Link href="/settings" className="text-sm text-primary hover:underline font-medium">
            Go to Settings
          </Link>
        </div>
      );
    }

    if (error) {
      return (
        <div className="p-6 text-center text-destructive">
          <AlertTriangle className="h-8 w-8 mx-auto mb-3" />
          <p className="text-sm font-medium">Failed to load alerts</p>
          <p className="text-xs text-muted-foreground mt-1">Please try again</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Alert Creator */}
        {showCreator ? (
          <div className="p-3 border-2 border-dashed border-primary/50 rounded-lg bg-primary/5">
            <AlertCreator
              userId={userId}
              onCreated={() => {
                setShowCreator(false);
                mutate();
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              className="w-full mt-3"
              onClick={() => setShowCreator(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 border-2 border-dashed hover:border-primary hover:bg-primary/5"
            onClick={() => setShowCreator(true)}
          >
            <Bell className="h-4 w-4" />
            Create New Alert
          </Button>
        )}

        {/* Alerts List - Grouped by Token */}
        <div className="space-y-2">
          {groupedAlerts && groupedAlerts.length > 0 ? (
            groupedAlerts.map((group) => renderTokenGroup(group))
          ) : (
            <div className="text-center p-8 rounded-lg border-2 border-dashed bg-background/50">
              <BellOff className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium text-muted-foreground">No alerts yet</p>
              <p className="text-xs text-muted-foreground mt-1">Create your first price alert</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderTrigger = () => {
    const alertCount = alerts?.length || 0;

    return (
      <div className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 transition-colors cursor-pointer">
        <div className="flex items-center min-w-0 flex-1">
          <div className="relative">
            <Bell className="h-4 w-4 mr-2 text-blue-500 flex-shrink-0" />
            {unreadCount > 0 && (
              <div className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full text-[8px] text-white flex items-center justify-center font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </div>
            )}
          </div>
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium">Alerts ({alertCount})</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const alertToDeleteData = alerts?.find(a => a.id === alertToDelete);

  return (
    <>
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <div className="w-full">
                  {renderTrigger()}
                </div>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side={isCollapsed ? "right" : "top"} align="center">
              <p>Price Alerts</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <PopoverContent
          side={isCollapsed ? "right" : "left"}
          align="start"
          className="w-[420px] p-4 bg-card/95 backdrop-blur-sm border-2 border-border/60 shadow-[0_0_30px_rgba(255,255,255,0.08)] ring-1 ring-white/10"
          sideOffset={isCollapsed ? 8 : 12}
        >
          <CardHeader className="px-0 pt-0 pb-3 border-b">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <Bell className="h-5 w-5 text-blue-500" />
              Price Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 pt-4 max-h-[600px] overflow-y-auto">
            {renderContent()}
          </CardContent>
        </PopoverContent>
      </Popover>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!alertToDelete} onOpenChange={(open) => !open && setAlertToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Alert?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the alert for{' '}
              <span className="font-semibold text-foreground">
                {alertToDeleteData?.TokenInfo?.symbol || alertToDeleteData?.TokenInfo?.name || 'this token'}
              </span>
              .
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => alertToDelete && handleDelete(alertToDelete)}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete Alert
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
