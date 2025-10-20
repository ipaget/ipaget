import { create } from "zustand";

export interface DownloadTask {
  id: string;
  bundleId: string;
  appName: string;
  fileName: string;
  progress: number;
  status: "downloading" | "completed" | "failed" | "cancelled";
  startTime: number;
  endTime?: number;
  error?: string;
  filePath?: string;
}

interface DownloadState {
  downloads: DownloadTask[];
  addDownload: (task: Omit<DownloadTask, "id" | "startTime" | "status" | "progress">) => string;
  updateDownload: (id: string, updates: Partial<DownloadTask>) => void;
  removeDownload: (id: string) => void;
  clearCompleted: () => void;
  getDownload: (id: string) => DownloadTask | undefined;
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  downloads: [],
  
  addDownload: (task) => {
    const id = `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newTask: DownloadTask = {
      ...task,
      id,
      startTime: Date.now(),
      status: "downloading",
      progress: 0,
    };
    
    set((state) => ({
      downloads: [newTask, ...state.downloads],
    }));
    
    return id;
  },
  
  updateDownload: (id, updates) => {
    set((state) => ({
      downloads: state.downloads.map((download) =>
        download.id === id ? { ...download, ...updates } : download
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
}));

