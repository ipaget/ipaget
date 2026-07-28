import { createWithEqualityFn } from "zustand/traditional";
import { invoke } from "@tauri-apps/api/core";
// Removed unused useErrorStore import
import { useToastStore } from "./toastStore";
import i18n from "../i18n";
import { isTauriRuntime } from "../lib/runtime";
import { goServiceClient } from "../lib/goService";

export interface Account {
  email: string;
  country: string;
  last_login?: string;
}

const SELECTED_ACCOUNT_STORAGE_KEY = "ipaget.selectedAccountEmail";

function readSelectedAccountEmail(): string | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    const email = localStorage.getItem(SELECTED_ACCOUNT_STORAGE_KEY);
    return email && email.trim() ? email.trim() : null;
  } catch {
    return null;
  }
}

function writeSelectedAccountEmail(email: string | null) {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    if (email && email.trim()) {
      localStorage.setItem(SELECTED_ACCOUNT_STORAGE_KEY, email.trim());
    } else {
      localStorage.removeItem(SELECTED_ACCOUNT_STORAGE_KEY);
    }
  } catch {
    // ignore storage failures in private browsing / restricted environments
  }
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

  setSelectedAccount: (account) => {
    writeSelectedAccountEmail(account?.email || null);
    set({
      selectedAccount: account,
      isAuthenticated: !!account,
    });
  },

  addOrUpdateAccount: (account) => set((state) => {
    const existingIndex = state.accounts.findIndex(a => a.email === account.email);
    let newAccounts: Account[];
    
    if (existingIndex >= 0) {
      newAccounts = [...state.accounts];
      newAccounts[existingIndex] = { ...account, last_login: new Date().toISOString() };
    } else {
      newAccounts = [...state.accounts, { ...account, last_login: new Date().toISOString() }];
    }

    writeSelectedAccountEmail(account.email);

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

    writeSelectedAccountEmail(newSelectedAccount?.email || null);

    return {
      accounts: newAccounts,
      selectedAccount: newSelectedAccount,
      isAuthenticated: !!newSelectedAccount,
    };
  }),

  loadAccounts: async () => {
    try {
      let accounts: Account[] = [];

      if (isTauriRuntime()) {
        accounts = await invoke<Account[]>("get_saved_accounts");
      } else {
        // Web mode: restore accounts from backend keychain via API
        const emails = await goServiceClient.listAccounts();
        accounts = await Promise.all(
          emails.map(async (email) => {
            try {
              const info = await goServiceClient.getAccountInfo(email);
              return {
                email: info.email || email,
                country: info.storefront || "",
              } as Account;
            } catch {
              return { email, country: "" } as Account;
            }
          })
        );
      }

      const state = get();
      const preferredEmail =
        state.selectedAccount?.email ||
        readSelectedAccountEmail() ||
        accounts[0]?.email ||
        null;

      let newSelectedAccount: Account | null = null;
      if (preferredEmail) {
        newSelectedAccount =
          accounts.find((account) => account.email === preferredEmail) || null;
      }

      // Keep current selection if it still exists in the loaded list.
      if (!newSelectedAccount && state.selectedAccount) {
        newSelectedAccount =
          accounts.find((account) => account.email === state.selectedAccount?.email) || null;
      }

      writeSelectedAccountEmail(newSelectedAccount?.email || null);

      set({
        accounts,
        selectedAccount: newSelectedAccount,
        isAuthenticated: !!newSelectedAccount,
      });
    } catch (error) {
      console.error("Failed to load accounts:", error);
      writeSelectedAccountEmail(null);
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

  logout: () => {
    writeSelectedAccountEmail(null);
    set({
      selectedAccount: null,
      isAuthenticated: false,
    });
  },

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
