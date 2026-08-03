import { useState, useRef, useEffect } from "react";
import { X, Search as SearchIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import SearchHighlight from "./SearchHighlight";

interface RawDataViewerProps {
  data: Record<string, any>;
  excludeKeys?: string[];
  className?: string;
}

export default function RawDataViewer({ data, excludeKeys = [], className = "" }: RawDataViewerProps) {
  const { t } = useTranslation();
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !e.shiftKey) {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false);
        setSearchQuery('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearch]);

  useEffect(() => {
    if (showSearch) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [showSearch]);

  const filteredEntries = Object.entries(data)
    .filter(([key]) => !excludeKeys.includes(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([key, value]) => {
      if (!searchQuery.trim()) return true;

      const valueStr = typeof value === 'object' && value !== null
        ? JSON.stringify(value, null, 2)
        : String(value ?? '-');

      const searchLower = searchQuery.toLowerCase();
      const keyMatch = key.toLowerCase().includes(searchLower);
      const valueMatch = valueStr.toLowerCase().includes(searchLower);
      return keyMatch || valueMatch;
    });

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${className}`}>
      {showSearch && (
        <div className="px-6 pt-4 pb-3 border-b border-gray-200 bg-white">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("devices.searchRawData")}
              className="w-full pl-9 pr-9 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="p-6 overflow-y-auto scrollbar-thin flex-1">
        <div className="bg-gray-50 rounded-lg p-4">
          {filteredEntries.length > 0 ? (
            filteredEntries.map(([key, value]) => {
              const valueStr = typeof value === 'object' && value !== null
                ? JSON.stringify(value, null, 2)
                : String(value ?? '-');

              return (
                <div key={key} className="grid grid-cols-[200px_1fr] gap-4 py-2 border-b border-gray-200 last:border-0 select-text min-w-0">
                  <div className="font-mono text-xs font-semibold text-gray-700 break-words min-w-0">
                    <SearchHighlight text={key} searchQuery={searchQuery} />
                  </div>
                  <div className="font-mono text-xs text-gray-600 break-all whitespace-pre-wrap min-w-0">
                    <SearchHighlight text={valueStr} searchQuery={searchQuery} />
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center text-gray-500 py-8">
              {searchQuery ? t("devices.noSearchResults") : t("devices.noRawData")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

