import { create } from "zustand";

interface ToastState {
  message: string | null;
  type: "info" | "success" | "warning" | "error";
  showProgress: boolean;
  progress: number;
  showToast: (
    message: string, 
    type?: "info" | "success" | "warning" | "error",
    showProgress?: boolean,
    progress?: number
  ) => void;
  updateProgress: (progress: number) => void;
  clearToast: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  type: "info",
  showProgress: false,
  progress: 0,
  showToast: (
    message: string, 
    type: "info" | "success" | "warning" | "error" = "info",
    showProgress: boolean = false,
    progress: number = 0
  ) =>
    set({ message, type, showProgress, progress }),
  updateProgress: (progress: number) => set({ progress }),
  clearToast: () => set({ message: null, showProgress: false, progress: 0 }),
}));

