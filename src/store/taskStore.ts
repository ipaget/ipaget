import { createWithEqualityFn } from "zustand/traditional";

export interface TaskProgress {
  type: string;
  task_id: string;
  task_type: string;
  status: string;
  progress: number;
  message: string;
  data?: Record<string, any>;
}

export interface Task {
  id: string;
  type: string;
  status: string;
  progress: number;
  message: string;
  data?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

interface TaskState {
  tasks: Map<string, Task>;
  addTask: (taskId: string, taskType: string, data?: Record<string, any>) => void;
  updateTask: (progress: TaskProgress) => void;
  getTask: (taskId: string) => Task | undefined;
  getTasksByType: (taskType: string) => Task[];
  getTasksByData: (filterFn: (data?: Record<string, any>) => boolean) => Task[];
  removeTask: (taskId: string) => void;
  clearCompletedTasks: () => void;
}

export const useTaskStore = createWithEqualityFn<TaskState>((set, get) => ({
  tasks: new Map(),
  
  addTask: (taskId, taskType, data) => {
    set((state) => {
      const newTasks = new Map(state.tasks);
      newTasks.set(taskId, {
        id: taskId,
        type: taskType,
        status: "pending",
        progress: 0,
        message: "Task created",
        data,
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
        // Monotonic guard: never let progress go backwards unless it is a terminal state.
        const isTerminalState = progress.status === "completed" || progress.status === "error";
        const safeProgress = isTerminalState || progress.progress >= existingTask.progress
          ? progress.progress
          : existingTask.progress;
        newTasks.set(progress.task_id, {
          ...existingTask,
          status: progress.status,
          progress: safeProgress,
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
  
  getTasksByData: (filterFn) => {
    return Array.from(get().tasks.values()).filter(task => filterFn(task.data));
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
