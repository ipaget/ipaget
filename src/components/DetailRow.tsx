import CopyButton from "./CopyButton";

interface DetailRowProps {
  label: string;
  value: string;
  copyable?: boolean;
}

export default function DetailRow({ label, value, copyable = false }: DetailRowProps) {
  return (
    <div className="flex items-center py-1 text-xs">
      <span className="w-28 flex-shrink-0 text-gray-500">
        {label}
      </span>
      <span className="flex-1 text-gray-900 break-all">
        {value}
      </span>
      {copyable && (
        <div className="ml-2 flex-shrink-0">
          <CopyButton text={value} size={14} className="!p-0" />
        </div>
      )}
    </div>
  );
}

