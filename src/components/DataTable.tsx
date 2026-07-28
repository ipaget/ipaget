import React, { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// Parse a width string (e.g. "minmax(80px, 1fr)", "120px", "1fr") into an initial px fallback
function parseWidthToPxFallback(width: string): number {
  const pxMatch = width.match(/(\d+(?:\.\d+)?)px/);
  if (pxMatch) return Math.max(40, parseFloat(pxMatch[1]));
  // Default fallback if no px specified
  return 140;
}

export interface DataTableColumn<T> {
  key: string;
  header: string | ReactNode;
  width: string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  minWidth?: number;
  scalePriority?: boolean;
  render: (item: T, index: number) => ReactNode;
}

export interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  keyExtractor: (item: T) => string;
  selectedIds?: Set<string>;
  onSelect?: (id: string) => void;
  onSelectAll?: () => void;
  onSort?: (key: string) => void;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  onRowClick?: (item: T, e: React.MouseEvent) => void;
  onContextMenu?: (item: T, e: React.MouseEvent) => void;
  emptyState?: ReactNode;
  selectable?: boolean;
  rowHeight?: 'normal' | 'large';
  getRowClassName?: (item: T) => string;
  removeAnimationDuration?: number;
  disableAnimation?: boolean;
  resizable?: boolean;
}

export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  selectedIds = new Set(),
  onSelect,
  onSelectAll,
  onSort,
  sortField,
  sortDirection,
  onRowClick,
  onContextMenu,
  emptyState,
  selectable = false,
  rowHeight = 'normal',
  getRowClassName,
  removeAnimationDuration = 300,
  disableAnimation = false,
  resizable = true,
}: DataTableProps<T>) {
  const headerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const headerContainerRef = useRef<HTMLDivElement | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastClientXRef = useRef<number>(0);
  const [headerPaddingLeft, setHeaderPaddingLeft] = useState<number>(0);

  // Compute initial widths immediately (no flicker)
  const initialWidths = useMemo(() => {
    if (!resizable) return null;
    return columns.map(col => Math.max(60, parseWidthToPxFallback(col.width)));
  }, [columns, resizable]);

  const minWidthsRef = useRef<number[]>(
    columns.map(c => Math.max(40, c.minWidth ?? 60))
  );

  const [columnWidths, setColumnWidths] = useState<number[] | null>(initialWidths);

  // Keep min widths in sync with latest columns
  useEffect(() => {
    minWidthsRef.current = columns.map(c => Math.max(40, c.minWidth ?? 60));
  }, [columns]);

  // Proportionally scale columns on container width change (no horizontal scroll)
  useEffect(() => {
    if (!resizable) return;
    const el = headerContainerRef.current;
    if (!el) return;
    
    let resizeTimeout: number | null = null;
    let rafId: number | null = null;
    let isFirstResize = true;
    
    const observer = new (window as any).ResizeObserver((entries: any) => {
      const entry = entries[0];
      const width: number = entry?.contentRect?.width || el.clientWidth;
      if (!width) return;
      
      // Cancel previous pending updates
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
        resizeTimeout = null;
      }
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      
      // Debounce resize updates (except first one for immediate layout)
      const applyResize = () => {
        const available = width - (selectable ? 40 : 0);
        if (available <= 0) return;
        let current = columnWidths;
        if (!current || current.length !== columns.length) {
          // Re-compute from column definitions if mismatch
          current = columns.map(col => Math.max(60, parseWidthToPxFallback(col.width)));
          setColumnWidths(current);
        }
        if (!current) return;
        const minArr = minWidthsRef.current.length === columns.length
          ? minWidthsRef.current
          : (minWidthsRef.current = columns.map(c => Math.max(40, c.minWidth ?? 60)));
        const sum = current.reduce((a, b) => a + b, 0);
        const delta = available - sum;
        if (Math.abs(delta) < 0.5) {
          isFirstResize = false;
          return;
        }
        const priorityIdxs = columns.map((c, i) => c.scalePriority ? i : -1).filter(i => i >= 0);
        let next = [...current];

        if (priorityIdxs.length > 0) {
          if (delta > 0) {
            // Grow: give all extra space to priority column(s) (equally)
            const share = delta / priorityIdxs.length;
            for (const i of priorityIdxs) {
              next[i] = Math.max(minArr[i], Math.floor(next[i] + share));
            }
          } else {
            // Shrink: take from priority column(s) first down to min; leftover from others proportionally
            let remaining = -delta;
            // First pass: reduce priority columns
            for (const i of priorityIdxs) {
              if (remaining <= 0) break;
              const cap = Math.max(0, next[i] - minArr[i]);
              const take = Math.min(cap, remaining);
              next[i] -= take;
              remaining -= take;
            }
            // Second pass: if still remaining, reduce others proportionally
            if (remaining > 0) {
              const otherIdxs = next.map((_, i) => i).filter(i => !priorityIdxs.includes(i));
              let adjustable = otherIdxs.filter(i => next[i] > minArr[i]);
              while (remaining > 0.5 && adjustable.length > 0) {
                const sumShares = adjustable.reduce((acc, i) => acc + next[i], 0) || adjustable.length;
                let consumed = 0;
                for (const i of adjustable) {
                  const share = next[i] / sumShares;
                  let take = remaining * share;
                  const cap = next[i] - minArr[i];
                  if (take > cap) take = cap;
                  next[i] -= take;
                  consumed += take;
                }
                remaining -= consumed;
                adjustable = adjustable.filter(i => next[i] > minArr[i] + 0.5);
                if (consumed === 0) break;
              }
            }
          }
          // Snap to integer px and fix rounding to exact available
          next = next.map((w, i) => Math.max(minArr[i], Math.floor(w)));
        let diff = available - next.reduce((a, b) => a + b, 0);
        if (diff !== 0) {
          const order = priorityIdxs.concat(next.map((_, i) => i).filter(i => !priorityIdxs.includes(i)));
          for (const i of order) {
            if (diff === 0) break;
            const step = diff > 0 ? 1 : -1;
            const candidate = next[i] + step;
            if (diff > 0 || candidate >= minArr[i]) {
              next[i] = candidate;
              diff -= step;
            }
          }
        }
        setColumnWidths(next);
        isFirstResize = false;
        return;
      }

      // Default: proportional scaling
      const scale = available / sum;
      let scaled = next.map((w, i) => Math.max(minArr[i], Math.floor(w * scale)));
      let diff = available - scaled.reduce((a, b) => a + b, 0);
      if (diff !== 0) {
        const indices = scaled
          .map((w, i) => ({ i, w }))
          .sort((a, b) => b.w - a.w)
          .map(x => x.i);
        for (const i of indices) {
          if (diff === 0) break;
          const step = diff > 0 ? 1 : -1;
          const candidate = scaled[i] + step;
          if (diff > 0 || candidate >= minArr[i]) {
            scaled[i] = candidate;
            diff -= step;
          }
        }
      }
      setColumnWidths(scaled);
      isFirstResize = false;
      };
      
      // Apply immediately on first resize, debounce subsequent ones with RAF
      if (isFirstResize) {
        rafId = requestAnimationFrame(applyResize);
      } else {
        resizeTimeout = window.setTimeout(() => {
          rafId = requestAnimationFrame(applyResize);
        }, 150);
      }
    });
    observer.observe(el);
    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [resizable, selectable, columns]);

  // Track header container padding-left for correct divider overlay alignment
  useEffect(() => {
    const el = headerContainerRef.current;
    if (!el) return;
    const updatePadding = () => {
      try {
        const cs = window.getComputedStyle(el);
        const padLeft = parseFloat(cs.paddingLeft || '0') || 0;
        setHeaderPaddingLeft(padLeft);
      } catch {}
    };
    updatePadding();
    const ro = new (window as any).ResizeObserver(updatePadding);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build CSS grid template columns string
  const gridTemplateColumns = useMemo(() => {
    if (resizable && columnWidths && columnWidths.length === columns.length) {
      const joined = columnWidths.map(w => `${w.toFixed(2)}px`).join(' ');
      return selectable ? `40px ${joined}` : joined;
    }
    // Fallback to provided widths
    const fallback = columns.map(col => col.width).join(' ');
    return selectable ? `40px ${fallback}` : fallback;
  }, [resizable, columnWidths, columns, selectable]);

  const dividerPositions = useMemo(() => {
    const widths = columnWidths && columnWidths.length === columns.length
      ? columnWidths
      : columns.map(col => Math.max(60, parseWidthToPxFallback(col.width)));
    const positions: number[] = [];
    let acc = selectable ? 40 : 0;
    for (let i = 0; i < widths.length - 1; i++) {
      acc += widths[i];
      positions.push(acc);
    }
    return positions;
  }, [columnWidths, columns, selectable]);

  // Drag-resize logic
  const draggingRef = useRef<{
    index: number;
    startX: number;
    startWidth: number;
    startWidths: number[];
    totalWidth: number;
    edge: 'left' | 'right';
  } | null>(null);

  const updateDragFrame = () => {
    rafIdRef.current = null;
    const state = draggingRef.current;
    if (!state || !resizable || !columnWidths) return;
    const clientX = lastClientXRef.current;
    const delta = clientX - state.startX;
    const start = state.startWidths;
    const min = minWidthsRef.current;
    const total = state.totalWidth;

    const targetIdx = state.index;
    const minSumOthers = start.reduce((acc, _, i) => i === targetIdx ? acc : acc + (min[i] ?? 60), 0);
    const maxTarget = total - minSumOthers;
    const desiredTarget = Math.min(Math.max(start[targetIdx] + delta, min[targetIdx] ?? 60), maxTarget);
    let d = desiredTarget - start[targetIdx];
    if (Math.abs(d) < 0.2) return;

    const current = [...start];
    current[targetIdx] = desiredTarget;
    const otherIdxs = current
      .map((_, i) => i)
      .filter(i => i !== targetIdx)
      .filter(i => state.edge === 'right' ? i > targetIdx : i < targetIdx);

    const distribute = (amount: number) => {
      let remainingLocal = amount;
      let adjustable = otherIdxs.filter(i => amount > 0 ? current[i] > (min[i] ?? 60) + 0.2 : true);
      const sign = amount > 0 ? -1 : 1;
      while (Math.abs(remainingLocal) > 0.2 && adjustable.length > 0) {
        const sumShares = adjustable.reduce((acc, i) => acc + start[i], 0) || adjustable.length;
        let consumed = 0;
        for (const i of adjustable) {
          const share = start[i] / sumShares;
          let take = Math.abs(remainingLocal) * share;
          if (amount > 0) {
            const minAllowed = min[i] ?? 60;
            const maxReduce = current[i] - minAllowed;
            if (take > maxReduce) take = maxReduce;
          }
          current[i] = current[i] + sign * take;
          consumed += take;
        }
        remainingLocal = (amount > 0 ? amount - consumed : amount + consumed);
        if (amount > 0) {
          adjustable = adjustable.filter(i => current[i] > (min[i] ?? 60) + 0.2);
        } else {
          if (Math.abs(remainingLocal) <= 0.2) break;
        }
        if (consumed === 0) break;
      }
    };

    if (d > 0) {
      distribute(d);
      const sumOthers = current.reduce((acc, w, i) => i === targetIdx ? acc : acc + w, 0);
      current[targetIdx] = total - sumOthers;
    } else {
      distribute(d);
      const sumOthers = current.reduce((acc, w, i) => i === targetIdx ? acc : acc + w, 0);
      current[targetIdx] = total - sumOthers;
      if (current[targetIdx] < (min[targetIdx] ?? 60)) {
        current[targetIdx] = (min[targetIdx] ?? 60);
      }
    }

    // Enforce mins strictly and preserve total by adjusting the target
    for (let i = 0; i < current.length; i++) {
      if (i === targetIdx) continue;
      const minI = min[i] ?? 60;
      if (current[i] < minI) {
        const inc = minI - current[i];
        current[i] = minI;
        current[targetIdx] = Math.max(min[targetIdx] ?? 60, current[targetIdx] - inc);
      }
    }
    // Final guard for target
    if (current[targetIdx] < (min[targetIdx] ?? 60)) {
      current[targetIdx] = (min[targetIdx] ?? 60);
    }

    setColumnWidths(current.map(w => Math.max(1, w)));
  };

  const onMouseMoveRaw = (e: MouseEvent) => {
    lastClientXRef.current = e.clientX;
    if (rafIdRef.current == null) {
      rafIdRef.current = window.requestAnimationFrame(updateDragFrame);
    }
  };

  const endDrag = () => {
    draggingRef.current = null;
    window.removeEventListener('mousemove', onMouseMoveRaw);
    window.removeEventListener('mouseup', endDrag);
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    try {
      document.body.style.cursor = '';
      (document.body.style as any).userSelect = '';
    } catch {}
  };

  const startDragAt = (e: React.MouseEvent, resizeIndex: number, edge: 'left' | 'right') => {
    if (!resizable) return;
    let start = columnWidths;
    if (!start || start.length !== columns.length) {
      // Lazy init widths on first drag
      start = columns.map(col => Math.max(60, parseWidthToPxFallback(col.width)));
      setColumnWidths(start);
    }
    if (minWidthsRef.current.length !== columns.length) {
      minWidthsRef.current = columns.map(c => Math.max(40, c.minWidth ?? 60));
    }
    if (!start) return;
    if (resizeIndex < 0 || resizeIndex >= start.length) return;
    e.preventDefault();
    e.stopPropagation();
    const startSnapshot = [...start];
    draggingRef.current = {
      index: resizeIndex,
      startX: e.clientX,
      startWidth: start[resizeIndex],
      startWidths: startSnapshot,
      totalWidth: startSnapshot.reduce((acc, w) => acc + w, 0),
      edge,
    };
    window.addEventListener('mousemove', onMouseMoveRaw);
    window.addEventListener('mouseup', endDrag);
    try {
      document.body.style.cursor = 'col-resize';
      (document.body.style as any).userSelect = 'none';
    } catch {}
  };
  
  const rowPadding = rowHeight === 'large' ? 'py-3' : 'py-2';
  const cellHeight = rowHeight === 'large' ? 'h-12' : 'h-8';

  const handleRowClick = (item: T, e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input[type="checkbox"]')) {
      return;
    }
    if (onRowClick) {
      onRowClick(item, e);
    } else if (onSelect && selectable) {
      onSelect(keyExtractor(item));
    }
  };

  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  const rowVariants = {
    initial: { opacity: 1, x: 0 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 120, transition: { duration: removeAnimationDuration / 1000, ease: 'easeOut' } },
  } as const;

  return (
    <div>
      {/* Table Header */}
      <div className="overflow-hidden" style={{ position: 'relative' }}>
        <div
          ref={headerContainerRef}
          className="grid gap-0 px-2 py-3 bg-gray-50 border-b border-gray-200 text-sm font-semibold text-gray-600 select-none overflow-visible sticky top-0 z-10"
          style={{ gridTemplateColumns }}
        >
          {selectable && (
            <div className="flex items-center justify-center whitespace-nowrap cursor-pointer px-2">
              <input
                type="checkbox"
                checked={selectedIds.size > 0 && selectedIds.size === data.length}
                onChange={onSelectAll}
                className="W-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 cursor-pointer"
              />
            </div>
          )}
          {columns.map((column, idx) => {
            const isSortable = column.sortable && onSort;
            const isLast = idx === columns.length - 1;
            const headerContent = (
              <span className="whitespace-nowrap">{column.header}</span>
            );

            return (
            <div
              key={column.key}
              ref={(el) => (headerRefs.current[idx] = el)}
              className={`relative flex items-center justify-center px-2 overflow-visible ${!isLast ? 'border-r border-gray-300' : ''}`}
            >
              {isSortable ? (
              <button
                  onClick={() => onSort && onSort(column.key)}
                  className="flex items-center space-x-1 hover:text-primary-600 transition-colors"
              >
                  {headerContent}
                {sortField === column.key && (
                    <span className="ml-1">{sortDirection === 'asc' ? '\u2191' : '\u2193'}</span>
                )}
              </button>
              ) : (
                headerContent
              )}
            </div>
          );
        })}
        {resizable && dividerPositions.map((left, i) => (
          <div
            key={`handle-${i}`}
            onMouseDown={(e) => startDragAt(e, i, 'right')}
            className="pointer-events-auto absolute top-0 h-full w-8 -translate-x-1/2 cursor-col-resize z-30"
            style={{ left: `${left + headerPaddingLeft}px` }}
          />
        ))}
        </div>
      </div>

      {/* Table Body */}
      <div className="divide-y divide-gray-100">
        {disableAnimation ? (
          <>
            {data.map((item, index) => {
              const itemKey = keyExtractor(item);
              const isSelected = selectedIds.has(itemKey);
              const customClassName = getRowClassName ? getRowClassName(item) : '';
              
              return (
                <div
                  key={itemKey}
                  onClick={(e) => handleRowClick(item, e)}
                  onContextMenu={(e) => onContextMenu?.(item, e)}
                  className={`grid gap-0 px-2 ${rowPadding} group cursor-default ${
                    isSelected
                      ? 'bg-primary-100'
                      : `${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-primary-50`
                  } ${customClassName}`}
                  style={{ gridTemplateColumns }}
                >
                  {selectable && (
                    <div className={`flex items-center justify-center ${cellHeight} cursor-pointer px-2`}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onSelect?.(itemKey)}
                        className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 cursor-pointer"
                      />
                    </div>
                  )}
                  {columns.map((column) => {
                    return (
                    <div
                      key={column.key}
                        className={`flex items-center ${cellHeight} px-2 ${
                        column.align === 'center' ? 'justify-center' : column.align === 'right' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {column.render(item, index)}
                    </div>
                    );
                  })}
                </div>
              );
            })}
          </>
        ) : (
          <AnimatePresence initial={false}>
            {data.map((item, index) => {
              const itemKey = keyExtractor(item);
              const isSelected = selectedIds.has(itemKey);
              const customClassName = getRowClassName ? getRowClassName(item) : '';
              
              return (
                <motion.div
                  key={itemKey}
                  layout
                  variants={rowVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  onClick={(e) => handleRowClick(item, e)}
                  onContextMenu={(e) => onContextMenu?.(item, e)}
                  className={`grid gap-0 px-2 ${rowPadding} group cursor-default ${
                    isSelected
                      ? 'bg-primary-100'
                      : `${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-primary-50`
                  } ${customClassName}`}
                  style={{ gridTemplateColumns }}
                >
                  {selectable && (
                    <div className={`flex items-center justify-center ${cellHeight} cursor-pointer px-2`}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onSelect?.(itemKey)}
                        className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 cursor-pointer"
                      />
                    </div>
                  )}
                  {columns.map((column) => {
                    return (
                    <div
                      key={column.key}
                        className={`flex items-center ${cellHeight} px-2 ${
                        column.align === 'center' ? 'justify-center' : column.align === 'right' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {column.render(item, index)}
                    </div>
                    );
                  })}
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

