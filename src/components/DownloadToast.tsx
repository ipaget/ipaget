import { useEffect, useState } from "react";
import { X, Download, CheckCircle, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface DownloadToastProps {
  appName: string;
  progress: number;
  status: "downloading" | "completed" | "error";
  message?: string;
  onCancel?: () => void;
  onClose: () => void;
}

export default function DownloadToast({
  appName,
  progress,
  status,
  message,
  onCancel,
  onClose,
}: DownloadToastProps) {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
    if (status === "completed" || status === "error") {
      const timer = setTimeout(() => {
        handleClose();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    handleClose();
  };

  return (
    <div
      className={`fixed bottom-4 right-4 w-96 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden transition-all duration-300 ${
        isVisible ? "translate-x-0 opacity-100" : "translate-x-full opacity-0"
      }`}
    >
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center space-x-2 flex-1">
            {status === "downloading" && (
              <Download className="text-blue-500 animate-pulse" size={20} />
            )}
            {status === "completed" && (
              <CheckCircle className="text-green-500" size={20} />
            )}
            {status === "error" && (
              <AlertCircle className="text-red-500" size={20} />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">
                {appName}
              </p>
              <p className="text-xs text-gray-500">
                {status === "downloading" && t("downloads.downloading")}
                {status === "completed" && t("downloads.completed")}
                {status === "error" && (message || t("downloads.failed"))}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="ml-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {status === "downloading" && (
          <>
            <div className="mb-2">
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>{t("downloads.progress")}</span>
                <span>{progress.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            {onCancel && (
              <button
                onClick={handleCancel}
                className="w-full mt-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
              >
                {t("common.cancel")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

