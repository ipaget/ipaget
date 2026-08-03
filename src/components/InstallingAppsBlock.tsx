import { useEffect, useState } from "react";
import { X, Check, Package } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useInstallStore } from "../store/installStore";
import type { Task } from "../store/taskStore";

interface InstallingAppsBlockProps {
  udid?: string;
  title?: string;
}

export default function InstallingAppsBlock({ udid, title }: InstallingAppsBlockProps) {
  const { t } = useTranslation();
  const installTasksRaw = useInstallStore((s) => s.tasks);
  const removeTask = useInstallStore((s) => s.removeTask);
  const installTasks = installTasksRaw.filter(t => t.type === "install" && (!udid || t.udid === udid)).map(t => ({
    id: t.id,
    type: "install",
    status: t.status === "completed" ? "completed" : t.status === "failed" ? "error" : "progress",
    progress: t.progress,
    message: t.message || "",
    data: {
      udid: t.udid,
      bundle_id: t.bundleId,
      file_path: t.filePath,
      version: t.version,
    },
    createdAt: t.startTime,
    updatedAt: t.endTime || Date.now(),
  } as Task));
  const [dismissingTasks, setDismissingTasks] = useState<Set<string>>(new Set());
  const [isVisible, setIsVisible] = useState(false);
  
  // Auto-dismiss completed tasks after 10 seconds
  useEffect(() => {
    const completedTasks = installTasks.filter(task => task.status === "completed");
    
    completedTasks.forEach(task => {
      if (!dismissingTasks.has(task.id)) {
        const timer = setTimeout(() => {
          removeTask(task.id);
        }, 10000);
        
        return () => clearTimeout(timer);
      }
    });
  }, [installTasks, removeTask, dismissingTasks]);
  
  const handleDismiss = (taskId: string) => {
    setDismissingTasks(prev => new Set(prev).add(taskId));
    setTimeout(() => {
      removeTask(taskId);
    }, 300);
  };
  
  const visibleTasks = installTasks.filter(task => !dismissingTasks.has(task.id));
  
  // Handle visibility animation
  useEffect(() => {
    if (visibleTasks.length > 0) {
      setIsVisible(true);
    } else if (isVisible) {
      const timer = setTimeout(() => setIsVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [visibleTasks.length, isVisible]);
  
  if (!isVisible && visibleTasks.length === 0) {
    return null;
  }
  
  const displayTitle = title || t("devices.installingApps");
  
  return (
    <div 
      className={`bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden mt-6 transition-all duration-300 ease-in-out ${
        visibleTasks.length === 0 ? 'animate-slideOut' : 'animate-slideIn'
      }`}
    >
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700">
          {displayTitle} ({visibleTasks.length})
        </h3>
      </div>
      
      <div className="divide-y divide-gray-100">
        {visibleTasks.map((task) => (
          <InstallTaskRow
            key={task.id}
            task={task}
            onDismiss={handleDismiss}
            isDismissing={dismissingTasks.has(task.id)}
          />
        ))}
      </div>
      
      <style>{`
        @keyframes slideIn {
          from {
            max-height: 0;
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            max-height: 1000px;
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes slideOut {
          from {
            max-height: 1000px;
            opacity: 1;
            transform: translateY(0);
          }
          to {
            max-height: 0;
            opacity: 0;
            transform: translateY(-10px);
          }
        }
        
        .animate-slideIn {
          animation: slideIn 300ms ease-out forwards;
        }
        
        .animate-slideOut {
          animation: slideOut 300ms ease-in forwards;
        }
      `}</style>
    </div>
  );
}

interface InstallTaskRowProps {
  task: Task;
  onDismiss: (taskId: string) => void;
  isDismissing: boolean;
}

function InstallTaskRow({ task, onDismiss, isDismissing }: InstallTaskRowProps) {
  const { t } = useTranslation();
  const isCompleted = task.status === "completed";
  const isError = task.status === "error";
  const isRunning = task.status === "started" || task.status === "progress";
  
  const getAppName = () => {
    if (task.data?.file_path) {
      const fileName = task.data.file_path.split(/[/\\]/).pop() || "";
      return fileName.replace(/\.(ipa|tipa)$/i, "");
    }
    return task.data?.bundle_id || t("common.unknownApp");
  };
  
  const getVersion = () => {
    return task.data?.version || "-";
  };
  
  return (
    <div
      className={`grid grid-cols-[48px_1fr_120px_100px_40px] gap-3 px-4 py-3 transition-all duration-300 ${
        isDismissing ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
      } ${
        isCompleted ? 'bg-green-50' : isError ? 'bg-red-50' : 'bg-white'
      }`}
    >
      {/* App Icon */}
      <div className="flex items-center">
        <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 shadow-sm">
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-400 to-blue-600">
            <Package className="text-white" size={20} />
          </div>
        </div>
      </div>
      
      {/* App Name */}
      <div className="flex flex-col justify-center min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {getAppName()}
        </p>
        <p className="text-xs text-gray-500 truncate">
          {task.data?.bundle_id || "-"}
        </p>
      </div>
      
      {/* Version */}
      <div className="flex items-center justify-center">
        <span className="text-xs text-gray-600">
          v{getVersion()}
        </span>
      </div>
      
      {/* Progress */}
      <div className="flex flex-col justify-center">
        {isRunning && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-gray-500">
              <span>{t("common.installing")}</span>
              <span>{Math.round(task.progress)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-600 h-full transition-all duration-300 ease-out"
                style={{ width: `${task.progress}%` }}
              />
            </div>
          </div>
        )}
        
        {isCompleted && (
          <div className="flex items-center justify-center space-x-1 text-green-600">
            <Check size={14} />
            <span className="text-xs font-medium">{t("common.completed")}</span>
          </div>
        )}
        
        {isError && (
          <div className="flex items-center justify-center">
            <span className="text-xs font-medium text-red-600">{t("common.error")}</span>
          </div>
        )}
      </div>
      
      {/* Action Button */}
      <div className="flex items-center justify-center">
        {isRunning && (
          <button
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            title={t("common.cancel")}
          >
            <X size={16} />
          </button>
        )}
        
        {(isCompleted || isError) && (
          <button
            onClick={() => onDismiss(task.id)}
            className={`p-1.5 rounded transition-colors ${
              isCompleted 
                ? 'text-green-600 hover:text-green-700 hover:bg-green-100' 
                : 'text-red-600 hover:text-red-700 hover:bg-red-100'
            }`}
            title={t("common.dismiss")}
          >
            {isCompleted ? <Check size={16} /> : <X size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}

