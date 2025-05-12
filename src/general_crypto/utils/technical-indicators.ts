import { createLogger } from '@/utils/logger';

const logger = createLogger('TechnicalIndicators');

/**
 * Calculates the Simple Moving Average (SMA) for a given period.
 * @param data Array of numbers (e.g., closing prices).
 * @param period The number of periods to average over.
 * @returns Array of SMA values, with initial values as null until enough data is available.
 */
export function calculateSMA(data: number[], period: number): (number | null)[] {
  if (period <= 0 || !data || data.length === 0) {
    return [];
  }

  const smaValues: (number | null)[] = new Array(data.length).fill(null);
  let sum = 0;

  for (let i = 0; i < data.length; i++) {
    sum += data[i];

    if (i >= period) {
      sum -= data[i - period]; // Subtract the value that falls out of the window
      smaValues[i] = sum / period;
    } else if (i === period - 1) {
      // First calculation point
      smaValues[i] = sum / period;
    }
  }

  return smaValues;
}

/**
 * Calculates the Relative Strength Index (RSI) for a given period.
 * @param data Array of numbers (e.g., closing prices).
 * @param period The number of periods (typically 14).
 * @returns Array of RSI values, with initial values as null.
 */
export function calculateRSI(data: number[], period: number): (number | null)[] {
  if (period <= 0 || !data || data.length < period) {
    return new Array(data.length).fill(null);
  }

  const rsiValues: (number | null)[] = new Array(data.length).fill(null);
  let gains = 0;
  let losses = 0;

  // Calculate initial average gain and loss for the first period
  for (let i = 1; i <= period; i++) {
    const change = data[i] - data[i - 1];
    if (change > 0) {
      gains += change;
    } else {
      losses -= change; // Losses are positive values
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Calculate first RSI value
  if (avgLoss === 0) {
    rsiValues[period] = 100;
  } else {
    const rs = avgGain / avgLoss;
    rsiValues[period] = 100 - (100 / (1 + rs));
  }

  // Calculate subsequent RSI values using Wilder's smoothing
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    let currentGain = 0;
    let currentLoss = 0;

    if (change > 0) {
      currentGain = change;
    } else {
      currentLoss = -change;
    }

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    if (avgLoss === 0) {
      rsiValues[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsiValues[i] = 100 - (100 / (1 + rs));
    }
  }

  return rsiValues;
} 