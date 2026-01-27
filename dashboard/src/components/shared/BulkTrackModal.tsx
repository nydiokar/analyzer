'use client';

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getCollectionColorFilled } from '@/lib/color-utils';
import type { useBulkTrackHolders } from '@/hooks/trackers/useBulkTrackHolders';

type BulkTrackController = ReturnType<typeof useBulkTrackHolders>;

interface BulkTrackModalProps {
  bulkTrack: BulkTrackController;
  defaultCollectionName: string;
  defaultNicknamePrefix: string;
}

export function BulkTrackModal({ bulkTrack, defaultCollectionName, defaultNicknamePrefix }: BulkTrackModalProps) {
  return (
    <AlertDialog open={bulkTrack.isOpen} onOpenChange={(open) => !open && bulkTrack.close()}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            Track selected holders
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground cursor-help">info</span>
                </TooltipTrigger>
                <TooltipContent className="text-xs max-w-xs">
                  New wallets get the rank-based name. Existing tracked wallets keep their current nickname.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </AlertDialogTitle>
        </AlertDialogHeader>

        <AlertDialogDescription asChild>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded-md border bg-muted/20 px-3 py-2 space-y-1">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Collection</div>
                <div className="flex items-center gap-2">
                  <Input
                    value={bulkTrack.collectionInput}
                    onChange={(e) => bulkTrack.setCollectionInput(e.target.value)}
                    className="h-8 text-xs font-mono"
                    placeholder={defaultCollectionName}
                  />
                  <Badge className={getCollectionColorFilled(bulkTrack.displayCollectionName)}>
                    {bulkTrack.displayCollectionName}
                  </Badge>
                </div>
              </div>

              <div className="rounded-md border bg-muted/20 px-3 py-2 space-y-1">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Naming</div>
                <div className="flex items-center gap-2">
                  <Input
                    value={bulkTrack.nicknameInput}
                    onChange={(e) => bulkTrack.setNicknameInput(e.target.value)}
                    className="h-8 text-xs font-mono"
                    placeholder={defaultNicknamePrefix}
                  />
                  <code className="rounded bg-muted px-2 py-0.5 text-[10px]">
                    {bulkTrack.displayNicknamePrefix}&#35;rank
                  </code>
                </div>
              </div>
            </div>

            <div className="rounded-md border">
              <ScrollArea className="h-56">
                <div className="divide-y">
                  {bulkTrack.preview.map((item) => {
                    const displayName = item.action === 'skip'
                      ? (item.knownLabel || item.existingNickname || item.generatedNickname)
                      : item.action === 'add'
                        ? item.generatedNickname
                        : item.existingNickname || item.generatedNickname;
                    return (
                      <div key={item.address} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground">
                            {displayName}
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {item.address.slice(0, 6)}...{item.address.slice(-4)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {item.action === 'add' && (
                            <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">
                              New
                            </Badge>
                          )}
                          {item.action === 'update' && (
                            <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30">
                              Add to collection
                            </Badge>
                          )}
                          {item.action === 'noop' && (
                            <Badge variant="outline">Already in collection</Badge>
                          )}
                          {item.action === 'skip' && (
                            <Badge variant="outline" className="border-amber-500/40 text-amber-700">
                              Skipped
                            </Badge>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            <div className="text-xs text-muted-foreground">
              {bulkTrack.summary.adds} new · {bulkTrack.summary.updates} add to collection · {bulkTrack.summary.noops} already tracked · {bulkTrack.summary.skips} skipped
            </div>
          </div>
        </AlertDialogDescription>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={bulkTrack.isSaving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={bulkTrack.isSaving || bulkTrack.preview.length === 0}
            onClick={(event) => {
              event.preventDefault();
              bulkTrack.confirm();
            }}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {bulkTrack.isSaving ? 'Adding...' : `Confirm (${bulkTrack.summary.adds + bulkTrack.summary.updates})`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
