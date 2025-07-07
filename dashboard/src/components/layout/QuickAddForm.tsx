import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, X, Tags, FolderOpen } from 'lucide-react';
import { getTagColor, getCollectionColor } from '@/lib/color-utils';

interface QuickAddFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: { nickname: string; tags: string[]; collections: string[] }) => Promise<void>;
  walletAddress: string;
  title: string;
}

// Memoized form component to prevent parent re-renders
const QuickAddForm = React.memo(({ 
  isOpen, 
  onClose, 
  onSave, 
  walletAddress,
  title 
}: QuickAddFormProps) => {
  const [formData, setFormData] = useState({
    nickname: '',
    tags: [] as string[],
    collections: [] as string[],
    newTag: '',
    newCollection: ''
  });

  const [isSaving, setIsSaving] = useState(false);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (isOpen) {
      setFormData({
        nickname: '',
        tags: [],
        collections: [],
        newTag: '',
        newCollection: ''
      });
    }
  }, [isOpen]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await onSave({
        nickname: formData.nickname,
        tags: formData.tags,
        collections: formData.collections
      });
      onClose();
    } catch (error) {
      // Error handling is done in parent component
    } finally {
      setIsSaving(false);
    }
  }, [formData, onSave, onClose]);

  const addTag = useCallback(() => {
    if (formData.newTag.trim() && !formData.tags.includes(formData.newTag.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, prev.newTag.trim()],
        newTag: ''
      }));
    }
  }, [formData.newTag, formData.tags]);

  const removeTag = useCallback((tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  }, []);

  const addCollection = useCallback(() => {
    if (formData.newCollection.trim() && !formData.collections.includes(formData.newCollection.trim())) {
      setFormData(prev => ({
        ...prev,
        collections: [...prev.collections, prev.newCollection.trim()],
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

  const handleNewTagChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, newTag: e.target.value }));
  }, []);

  const handleNewCollectionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, newCollection: e.target.value }));
  }, []);

  const handleTagKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  }, [addTag]);

  const handleCollectionKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCollection();
    }
  }, [addCollection]);

  const truncateWalletAddress = (address: string, startLength: number = 8, endLength: number = 6) => {
    if (address.length <= startLength + endLength) return address;
    return `${address.substring(0, startLength)}...${address.substring(address.length - endLength)}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Add wallet {truncateWalletAddress(walletAddress)} to your favorites with optional nickname, tags, and collections.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="nickname" className="text-sm font-medium">Nickname (optional)</label>
            <Input
              id="nickname"
              placeholder="Enter a nickname for this wallet..."
              value={formData.nickname}
              onChange={handleNicknameChange}
              disabled={isSaving}
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Tags</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {formData.tags.map((tag) => (
                <Badge 
                  key={tag} 
                  className={`text-xs px-2 py-1 cursor-pointer ${getTagColor(tag)}`}
                  onClick={() => removeTag(tag)}
                >
                  <Tags className="h-3 w-3 mr-1" />
                  {tag}
                  <X className="h-3 w-3 ml-1" />
                </Badge>
              ))}
            </div>
            <div className="flex gap-1">
              <Input
                placeholder="Add tag..."
                value={formData.newTag}
                onChange={handleNewTagChange}
                onKeyDown={handleTagKeyDown}
                disabled={isSaving}
              />
              <Button onClick={addTag} size="sm" variant="outline" disabled={isSaving}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Collections</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {formData.collections.map((collection) => (
                <Badge 
                  key={collection} 
                  className={`text-xs px-2 py-1 cursor-pointer ${getCollectionColor(collection)}`}
                  onClick={() => removeCollection(collection)}
                >
                  <FolderOpen className="h-3 w-3 mr-1" />
                  {collection}
                  <X className="h-3 w-3 ml-1" />
                </Badge>
              ))}
            </div>
            <div className="flex gap-1">
              <Input
                placeholder="Add collection..."
                value={formData.newCollection}
                onChange={handleNewCollectionChange}
                onKeyDown={handleCollectionKeyDown}
                disabled={isSaving}
              />
              <Button onClick={addCollection} size="sm" variant="outline" disabled={isSaving}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
        
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Adding...' : 'Add to Favorites'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

QuickAddForm.displayName = 'QuickAddForm';

export default QuickAddForm; 