import { X, AlertCircle, RotateCw } from "lucide-react";
import { useErrorStore } from "../store/errorStore";
import { useTranslation } from "react-i18next";
import { relaunch } from "@tauri-apps/plugin-process";

export default function ErrorDialog() {
  const { t } = useTranslation();
  const { title, message, showRestartButton, clearError } = useErrorStore();

  if (!message) return null;

  const handleRestart = async () => {
    try {
      await relaunch();
    } catch (error) {
      console.error("Failed to restart app:", error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full animate-in fade-in zoom-in duration-200">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <AlertCircle className="text-red-600" size={24} />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">
                {title || t("common.error")}
              </h3>
            </div>
            <button
              onClick={clearError}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
          <p className="text-gray-600 mb-6 ml-13 whitespace-pre-line">{message}</p>
          <div className="flex justify-end gap-2">
            {showRestartButton && (
              <button
                onClick={handleRestart}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-2"
              >
                <RotateCw size={16} />
                {t("service.restartApp")}
              </button>
            )}
            <button
              onClick={clearError}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

