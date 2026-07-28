import { createWithEqualityFn } from "zustand/traditional";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/runtime";

export interface AppSettings {
  language: string;
  anisette_url: string;
  proxy_url: string;
}

interface SettingsState {
  settings: AppSettings;
  isLoaded: boolean;
  
  loadSettings: () => Promise<void>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = createWithEqualityFn<SettingsState>((set, get) => ({
  settings: {
    language: "en",
    anisette_url: "",
    proxy_url: "",
  },
  isLoaded: false,

  loadSettings: async () => {
    try {
      if (!isTauriRuntime()) {
        set({ isLoaded: true });
        return;
      }

      const settings = await invoke<AppSettings>("get_settings");
      set({ settings, isLoaded: true });
    } catch (error) {
      console.error("Failed to load settings:", error);
      set({ isLoaded: true });
    }
  },

  updateSettings: async (newSettings: Partial<AppSettings>) => {
    const currentSettings = get().settings;
    const updatedSettings = { ...currentSettings, ...newSettings };
    
    try {
      if (!isTauriRuntime()) {
        set({ settings: updatedSettings });
        return;
      }

      await invoke("save_settings", { settings: updatedSettings });
      set({ settings: updatedSettings });
    } catch (error) {
      console.error("Failed to save settings:", error);
      throw error;
    }
  },
}));



