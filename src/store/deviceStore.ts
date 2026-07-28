import { createWithEqualityFn } from "zustand/traditional";
import type { DeviceInfo } from "../lib/goService";

export type { DeviceInfo };

export interface AppInfo {
  bundle_id: string;
  name: string;
  version: string;
  icon_url?: string;
  icon_data?: string;
  auth_type: string;
  build_machine_os_build?: string;
  cf_bundle_executable?: string;
  signer_identity?: string;
  minimum_os_version?: string;
  application_type?: string;
  path?: string;
  container?: string;
  cf_bundle_numeric_version?: number;
  sequence_number?: number;
  app_size?: number;
  data_size?: number;
  raw_data?: Record<string, any>;
  entitlements_xml?: string;
}

interface DeviceAppsCache {
  apps: AppInfo[];
  icons: Record<string, string>;
  loadedAt: number;
}

interface DeviceState {
  // Device Management
  connectedDevices: DeviceInfo[];
  selectedDevice: DeviceInfo | null;
  isRefreshing: boolean;
  refreshCompleted: boolean;
  refreshTrigger: number;
  
  // Pairing & Trust
  pendingPairDevice: string | null; // UDID of device that needs pairing
  showTrustDialog: boolean;
  trustStatus: "pairing" | "device_locked" | "waiting_trust" | "success" | "timeout";
  pairingDeviceUdid: string | null;
  
  // Device Apps Cache
  deviceAppsCache: Map<string, DeviceAppsCache>;
  
  // Actions
  setConnectedDevices: (devices: DeviceInfo[]) => void;
  setSelectedDevice: (device: DeviceInfo | null) => void;
  setIsRefreshing: (isRefreshing: boolean) => void;
  setRefreshCompleted: (completed: boolean) => void;
  setPendingPairDevice: (udid: string | null) => void;
  setShowTrustDialog: (show: boolean) => void;
  setTrustStatus: (status: "pairing" | "device_locked" | "waiting_trust" | "success" | "timeout") => void;
  setPairingDeviceUdid: (udid: string | null) => void;
  triggerRefresh: () => void;
  
  // Device Apps Cache Actions
  setDeviceAppsCache: (udid: string, apps: AppInfo[], icons: Record<string, string>) => void;
  getDeviceAppsCache: (udid: string) => DeviceAppsCache | undefined;
  clearDeviceAppsCache: (udid: string) => void;
  clearAllDeviceAppsCache: () => void;
}

export const useDeviceStore = createWithEqualityFn<DeviceState>((set, get) => ({
  // Device Management
  connectedDevices: [],
  selectedDevice: null,
  isRefreshing: false,
  refreshCompleted: false,
  refreshTrigger: 0,
  
  // Pairing & Trust
  pendingPairDevice: null,
  showTrustDialog: false,
  trustStatus: "pairing",
  pairingDeviceUdid: null,
  
  // Device Apps Cache
  deviceAppsCache: new Map(),
  
  // Actions
  setConnectedDevices: (devices) => set((state) => {
    // If no device is currently selected and we have devices, auto-select the first one
    let newSelectedDevice = state.selectedDevice;
    
    if (!state.selectedDevice && devices.length > 0) {
      newSelectedDevice = devices[0];
      console.log(`[DeviceStore] Auto-selecting first device: ${devices[0].name} (${devices[0].udid})`);
    } else if (state.selectedDevice) {
      // Check if the selected device is still connected
      const stillConnected = devices.find(d => d.udid === state.selectedDevice!.udid);
      if (!stillConnected) {
        // Selected device disconnected, clear selection or auto-select first device
        newSelectedDevice = devices.length > 0 ? devices[0] : null;
        if (newSelectedDevice) {
          console.log(`[DeviceStore] Previous device disconnected, auto-selecting: ${newSelectedDevice.name}`);
        } else {
          console.log(`[DeviceStore] Previous device disconnected, no devices available`);
        }
      }
    }
    
    console.log(`[DeviceStore] setConnectedDevices: ${devices.length} devices, selected: ${newSelectedDevice?.name || 'none'}`);
    
    return { 
      connectedDevices: devices,
      selectedDevice: newSelectedDevice
    };
  }),
  setSelectedDevice: (device) => set({ selectedDevice: device }),
  setIsRefreshing: (isRefreshing) => set({ isRefreshing }),
  setRefreshCompleted: (completed) => set({ refreshCompleted: completed }),
  setPendingPairDevice: (udid) => set({ pendingPairDevice: udid }),
  setShowTrustDialog: (show) => set({ showTrustDialog: show }),
  setTrustStatus: (status) => set({ trustStatus: status }),
  setPairingDeviceUdid: (udid) => set({ pairingDeviceUdid: udid }),
  triggerRefresh: () => {
    set((state) => ({ 
      refreshTrigger: state.refreshTrigger + 1
    }));
  },
  
  // Device Apps Cache Actions
  setDeviceAppsCache: (udid, apps, icons) => {
    set((state) => {
      const newCache = new Map(state.deviceAppsCache);
      newCache.set(udid, {
        apps,
        icons,
        loadedAt: Date.now(),
      });
      return { deviceAppsCache: newCache };
    });
  },
  
  getDeviceAppsCache: (udid) => {
    return get().deviceAppsCache.get(udid);
  },
  
  clearDeviceAppsCache: (udid) => {
    set((state) => {
      const newCache = new Map(state.deviceAppsCache);
      newCache.delete(udid);
      return { deviceAppsCache: newCache };
    });
  },
  
  clearAllDeviceAppsCache: () => {
    set({ deviceAppsCache: new Map() });
  },
}));

