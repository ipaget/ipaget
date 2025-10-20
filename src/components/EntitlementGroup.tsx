import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import CopyButton from "./CopyButton";
import OverflowText from "./OverflowText";

interface EntitlementItem {
  key: string;
  value: string | string[] | boolean;
  type: string;
}

interface EntitlementGroupProps {
  title: string;
  icon?: string;
  items: EntitlementItem[];
  defaultExpanded?: boolean;
}

export default function EntitlementGroup({
  title,
  icon,
  items,
  defaultExpanded = false,
}: EntitlementGroupProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const renderValue = (value: string | string[] | boolean, key: string) => {
    if (typeof value === "boolean") {
      return (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
          value ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
        }`}>
          {value ? "true" : "false"}
        </span>
      );
    }

    if (Array.isArray(value)) {
      return (
        <div className="space-y-1">
          {value.map((item, index) => (
            <div
              key={index}
              className="flex items-center space-x-2 bg-gray-50 px-3 py-1.5 rounded group"
            >
              <OverflowText
                text={item}
                className="flex-1 text-sm font-mono text-gray-700"
              />
              <CopyButton text={item} size={12} />
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="flex items-center space-x-2 group">
        <OverflowText
          text={value}
          className="flex-1 text-sm font-mono text-gray-700"
        />
        <CopyButton text={value} size={12} />
      </div>
    );
  };

  if (items.length === 0) return null;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center space-x-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown size={16} className="text-gray-500 flex-shrink-0" />
        ) : (
          <ChevronRight size={16} className="text-gray-500 flex-shrink-0" />
        )}
        {icon && <span className="text-lg flex-shrink-0">{icon}</span>}
        <span className="font-semibold text-gray-900 flex-1 text-left">{title}</span>
        <span className="text-xs text-gray-500 flex-shrink-0">{items.length} items</span>
      </button>

      {isExpanded && (
        <div className="px-4 py-3 space-y-3 bg-white">
          {items.map((item) => (
            <div key={item.key} className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-medium text-gray-500">{item.key}</span>
                <CopyButton text={item.key} size={10} />
              </div>
              {renderValue(item.value, item.key)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

