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
  bytesDownloaded: number;
  totalBytes: number;
  speedBytesPerSecond: number;
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
  addDownload: (task: Omit<DownloadTask, "startTime" | "status" | "progress" | "lastUpdateTime" | "bytesDownloaded" | "totalBytes" | "speedBytesPerSecond">) => string;
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
    options?: { externalVersionId?: string; storeItemId?: number }
  ) => Promise<string>;
}

const taskStatusPollers = new Map<string, number>();
const reloginPromptedTasks = new Set<string>();
const notOwnedNotifiedTasks = new Set<string>();

const startTaskStatusPolling = (taskId: string) => {
  if (taskStatusPollers.has(taskId)) return;

  const poll = async () => {
    try {
      const progress = await goServiceClient.getTaskStatus(taskId);
      useTaskStore.getState().updateTask(progress);

      if (progress.status === "completed" || progress.status === "error" || progress.status === "cancelled") {
        const timer = taskStatusPollers.get(taskId);
        if (timer !== undefined) {
          window.clearInterval(timer);
          taskStatusPollers.delete(taskId);
        }
      }
    } catch {
    }
  };

  void poll();
  const timer = window.setInterval(poll, 250);
  taskStatusPollers.set(taskId, timer);
};

export const useDownloadStore = createWithEqualityFn<DownloadState>((set, get) => ({
  downloads: [],
  
  addDownload: (task) => {
    const id = task.id ?? `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();
    const newTask: DownloadTask = {
      ...task,
      id,
      startTime: now,
      lastUpdateTime: now,
      status: "downloading",
      progress: 0,
      bytesDownloaded: 0,
      totalBytes: 0,
      speedBytesPerSecond: 0,
    };
    set((state) => ({
      downloads: [newTask, ...state.downloads],
    }));
    
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

  startDownload: async (bundleId, email, outputDir, appName, iconUrl, options) => {
    const result = await goServiceClient.downloadApp(bundleId, email, outputDir, appName, iconUrl, options);
    const taskId = result.task_id;

    // Register task in task store, which will sync to download store via subscription
    try {
      useTaskStore.getState().addTask(taskId, "download", {
        bundle_id: bundleId,
        app_name: appName || bundleId,
        icon_url: iconUrl,
      });
    } catch {}

    startTaskStatusPolling(taskId);

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
        const bytesDownloaded = Number((task.data as any)?.bytes_downloaded || 0);
        const totalBytes = Number((task.data as any)?.total_bytes || 0);
        const speedBytesPerSecond = Number((task.data as any)?.speed_bytes_per_second || 0);
        const bundleId = (task.data as any)?.bundle_id as string | undefined;
        const appName = (task.data as any)?.app_name as string | undefined;
        const iconUrl = (task.data as any)?.icon_url as string | undefined;
        const dataError = (task.data as any)?.error as string | undefined;
        const accountExpired = (task.data as any)?.account_expired as boolean | undefined;
        const notOwned = (task.data as any)?.not_owned as boolean | undefined;
        const email = (task.data as any)?.email as string | undefined;
        
        // Handle account expiration
        if (task.status === 'error' && accountExpired && email && !reloginPromptedTasks.has(task.id)) {          reloginPromptedTasks.add(task.id);
          try {
            const accountStore = useAccountStore.getState();
            const toastStore = useToastStore.getState();

            void (async () => {
              try {
                await invoke("remove_saved_account", { email });
              } catch (err) {
                console.error("Failed to remove expired account:", err);
              }

              accountStore.removeAccount(email);
              accountStore.requireRelogin(email);
              toastStore.showToast(i18n.t('auth.sessionExpiredPrompt'), 'error');
            })();
          } catch (err) {
            console.error('[downloadStore] Failed to handle account expiration:', err);
          }
        }

        // Handle an app that the signed-in account does not own
        if (task.status === 'error' && notOwned && !notOwnedNotifiedTasks.has(task.id)) {
          notOwnedNotifiedTasks.add(task.id);
          try {
            useToastStore.getState().showToast(i18n.t('downloads.notOwned'), 'error');
          } catch (err) {
            console.error('[downloadStore] Failed to report the not-owned download:', err);
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
          if (task.status === "started" || mappedStatus !== "downloading") {
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

            if (mappedStatus !== "downloading") {
              downloadsApi.updateDownload(task.id, {
                progress: task.progress,
                status: mappedStatus,
                bytesDownloaded,
                totalBytes,
                speedBytesPerSecond,
              });
            }
          }
        } else {
          downloadsApi.updateDownload(task.id, {
            progress: task.progress,
            status: mappedStatus,
            bytesDownloaded,
            totalBytes,
            speedBytesPerSecond,
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

// Prevents permanently stale downloads when no terminal event arrives.
const STUCK_TIMEOUT_MS = 120 * 1000;
const WATCHDOG_INTERVAL_MS = 15 * 1000;
let watchdogStarted = false;

const startWatchdog = () => {
  if (watchdogStarted) return;
  watchdogStarted = true;
  setInterval(() => {
    const now = Date.now();
    const downloadsApi = useDownloadStore.getState();
    for (const download of downloadsApi.downloads) {
      if (download.status !== "downloading") continue;
      if (now - download.lastUpdateTime < STUCK_TIMEOUT_MS) continue;
      downloadsApi.updateDownload(download.id, {
        status: "failed",
        error: "Download timed out: no progress updates received",
        endTime: now,
      });
      console.error("[downloadStore] Marked stuck download as failed:", download.id);
    }
  }, WATCHDOG_INTERVAL_MS);
};

startWatchdog();

