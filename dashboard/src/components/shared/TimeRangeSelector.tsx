"use client";

import React from 'react';
import { format, startOfDay, endOfDay, isEqual } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useTimeRangeStore, TimeRangePreset } from '@/store/time-range-store';

interface PresetButton {
  value: TimeRangePreset;
  label: string;
}

const presetButtonsList: PresetButton[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '1m', label: '1m' },
  { value: '3m', label: '3m' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All' },
];

export default function TimeRangeSelector() {
  const {
    preset,
    startDate,
    endDate,
    setPreset,
    setCustomDateRange,
  } = useTimeRangeStore();

  // Track if component has mounted on client to prevent hydration mismatch
  const [isMounted, setIsMounted] = React.useState(false);

  // Local state for date pickers, synced with store but allows intermediate changes
  const [currentDisplayStartDate, setCurrentDisplayStartDate] = React.useState<Date>(startDate);
  const [currentDisplayEndDate, setCurrentDisplayEndDate] = React.useState<Date>(endDate);

  // Set mounted state after hydration to prevent mismatch
  React.useEffect(() => {
    setIsMounted(true);
  }, []);

  // Memoized date comparison to avoid expensive isEqual calls
  const shouldUpdateStartDate = React.useMemo(() => {
    return !isEqual(startDate, currentDisplayStartDate);
  }, [startDate, currentDisplayStartDate]);

  const shouldUpdateEndDate = React.useMemo(() => {
    return !isEqual(endDate, currentDisplayEndDate);
  }, [endDate, currentDisplayEndDate]);

  // Effect to update local display dates when global store changes
  React.useEffect(() => {
    if (shouldUpdateStartDate) {
      setCurrentDisplayStartDate(startDate);
    }
    if (shouldUpdateEndDate) {
      setCurrentDisplayEndDate(endDate);
    }
  }, [startDate, endDate, shouldUpdateStartDate, shouldUpdateEndDate]);

  // Memoized click handler to prevent unnecessary re-renders
  const handlePresetButtonClick = React.useCallback((selectedPreset: TimeRangePreset) => {
    setPreset(selectedPreset);
  }, [setPreset]);

  // Create stable click handlers for each preset to prevent double events
  const clickHandlers = React.useMemo(() => {
    const handlers: Record<TimeRangePreset, () => void> = {} as Record<TimeRangePreset, () => void>;
    presetButtonsList.forEach((p) => {
      handlers[p.value] = () => handlePresetButtonClick(p.value);
    });
    return handlers;
  }, [handlePresetButtonClick]);

  // Memoized date change handler
  const handleDateChange = React.useCallback((date: Date | undefined, type: 'start' | 'end') => {
    if (!date) return;

    let newStart = currentDisplayStartDate;
    let newEnd = currentDisplayEndDate;

    if (type === 'start') {
      newStart = startOfDay(date);
      // Ensure start date is not after end date
      if (newStart > newEnd) {
        newEnd = endOfDay(newStart); // Adjust end date if necessary
      }
    } else {
      newEnd = endOfDay(date);
      // Ensure end date is not before start date
      if (newEnd < newStart) {
        newStart = startOfDay(newEnd); // Adjust start date if necessary
      }
    }
    
    setCurrentDisplayStartDate(newStart);
    setCurrentDisplayEndDate(newEnd);
    setCustomDateRange(newStart, newEnd); // Update global store, sets preset to 'custom'
  }, [currentDisplayStartDate, currentDisplayEndDate, setCustomDateRange]);
  
  // Memoized range label to prevent recalculation on every render
  const currentRangeLabel = React.useMemo(() => {
    if (!currentDisplayStartDate || !currentDisplayEndDate) return "Loading range...";
    const foundPreset = presetButtonsList.find((p: PresetButton) => p.value === preset);
    const formattedStartDate = format(currentDisplayStartDate, 'MMM d');
    const formattedEndDate = format(currentDisplayEndDate, 'MMM d, yy');

    if (preset === 'custom') {
      return `${formattedStartDate} - ${formattedEndDate}`;
    }
    return `${foundPreset?.label}: ${formattedStartDate} - ${formattedEndDate}`;
  }, [currentDisplayStartDate, currentDisplayEndDate, preset]);

  // Memoized button rendering to prevent unnecessary re-renders
  const presetButtons = React.useMemo(() => {
    return presetButtonsList.map((p: PresetButton) => (
      <Button
        key={p.value}
        variant={preset === p.value ? 'default' : 'ghost'}
        size="sm"
        className="h-7 text-[11px] px-2 font-medium"
        onClick={clickHandlers[p.value]}
      >
        {p.label}
      </Button>
    ));
  }, [preset, clickHandlers]);

  return (
    <div className="flex items-center gap-1">
      {presetButtons}
    </div>
  );
} 