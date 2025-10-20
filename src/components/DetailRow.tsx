import { useTranslation } from "react-i18next";
import CopyButton from "./CopyButton";

interface DetailRowProps {
  label: string;
  value: string;
  copyable?: boolean;
}

export default function DetailRow({ label, value, copyable = false }: DetailRowProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col py-2 border-b border-gray-100">
      <span className="text-xs font-semibold text-gray-500 mb-1">
        {label}
      </span>
      <div className="flex items-center space-x-2">
        <span className="text-sm text-gray-900 font-mono break-all flex-1">
          {value}
        </span>
        {copyable && <CopyButton text={value} />}
      </div>
    </div>
  );
}

