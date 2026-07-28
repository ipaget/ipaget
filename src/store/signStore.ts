import { createWithEqualityFn } from "zustand/traditional";
import { useTaskStore, Task } from "./taskStore";
import { useIpaStore } from "./ipaStore";

export type SignTaskStatus = "running" | "completed" | "failed";

export interface SignTask {
  id: string;
  type: string; // sign | resign | signing
  filePath?: string;
  bundleId?: string;
  appName?: string;
  version?: string;
  progress: number;
  status: SignTaskStatus;
  message?: string;
  startTime: number;
  endTime?: number;
  error?: string;
}

interface SignState {
  tasks: SignTask[];
  addTask: (task: Omit<SignTask, "startTime" | "progress"> & { progress?: number }) => string;
  updateTask: (id: string, updates: Partial<SignTask>) => void;
  removeTask: (id: string) => void;
  getTask: (id: string) => SignTask | undefined;
}

export const useSignStore = createWithEqualityFn<SignState>((set, get) => ({
  tasks: [],

  addTask: (task) => {
    const id = task.id ?? `sign-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const newTask: SignTask = {
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
}));

// Subscribe to taskStore to sync sign-related tasks into sign store
let signTaskSyncInitialized = false;
try {
  if (!signTaskSyncInitialized) {
    signTaskSyncInitialized = true;
    useTaskStore.subscribe((state: any) => {
      const tasksMap: Map<string, Task> = state.tasks as Map<string, Task>;
      const signApi = useSignStore.getState();
      const ipaApi = useIpaStore.getState();
      for (const task of tasksMap.values()) {
        if (task.type !== "sign" && task.type !== "resign" && task.type !== "signing" && task.type !== "export") continue;

        const statusMap: Record<string, SignTaskStatus> = {
          started: "running",
          progress: "running",
          completed: "completed",
          error: "failed",
        } as const;
        const nextStatus = statusMap[task.status as keyof typeof statusMap] || "running";

        const filePath = (task.data as any)?.file_path as string | undefined;
        const bundleId = (task.data as any)?.bundle_id as string | undefined;
        const version = (task.data as any)?.version as string | undefined;
        const appName = (task.data as any)?.app_name as string | undefined;

        const existing = signApi.getTask(task.id);
        if (!existing) {
          signApi.addTask({
            id: task.id,
            type: task.type,
            filePath,
            bundleId,
            appName,
            version,
            status: nextStatus,
            message: task.message,
            progress: task.progress,
            endTime: nextStatus === "completed" || nextStatus === "failed" ? Date.now() : undefined,
            error: nextStatus === "failed" ? task.message : undefined,
          });
        } else {
          signApi.updateTask(task.id, {
            status: nextStatus,
            message: task.message,
            progress: task.progress,
            filePath: filePath ?? existing.filePath,
            bundleId: bundleId ?? existing.bundleId,
            version: version ?? existing.version,
            appName: appName ?? existing.appName,
            endTime: nextStatus === "completed" || nextStatus === "failed" ? Date.now() : existing.endTime,
            error: nextStatus === "failed" ? task.message : existing.error,
          });
        }

        // When completed, mark in ipaStore as signed
        if (nextStatus === "completed" && filePath) {
          ipaApi.markSigned(filePath, { bundleId, appName, version }).catch(() => {});
        }
      }
    });
  }
} catch {}


