import { create } from "zustand";

export interface TaskProgress {
  type: string;
  task_id: string;
  task_type: string;
  status: string;
  progress: number;
  message: string;
  udid?: string;
  bundle_id?: string;
  file_path?: string;
  data?: Record<string, any>;
}

export interface Task {
  id: string;
  type: string;
  status: string;
  progress: number;
  message: string;
  udid?: string;
  bundle_id?: string;
  file_path?: string;
  data?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

interface TaskState {
  tasks: Map<string, Task>;
  addTask: (taskId: string, taskType: string, udid?: string, bundle_id?: string, file_path?: string) => void;
  updateTask: (progress: TaskProgress) => void;
  getTask: (taskId: string) => Task | undefined;
  getTasksByType: (taskType: string) => Task[];
  getTasksByUdidAndBundleId: (udid: string, bundle_id: string) => Task[];
  removeTask: (taskId: string) => void;
  clearCompletedTasks: () => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: new Map(),
  
  addTask: (taskId, taskType, udid, bundle_id, file_path) => {
    set((state) => {
      const newTasks = new Map(state.tasks);
      newTasks.set(taskId, {
        id: taskId,
        type: taskType,
        status: "pending",
        progress: 0,
        message: "Task created",
        udid,
        bundle_id,
        file_path,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { tasks: newTasks };
    });
  },
  
  updateTask: (progress) => {
    set((state) => {
      const newTasks = new Map(state.tasks);
      const existingTask = newTasks.get(progress.task_id);
      
      if (existingTask) {
        newTasks.set(progress.task_id, {
          ...existingTask,
          status: progress.status,
          progress: progress.progress,
          message: progress.message,
          data: progress.data,
          updatedAt: Date.now(),
        });
      } else {
        newTasks.set(progress.task_id, {
          id: progress.task_id,
          type: progress.task_type,
          status: progress.status,
          progress: progress.progress,
          message: progress.message,
          udid: progress.udid,
          bundle_id: progress.bundle_id,
          file_path: progress.file_path,
          data: progress.data,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      
      return { tasks: newTasks };
    });
  },
  
  getTask: (taskId) => {
    return get().tasks.get(taskId);
  },
  
  getTasksByType: (taskType) => {
    return Array.from(get().tasks.values()).filter(task => task.type === taskType);
  },
  
  getTasksByUdidAndBundleId: (udid, bundle_id) => {
    return Array.from(get().tasks.values()).filter(
      task => task.udid === udid && task.bundle_id === bundle_id
    );
  },
  
  removeTask: (taskId) => {
    set((state) => {
      const newTasks = new Map(state.tasks);
      newTasks.delete(taskId);
      return { tasks: newTasks };
    });
  },
  
  clearCompletedTasks: () => {
    set((state) => {
      const newTasks = new Map(state.tasks);
      for (const [taskId, task] of newTasks.entries()) {
        if (task.status === "completed" || task.status === "error") {
          newTasks.delete(taskId);
        }
      }
      return { tasks: newTasks };
    });
  },
}));

