import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import CustomSelect from "../CustomSelect";
import {
  PLIST_ALL_TYPES,
  PlistDictEntry,
  PlistNode,
  PlistNodeType,
  convertPlistNodeType,
  createDefaultPlistNode,
  summarizePlistNode,
} from "../../lib/plistTypes";

interface PlistTreeEditorProps {
  root: PlistNode;
  onChange: (nextRoot: PlistNode) => void;
  readOnly?: boolean;
}

interface NodeRowProps {
  label: string;
  node: PlistNode;
  depth: number;
  pathKey: string;
  canDelete: boolean;
  readOnly?: boolean;
  onChange: (nextNode: PlistNode) => void;
  onDelete?: () => void;
  onRename?: (nextLabel: string) => void;
}

function TypeSelect({
  value,
  disabled,
  onChange,
}: {
  value: PlistNodeType;
  disabled?: boolean;
  onChange: (nextType: PlistNodeType) => void;
}) {
  const { t } = useTranslation();
  return (
    <CustomSelect
      size="sm"
      className="w-[132px] shrink-0"
      value={value}
      disabled={disabled}
      onChange={(nextValue) => onChange(nextValue as PlistNodeType)}
      options={PLIST_ALL_TYPES.map((nodeType) => ({
        value: nodeType,
        label: t(`plist.types.${nodeType}`),
      }))}
    />
  );
}

function NodeRow({
  label,
  node,
  depth,
  pathKey,
  canDelete,
  readOnly,
  onChange,
  onDelete,
  onRename,
}: NodeRowProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(depth < 2);
  const isContainer = node.type === "dict" || node.type === "array";
  const paddingLeft = 12 + depth * 18;

  const childRows = useMemo(() => {
    if (node.type === "dict") {
      return node.entries.map((entry, index) => ({
        key: `${pathKey}.dict.${index}.${entry.key}`,
        label: entry.key,
        child: entry.value,
        index,
      }));
    }
    if (node.type === "array") {
      return node.items.map((item, index) => ({
        key: `${pathKey}.array.${index}`,
        label: `[${index}]`,
        child: item,
        index,
      }));
    }
    return [];
  }, [node, pathKey]);

  const updateDictEntry = (index: number, nextEntry: PlistDictEntry) => {
    if (node.type !== "dict") return;
    const entries = node.entries.map((entry, entryIndex) =>
      entryIndex === index ? nextEntry : entry
    );
    onChange({ type: "dict", entries });
  };

  const updateArrayItem = (index: number, nextItem: PlistNode) => {
    if (node.type !== "array") return;
    const items = node.items.map((item, itemIndex) =>
      itemIndex === index ? nextItem : item
    );
    onChange({ type: "array", items });
  };

  const deleteDictEntry = (index: number) => {
    if (node.type !== "dict") return;
    onChange({
      type: "dict",
      entries: node.entries.filter((_, entryIndex) => entryIndex !== index),
    });
  };

  const deleteArrayItem = (index: number) => {
    if (node.type !== "array") return;
    onChange({
      type: "array",
      items: node.items.filter((_, itemIndex) => itemIndex !== index),
    });
  };

  const addChild = () => {
    if (node.type === "dict") {
      let nextIndex = 1;
      let nextKey = `New Key ${nextIndex}`;
      const existingKeys = new Set(node.entries.map((entry) => entry.key));
      while (existingKeys.has(nextKey)) {
        nextIndex += 1;
        nextKey = `New Key ${nextIndex}`;
      }
      onChange({
        type: "dict",
        entries: [...node.entries, { key: nextKey, value: createDefaultPlistNode("string") }],
      });
      setExpanded(true);
      return;
    }
    if (node.type === "array") {
      onChange({
        type: "array",
        items: [...node.items, createDefaultPlistNode("string")],
      });
      setExpanded(true);
    }
  };

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <div
        className="flex min-h-11 items-center gap-2 py-1.5 pr-2"
        style={{ paddingLeft }}
      >
        <button
          type="button"
          className={`flex h-6 w-6 items-center justify-center rounded text-gray-500 ${
            isContainer ? "hover:bg-gray-100" : "invisible"
          }`}
          onClick={() => setExpanded((current) => !current)}
          disabled={!isContainer}
          aria-label={expanded ? t("plist.collapse") : t("plist.expand")}
        >
          {isContainer ? (
            expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : null}
        </button>

        {onRename && !readOnly ? (
          <input
            value={label}
            onChange={(event) => onRename(event.target.value)}
            className="h-8 min-w-[120px] max-w-[220px] flex-1 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
          />
        ) : (
          <span className="min-w-[120px] max-w-[220px] flex-1 truncate text-sm font-medium text-gray-800">
            {label}
          </span>
        )}

        <TypeSelect
          value={node.type}
          disabled={readOnly}
          onChange={(nextType) => onChange(convertPlistNodeType(node, nextType))}
        />

        <div className="min-w-0 flex-1">
          {node.type === "string" && (
            <input
              value={node.value}
              disabled={readOnly}
              onChange={(event) => onChange({ type: "string", value: event.target.value })}
              className="h-8 w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200 disabled:bg-gray-50"
            />
          )}
          {(node.type === "integer" || node.type === "real" || node.type === "uid") && (
            <input
              value={String(node.value)}
              disabled={readOnly}
              onChange={(event) => onChange({ type: node.type, value: event.target.value } as PlistNode)}
              className="h-8 w-full rounded-md border border-gray-300 bg-white px-2 font-mono text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200 disabled:bg-gray-50"
            />
          )}
          {node.type === "boolean" && (
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={node.value}
                disabled={readOnly}
                onChange={(event) => onChange({ type: "boolean", value: event.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              {node.value ? t("common.yes") : t("common.no")}
            </label>
          )}
          {node.type === "data" && (
            <input
              value={node.value}
              disabled={readOnly}
              onChange={(event) => onChange({ type: "data", value: event.target.value })}
              placeholder={t("plist.dataPlaceholder")}
              className="h-8 w-full rounded-md border border-gray-300 bg-white px-2 font-mono text-xs text-gray-900 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200 disabled:bg-gray-50"
            />
          )}
          {node.type === "date" && (
            <input
              value={node.value}
              disabled={readOnly}
              onChange={(event) => onChange({ type: "date", value: event.target.value })}
              placeholder="2024-01-01T00:00:00Z"
              className="h-8 w-full rounded-md border border-gray-300 bg-white px-2 font-mono text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200 disabled:bg-gray-50"
            />
          )}
          {(node.type === "dict" || node.type === "array" || node.type === "null") && (
            <span className="text-xs text-gray-500">{summarizePlistNode(node)}</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {isContainer && !readOnly && (
            <button
              type="button"
              onClick={addChild}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700 transition hover:bg-gray-50"
              title={t("plist.addChild")}
            >
              <Plus size={14} />
              {t("plist.add")}
            </button>
          )}
          {canDelete && !readOnly && onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-red-600 transition hover:bg-red-50"
              title={t("common.delete")}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {isContainer && expanded && (
        <div>
          {childRows.length === 0 ? (
            <div
              className="py-2 text-xs text-gray-400"
              style={{ paddingLeft: paddingLeft + 28 }}
            >
              {t("plist.emptyContainer")}
            </div>
          ) : (
            childRows.map((childRow) => (
              <NodeRow
                key={childRow.key}
                label={childRow.label}
                node={childRow.child}
                depth={depth + 1}
                pathKey={childRow.key}
                canDelete={!readOnly}
                readOnly={readOnly}
                onChange={(nextChild) => {
                  if (node.type === "dict") {
                    updateDictEntry(childRow.index, {
                      key: node.entries[childRow.index].key,
                      value: nextChild,
                    });
                  } else if (node.type === "array") {
                    updateArrayItem(childRow.index, nextChild);
                  }
                }}
                onDelete={() => {
                  if (node.type === "dict") {
                    deleteDictEntry(childRow.index);
                  } else if (node.type === "array") {
                    deleteArrayItem(childRow.index);
                  }
                }}
                onRename={
                  node.type === "dict"
                    ? (nextLabel) =>
                        updateDictEntry(childRow.index, {
                          key: nextLabel,
                          value: node.entries[childRow.index].value,
                        })
                    : undefined
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function PlistTreeEditor({
  root,
  onChange,
  readOnly = false,
}: PlistTreeEditorProps) {
  const { t } = useTranslation();

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
        <p className="text-sm font-medium text-gray-800">{t("plist.treeTitle")}</p>
      </div>
      <div className="max-h-[calc(100vh-260px)] overflow-auto">
        <NodeRow
          label={t("plist.root")}
          node={root}
          depth={0}
          pathKey="root"
          canDelete={false}
          readOnly={readOnly}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
