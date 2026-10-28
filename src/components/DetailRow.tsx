import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface DetailRowProps {
  label: string;
  value: string;
  copyable?: boolean;
  truncate?: boolean;
  large?: boolean;
}

export default function DetailRow({ label, value, copyable = false, truncate = false, large = false }: DetailRowProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) {
        window.clearTimeout(resetTimer.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    if (!copyable || !value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (resetTimer.current !== null) {
        window.clearTimeout(resetTimer.current);
      }
      resetTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  return (
    <div className={`flex items-center ${large ? "py-1.5 text-[15px]" : "py-1 text-xs"}`}>
      <span className={`${large ? "w-32 text-gray-700" : "w-28 text-gray-500"} flex-shrink-0`}>
        {label}
      </span>
      {copyable ? (
        <span className="min-w-0 flex-1">
          <span
            role="button"
            tabIndex={0}
            onClick={handleCopy}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleCopy();
              }
            }}
            className={`block cursor-pointer select-all transition-colors ${
              truncate ? "truncate" : "break-all"
            } ${copied ? "text-primary-600" : "text-gray-900 hover:text-primary-600"}`}
          >
            {copied ? t("common.copied") : value}
          </span>
        </span>
      ) : (
        <span className={`flex-1 text-gray-900 ${truncate ? "truncate" : "break-all"}`}>{value}</span>
      )}
    </div>
  );
}

