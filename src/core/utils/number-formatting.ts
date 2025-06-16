export function formatLargeNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) {
    return '0';
  }

  if (Math.abs(num) < 1000) {
    return num.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  }

  const units = ['K', 'M', 'B', 'T'];
  const unit = Math.floor((Math.abs(num).toString().length - 1) / 3) - 1;

  if (unit >= units.length) {
    return num.toExponential(2);
  }

  const value = num / Math.pow(1000, unit + 1);

  return (
    value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }) + units[unit]
  );
} 