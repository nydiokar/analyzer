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

  // Local state for date pickers, synced with store but allows intermediate changes
  const [currentDisplayStartDate, setCurrentDisplayStartDate] = React.useState<Date>(startDate);
  const [currentDisplayEndDate, setCurrentDisplayEndDate] = React.useState<Date>(endDate);

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
        variant={preset === p.value ? 'default' : 'outline'}
        size="sm"
        className="h-8 text-xs px-3"
        onClick={clickHandlers[p.value]}
      >
        {p.label}
      </Button>
    ));
  }, [preset, clickHandlers]);

  return (
    <div className="flex flex-col items-center gap-2 p-1 rounded-lg shadow-sm bg-card text-card-foreground border">
      <div className="flex items-center gap-1">
        {presetButtons}
      </div>
      <div className="flex items-center gap-1">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={"outline"}
              size="sm"
              className={cn(
                "w-[110px] justify-start text-left font-normal h-8 text-xs px-2",
                !currentDisplayStartDate && "text-muted-foreground"
              )}
              id="startDatePickerButton"
              name="startDatePickerButton"
            >
              <CalendarIcon className="mr-1 h-3 w-3" />
              {currentDisplayStartDate ? format(currentDisplayStartDate, 'MMM d, yy') : <span>Start</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0">
            <Calendar
              mode="single"
              selected={currentDisplayStartDate}
              onSelect={(d) => handleDateChange(d, 'start')}
              initialFocus
              disabled={(date) => date > (currentDisplayEndDate || new Date()) || date < new Date("2000-01-01")}
            />
          </PopoverContent>
        </Popover>

        <span className="text-xs text-muted-foreground">-</span>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={"outline"}
              size="sm"
              className={cn(
                "w-[110px] justify-start text-left font-normal h-8 text-xs px-2",
                !currentDisplayEndDate && "text-muted-foreground"
              )}
              id="endDatePickerButton"
              name="endDatePickerButton"
            >
              <CalendarIcon className="mr-1 h-3 w-3" />
              {currentDisplayEndDate ? format(currentDisplayEndDate, 'MMM d, yy') : <span>End</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0">
            <Calendar
              mode="single"
              selected={currentDisplayEndDate}
              onSelect={(d) => handleDateChange(d, 'end')}
              initialFocus
              disabled={(date) => date < (currentDisplayStartDate || new Date("2000-01-01")) || date > new Date()}
            />
          </PopoverContent>
        </Popover>
      </div>
      <p className='text-xs text-muted-foreground/80 text-center whitespace-nowrap pt-0.5'>
        {currentRangeLabel}
      </p>
    </div>
  );
} 