import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, X, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useConnectionStore } from "../store/connectionStore";
import { useTranslation } from "react-i18next";

export default function TitleBar() {
  const appWindow = getCurrentWindow();
  const { status, reconnectAttempts } = useConnectionStore();
  const { t } = useTranslation();

  const handleMinimize = () => {
    appWindow.minimize();
  };

  const handleClose = () => {
    appWindow.close();
  };

  const getStatusText = () => {
    switch (status) {
      case "connected":
        return t("service.connected");
      case "connecting":
        return reconnectAttempts > 0 
          ? t("service.reconnecting", { attempt: reconnectAttempts })
          : t("service.connecting");
      case "disconnected":
      case "error":
        return t("service.disconnected");
      default:
        return "";
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case "connected":
        return <Wifi size={14} className="text-green-700" />;
      case "connecting":
        return <RefreshCw size={14} className="text-yellow-700 animate-spin" />;
      case "disconnected":
      case "error":
        return <WifiOff size={14} className="text-red-700" />;
      default:
        return null;
    }
  };

  return (
    <div className="h-8 bg-white border-b border-gray-200 flex items-center justify-between select-none">
      <div data-tauri-drag-region className="flex-1 h-full flex items-center px-4 gap-3">
        <span className="text-sm font-semibold text-gray-700">iPAGet</span>
        
        {/* Connection Status Indicator */}
        {status !== "connected" && (
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${
            status === "connecting" ? "bg-yellow-100" :
            status === "error" || status === "disconnected" ? "bg-red-100" :
            "bg-gray-100"
          }`}>
            {getStatusIcon()}
            <span className="text-xs font-medium text-gray-700">
              {getStatusText()}
            </span>
          </div>
        )}
      </div>
      <div className="flex h-full">
        <button
          onClick={handleMinimize}
          className="w-12 h-full flex items-center justify-center hover:bg-gray-100 transition-colors"
          title="Minimize"
        >
          <Minus size={16} className="text-gray-600" />
        </button>
        <button
          onClick={handleClose}
          className="w-12 h-full flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
          title="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

