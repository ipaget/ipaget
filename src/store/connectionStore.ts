import { create } from "zustand";

export type ConnectionStatus = "connected" | "connecting" | "disconnected" | "error";

interface ConnectionState {
  status: ConnectionStatus;
  reconnectAttempts: number;
  errorMessage: string | null;
  setStatus: (status: ConnectionStatus) => void;
  setReconnectAttempts: (attempts: number) => void;
  setErrorMessage: (message: string | null) => void;
  reset: () => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: "connecting",
  reconnectAttempts: 0,
  errorMessage: null,
  setStatus: (status) => set({ status }),
  setReconnectAttempts: (attempts) => set({ reconnectAttempts: attempts }),
  setErrorMessage: (message) => set({ errorMessage: message }),
  reset: () => set({ status: "connecting", reconnectAttempts: 0, errorMessage: null }),
}));

