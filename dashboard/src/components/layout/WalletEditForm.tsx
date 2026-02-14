import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus, X, AlertCircle, ArrowRight } from 'lucide-react';
import { getCollectionColorFilled } from '@/lib/color-utils';
import { WALLET_NICKNAME_MAX } from '@/lib/constants';

interface WalletEditFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { nickname: string; collections: string[] }) => Promise<void>;
  initialData: {
    nickname: string;
    collections: string[];
  };
  title?: string;
}

export const WalletEditForm: React.FC<WalletEditFormProps> = React.memo(({
  isOpen,
  onClose,
  onSave,
  initialData,
  title = "Edit Wallet Data"
}) => {
  const [formData, setFormData] = useState({
    nickname: initialData.nickname,
    collections: [...initialData.collections],
    newCollection: ''
  });

  const [isSaving, setIsSaving] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);

  // Reset form when dialog opens/closes or initialData changes
  React.useEffect(() => {
    if (isOpen) {
      setFormData({
        nickname: initialData.nickname,
        collections: [...initialData.collections],
        newCollection: ''
      });
    }
  }, [isOpen, initialData]);

  const handleNicknameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, nickname: e.target.value }));
  }, []);

  const handleNewCollectionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, newCollection: e.target.value }));
  }, []);

  const [duplicateWarning, setDuplicateWarning] = useState(false);

  const addCollection = useCallback(() => {
    const trimmed = formData.newCollection.trim();
    if (!trimmed) return;

    if (formData.collections.includes(trimmed)) {
      // Show duplicate warning
      setDuplicateWarning(true);
      setTimeout(() => setDuplicateWarning(false), 2500);
      return;
    }

    setFormData(prev => ({
      ...prev,
      collections: [...prev.collections, trimmed],
      newCollection: ''
    }));
    setDuplicateWarning(false);
  }, [formData.newCollection, formData.collections]);

  const removeCollection = useCallback((collectionToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      collections: prev.collections.filter(collection => collection !== collectionToRemove)
    }));
  }, []);

  const handleSave = useCallback(async () => {
    if (isSaving) return;

    // Show warning if there's unsaved collection text
    if (formData.newCollection.trim()) {
      setShowUnsavedWarning(true);
      return;
    }

    // Proceed with save
    await performSave();
  }, [formData, isSaving, performSave]);

  const performSave = useCallback(async () => {
    setIsSaving(true);
    setShowUnsavedWarning(false);
    try {
      await onSave({
        nickname: formData.nickname.trim(),
        collections: formData.collections
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  }, [formData, onSave, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCollection();
    }
  }, [addCollection]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Nickname - Compact Row */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium w-24 flex-shrink-0">Nickname</label>
            <div className="flex-1 relative">
              <Input
                placeholder="Enter a memorable name..."
                value={formData.nickname}
                onChange={handleNicknameChange}
                maxLength={WALLET_NICKNAME_MAX}
                className="flex-1"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50">
                {formData.nickname.length}/{WALLET_NICKNAME_MAX}
              </span>
            </div>
          </div>

          {/* Collections - Compact Layout with Visual Guide */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium w-24 flex-shrink-0">Collections</label>
              <div className="flex items-center gap-2 flex-1">
                <div className="flex-1 relative">
                  <Input
                    placeholder="Type collection name..."
                    value={formData.newCollection}
                    onChange={handleNewCollectionChange}
                    onKeyDown={handleKeyDown}
                    maxLength={20}
                    className="flex-1 pr-12"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50">
                    {formData.newCollection.length}/20
                  </span>
                </div>
                <div className="flex flex-col items-center -mt-1">
                  <span className="text-[10px] text-muted-foreground/60 font-medium mb-0.5">add</span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <Button onClick={addCollection} size="sm" className="bg-purple-600 hover:bg-purple-700 h-9 px-3">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Duplicate Warning */}
            {duplicateWarning && (
              <div className="pl-[112px]">
                <p className="text-xs text-amber-600 dark:text-amber-500 animate-in fade-in duration-200">
                  Collection &quot;{formData.newCollection.trim()}&quot; already exists
                </p>
              </div>
            )}

            {/* Collection Tags Below */}
            {formData.collections.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pl-[112px]">
                {formData.collections.map((collection) => (
                  <Badge
                    key={collection}
                    className={`text-xs px-2 py-1 cursor-pointer ${getCollectionColorFilled(collection)}`}
                    onClick={() => removeCollection(collection)}
                  >
                    {collection}
                    <X className="h-3 w-3 ml-1.5" />
                  </Badge>
                ))}
              </div>
            )}

            {/* Hint Text */}
            <p className="text-xs text-muted-foreground pl-[112px]">
              Organize your tracked wallets into collections (e.g., &quot;Main Portfolio&quot;, &quot;Watchlist&quot;, &quot;Research&quot;)
            </p>
          </div>
        </div>

        {/* Unsaved Collection Warning */}
        {showUnsavedWarning && (
          <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
            <AlertDescription className="text-sm text-amber-800 dark:text-amber-300">
              <p className="font-medium mb-2">You have unsaved collection text: &quot;{formData.newCollection.trim()}&quot;</p>
              <p className="text-xs mb-3">Did you forget to click the Add button?</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowUnsavedWarning(false)}
                  className="h-7 text-xs"
                >
                  Go Back
                </Button>
                <Button
                  size="sm"
                  onClick={performSave}
                  className="h-7 text-xs bg-amber-600 hover:bg-amber-700"
                >
                  Save Without It
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

WalletEditForm.displayName = 'WalletEditForm';
