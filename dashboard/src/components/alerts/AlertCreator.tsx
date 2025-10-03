"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { createAlert } from '@/hooks/useAlerts';

interface AlertCreatorProps {
  tokenAddress: string;
  userId: string;
  onCreated?: () => void;
}

export function AlertCreator({ tokenAddress, userId, onCreated }: AlertCreatorProps) {
  const [label, setLabel] = useState('');
  const [operator, setOperator] = useState<'gt' | 'lt'>('gt');
  const [targetPrice, setTargetPrice] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!targetPrice || isNaN(parseFloat(targetPrice))) {
      alert('Please enter a valid price');
      return;
    }

    setIsCreating(true);
    try {
      await createAlert({
        userId,
        tokenAddress,
        label: label || `Price ${operator === 'gt' ? 'above' : 'below'} $${targetPrice}`,
        condition: {
          type: 'price',
          operator,
          value: parseFloat(targetPrice),
          field: 'priceUsd',
        },
        channels: ['in_app'],
        cooldownMinutes: 60,
      });

      // Reset form
      setLabel('');
      setTargetPrice('');

      onCreated?.();
    } catch (error) {
      console.error('Failed to create alert:', error);
      alert('Failed to create alert');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-3 p-4 border rounded-lg bg-card">
      <h3 className="font-semibold text-sm">Create Price Alert</h3>

      <div className="space-y-2">
        <Label htmlFor="alert-label" className="text-xs">Label (optional)</Label>
        <Input
          id="alert-label"
          placeholder="Moon alert"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="h-8 text-sm"
        />
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <Label className="text-xs">Condition</Label>
          <select
            value={operator}
            onChange={(e) => setOperator(e.target.value as 'gt' | 'lt')}
            className="w-full h-8 text-sm rounded-md border border-input bg-background px-3 py-2"
          >
            <option value="gt">Price goes above</option>
            <option value="lt">Price goes below</option>
          </select>
        </div>

        <div className="flex-1">
          <Label htmlFor="target-price" className="text-xs">Target Price</Label>
          <Input
            id="target-price"
            type="number"
            step="0.000001"
            placeholder="0.00001"
            value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
      </div>

      <Button
        onClick={handleCreate}
        disabled={isCreating || !targetPrice}
        className="w-full h-8 text-sm"
      >
        {isCreating ? 'Creating...' : 'Create Alert'}
      </Button>
    </div>
  );
}
