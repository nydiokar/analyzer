'use client';

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

interface SyncConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  missingWallets: string[];
}

export function SyncConfirmationDialog({ isOpen, onClose, onConfirm, missingWallets }: SyncConfirmationDialogProps) {
  if (!isOpen) return null;

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sync Required</AlertDialogTitle>
          <AlertDialogDescription>
            The following wallets are not in our database and need to be synced before analysis can be run. This may take a few minutes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="my-4 max-h-32 overflow-y-auto rounded-md border bg-muted p-2">
          <ul className="list-disc pl-5">
            {missingWallets.map((wallet) => (
              <li key={wallet} className="font-mono text-xs">
                {wallet}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-muted-foreground">Do you want to proceed with syncing?</p>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Proceed</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
} 