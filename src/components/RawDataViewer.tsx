import { useState, useRef, useEffect, useMemo, useCallback, type ReactNode, type UIEvent } from "react";
import { X, Search as SearchIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import SearchHighlight from "./SearchHighlight";

const MIN_SEARCH_LENGTH = 2;
const SEARCH_CHUNK_SIZE = 40;
const INITIAL_RENDER_COUNT = 40;
const RENDER_BATCH_SIZE = 40;
const LOAD_AHEAD_PX = 900;
const JSON_RENDER_BATCH_SIZE = 80;

interface RawDataEntry {
  key: string;
  value: unknown;
  keySearchText: string;
}

interface EntryText {
  valueText: string;
  searchText: string;
}

interface RawDataViewerProps {
  data: Record<string, any>;
  excludeKeys?: string[];
  className?: string;
  alwaysShowSearch?: boolean;
  toolbarAction?: ReactNode;
}

export default function RawDataViewer({ data, excludeKeys = [], className = "", alwaysShowSearch = false, toolbarAction }: RawDataViewerProps) {
  const { t } = useTranslation();
  const [showSearch, setShowSearch] = useState(alwaysShowSearch);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copiedJsonPath, setCopiedJsonPath] = useState<string | null>(null);
  const [filteredEntries, setFilteredEntries] = useState<RawDataEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [renderedCount, setRenderedCount] = useState(INITIAL_RENDER_COUNT);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const copyTimerRef = useRef<number | null>(null);
  const entryTextCacheRef = useRef(new WeakMap<RawDataEntry, EntryText>());

  const excludeKeySignature = excludeKeys.join("\u0000");
  const entries = useMemo<RawDataEntry[]>(() => {
    const excludedKeys = new Set(excludeKeys);

    return Object.entries(data)
      .filter(([key]) => !excludedKeys.has(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({
        key,
        value: unwrapIORegistryValue(key, value),
        keySearchText: key.toLowerCase(),
      }));
  }, [data, excludeKeySignature]);

  const getEntryText = useCallback((entry: RawDataEntry): EntryText => {
    const cachedText = entryTextCacheRef.current.get(entry);
    if (cachedText) {
      return cachedText;
    }

    const valueText = typeof entry.value === "object" && entry.value !== null
      ? JSON.stringify(entry.value, null, 2) ?? "-"
      : String(entry.value ?? '-');
    const entryText = {
      valueText,
      searchText: valueText.toLowerCase(),
    };
    entryTextCacheRef.current.set(entry, entryText);
    return entryText;
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

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

  const copyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setCopiedJsonPath(null);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopiedKey(null), 1500);
    } catch (error) {
      console.error("Failed to copy raw data value:", error);
    }
  };

  const copyJsonToken = async (path: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(null);
      setCopiedJsonPath(path);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopiedJsonPath(null), 1500);
    } catch (error) {
      console.error("Failed to copy raw JSON token:", error);
    }
  };

  useEffect(() => {
    if (showSearch) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [showSearch]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    const normalizedQuery = searchQuery.trim().toLowerCase();

    if (normalizedQuery.length < MIN_SEARCH_LENGTH) {
      setIsSearching(false);
      setFilteredEntries(entries);
      return () => {
        cancelled = true;
      };
    }

    setIsSearching(true);
    setFilteredEntries([]);
    const results: RawDataEntry[] = [];
    let index = 0;

    const processChunk = () => {
      if (cancelled) return;

      const end = Math.min(index + SEARCH_CHUNK_SIZE, entries.length);
      for (; index < end; index += 1) {
        const entry = entries[index];
        if (entry.keySearchText.includes(normalizedQuery) || getEntryText(entry).searchText.includes(normalizedQuery)) {
          results.push(entry);
        }
      }

      if (index < entries.length) {
        timeoutId = window.setTimeout(processChunk, 0);
      } else {
        setFilteredEntries(results);
        setIsSearching(false);
      }
    };

    processChunk();
    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [entries, getEntryText, searchQuery]);

  useEffect(() => {
    setRenderedCount(INITIAL_RENDER_COUNT);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [entries, searchQuery]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || renderedCount >= filteredEntries.length) return;

    if (container.scrollHeight <= container.clientHeight + LOAD_AHEAD_PX) {
      setRenderedCount((current) => Math.min(current + RENDER_BATCH_SIZE, filteredEntries.length));
    }
  }, [filteredEntries.length, renderedCount]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - LOAD_AHEAD_PX) {
      setRenderedCount((current) => Math.min(current + RENDER_BATCH_SIZE, filteredEntries.length));
    }
  };

  const activeSearchQuery = searchQuery.trim().length >= MIN_SEARCH_LENGTH ? searchQuery.trim() : "";
  const visibleEntries = filteredEntries.slice(0, renderedCount);

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${className}`}>
      {(alwaysShowSearch || showSearch) && (
        <div className={`flex items-center justify-between border-b border-gray-200 bg-white ${alwaysShowSearch ? "px-6 py-3" : "px-6 pt-4 pb-3"}`}>
          {alwaysShowSearch ? <div>{toolbarAction}</div> : null}
          <div className="flex items-center">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("devices.searchRawData")}
                className={`${alwaysShowSearch ? "w-[300px]" : "w-full"} pl-9 pr-9 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent`}
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
            {searchQuery.trim().length === 1 && (
              <span className="ml-3 whitespace-nowrap text-xs text-gray-500">
                {t("devices.rawDataSearchHint")}
              </span>
            )}
          </div>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={`${alwaysShowSearch ? "p-0" : "p-6"} overflow-y-auto scrollbar-thin flex-1`}
      >
        {isSearching ? (
          <div className="text-center text-gray-500 py-8">{t("common.loading")}</div>
        ) : filteredEntries.length > 0 ? (
          <div className={alwaysShowSearch ? "py-3" : "bg-gray-50 rounded-lg p-4"}>
            {visibleEntries.map((entry) => {
              const isJsonValue = entry.value !== null && typeof entry.value === "object";
              const valueText = isJsonValue ? "" : getEntryText(entry).valueText;

              return (
                <div
                  key={entry.key}
                  style={{ contentVisibility: "auto", containIntrinsicSize: "0 64px" }}
                  className={`grid select-text min-w-0 border-b border-gray-200 last:border-0 ${
                    alwaysShowSearch
                      ? "grid-cols-[350px_1fr] gap-0 px-9 py-1.5 hover:bg-gray-100"
                      : "grid-cols-[200px_1fr] gap-4 py-2"
                  }`}
                >
                  <div className="font-mono text-xs font-semibold text-gray-700 break-words min-w-0">
                    <SearchHighlight text={entry.key} searchQuery={activeSearchQuery} />
                  </div>
                  <div
                    role={isJsonValue ? undefined : "button"}
                    tabIndex={isJsonValue ? undefined : 0}
                    onClick={isJsonValue ? undefined : () => copyValue(entry.key, valueText)}
                    onKeyDown={isJsonValue ? undefined : (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        copyValue(entry.key, valueText);
                      }
                    }}
                    className={`font-mono text-xs break-all whitespace-pre-wrap min-w-0 ${
                      isJsonValue ? "" : "cursor-pointer transition-colors"
                    } ${
                      isJsonValue
                        ? "text-gray-600"
                        : copiedKey === entry.key
                          ? "text-primary-600"
                          : "text-gray-600 hover:text-primary-600"
                    }`}
                  >
                    {!isJsonValue && copiedKey === entry.key ? t("common.copied") : isJsonValue ? (
                      <JsonValueView
                        value={entry.value}
                        path={entry.key}
                        searchQuery={activeSearchQuery}
                        copiedPath={copiedJsonPath}
                        copiedLabel={t("common.copied")}
                        onCopy={copyJsonToken}
                      />
                    ) : (
                      <SearchHighlight text={valueText} searchQuery={activeSearchQuery} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center text-gray-500 py-8">
            {activeSearchQuery ? t("devices.noSearchResults") : t("devices.noRawData")}
          </div>
        )}
      </div>
    </div>
  );
}

function unwrapIORegistryValue(key: string, value: unknown): unknown {
  const normalizedKey = key.toLowerCase();
  const isIORegistryEntry = normalizedKey.startsWith("ioregentry:") || normalizedKey.startsWith("ioregistry:");

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  if (isIORegistryEntry && Object.keys(value).length === 1 && Object.prototype.hasOwnProperty.call(value, "IORegistry")) {
    return (value as Record<string, unknown>).IORegistry;
  }

  return value;
}

interface JsonValueViewProps {
  value: unknown;
  path: string;
  searchQuery: string;
  copiedPath: string | null;
  copiedLabel: string;
  onCopy: (path: string, value: string) => void;
}

function JsonValueView({ value, path, searchQuery, copiedPath, copiedLabel, onCopy }: JsonValueViewProps) {
  const [lines, setLines] = useState<JsonLine[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    const iterator = createJsonLines(value, path);
    const generatedLines: JsonLine[] = [];
    let isDone = false;

    const renderChunk = () => {
      if (cancelled) return;

      for (let index = 0; index < JSON_RENDER_BATCH_SIZE; index += 1) {
        const next = iterator.next();
        if (next.done) {
          isDone = true;
          break;
        }
        generatedLines.push(next.value);
      }

      setLines([...generatedLines]);
      if (!isDone) {
        timeoutId = window.setTimeout(renderChunk, 0);
      }
    };

    setLines([]);
    renderChunk();
    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [value, path]);

  return (
    <>
      {lines.map((line, index) => (
        <div key={`${path}:${index}`} style={{ paddingLeft: `${line.indent * 16}px` }}>
          {line.parts.map((part, partIndex) => (
            part.copyText === undefined ? (
              <span key={partIndex}>{part.text}</span>
            ) : (
              <JsonCopyToken
                key={partIndex}
                path={part.path || `${path}:${index}:${partIndex}`}
                text={part.text}
                copyText={part.copyText}
                copiedText={copiedLabel}
                searchQuery={searchQuery}
                copiedPath={copiedPath}
                onCopy={onCopy}
              />
            )
          ))}
        </div>
      ))}
    </>
  );
}

interface JsonLine {
  indent: number;
  parts: JsonPart[];
}

interface JsonPart {
  text: string;
  copyText?: string;
  path?: string;
}

function* createJsonLines(
  value: unknown,
  path: string,
  indent = 0,
  prefix: JsonPart[] = [],
  trailingComma = false,
): Generator<JsonLine> {
  const suffix = trailingComma ? "," : "";

  if (value === null || typeof value !== "object") {
    yield {
      indent,
      parts: [
        ...prefix,
        {
          path,
          text: formatJsonPrimitive(value),
          copyText: formatJsonCopyText(value),
        },
        { text: suffix },
      ],
    };
    return;
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? value.map((child, index) => [String(index), child] as const)
    : Object.entries(value as Record<string, unknown>);

  yield {
    indent,
    parts: [...prefix, { text: isArray ? "[" : "{" }],
  };

  for (let index = 0; index < entries.length; index += 1) {
    const [key, child] = entries[index];
    const childPrefix = isArray
      ? []
      : [
          {
            path: `${path}.key.${key}`,
            text: JSON.stringify(key),
            copyText: key,
          },
          { text: ": " },
        ];
    yield* createJsonLines(child, `${path}.${key}`, indent + 1, childPrefix, index < entries.length - 1);
  }

  yield {
    indent,
    parts: [{ text: isArray ? "]" : "}" }, { text: suffix }],
  };
}

interface JsonCopyTokenProps {
  path: string;
  text: string;
  copyText: string;
  copiedText: string;
  searchQuery: string;
  copiedPath: string | null;
  onCopy: (path: string, value: string) => void;
}

function JsonCopyToken({ path, text, copyText, copiedText, searchQuery, copiedPath, onCopy }: JsonCopyTokenProps) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => onCopy(path, copyText)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onCopy(path, copyText);
        }
      }}
      className={`cursor-pointer transition-colors hover:text-primary-600 ${
        copiedPath === path ? "text-primary-600" : ""
      }`}
    >
      {copiedPath === path ? copiedText : (
        <SearchHighlight text={text} searchQuery={searchQuery} />
      )}
    </span>
  );
}

function formatJsonPrimitive(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function formatJsonCopyText(value: unknown): string {
  if (typeof value === "string") return value;
  return formatJsonPrimitive(value);
}

