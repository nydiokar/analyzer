/**
 * Shared utility for formatting classification enums consistently across UI
 */

import type { StrategyType, SpeedCategory, FlowPattern } from '@/types/api';

/**
 * Format strategy type enum for display (spaces, title case)
 */
export function formatStrategyType(strategy: StrategyType | string | null | undefined): string {
  if (!strategy) return 'Unclassified';
  
  // Convert underscore-separated enum to space-separated title case
  return strategy
    .split('_')
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Format speed category enum for display
 */
export function formatSpeedCategory(speed: SpeedCategory | string | null | undefined): string {
  if (!speed) return 'Unknown';
  
  // Speed categories are single words, just title case
  return speed.charAt(0) + speed.slice(1).toLowerCase();
}

/**
 * Format flow pattern enum for display
 */
export function formatFlowPattern(flow: FlowPattern | string | null | undefined): string {
  if (!flow) return 'Unknown';
  
  // Convert underscore-separated to space-separated title case
  return flow
    .split('_')
    .map(word => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}
