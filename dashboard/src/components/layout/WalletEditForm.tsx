import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Plus, X, Tags, FolderOpen } from 'lucide-react';
import { getTagColor, getCollectionColor } from '@/lib/color-utils';

interface WalletEditFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { nickname: string; tags: string[]; collections: string[] }) => Promise<void>;
  initialData: {
    nickname: string;
    tags: string[];
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
    tags: [...initialData.tags],
    collections: [...initialData.collections],
    newTag: '',
    newCollection: ''
  });

  const [isSaving, setIsSaving] = useState(false);

  // Reset form when dialog opens/closes or initialData changes
  React.useEffect(() => {
    if (isOpen) {
      setFormData({
        nickname: initialData.nickname,
        tags: [...initialData.tags],
        collections: [...initialData.collections],
        newTag: '',
        newCollection: ''
      });
    }
  }, [isOpen, initialData]);

  const handleNicknameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, nickname: e.target.value }));
  }, []);

  const handleNewTagChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, newTag: e.target.value }));
  }, []);

  const handleNewCollectionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, newCollection: e.target.value }));
  }, []);

  const addTag = useCallback(() => {
    const trimmed = formData.newTag.trim();
    if (trimmed && !formData.tags.includes(trimmed)) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, trimmed],
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

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    
    setIsSaving(true);
    try {
      await onSave({
        nickname: formData.nickname.trim(),
        tags: formData.tags,
        collections: formData.collections
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  }, [formData, onSave, onClose, isSaving]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, type: 'tag' | 'collection') => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (type === 'tag') {
        addTag();
      } else {
        addCollection();
      }
    }
  }, [addTag, addCollection]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Edit wallet information including nickname, tags, and collections for better organization.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Nickname */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Nickname</label>
            <Input
              placeholder="Enter a memorable name..."
              value={formData.nickname}
              onChange={handleNicknameChange}
            />
          </div>
          
          {/* Tags */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Tags</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {formData.tags.map((tag) => (
                <Badge 
                  key={tag} 
                  variant="secondary" 
                  className={`text-xs px-2 py-1 border cursor-pointer ${getTagColor(tag)}`}
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
                onKeyDown={(e) => handleKeyDown(e, 'tag')}
              />
              <Button onClick={addTag} size="sm" variant="outline">
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>
          
          {/* Collections */}
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
                onKeyDown={(e) => handleKeyDown(e, 'collection')}
              />
              <Button onClick={addCollection} size="sm" variant="outline">
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
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

WalletEditForm.displayName = 'WalletEditForm'; 