import { useCallback, useEffect, useMemo, useState } from 'react';

export function useTableHudToggle(rowIds: string[]) {
  const normalizedIds = useMemo(
    () => Array.from(new Set(rowIds.filter(Boolean))),
    [rowIds]
  );

  const [showHud, setShowHud] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!showHud) {
      setExpandedRows(new Set());
      return;
    }
    setExpandedRows(new Set(normalizedIds));
  }, [showHud, normalizedIds]);

  const toggleAll = useCallback(() => {
    setShowHud((prev) => !prev);
  }, []);

  const toggleRow = useCallback((rowId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }, []);

  const isRowExpanded = useCallback(
    (rowId: string) => expandedRows.has(rowId),
    [expandedRows]
  );

  return {
    showHud,
    toggleAll,
    toggleRow,
    isRowExpanded,
  };
}
