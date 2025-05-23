import { create } from 'zustand';
import { subDays, startOfDay, endOfDay } from 'date-fns'; // For date manipulation

export type TimeRangePreset = '24h' | '7d' | '1m' | '3m' | 'ytd' | 'all';

export interface TimeRangeState {
  preset: TimeRangePreset | 'custom';
  startDate: Date;
  endDate: Date;
  setPreset: (preset: TimeRangePreset | 'custom') => void;
  setCustomDateRange: (startDate: Date, endDate: Date) => void;
}

const getDefaultEndDate = () => endOfDay(new Date());
const getDefaultStartDate = (daysToSubtract: number) => startOfDay(subDays(new Date(), daysToSubtract));

export const useTimeRangeStore = create<TimeRangeState>((set) => ({
  preset: '1m', // Default to last 1 month
  startDate: getDefaultStartDate(30),
  endDate: getDefaultEndDate(),

  setPreset: (preset) => {
    let newStartDate: Date;
    const newEndDate = getDefaultEndDate();

    switch (preset) {
      case '24h':
        newStartDate = getDefaultStartDate(1);
        break;
      case '7d':
        newStartDate = getDefaultStartDate(7);
        break;
      case '1m':
        newStartDate = getDefaultStartDate(30);
        break;
      case '3m':
        newStartDate = getDefaultStartDate(90);
        break;
      case 'ytd':
        newStartDate = startOfDay(new Date(new Date().getFullYear(), 0, 1));
        break;
      case 'all':
        // For 'all', we might use a very early date or rely on API to not filter by start date
        // Using a practical early date for now.
        newStartDate = new Date(2000, 0, 1); 
        break;
      default:
        newStartDate = getDefaultStartDate(30); // Default to 1 month if unknown
    }
    set({ preset, startDate: newStartDate, endDate: newEndDate });
  },

  setCustomDateRange: (startDate, endDate) => {
    set({
      preset: 'custom',
      startDate: startOfDay(startDate),
      endDate: endOfDay(endDate),
    });
  },
}));

// Optional: selector for easy access to formatted dates or specific parts of the state
export const selectTimeRange = (state: TimeRangeState) => ({ 
  startDate: state.startDate, 
  endDate: state.endDate, 
  preset: state.preset 
}); 