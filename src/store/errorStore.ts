import { create } from "zustand";

interface ErrorState {
  message: string | null;
  title: string | null;
  showRestartButton: boolean;
  showError: (title: string, message: string, showRestartButton?: boolean) => void;
  clearError: () => void;
}

export const useErrorStore = create<ErrorState>((set) => ({
  message: null,
  title: null,
  showRestartButton: false,
  showError: (title: string, message: string, showRestartButton: boolean = false) =>
    set({ title, message, showRestartButton }),
  clearError: () => set({ title: null, message: null, showRestartButton: false }),
}));

