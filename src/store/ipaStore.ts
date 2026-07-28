import { createWithEqualityFn } from "zustand/traditional";
import { invoke } from "@tauri-apps/api/core";
import { goServiceClient } from "../lib/goService";
import { isTauriRuntime } from "../lib/runtime";

export type IpaSource = "native" | "downloaded" | "signed";

export interface IpaMeta {
  path: string;
  name: string;
  size: number;
  source: IpaSource;
  appName?: string;
  bundleId?: string;
  version?: string;
  iconBase64?: string;
  minimumOsVersion?: string;
  certificateStatus?: string;
  signerName?: string;
  signerIdentity?: string;
  organization?: string;
  teamId?: string;
  purchaserEmail?: string;
  isEncrypted?: boolean;
}

interface IpaStoreState {
  byPath: { [path: string]: IpaMeta };
  pathsBySource: {
    native: string[];
    downloaded: string[];
    signed: string[];
  };
  isLoading: boolean;
  setLoading: (loading: boolean) => void;
  upsertMany: (items: IpaMeta[]) => void;
  indexNativeFromBackend: () => Promise<void>;
  markDownloaded: (path: string, fields?: Partial<IpaMeta>) => Promise<void>;
  markSigned: (path: string, fields?: Partial<IpaMeta>) => Promise<void>;
}

export const useIpaStore = createWithEqualityFn<IpaStoreState>((set, get) => ({
  byPath: {},
  pathsBySource: { native: [], downloaded: [], signed: [] },
  isLoading: false,

  setLoading: (loading) => set({ isLoading: loading }),

  upsertMany: (items) =>
    set((state) => {
      const byPath = { ...state.byPath };
      const pathsBySource: IpaStoreState["pathsBySource"] = {
        native: [...state.pathsBySource.native],
        downloaded: [...state.pathsBySource.downloaded],
        signed: [...state.pathsBySource.signed],
      };
      for (const item of items) {
        byPath[item.path] = { ...byPath[item.path], ...item };
        const list = pathsBySource[item.source];
        if (!list.includes(item.path)) list.push(item.path);
      }
      return { byPath, pathsBySource };
    }),

  indexNativeFromBackend: async () => {
    const { setLoading } = get();
    setLoading(true);
    try {
      const metas = isTauriRuntime()
        ? await invoke<IpaMeta[]>("get_downloaded_ipas")
        : await goServiceClient.listIPAFiles();
      
      set((state) => {
        const byPath = { ...state.byPath };
        const newNativePaths: string[] = [];
        
        // Create a set of new paths for quick lookup
        const newPathSet = new Set(metas.map(m => m.path));
        
        // Remove old native entries that are no longer present
        for (const path of state.pathsBySource.native) {
          if (!newPathSet.has(path) && byPath[path]?.source === "native") {
            delete byPath[path];
          }
        }
        
        // Add or update new native entries
        for (const meta of metas) {
          // Preserve existing metadata (like appName, icon) if path exists
          if (byPath[meta.path]) {
            byPath[meta.path] = { ...byPath[meta.path], ...meta };
          } else {
            byPath[meta.path] = meta;
          }
          newNativePaths.push(meta.path);
        }
        
        return {
          byPath,
          pathsBySource: {
            ...state.pathsBySource,
            native: newNativePaths,
          }
        };
      });
    } catch (error) {
      console.error("Failed to index native IPAs from backend:", error);
    } finally {
      setLoading(false);
    }
  },

  markDownloaded: async (path, fields) => {
    const { upsertMany } = get();
    const meta: IpaMeta = {
      ...fields,
      path,
      name: path.split(/[/\\]/).pop()!,
      size: fields?.size ?? 0,
      source: "downloaded",
    };
    upsertMany([meta]);
  },

  markSigned: async (path, fields) => {
    const { upsertMany } = get();
    const meta: IpaMeta = {
      ...fields,
      path,
      name: path.split(/[/\\]/).pop()!,
      size: fields?.size ?? 0,
      source: "signed",
    };
    upsertMany([meta]);
  },
}));

export function selectBySource(source: IpaSource) {
  return (state: IpaStoreState) =>
    state.pathsBySource[source]
      .map((p) => state.byPath[p])
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
}


