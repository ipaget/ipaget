import { useEffect, useState, useCallback, useRef } from "react";
import { useTaskStore, Task } from "../store/taskStore";

export interface TaskOptions {
  onStart?: (taskId: string) => void;
  onProgress?: (task: Task) => void;
  onComplete?: (task: Task) => void;
  onError?: (task: Task) => void;
  autoRemoveOnComplete?: boolean;
  autoRemoveDelay?: number;
}

// Custom equality function that compares task arrays by content, not reference
function areTaskArraysEqual(prev: Task[], next: Task[]): boolean {
  if (prev.length !== next.length) return false;
  
  // Compare each task by id and updatedAt timestamp
  for (let i = 0; i < prev.length; i++) {
    if (prev[i].id !== next[i].id || prev[i].updatedAt !== next[i].updatedAt) {
      return false;
    }
  }
  
  return true;
}

export function useTask(taskType?: string, dataFilter?: (data?: Record<string, any>) => boolean) {
  const { addTask, getTask, removeTask } = useTaskStore();
  
  // Use Zustand selector with custom equality to only re-render when tasks actually change
  const activeTasks = useTaskStore(
    state => {
      const tasksArray = Array.from(state.tasks.values());
      
      if (taskType && dataFilter) {
        return tasksArray.filter(t => t.type === taskType && dataFilter(t.data));
      } else if (taskType) {
        return tasksArray.filter(t => t.type === taskType);
      } else if (dataFilter) {
        return tasksArray.filter(t => dataFilter(t.data));
      } else {
        return tasksArray;
      }
    },
    areTaskArraysEqual
  );

  const createTask = useCallback((
    taskId: string,
    type: string,
    options?: TaskOptions & { data?: Record<string, any> }
  ) => {
    addTask(taskId, type, options?.data);
    
    if (options?.onStart) {
      options.onStart(taskId);
    }
    
    return taskId;
  }, [addTask]);

  const isTaskRunning = useCallback((dataFilter?: (data?: Record<string, any>) => boolean, type?: string) => {
    if (dataFilter && type) {
      return activeTasks.some(
        task => task.type === type && 
                dataFilter(task.data) &&
                (task.status === "started" || task.status === "progress")
      );
    }
    return activeTasks.some(task => task.status === "started" || task.status === "progress");
  }, [activeTasks]);

  const getRunningTask = useCallback((dataFilter?: (data?: Record<string, any>) => boolean, type?: string) => {
    if (dataFilter && type) {
      return activeTasks.find(
        task => task.type === type && 
                dataFilter(task.data) &&
                (task.status === "started" || task.status === "progress")
      );
    }
    return activeTasks.find(task => task.status === "started" || task.status === "progress");
  }, [activeTasks]);

  const allTasks = useTaskStore(state => state.tasks);
  
  return {
    tasks: activeTasks,
    allTasks,
    createTask,
    getTask,
    removeTask,
    isTaskRunning,
    getRunningTask,
  };
}

export function useTaskSubscription(taskId: string | undefined, options?: TaskOptions) {
  const { getTask, removeTask } = useTaskStore();
  const [task, setTask] = useState<Task | undefined>();
  const optionsRef = useRef(options);

  // Keep options ref up to date
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    if (!taskId) return;

    // Initial fetch
    setTask(getTask(taskId));

    // Subscribe to store changes (no polling)
    const unsubscribe = useTaskStore.subscribe((state: any, prevState: any) => {
      const updatedTask = state.tasks.get(taskId);
      const prevTask = prevState?.tasks?.get ? prevState.tasks.get(taskId) : undefined;
      if (updatedTask === prevTask) return;

      setTask(updatedTask);

      if (updatedTask) {
        const opts = optionsRef.current;
        if (updatedTask.status === "started" || updatedTask.status === "progress") {
          opts?.onProgress?.(updatedTask);
        } else if (updatedTask.status === "completed") {
          opts?.onComplete?.(updatedTask);
          if (opts?.autoRemoveOnComplete) {
            const delay = opts.autoRemoveDelay || 1000;
            setTimeout(() => {
              removeTask(updatedTask.id);
            }, delay);
          }
        } else if (updatedTask.status === "error") {
          opts?.onError?.(updatedTask);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [taskId, getTask, removeTask]);

  return task;
}

