import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, X, FolderOpen } from 'lucide-react';
import { getCollectionColor } from '@/lib/color-utils';

interface QuickAddFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: { nickname: string; collections: string[] }) => Promise<void>;
  walletAddress: string;
  title: string;
}

// Sleek, compact form for quickly adding wallets to favorites
const QuickAddForm = React.memo(({
  isOpen,
  onClose,
  onSave,
  walletAddress,
  title
}: QuickAddFormProps) => {
  const [formData, setFormData] = useState({
    nickname: '',
    collections: [] as string[],
    newCollection: ''
  });

  const [isSaving, setIsSaving] = useState(false);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (isOpen) {
      setFormData({
        nickname: '',
        collections: [],
        newCollection: ''
      });
    }
  }, [isOpen]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await onSave({
        nickname: formData.nickname,
        collections: formData.collections
      });
      onClose();
    } catch (error) {
      // Error handling is done in parent component
    } finally {
      setIsSaving(false);
    }
  }, [formData, onSave, onClose]);

  const addCollection = useCallback(() => {
    const trimmed = formData.newCollection.trim();
    if (trimmed && !formData.collections.includes(trimmed)) {
      setFormData(prev => ({
        ...prev,
        collections: [...prev.collections, trimmed],
        newCollection: ''
      }));
    }
  }, [formData.newCollection, formData.collections]);

  const removeCollection = useCallback((collectionToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      collections: prev.collections.filter(collection => collection !== collectionToRemove)
    }));
  }, []);

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
          {/* Wallet Address (read-only display) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Wallet Address</label>
            <code className="block text-xs bg-muted px-3 py-2 rounded-md truncate">
              {walletAddress}
            </code>
          </div>

          {/* Nickname */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Nickname</label>
            <Input
              placeholder="e.g., Main Whale, Research Wallet..."
              value={formData.nickname}
              onChange={handleNicknameChange}
              onKeyDown={(e) => handleKeyDown(e, 'save')}
              className="h-9"
            />
          </div>

          {/* Collections */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Collections</label>
            {formData.collections.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {formData.collections.map((collection) => (
                  <Badge
                    key={collection}
                    className={`text-xs px-2 py-0.5 cursor-pointer ${getCollectionColor(collection)}`}
                    onClick={() => removeCollection(collection)}
                  >
                    <FolderOpen className="h-3 w-3 mr-1" />
                    {collection}
                    <X className="h-3 w-3 ml-1" />
                  </Badge>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <Input
                placeholder="Add collection..."
                value={formData.newCollection}
                onChange={handleNewCollectionChange}
                onKeyDown={(e) => handleKeyDown(e, 'collection')}
                className="h-9"
              />
              <Button
                onClick={addCollection}
                size="sm"
                variant="outline"
                className="h-9 px-3"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
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
