import { createWithEqualityFn } from "zustand/traditional";
import { goServiceClient } from "../lib/goService";
import { useTaskStore, Task } from "./taskStore";
import { useAccountStore } from "./accountStore";
import { useToastStore } from "./toastStore";
import { invoke } from "@tauri-apps/api/core";
import i18n from "../i18n";

export interface DownloadTask {
  id: string;
  bundleId: string;
  appName: string;
  fileName: string;
  progress: number;
  status: "downloading" | "completed" | "failed" | "cancelled";
  startTime: number;
  endTime?: number;
  lastUpdateTime: number;
  error?: string;
  filePath?: string;
  iconUrl?: string;
}

interface DownloadState {
  downloads: DownloadTask[];
  addDownload: (task: Omit<DownloadTask, "startTime" | "status" | "progress" | "lastUpdateTime">) => string;
  updateDownload: (id: string, updates: Partial<DownloadTask>) => void;
  removeDownload: (id: string) => void;
  clearCompleted: () => void;
  getDownload: (id: string) => DownloadTask | undefined;
  getActiveDownloadTaskByBundleId: (bundleId: string) => DownloadTask | undefined;
  startDownload: (
    bundleId: string,
    email: string,
    outputDir: string,
    appName?: string,
    iconUrl?: string,
    externalVersionId?: string
  ) => Promise<string>;
}

export const useDownloadStore = createWithEqualityFn<DownloadState>((set, get) => ({
  downloads: [],
  
  addDownload: (task) => {
    const id = task.id ?? `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const existing = get().downloads.find((download) => download.id === id);
    if (existing) {
      // Merge metadata for the same task id instead of creating a duplicate entry.
      // startDownload and the taskStore subscription can both try to register the same download.
      set((state) => ({
        downloads: state.downloads.map((download) =>
          download.id === id
            ? {
                ...download,
                bundleId: task.bundleId || download.bundleId,
                appName: task.appName || download.appName,
                fileName: task.fileName || download.fileName,
                filePath: task.filePath ?? download.filePath,
                iconUrl: task.iconUrl || download.iconUrl,
                lastUpdateTime: Date.now(),
              }
            : download
        ),
      }));
      return id;
    }

    const now = Date.now();
    const newTask: DownloadTask = {
      ...task,
      id,
      startTime: now,
      lastUpdateTime: now,
      status: "downloading",
      progress: 0,
    };

    set((state) => {
      // Guard again inside set() against concurrent duplicate inserts for the same id.
      if (state.downloads.some((download) => download.id === id)) {
        return state;
      }
      return {
        downloads: [newTask, ...state.downloads],
      };
    });

    return id;
  },
  
  updateDownload: (id, updates) => {
    set((state) => ({
      downloads: state.downloads.map((download) =>
        download.id === id ? { ...download, ...updates, lastUpdateTime: Date.now() } : download
      ),
    }));
  },
  
  removeDownload: (id) => {
    set((state) => ({
      downloads: state.downloads.filter((download) => download.id !== id),
    }));
  },
  
  clearCompleted: () => {
    set((state) => ({
      downloads: state.downloads.filter(
        (download) => download.status === "downloading"
      ),
    }));
  },
  
  getDownload: (id) => {
    return get().downloads.find((download) => download.id === id);
  },

  getActiveDownloadTaskByBundleId: (bundleId) => {
    return get().downloads.find(d => d.bundleId === bundleId && d.status === "downloading");
  },

  startDownload: async (bundleId, email, outputDir, appName, iconUrl, externalVersionId) => {
    const result = await goServiceClient.downloadApp(bundleId, email, outputDir, appName, iconUrl, externalVersionId);
    const taskId = result.task_id;

    get().addDownload({
      id: taskId,
      bundleId,
      appName: appName || bundleId,
      fileName: "",
      iconUrl,
    });

    // Register task in task store, which will sync to download store via subscription
    try {
      useTaskStore.getState().addTask(taskId, "download", {
        bundle_id: bundleId,
        app_name: appName || bundleId,
        icon_url: iconUrl,
        external_version_id: externalVersionId,
      });
    } catch {}

    return taskId;
  },
}));

// Sync taskStore updates into downloadStore
let downloadTaskSyncInitialized = false;
try {
  if (!downloadTaskSyncInitialized) {
    downloadTaskSyncInitialized = true;
    useTaskStore.subscribe((state: any) => {
      const tasksMap: Map<string, Task> = state.tasks as Map<string, Task>;
      const downloadsApi = useDownloadStore.getState();
      const list = Array.from(tasksMap.values());
      for (const task of list) {
        if (task.type !== "download") continue;
        const existing = downloadsApi.getDownload(task.id);
        const statusMap: Record<string, DownloadTask["status"]> = {
          started: "downloading",
          progress: "downloading",
          completed: "completed",
          error: "failed",
          cancelled: "cancelled",
        } as const;
        const mappedStatus = statusMap[task.status as keyof typeof statusMap] || "downloading";
        const filePath = (task.data as any)?.file_path as string | undefined;
        const bundleId = (task.data as any)?.bundle_id as string | undefined;
        const appName = (task.data as any)?.app_name as string | undefined;
        const iconUrl = (task.data as any)?.icon_url as string | undefined;
        const dataError = (task.data as any)?.error as string | undefined;
        const accountExpired = (task.data as any)?.account_expired as boolean | undefined;
        const email = (task.data as any)?.email as string | undefined;
        
        // Handle account expiration
        if (task.status === 'error' && accountExpired && email) {
          try {
            const accountStore = useAccountStore.getState();
            const toastStore = useToastStore.getState();
            
            // Logout the account from backend
            invoke("remove_saved_account", { email }).catch(console.error);
            
            // Remove account from store (logout)
            accountStore.removeAccount(email);
            
            // Show toast notification only, do NOT open login dialog
            toastStore.showToast(i18n.t('auth.sessionExpiredPrompt'), 'error');
          } catch (err) {
            console.error('[downloadStore] Failed to handle account expiration:', err);
          }
        }
        
        // Get error message from task.message first, then from task.data.error
        const getErrorMessage = () => {
          if (task.status !== 'error') return undefined;
          if (task.message) return task.message;
          if (dataError) return dataError;
          return 'Unknown error occurred';
        };

        if (!existing) {
          // Only add new download if it's a fresh "started" task
          // This prevents deleted tasks from reappearing when taskStore updates
          if (task.status === "started") {
            downloadsApi.addDownload({
              id: task.id,
              bundleId: bundleId || task.id,
              appName: appName || bundleId || task.id,
              fileName: "",
              filePath,
              endTime: mappedStatus === "completed" || mappedStatus === "failed" || mappedStatus === "cancelled" ? Date.now() : undefined,
              error: getErrorMessage(),
              iconUrl,
            });
          }
        } else {
          downloadsApi.updateDownload(task.id, {
            progress: task.progress,
            status: mappedStatus,
            error: getErrorMessage(),
            endTime: mappedStatus === "completed" || mappedStatus === "failed" || mappedStatus === "cancelled" ? Date.now() : undefined,
            filePath: filePath ?? existing.filePath,
            appName: appName || existing.appName,
            bundleId: bundleId || existing.bundleId,
            iconUrl: iconUrl || existing.iconUrl,
          });
        }
      }
    });
  }
} catch {}
