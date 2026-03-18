"use client";

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createAlert } from '@/hooks/useAlerts';
import { fetcher } from '@/lib/fetcher';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

interface AlertCreatorProps {
  tokenAddress?: string; // Optional now - can be provided via input
  userId: string;
  onCreated?: () => void;
}

type AlertType = 'price' | 'percentage';

export function AlertCreator({ tokenAddress: initialTokenAddress, userId, onCreated }: AlertCreatorProps) {
  const [tokenAddress, setTokenAddress] = useState(initialTokenAddress || '');
  const [alertType, setAlertType] = useState<AlertType>('price');
  const [operator, setOperator] = useState<'gt' | 'lt'>('gt');
  const [targetValue, setTargetValue] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  const validateTokenAddress = async (address: string): Promise<boolean> => {
    // Basic format validation
    if (!address || address.trim().length === 0) {
      toast.error('Please enter a token address');
      return false;
    }

    const trimmed = address.trim();

    // Solana addresses are base58 encoded and typically 32-44 characters
    if (trimmed.length < 32 || trimmed.length > 44) {
      toast.error('Invalid Solana token address length');
      return false;
    }

    // Check if it's valid base58 (only contains valid base58 characters)
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
    if (!base58Regex.test(trimmed)) {
      toast.error('Invalid token address format - must be base58');
      return false;
    }

    // Verify token exists by calling DexScreener validation endpoint
    setIsValidating(true);
    try {
      const result = await fetcher(`/token-validation/${trimmed}`);

      if (!result || !result.valid) {
        toast.error(result?.error || 'Token not found on Solana - please check the address');
        return false;
      }

      // Token exists on DexScreener
      return true;
    } catch (error) {
      console.error('Token validation error:', error);
      toast.error('Failed to validate token address - please try again');
      return false;
    } finally {
      setIsValidating(false);
    }
  };

  const handleCreate = async () => {
    // Validate target value
    if (!targetValue || isNaN(parseFloat(targetValue)) || parseFloat(targetValue) <= 0) {
      toast.error(`Please enter a valid ${alertType === 'price' ? 'price' : 'percentage'} greater than 0`);
      return;
    }

    // Validate token address (includes API check)
    const isValid = await validateTokenAddress(tokenAddress);
    if (!isValid) {
      return;
    }

    setIsCreating(true);
    try {
      const condition = alertType === 'price'
        ? {
            type: 'price',
            operator,
            value: parseFloat(targetValue),
            field: 'priceUsd',
          }
        : {
            type: 'percentage',
            operator,
            value: parseFloat(targetValue),
            field: 'priceUsd',
          };

      // Auto-generate label for backend storage
      const labelText = alertType === 'price'
        ? `Price ${operator === 'gt' ? 'above' : 'below'} $${targetValue}`
        : `Price ${operator === 'gt' ? 'increases' : 'decreases'} by ${targetValue}%`;

      await createAlert({
        userId,
        tokenAddress: tokenAddress.trim(),
        label: labelText,
        condition,
        channels: ['in_app'],
        cooldownMinutes: 60,
      });

      toast.success('Alert created successfully');

      // Reset form only if no initial token address (sidebar mode)
      if (!initialTokenAddress) {
        setTokenAddress('');
      }
      setTargetValue('');

      onCreated?.();
    } catch (error) {
      console.error('Failed to create alert:', error);
      toast.error('Failed to create alert');
    } finally {
      setIsCreating(false);
    }
  };

  const showTokenInput = !initialTokenAddress;
  const isDisabled = isCreating || isValidating || !targetValue || !tokenAddress;

  return (
    <div className="space-y-3">
      {showTokenInput && (
        <div className="space-y-2">
          <Label htmlFor="token-address" className="text-xs font-medium">Token Address *</Label>
          <Input
            id="token-address"
            placeholder="Enter Solana token address"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            className="h-9 text-sm font-mono"
            disabled={isCreating || isValidating}
          />
          <p className="text-[10px] text-muted-foreground">
            Will be validated before creating alert
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs font-medium">Alert Type</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={alertType === 'price' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAlertType('price')}
            disabled={isCreating || isValidating}
            className="h-9 text-xs"
          >
            Price
          </Button>
          <Button
            type="button"
            variant={alertType === 'percentage' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAlertType('percentage')}
            disabled={isCreating || isValidating}
            className="h-9 text-xs"
          >
            % Change
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-xs font-medium">Condition</Label>
          <select
            value={operator}
            onChange={(e) => setOperator(e.target.value as 'gt' | 'lt')}
            className="w-full h-9 text-sm rounded-md border border-input bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            disabled={isCreating || isValidating}
          >
            {alertType === 'price' ? (
              <>
                <option value="gt">Price goes above</option>
                <option value="lt">Price goes below</option>
              </>
            ) : (
              <>
                <option value="gt">Increases by</option>
                <option value="lt">Decreases by</option>
              </>
            )}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="target-value" className="text-xs font-medium">
            {alertType === 'price' ? 'Target Price *' : 'Percentage *'}
          </Label>
          <div className="relative">
            {alertType === 'price' && (
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            )}
            <Input
              id="target-value"
              type="number"
              step={alertType === 'price' ? '0.000001' : '1'}
              placeholder={alertType === 'price' ? '0.00001' : '300'}
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              className={`h-9 text-sm ${alertType === 'price' ? 'pl-6' : ''}`}
              disabled={isCreating || isValidating}
            />
            {alertType === 'percentage' && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            )}
          </div>
        </div>
      </div>

      <Button
        onClick={handleCreate}
        disabled={isDisabled}
        className="w-full h-9 text-sm"
      >
        {isValidating ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Validating...
          </>
        ) : isCreating ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Creating...
          </>
        ) : (
          'Create Alert'
        )}
      </Button>
    </div>
  );
}
