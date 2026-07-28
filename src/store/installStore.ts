import { createWithEqualityFn } from "zustand/traditional";
import { goServiceClient } from "../lib/goService";
import { useTaskStore } from "./taskStore";

export type InstallTaskType = "install" | "uninstall";
export type InstallTaskStatus = "installing" | "uninstalling" | "completed" | "failed";

export interface InstallTask {
  id: string;
  type: InstallTaskType;
  udid?: string;
  bundleId?: string;
  certificateId?: string | null;
  appName?: string;
  filePath?: string;
  version?: string;
  progress: number;
  status: InstallTaskStatus;
  message?: string;
  startTime: number;
  endTime?: number;
  error?: string;
}

interface InstallState {
  tasks: InstallTask[];
  addTask: (task: Omit<InstallTask, "startTime" | "progress"> & { progress?: number }) => string;
  updateTask: (id: string, updates: Partial<InstallTask>) => void;
  removeTask: (id: string) => void;
  getTask: (id: string) => InstallTask | undefined;
  startInstall: (
    udid: string,
    filePath: string,
    bundleId?: string,
    version?: string,
    appName?: string,
    certificateId?: string | null,
  ) => Promise<string>;
  startUninstall: (udid: string, bundleId: string, appName?: string) => Promise<string>;
}

export const useInstallStore = createWithEqualityFn<InstallState>((set, get) => ({
  tasks: [],

  addTask: (task) => {
    const id = task.id ?? `install-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newTask: InstallTask = {
      ...task,
      id,
      startTime: Date.now(),
      progress: task.progress ?? 0,
    };
    set((state) => ({ tasks: [newTask, ...state.tasks] }));
    return id;
  },

  updateTask: (id, updates) => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    }));
  },

  removeTask: (id) => {
    set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
  },

  getTask: (id) => get().tasks.find((t) => t.id === id),

  startInstall: async (udid, filePath, bundleId, version, appName, certificateId) => {
    const response = await goServiceClient.installApp(udid, filePath, bundleId, version, certificateId);
    const taskId = response.task_id;

    // Optimistic task in install store
    get().addTask({
      id: taskId,
      type: "install",
      udid,
      bundleId,
      certificateId,
      filePath,
      version,
      appName,
      status: "installing",
      message: "Installing",
    });

    // Also register in taskStore for unified tracking
    try {
      useTaskStore.getState().addTask(taskId, "install", {
        udid,
        bundle_id: bundleId,
        certificate_id: certificateId,
        file_path: filePath,
        version,
        app_name: appName,
      });
    } catch {}

    return taskId;
  },

  startUninstall: async (udid, bundleId, appName) => {
    const response = await goServiceClient.uninstallApp(udid, bundleId);
    const taskId = (response as any)?.task_id || `uninstall-${Date.now()}`;

    get().addTask({
      id: taskId,
      type: "uninstall",
      udid,
      bundleId,
      appName,
      status: "uninstalling",
      message: "Uninstalling",
    });

    try {
      useTaskStore.getState().addTask(taskId, "uninstall", {
        udid,
        bundle_id: bundleId,
        app_name: appName,
      });
    } catch {}

    return taskId;
  },
}));

// Subscribe to taskStore to sync into install store
let installTaskSyncInitialized = false;
try {
  if (!installTaskSyncInitialized) {
    installTaskSyncInitialized = true;
    let prevTasks: Map<string, any> | null = null;
    useTaskStore.subscribe(
      (state) => {
        const tasks = state.tasks;
        if (tasks === prevTasks) return;
        prevTasks = tasks;

        const installApi = useInstallStore.getState();
        for (const task of tasks.values()) {
          if (task.type !== "install" && task.type !== "uninstall") continue;

          const statusMapInstall: Record<string, InstallTaskStatus> = {
            started: task.type === "install" ? "installing" : "uninstalling",
            progress: task.type === "install" ? "installing" : "uninstalling",
            completed: "completed",
            error: "failed",
          } as const;
          const nextStatus = statusMapInstall[task.status as keyof typeof statusMapInstall] || (task.type === "install" ? "installing" : "uninstalling");

          const udid = (task.data as any)?.udid as string | undefined;
          const bundleId = (task.data as any)?.bundle_id as string | undefined;
          const certificateId = (task.data as any)?.certificate_id as string | undefined;
          const filePath = (task.data as any)?.file_path as string | undefined;
          const version = (task.data as any)?.version as string | undefined;
          const appName = (task.data as any)?.app_name as string | undefined;

          const existing = installApi.getTask(task.id);
          if (!existing) {
            installApi.addTask({
              id: task.id,
              type: task.type as InstallTaskType,
              udid,
              bundleId,
              certificateId,
              filePath,
              version,
              appName,
              status: nextStatus,
              message: task.message,
              progress: task.progress,
              endTime: nextStatus === "completed" || nextStatus === "failed" ? Date.now() : undefined,
              error: nextStatus === "failed" ? task.message : undefined,
            });
          } else {
            installApi.updateTask(task.id, {
              status: nextStatus,
              message: task.message,
              progress: task.progress,
              udid: udid ?? existing.udid,
              bundleId: bundleId ?? existing.bundleId,
              certificateId: certificateId ?? existing.certificateId,
              filePath: filePath ?? existing.filePath,
              version: version ?? existing.version,
              appName: appName ?? existing.appName,
              endTime: nextStatus === "completed" || nextStatus === "failed" ? Date.now() : existing.endTime,
              error: nextStatus === "failed" ? task.message : existing.error,
            });
          }
        }
      }
    );
  }
} catch {}


