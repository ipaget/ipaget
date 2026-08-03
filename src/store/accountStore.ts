import { createWithEqualityFn } from "zustand/traditional";
import { invoke } from "@tauri-apps/api/core";
// Removed unused useErrorStore import
import { useToastStore } from "./toastStore";
import i18n from "../i18n";

export interface Account {
  email: string;
  country: string;
  last_login?: string;
}

export type LoginDialogContext = "download" | "certificate";

interface AccountState {
  accounts: Account[];
  selectedAccount: Account | null;
  showLoginDialog: boolean;
  isAuthenticated: boolean;
  loginDialogPrefillEmail: string | null;
  loginDialogContext: LoginDialogContext;

  setAccounts: (accounts: Account[]) => void;
  setSelectedAccount: (account: Account | null) => void;
  addOrUpdateAccount: (account: Account) => void;
  removeAccount: (email: string) => void;
  loadAccounts: () => Promise<void>;
  setShowLoginDialog: (show: boolean, prefillEmail?: string, context?: LoginDialogContext) => void;
  logout: () => void;
  requireAuth: () => Promise<boolean>;
  requireRelogin: () => void;
}

export function handleTokenExpired() {
  const { requireRelogin } = useAccountStore.getState();
  const { showToast } = useToastStore.getState();
  
  console.log('[handleTokenExpired] Token expired, requiring relogin');
  
  try {
    showToast(i18n.t('auth.tokenExpired'), 'warning');
  } catch {}

  requireRelogin();
}

export const useAccountStore = createWithEqualityFn<AccountState>((set, get) => ({
  accounts: [],
  selectedAccount: null,
  showLoginDialog: false,
  isAuthenticated: false,
  loginDialogPrefillEmail: null,
  loginDialogContext: "download",

  setAccounts: (accounts) => set({ accounts }),

  setSelectedAccount: (account) => set({ 
    selectedAccount: account,
    isAuthenticated: !!account,
  }),

  addOrUpdateAccount: (account) => set((state) => {
    const existingIndex = state.accounts.findIndex(a => a.email === account.email);
    let newAccounts: Account[];
    
    if (existingIndex >= 0) {
      newAccounts = [...state.accounts];
      newAccounts[existingIndex] = { ...account, last_login: new Date().toISOString() };
    } else {
      newAccounts = [...state.accounts, { ...account, last_login: new Date().toISOString() }];
    }

    return {
      accounts: newAccounts,
      selectedAccount: account,
      isAuthenticated: true,
    };
  }),

  removeAccount: (email) => set((state) => {
    const newAccounts = state.accounts.filter(a => a.email !== email);
    const newSelectedAccount = state.selectedAccount?.email === email 
      ? (newAccounts.length > 0 ? newAccounts[0] : null)
      : state.selectedAccount;

    return {
      accounts: newAccounts,
      selectedAccount: newSelectedAccount,
      isAuthenticated: !!newSelectedAccount,
    };
  }),

  loadAccounts: async () => {
    try {
      const accounts = await invoke<Account[]>("get_saved_accounts");
      const state = get();
      
      let newSelectedAccount = state.selectedAccount;
      let newIsAuthenticated = state.isAuthenticated;
      
      if (state.selectedAccount) {
        const stillExists = accounts.find(a => a.email === state.selectedAccount?.email);
        if (!stillExists) {
          newSelectedAccount = null;
          newIsAuthenticated = false;
        }
      }
      
      set({ 
        accounts,
        selectedAccount: newSelectedAccount,
        isAuthenticated: newIsAuthenticated,
      });
    } catch (error) {
      console.error("Failed to load accounts:", error);
      set({ 
        accounts: [],
        selectedAccount: null,
        isAuthenticated: false,
      });
    }
  },

  setShowLoginDialog: (show, prefillEmail, context = "download") => set((state) => ({ 
    showLoginDialog: show,
    loginDialogPrefillEmail: prefillEmail || null,
    loginDialogContext: show ? context : state.loginDialogContext,
  })),

  logout: () => set({ 
    selectedAccount: null,
    isAuthenticated: false,
  }),

  requireAuth: async () => {
    const state = get();
    if (state.selectedAccount?.email) {
      return true;
    }
    set({ showLoginDialog: true, loginDialogPrefillEmail: null, loginDialogContext: "download" });
    return false;
  },

  requireRelogin: () => {
    const state = get();
    const email = state.selectedAccount?.email || null;
    set({ 
      showLoginDialog: true,
      loginDialogPrefillEmail: email,
      loginDialogContext: "download",
    });
  },
}));

