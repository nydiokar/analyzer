import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, X, ArrowRight, AlertCircle } from 'lucide-react';
import { getCollectionColorFilled } from '@/lib/color-utils';
import { isValidWalletAddress } from '@/lib/solana-utils';
import { WALLET_NICKNAME_MAX } from '@/lib/constants';

interface QuickAddFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: { walletAddress: string; nickname: string; collections: string[] }) => Promise<void>;
  walletAddress?: string; // Optional - if not provided, user inputs it
  initialNickname?: string; // Optional - pre-fills the nickname field
  title: string;
}

// Sleek, compact form for quickly adding wallets to favorites
const QuickAddForm = React.memo(({
  isOpen,
  onClose,
  onSave,
  walletAddress,
  initialNickname,
  title
}: QuickAddFormProps) => {
  const [formData, setFormData] = useState({
    walletAddress: walletAddress || '',
    nickname: '',
    collections: [] as string[],
    newCollection: ''
  });

  const [isSaving, setIsSaving] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);

  // Whether wallet address should be editable (when not provided as prop)
  const isAddressEditable = !walletAddress;

  // Reset form when dialog opens
  React.useEffect(() => {
    if (isOpen) {
      setFormData({
        walletAddress: walletAddress || '',
        nickname: initialNickname || '',
        collections: [],
        newCollection: ''
      });
      setDuplicateWarning(false);
      setAddressError(null);
    }
  }, [isOpen, walletAddress, initialNickname]);

  const handleSave = useCallback(async () => {
    // Validate wallet address if editable
    if (isAddressEditable) {
      const trimmedAddress = formData.walletAddress.trim();
      if (!trimmedAddress) {
        setAddressError('Wallet address is required');
        return;
      }
      if (!isValidWalletAddress(trimmedAddress)) {
        setAddressError('Invalid wallet address format');
        return;
      }
    }

    setIsSaving(true);
    try {
      await onSave({
        walletAddress: formData.walletAddress.trim(),
        nickname: formData.nickname,
        collections: formData.collections
      });
      onClose();
    } catch (error) {
      // Error handling is done in parent component
    } finally {
      setIsSaving(false);
    }
  }, [formData, onSave, onClose, isAddressEditable]);

  const addCollection = useCallback(() => {
    const trimmed = formData.newCollection.trim();
    if (!trimmed) return;

    if (formData.collections.includes(trimmed)) {
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

  const handleWalletAddressChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, walletAddress: e.target.value }));
    // Clear error when user types
    if (addressError) setAddressError(null);
  }, [addressError]);

  const handleNicknameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, nickname: e.target.value }));
  }, []);

  const handleNewCollectionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, newCollection: e.target.value }));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, action: 'collection' | 'save') => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (action === 'collection') {
        addCollection();
      } else {
        handleSave();
      }
    }
  }, [addCollection, handleSave]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Wallet Address - Input or Read-only */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Wallet Address</label>
            {isAddressEditable ? (
              <div className="space-y-1">
                <Input
                  placeholder="Solana or EVM (0x...) wallet address..."
                  value={formData.walletAddress}
                  onChange={handleWalletAddressChange}
                  className={`h-9 font-mono text-xs ${addressError ? 'border-red-500' : ''}`}
                />
                {addressError && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-500">
                    <AlertCircle className="h-3.5 w-3.5" />
                    <span>{addressError}</span>
                  </div>
                )}
              </div>
            ) : (
              <code className="block text-xs bg-muted px-3 py-2 rounded-md truncate">
                {walletAddress}
              </code>
            )}
          </div>

          {/* Nickname */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Nickname</label>
            <div className="relative">
              <Input
                placeholder="e.g., Main Whale, Research Wallet..."
                value={formData.nickname}
                onChange={handleNicknameChange}
                onKeyDown={(e) => handleKeyDown(e, 'save')}
                maxLength={WALLET_NICKNAME_MAX}
                className="h-9"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50">
                {formData.nickname.length}/{WALLET_NICKNAME_MAX}
              </span>
            </div>
          </div>

          {/* Collections */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Collections</label>
            {formData.collections.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {formData.collections.map((collection) => (
                  <Badge
                    key={collection}
                    className={`text-xs px-2 py-0.5 cursor-pointer font-medium ${getCollectionColorFilled(collection)}`}
                    onClick={() => removeCollection(collection)}
                  >
                    {collection}
                    <X className="h-3 w-3 ml-1.5" />
                  </Badge>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <div className="flex-1 relative">
                <Input
                  placeholder="Type collection name..."
                  value={formData.newCollection}
                  onChange={handleNewCollectionChange}
                  onKeyDown={(e) => handleKeyDown(e, 'collection')}
                  maxLength={20}
                  className="h-9 pr-12"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/50">
                  {formData.newCollection.length}/20
                </span>
              </div>
              <div className="flex flex-col items-center -mt-1">
                <span className="text-[10px] text-muted-foreground/60 font-medium mb-0.5">add</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <Button
                onClick={addCollection}
                size="sm"
                className="h-9 px-3 bg-purple-600 hover:bg-purple-700"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {duplicateWarning && (
              <p className="text-xs text-amber-600 dark:text-amber-500 animate-in fade-in duration-200">
                Collection &quot;{formData.newCollection.trim()}&quot; already exists
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving} size="sm">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving} size="sm">
            {isSaving ? 'Adding...' : 'Add to Tracked'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

QuickAddForm.displayName = 'QuickAddForm';

export default QuickAddForm;
