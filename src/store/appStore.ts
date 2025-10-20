import { create } from "zustand";

export interface AppInfo {
  bundle_id: string;
  name: string;
  version: string;
  icon_url?: string;
  price?: number;
  description?: string;
  rating?: number;
  download_count?: string;
}

export interface VersionInfo {
  version: string;
  release_date: string;
  size: string;
  notes?: string;
}

export interface IpaFileInfo {
  name: string;
  path: string;
  size: number;
  bundle_id: string;
  version: string;
  download_date: string;
  app_name?: string;
  icon_base64?: string;
  minimum_os_version?: string;
}

export interface AppSizeUpdate {
  udid: string;
  bundle_id: string;
  app_size: number;
  data_size: number;
}

interface AppState {
  searchResults: AppInfo[];
  selectedApp: AppInfo | null;
  appVersions: VersionInfo[];
  downloadedIpas: IpaFileInfo[];
  isLoading: boolean;
  setSearchResults: (results: AppInfo[]) => void;
  setSelectedApp: (app: AppInfo | null) => void;
  setAppVersions: (versions: VersionInfo[]) => void;
  setDownloadedIpas: (ipas: IpaFileInfo[]) => void;
  setLoading: (loading: boolean) => void;
  
  // App size updates from WebSocket
  appSizeUpdates: Map<string, AppSizeUpdate>; // key: `${udid}:${bundle_id}`
  updateAppSize: (update: AppSizeUpdate) => void;
  getAppSize: (udid: string, bundle_id: string) => AppSizeUpdate | undefined;
}

export const useAppStore = create<AppState>((set, get) => ({
  searchResults: [],
  selectedApp: null,
  appVersions: [],
  downloadedIpas: [],
  isLoading: false,
  setSearchResults: (results) => set({ searchResults: results }),
  setSelectedApp: (app) => set({ selectedApp: app }),
  setAppVersions: (versions) => set({ appVersions: versions }),
  setDownloadedIpas: (ipas) => set({ downloadedIpas: ipas }),
  setLoading: (loading) => set({ isLoading: loading }),
  
  appSizeUpdates: new Map(),
  updateAppSize: (update) => {
    const key = `${update.udid}:${update.bundle_id}`;
    set((state) => {
      const newMap = new Map(state.appSizeUpdates);
      newMap.set(key, update);
      return { appSizeUpdates: newMap };
    });
  },
  getAppSize: (udid, bundle_id) => {
    const key = `${udid}:${bundle_id}`;
    return get().appSizeUpdates.get(key);
  },
}));

