import { create } from "zustand";

interface AuthState {
  isAuthenticated: boolean;
  userEmail: string | null;
  country: string | null;
  showLoginDialog: boolean;
  setAuthenticated: (value: boolean) => void;
  setUserEmail: (email: string | null) => void;
  setCountry: (country: string | null) => void;
  setAccountInfo: (email: string, country: string) => void;
  setShowLoginDialog: (show: boolean) => void;
  logout: () => void;
  requireAuth: () => Promise<boolean>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: false,
  userEmail: null,
  country: null,
  showLoginDialog: false,
  setAuthenticated: (value) => set({ isAuthenticated: value }),
  setUserEmail: (email) => set({ userEmail: email }),
  setCountry: (country) => set({ country: country }),
  setAccountInfo: (email, country) => set({ 
    isAuthenticated: true, 
    userEmail: email, 
    country: country 
  }),
  setShowLoginDialog: (show) => set({ showLoginDialog: show }),
  logout: () => set({ isAuthenticated: false, userEmail: null, country: null }),
  requireAuth: async () => {
    const state = get();
    if (state.isAuthenticated) {
      return true;
    }
    set({ showLoginDialog: true });
    return false;
  },
}));

