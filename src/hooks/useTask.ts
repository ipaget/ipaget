import { useEffect, useState, useCallback } from "react";
import { useTaskStore, Task, TaskProgress } from "../store/taskStore";

export interface TaskOptions {
  onStart?: (taskId: string) => void;
  onProgress?: (task: Task) => void;
  onComplete?: (task: Task) => void;
  onError?: (task: Task) => void;
  autoRemoveOnComplete?: boolean;
  autoRemoveDelay?: number;
}

export function useTask(taskType?: string, udid?: string, bundle_id?: string) {
  const { tasks, addTask, updateTask, getTask, getTasksByType, getTasksByUdidAndBundleId, removeTask } = useTaskStore();
  const [activeTasks, setActiveTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (taskType && udid && bundle_id) {
      setActiveTasks(getTasksByUdidAndBundleId(udid, bundle_id).filter(t => t.type === taskType));
    } else if (taskType) {
      setActiveTasks(getTasksByType(taskType));
    } else if (udid && bundle_id) {
      setActiveTasks(getTasksByUdidAndBundleId(udid, bundle_id));
    } else {
      setActiveTasks(Array.from(tasks.values()));
    }
  }, [tasks, taskType, udid, bundle_id]);

  const createTask = useCallback((
    taskId: string,
    type: string,
    options?: TaskOptions & { udid?: string; bundle_id?: string; file_path?: string }
  ) => {
    addTask(taskId, type, options?.udid, options?.bundle_id, options?.file_path);
    
    if (options?.onStart) {
      options.onStart(taskId);
    }
    
    return taskId;
  }, [addTask]);

  const isTaskRunning = useCallback((udid?: string, bundle_id?: string, type?: string) => {
    if (udid && bundle_id && type) {
      return activeTasks.some(
        task => task.udid === udid && 
                task.bundle_id === bundle_id && 
                task.type === type &&
                (task.status === "started" || task.status === "progress")
      );
    }
    return activeTasks.some(task => task.status === "started" || task.status === "progress");
  }, [activeTasks]);

  const getRunningTask = useCallback((udid?: string, bundle_id?: string, type?: string) => {
    if (udid && bundle_id && type) {
      return activeTasks.find(
        task => task.udid === udid && 
                task.bundle_id === bundle_id && 
                task.type === type &&
                (task.status === "started" || task.status === "progress")
      );
    }
    return activeTasks.find(task => task.status === "started" || task.status === "progress");
  }, [activeTasks]);

  return {
    tasks: activeTasks,
    allTasks: tasks,
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

  useEffect(() => {
    if (!taskId) return;

    const checkTask = () => {
      const currentTask = getTask(taskId);
      setTask(currentTask);

      if (currentTask) {
        if (currentTask.status === "started" || currentTask.status === "progress") {
          options?.onProgress?.(currentTask);
        } else if (currentTask.status === "completed") {
          options?.onComplete?.(currentTask);
          
          if (options?.autoRemoveOnComplete) {
            const delay = options.autoRemoveDelay || 1000;
            setTimeout(() => {
              removeTask(taskId);
            }, delay);
          }
        } else if (currentTask.status === "error") {
          options?.onError?.(currentTask);
        }
      }
    };

    const interval = setInterval(checkTask, 100);
    checkTask();

    return () => clearInterval(interval);
  }, [taskId, options, getTask, removeTask]);

  return task;
}

