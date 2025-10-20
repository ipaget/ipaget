import { invoke } from "@tauri-apps/api/core";

let serviceUrl: string | null = null;

export async function ensureServiceRunning(): Promise<string> {
  if (!serviceUrl) {
    const isRunning = await invoke<boolean>("is_go_service_running");
    if (!isRunning) {
      await invoke<number>("start_go_service");
    }
    serviceUrl = await invoke<string>("get_go_service_url");
  }
  return serviceUrl;
}

export interface StorageInfo {
  total_disk_capacity: number;
  total_data_capacity: number;
  total_system_capacity: number;
  total_data_available: number;
  amount_data_available: number;
  amount_data_reserved: number;
  total_system_available: number;
  used_space: number;
  used_percentage: number;
  available_percentage: number;
  formatted_total: string;
  formatted_used: string;
  formatted_available: string;
  camera_usage?: number;
  photo_usage?: number;
  calendar_usage?: number;
  notes_usage?: number;
  voicemail_usage?: number;
  web_cache_usage?: number;
  media_cache_usage?: number;
  calculate_status?: string;
}

export interface DeviceInfo {
  udid: string;
  name: string;
  model: string; // Product type identifier like "iPhone14,5" (use getDeviceModelName() to get friendly name)
  version: string; // iOS version like "18.7.1"
  color?: string; // Device color
  enclosure_color?: string; // Device enclosure color
  product_type: string; // Internal identifier like "iPhone14,5"
  product_name: string; // Like "A2634"
  build_version: string; // Like "22H31"
  firmware_version: string; // Firmware version like "iBoot-11881.140.96"
  serial_number: string; // Serial number
  imei?: string; // International Mobile Equipment Identity
  phone_number: string; // Phone number
  ecid?: string; // Exclusive Chip ID (last 16 chars of UDID)
  region_info: string; // Like "CH/A"
  model_number: string; // Like "MLE03"
  sales_model: string; // Sales model like "MLE03 CH/A"
  time_zone: string; // Time zone like "Asia/Shanghai"
  activation_state: string; // Activated/Unactivated
  is_paired: boolean; // Device pairing status
  is_jailbroken: boolean; // Jailbreak status
  cpu_architecture: string; // CPU type
  disk_type?: string; // Storage type
  battery_level: number; // Battery percentage
  battery_health: number; // Battery health percentage
  battery_cycle_count: number; // Charge cycles
  manufacture_date: string; // Production date
  warranty_expiration: string; // Warranty expiration
  apple_id_locked: boolean; // Apple ID lock status
  icloud_enabled: boolean; // iCloud status
  wifi_address: string; // WiFi MAC address
  bluetooth_address: string; // Bluetooth MAC address
  storage_info?: StorageInfo; // Device storage information
  raw_data?: Record<string, any>; // All raw device data from GetValues
}

export interface AppInfo {
  bundle_id: string;
  name: string;
  version: string;
  icon_url?: string;
  icon_data?: string;
  auth_type: string; // apple_store, shared, development, unknown, system
  build_machine_os_build?: string;
  cf_bundle_executable?: string;
  signer_identity?: string;
  minimum_os_version?: string;
  application_type?: string;
  path?: string;
  container?: string;
  cf_bundle_numeric_version?: number;
  sequence_number?: number;
  app_size?: number; // Static disk usage (app binary) in bytes
  data_size?: number; // Dynamic disk usage (documents) in bytes
  raw_data?: Record<string, any>;
  entitlements_xml?: string;
}

export interface DeviceAttachedEvent {
  type: "device_attached";
  device_id?: number;
  serial_number: string;
  properties?: any;
}

export interface DeviceDetachedEvent {
  type: "device_detached";
  device_id?: number;
  serial_number: string;
  properties?: any;
}

export interface AppSizeUpdateEvent {
  type: "app_size_update";
  udid: string;
  bundle_id: string;
  app_size: number;
  data_size: number;
}

export interface TaskProgressEvent {
  type: "task_progress";
  task_id: string;
  task_type: string;
  status: string;
  progress: number;
  message: string;
  udid?: string;
  bundle_id?: string;
  file_path?: string;
  data?: Record<string, any>;
}

export type WebSocketEvent =
  | DeviceAttachedEvent
  | DeviceDetachedEvent
  | AppSizeUpdateEvent
  | TaskProgressEvent;

export interface AuthResponse {
  success: boolean;
  requires_2fa?: boolean;
  email?: string;
  cookie_file?: string;
  message: string;
}

export interface AppSearchResult {
  id: number;
  bundle_id: string;
  name: string;
  version: string;
  price: number;
  formatted_price: string;
  icon_url: string;
  icon_url_60?: string;
  icon_url_100?: string;
  icon_url_512?: string;
  description: string;
  release_notes?: string;
  developer_name: string;
  developer_id?: number;
  genres?: string[];
  primary_genre?: string;
  content_rating?: string;
  average_rating?: number;
  rating_count?: number;
  file_size?: number;
  file_size_formatted?: string;
  minimum_os_version?: string;
  release_date?: string;
  current_version_release_date?: string;
}

export interface AppDetails extends AppSearchResult {
  screenshots?: string[];
  screenshots_ipad?: string[];
  supported_devices?: string[];
  language_codes?: string[];
  has_in_app_purchases: boolean;
}

export interface AppVersion {
  version_id: string;
  version_string: string;
  release_date?: string;
  success: boolean;
  error?: string;
}

export interface AppVersionHistory {
  bundle_id: string;
  app_name: string;
  latest_version: string;
  version_identifiers: string[];
  versions?: AppVersion[];
}

export interface AccountInfo {
  email: string;
  name: string;
  storefront: string;
}

export interface IPAInfo {
  name: string;
  bundle_id: string;
  version: string;
  minimum_os_version?: string;
  icon_base64?: string;
  file_path: string;
}

export interface FileItem {
  path: string;
  size: number;
  is_directory: boolean;
}

export interface ResourceItem {
  name: string;
  type: string;
  size: number;
}

export interface IPADetails {
  entitlements_xml: string;
  files: FileItem[];
  resources: ResourceItem[];
}

export class GoServiceClient {
  private baseUrl: string = "";
  private ws: WebSocket | null = null;
  private eventCallbacks: ((event: WebSocketEvent) => void)[] = [];
  private reconnectTimer: number | null = null;
  private reconnectAttempts: number = 0;
  private shouldReconnect: boolean = false;
  private errorCallback: ((error: Error, isWsError: boolean, reconnectAttempts: number) => void) | null = null;
  private statusCallback: ((status: "connected" | "connecting" | "disconnected" | "error", reconnectAttempts: number) => void) | null = null;

  async init() {
    this.baseUrl = await ensureServiceRunning();
  }

  async getWebSocketUrl(): Promise<string> {
    await this.init();
    return this.baseUrl.replace("http://", "ws://").replace("https://", "wss://") + "/ws";
  }

  setErrorCallback(callback: (error: Error, isWsError: boolean, reconnectAttempts: number) => void) {
    this.errorCallback = callback;
  }

  setStatusCallback(callback: (status: "connected" | "connecting" | "disconnected" | "error", reconnectAttempts: number) => void) {
    this.statusCallback = callback;
  }

  private notifyError(error: Error, isWsError: boolean = false) {
    if (this.errorCallback) {
      this.errorCallback(error, isWsError, this.reconnectAttempts);
    }
  }

  private notifyStatus(status: "connected" | "connecting" | "disconnected" | "error") {
    if (this.statusCallback) {
      this.statusCallback(status, this.reconnectAttempts);
    }
  }

  async listDevices(): Promise<DeviceInfo[]> {
    await this.init();
    try {
      const response = await fetch(`${this.baseUrl}/devices`);
      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error || "Failed to list devices");
        // Don't notify for one-time API errors
        throw error;
      }
      return result.data || [];
    } catch (error: any) {
      if (!error.message) {
        error = new Error("Network error: Unable to connect to Go service");
      }
      // Don't notify for one-time API errors
      throw error;
    }
  }

  async listConnectedDeviceUDIDs(): Promise<string[]> {
    await this.init();
    try {
      const response = await fetch(`${this.baseUrl}/devices/connected`);
      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error || "Failed to list connected devices");
        throw error;
      }
      return result.data || [];
    } catch (error: any) {
      if (!error.message) {
        error = new Error("Network error: Unable to connect to Go service");
      }
      throw error;
    }
  }

  async listApps(udid: string): Promise<AppInfo[]> {
    await this.init();
    try {
      const response = await fetch(`${this.baseUrl}/device/${udid}/apps`);
      const result = await response.json();
      if (!response.ok) {
        const error = new Error(result.error || "Failed to list apps");
        // Don't notify for one-time API errors
        throw error;
      }
      return result.data || [];
    } catch (error: any) {
      if (!error.message) {
        error = new Error("Network error: Unable to connect to Go service");
      }
      // Don't notify for one-time API errors
      throw error;
    }
  }

  async getAppIcons(udid: string, bundleIds: string[]): Promise<Record<string, string>> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/device/${udid}/icons`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bundle_ids: bundleIds }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Failed to get app icons");
    }
    return result.data || {};
  }

  async installApp(udid: string, ipaPath: string, bundleId?: string, version?: string): Promise<{ task_id: string }> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/device/${udid}/install`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        ipa_path: ipaPath,
        bundle_id: bundleId,
        version: version,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Failed to install app");
    }
    return result.data;
  }

  async launchApp(udid: string, bundleId: string): Promise<void> {
    await this.init();
    const response = await fetch(
      `${this.baseUrl}/device/${udid}/launch/${bundleId}`,
      {
        method: "POST",
      }
    );
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Failed to launch app");
    }
  }

  async killApp(udid: string, bundleId: string): Promise<void> {
    await this.init();
    const response = await fetch(
      `${this.baseUrl}/device/${udid}/kill/${bundleId}`,
      {
        method: "POST",
      }
    );
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Failed to kill app");
    }
  }

  async restartDevice(udid: string): Promise<void> {
    await this.init();
    const response = await fetch(
      `${this.baseUrl}/device/${udid}/restart`,
      {
        method: "POST",
      }
    );
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Failed to restart device");
    }
  }

  async shutdownDevice(udid: string): Promise<void> {
    await this.init();
    const response = await fetch(
      `${this.baseUrl}/device/${udid}/shutdown`,
      {
        method: "POST",
      }
    );
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Failed to shutdown device");
    }
  }

  async uninstallApp(udid: string, bundleId: string): Promise<void> {
    await this.init();
    const response = await fetch(
      `${this.baseUrl}/device/${udid}/app/${bundleId}`,
      {
        method: "DELETE",
      }
    );
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Failed to uninstall app");
    }
  }

  connectWebSocket(onEvent: (event: WebSocketEvent) => void) {
    if (!this.eventCallbacks.includes(onEvent)) {
      this.eventCallbacks.push(onEvent);
    }

    this.shouldReconnect = true;
    
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.initWebSocket();
    }
  }

  private async initWebSocket() {
    try {
      if (!this.baseUrl) {
        await this.init();
      }

      const wsUrl = this.baseUrl.replace("http://", "ws://");
      console.log(`Connecting to WebSocket: ${wsUrl}/ws (attempt ${this.reconnectAttempts + 1})`);
      
      this.notifyStatus("connecting");
      this.ws = new WebSocket(`${wsUrl}/ws`);

      this.ws.onopen = () => {
        console.log("WebSocket connected successfully");
        this.reconnectAttempts = 0;
        this.notifyStatus("connected");
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const wsEvent: WebSocketEvent = JSON.parse(event.data);
          console.log("WebSocket message received:", wsEvent);
          this.eventCallbacks.forEach((cb) => cb(wsEvent));
        } catch (err) {
          console.error("Failed to parse WebSocket message:", err);
        }
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        this.notifyStatus("error");
        // Notify error with current reconnect attempts
        this.notifyError(new Error("WebSocket connection failed"), true);
      };

      this.ws.onclose = (event) => {
        console.log(`WebSocket disconnected (code: ${event.code}, reason: ${event.reason})`);
        this.ws = null;
        
        if (event.code !== 1000) {
          this.notifyStatus("disconnected");
          this.notifyError(new Error("WebSocket connection closed unexpectedly"), true);
        }
        
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };
    } catch (error: any) {
      console.error("Failed to initialize WebSocket:", error);
      this.notifyStatus("error");
      this.notifyError(error instanceof Error ? error : new Error(String(error)), true);
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, Math.min(this.reconnectAttempts, 10)), 30000);
    
    console.log(`WebSocket will reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    this.reconnectTimer = window.setTimeout(() => {
      if (this.shouldReconnect) {
        this.initWebSocket();
      }
    }, delay);
  }

  disconnectWebSocket(onEvent?: (event: WebSocketEvent) => void) {
    if (onEvent) {
      this.eventCallbacks = this.eventCallbacks.filter((cb) => cb !== onEvent);
    } else {
      this.eventCallbacks = [];
    }

    if (this.eventCallbacks.length === 0) {
      this.shouldReconnect = false;
      
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      
      if (this.ws) {
        console.log("Closing WebSocket connection");
        this.ws.close();
        this.ws = null;
      }
      
      this.reconnectAttempts = 0;
    }
  }

  async login(email: string, password: string): Promise<AuthResponse> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Login failed");
    }
    
    return await response.json();
  }

  async verify2FA(
    email: string,
    password: string,
    code: string
  ): Promise<AuthResponse> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/auth/verify2fa`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, code }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "2FA verification failed");
    }
    
    return await response.json();
  }

  async logout(email: string): Promise<void> {
    await this.init();
    const response = await fetch(
      `${this.baseUrl}/auth/logout?email=${encodeURIComponent(email)}`,
      {
        method: "POST",
      }
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Logout failed");
    }
  }

  async checkAuth(email: string): Promise<boolean> {
    await this.init();
    const response = await fetch(
      `${this.baseUrl}/auth/check?email=${encodeURIComponent(email)}`
    );
    
    if (!response.ok) {
      return false;
    }
    
    const result = await response.json();
    return result.data?.authenticated || false;
  }

  async getAccountInfo(email: string): Promise<AccountInfo> {
    await this.init();
    const response = await fetch(
      `${this.baseUrl}/auth/info?email=${encodeURIComponent(email)}`
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to get account info");
    }
    
    const result = await response.json();
    return result.data;
  }

  async getCountryCode(email: string): Promise<string> {
    await this.init();
    const response = await fetch(
      `${this.baseUrl}/auth/country?email=${encodeURIComponent(email)}`
    );
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to get country code");
    }
    
    const result = await response.json();
    return result.data.country_code;
  }

  async searchApps(
    keyword: string,
    email: string,
    limit: number = 10
  ): Promise<AppSearchResult[]> {
    await this.init();
    const params = new URLSearchParams({
      keyword,
      email,
      limit: limit.toString(),
    });
    
    const response = await fetch(`${this.baseUrl}/apps/search?${params}`);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Search failed");
    }
    
    const result = await response.json();
    return result.data.apps || [];
  }

  async getAppDetails(bundleId: string, email: string): Promise<AppDetails> {
    await this.init();
    const params = new URLSearchParams({
      bundle_id: bundleId,
      email,
    });
    
    const response = await fetch(`${this.baseUrl}/apps/details?${params}`);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to get app details");
    }
    
    const result = await response.json();
    return result.data;
  }

  async getAppVersionHistory(bundleId: string, email: string): Promise<AppVersionHistory> {
    await this.init();
    const params = new URLSearchParams({
      bundle_id: bundleId,
      email,
    });
    
    const response = await fetch(`${this.baseUrl}/apps/versions?${params}`);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to get version history");
    }
    
    const result = await response.json();
    return result.data;
  }

  async getVersionDetails(
    bundleId: string,
    email: string,
    versionIds: string[]
  ): Promise<AppVersion[]> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/apps/version-details`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bundle_id: bundleId,
        email,
        version_ids: versionIds,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to get version details");
    }
    
    const result = await response.json();
    return result.data.versions || [];
  }

  async downloadApp(
    bundleId: string,
    email: string,
    outputDir: string,
    appName?: string
  ): Promise<{ task_id: string }> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/apps/download`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        bundle_id: bundleId,
        email,
        output_dir: outputDir,
        app_name: appName,
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Download failed");
    }
    
    const result = await response.json();
    return result.data;
  }

  async checkPairingStatus(udid: string): Promise<{ is_paired: boolean; waiting_for_trust: boolean; needs_pairing: boolean }> {
    const url = await ensureServiceRunning();
    const response = await fetch(`${url}/device/${udid}/pair-status`);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to check pairing status");
    }
    
    return await response.json();
  }

  async pairDevice(udid: string): Promise<{ success: boolean; waiting_for_trust?: boolean; message?: string }> {
    const url = await ensureServiceRunning();
    const response = await fetch(`${url}/device/${udid}/pair`, {
      method: "POST",
    });
    
    if (response.status === 202) {
      const data = await response.json();
      return {
        success: false,
        waiting_for_trust: true,
        message: data.message,
      };
    }
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to pair device");
    }
    
    return { success: true };
  }

  async parseIPA(filePath: string): Promise<IPAInfo> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/ipa/parse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file_path: filePath }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to parse IPA file");
    }
    
    const result = await response.json();
    return result.data;
  }

  async getIpaDetails(filePath: string): Promise<{ task_id: string }> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/ipa/details`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file_path: filePath }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to get IPA details");
    }
    
    const result = await response.json();
    return result.data;
  }
}

export const goServiceClient = new GoServiceClient();

export async function parseIPA(filePath: string): Promise<IPAInfo> {
  return goServiceClient.parseIPA(filePath);
}

