import React, { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface DataTableColumn<T> {
  key: string;
  header: string | ReactNode;
  width: string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
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
}: DataTableProps<T>) {
  const gridTemplateColumns = selectable
    ? `40px ${columns.map(col => col.width).join(' ')}`
    : columns.map(col => col.width).join(' ');
  
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
    <>
      {/* Table Header */}
      <div
        className="grid gap-4 px-4 py-3 bg-gray-50 border-b border-gray-200 text-sm font-semibold text-gray-600 sticky top-0 z-10"
        style={{ gridTemplateColumns }}
      >
        {selectable && (
          <div className="flex items-center justify-center whitespace-nowrap cursor-pointer">
            <input
              type="checkbox"
              checked={selectedIds.size > 0 && selectedIds.size === data.length}
              onChange={onSelectAll}
              className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 cursor-pointer"
            />
          </div>
        )}
        {columns.map((column) => {
          const alignClass = column.align === 'center' ? 'justify-center' : column.align === 'right' ? 'justify-end' : 'justify-start';
          const textAlign = column.align === 'center' ? 'text-center' : column.align === 'right' ? 'text-right' : 'text-left';
          
          if (column.sortable && onSort) {
            return (
              <button
                key={column.key}
                onClick={() => onSort(column.key)}
                className={`${textAlign} hover:text-primary-600 transition-colors flex items-center ${alignClass} space-x-1 whitespace-nowrap`}
              >
                <span>{column.header}</span>
                {sortField === column.key && (
                  <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                )}
              </button>
            );
          }
          
          return (
            <div key={column.key} className={`${textAlign} whitespace-nowrap`}>
              {column.header}
            </div>
          );
        })}
      </div>

      {/* Table Body */}
      <div className="divide-y divide-gray-100">
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
                className={`grid gap-4 px-4 ${rowPadding} group cursor-default ${
                  isSelected
                    ? 'bg-primary-100'
                    : `${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-primary-50`
                } ${customClassName}`}
                style={{ gridTemplateColumns }}
              >
                {selectable && (
                  <div className={`flex items-center justify-center ${cellHeight} cursor-pointer`}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onSelect?.(itemKey)}
                      className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 cursor-pointer"
                    />
                  </div>
                )}
                {columns.map((column) => (
                  <div
                    key={column.key}
                    className={`flex items-center ${cellHeight} ${
                      column.align === 'center' ? 'justify-center' : column.align === 'right' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {column.render(item, index)}
                  </div>
                ))}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </>
  );
}

