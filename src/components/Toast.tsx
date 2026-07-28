import { useEffect, useState } from "react";
import { X, Info, CheckCircle, AlertCircle, AlertTriangle, Loader2 } from "lucide-react";
import { useToastStore } from "../store/toastStore";

export default function Toast() {
  const { message, type, showProgress, progress, clearToast } = useToastStore();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (message) {
      setIsVisible(true);
      if (!showProgress) {
        const timer = setTimeout(() => {
          setIsVisible(false);
          setTimeout(() => {
            clearToast();
          }, 300);
        }, 3000);
        return () => clearTimeout(timer);
      }
    } else {
      setIsVisible(false);
    }
  }, [message, showProgress, clearToast]);

  if (!message) return null;

  const getIcon = () => {
    if (showProgress) {
      return <Loader2 className="text-blue-500 animate-spin" size={20} />;
    }
    switch (type) {
      case "success":
        return <CheckCircle className="text-green-500" size={20} />;
      case "error":
        return <AlertCircle className="text-red-500" size={20} />;
      case "warning":
        return <AlertTriangle className="text-yellow-500" size={20} />;
      default:
        return <Info className="text-blue-500" size={20} />;
    }
  };

  const getBgColor = () => {
    switch (type) {
      case "success":
        return "bg-green-50 border-green-200";
      case "error":
        return "bg-red-50 border-red-200";
      case "warning":
        return "bg-yellow-50 border-yellow-200";
      default:
        return "bg-blue-50 border-blue-200";
    }
  };

  const getProgressColor = () => {
    switch (type) {
      case "success":
        return "bg-green-500";
      case "error":
        return "bg-red-500";
      case "warning":
        return "bg-yellow-500";
      default:
        return "bg-blue-500";
    }
  };

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => {
      clearToast();
    }, 300);
  };

  return (
    <div className={`fixed bottom-4 right-4 z-[60] transition-all duration-300 ${
      isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
    }`}>
      <div
        className={`rounded-lg shadow-lg border ${getBgColor()} min-w-[300px] max-w-md overflow-hidden break-words`}
      >
        {showProgress && (
          <div className="w-full bg-gray-200 h-1">
            <div
              className={`h-1 ${getProgressColor()} transition-all duration-300`}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        <div className="flex items-start space-x-3 px-4 py-3">
          <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>
          <p className="flex-1 text-sm text-gray-900 break-words overflow-wrap-anywhere">{message}</p>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

