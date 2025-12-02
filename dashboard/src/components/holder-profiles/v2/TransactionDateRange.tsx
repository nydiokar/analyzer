import { format } from 'date-fns';

interface Props {
  oldestTimestamp?: number;
  newestTimestamp?: number;
}

export function TransactionDateRange({ oldestTimestamp, newestTimestamp }: Props) {
  if (!oldestTimestamp || !newestTimestamp) {
    return null;
  }

  const formatDate = (timestamp: number) => {
    return format(new Date(timestamp * 1000), 'MMM d, yyyy');
  };

  const oldestDate = formatDate(oldestTimestamp);
  const newestDate = formatDate(newestTimestamp);

  return (
    <div className="text-xs text-muted-foreground mt-2">
      Transactions from {oldestDate} to {newestDate}
    </div>
  );
}
