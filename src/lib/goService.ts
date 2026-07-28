import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./runtime";
import type { PlistNode, PlistParseResult } from "./plistTypes";

export class TokenExpiredError extends Error {
  constructor(message: string = "password token expired") {
    super(message);
    this.name = "TokenExpiredError";
  }
}

let serviceUrl: string | null = null;

const DEFAULT_DEV_SERVICE_URL = "/api";

// Error message to i18n key mapping
const ERROR_MESSAGE_TO_KEY: Record<string, string> = {
  "invalid username or password": "auth.errors.invalidUsernameOrPassword",
  "enter the correct password": "auth.errors.invalidUsernameOrPassword",
  "account is disabled": "auth.errors.accountDisabled",
  "too many attempts": "auth.errors.tooManyAttempts",
  "network timeout": "auth.errors.networkTimeout",
  "invalid or expired verification code": "auth.errors.invalidOrExpiredCode",
  "incorrect verification code": "auth.errors.invalidOrExpiredCode",
  "failed to get mac address": "auth.errors.failedToGetMacAddress",
  "apple service error": "auth.errors.appleServiceError",
};

export function getAuthErrorKey(message: string): string | null {
  const lowerMessage = message.toLowerCase();
  for (const [key, value] of Object.entries(ERROR_MESSAGE_TO_KEY)) {
    if (lowerMessage.includes(key)) {
      return value;
    }
  }
  return null;
}

export async function ensureServiceRunning(): Promise<string> {
  if (!serviceUrl) {
    if (!isTauriRuntime()) {
      serviceUrl = DEFAULT_DEV_SERVICE_URL;
      return serviceUrl;
    }

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
  imei2?: string; // International Mobile Equipment Identity 2
  phone_number: string; // Phone number
  ecid?: string; // Exclusive Chip ID (last 16 chars of UDID)
  region_info: string; // Like "CH/A"
  model_number: string; // Like "MLE03"
  regulatory_model: string; // Like "A2634"
  sales_model: string; // Sales model like "MLE03 CH/A"
  time_zone: string; // Time zone like "Asia/Shanghai"
  activation_state: string; // Activated/Unactivated
  is_paired: boolean; // Device pairing status
  is_jailbroken: boolean; // Jailbreak status
  cpu_architecture: string; // CPU type
  disk_type?: string; // Storage type
  battery_level: number; // Battery percentage
  battery_is_charging: boolean; // Battery is actively charging
  battery_external_connected: boolean; // External power is connected
  battery_fully_charged: boolean; // Battery is fully charged
  battery_health: number; // Battery health percentage
  battery_cycle_count: number; // Charge cycles
  battery_watts?: number; // Charging wattage
  manufacture_date: string; // Production date
  warranty_expiration: string; // Warranty expiration
  apple_id_locked: boolean; // Apple ID lock status
  icloud_enabled: boolean; // iCloud status
  wifi_address: string; // WiFi MAC address
  ethernet_address: string; // Cellular/Ethernet MAC address
  bluetooth_address: string; // Bluetooth MAC address
  imsi?: string; // International Mobile Subscriber Identity
  sim_status?: string; // SIM Status
  sim_tray_status?: string; // SIM Tray Status
  sim1_info?: string; // SIM 1 Carrier Info
  sim2_info?: string; // SIM 2 Carrier Info
  crash_log_count: number; // Number of crash logs
  storage_info?: StorageInfo; // Device storage information
  hardware_details?: HardwareDetails; // Detailed hardware information
  raw_data?: Record<string, any>; // All raw device data from GetValues
}

export interface HardwareDetails {
  // Mainboard & Chip
  mlb_serial_number?: string; // Main Logic Board serial number
  hardware_model?: string; // Hardware model (e.g., D17AP)
  hardware_platform?: string; // Platform (e.g., t8110)
  chip_id?: number; // Chip ID (e.g., 33040)
  die_id?: number; // Die ID / Unique Chip ID (ECID)
  board_id?: number; // Board ID
  
  // Baseband & Cellular
  baseband_version?: string; // Baseband firmware version
  baseband_chip_id?: number; // Baseband chip ID
  baseband_cert_id?: number; // Baseband certificate ID
  baseband_serial_number?: string; // Baseband serial number
  iccid?: string; // SIM 1 card number
  iccid2?: string; // SIM 2 card number
  imsi2?: string; // SIM 2 IMSI
  meid?: string; // Mobile Equipment Identifier
  
  // Sensors
  ambient_light_sensor?: string; // Ambient light sensor serial
  proximity_sensor?: string; // Proximity sensor serial (Rosaline)
  cover_glass_serial?: string; // Cover glass serial number
  
  // Battery
  battery_serial?: string; // Battery serial number
  battery_manufacturer?: string; // Battery manufacturer data
  
  // WiFi & Network
  wifi_chipset?: string; // WiFi chipset (e.g., 4387)
  wifi_module_serial?: string; // WiFi module serial number
  wifi_driver_version?: string; // WiFi driver version
  wireless_board_serial?: string; // Wireless board serial number
  
  // Display
  display_max_brightness?: number; // Max brightness in nits
  display_type?: string; // Display type (e.g., OLED)
  
  // Other
  partition_type?: string; // Partition type (e.g., GUID_partition_scheme)
  apfs_container_uuid?: string; // APFS container UUID
  boot_session_id?: string; // Boot session ID
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

export interface Certificate {
  id: string;
  name: string;
  type: "p12" | "free_sign";
  team_id: string;
  bundle_id: string;
  created_at: string;
  expires_at: string;
  is_default: boolean;
  is_expired: boolean;
  days_until_expiry: number;
  common_name: string;
  raw_data?: Record<string, any>;
}

export interface ExportedCertificate {
  fileName: string;
  contentType: string;
  data: Uint8Array;
}

export function deriveFreeSignBundleId(bundleId: string, teamId: string): string {
  const trimmedBundleId = bundleId.trim();
  const trimmedTeamId = teamId.trim();
  if (!trimmedBundleId || !trimmedTeamId) {
    return trimmedBundleId;
  }

  const suffix = `.${trimmedTeamId}`;
  if (trimmedBundleId.endsWith(suffix)) {
    return trimmedBundleId;
  }

  return `${trimmedBundleId}${suffix}`;
}

export interface ImportP12Request {
  name: string;
  p12_data: string; // Base64 encoded
  provision_data: string; // Base64 encoded
  password: string;
  is_default: boolean;
}

export interface ImportFreeSignRequest {
  name: string;
  apple_id: string;
  password: string;
  is_default: boolean;
  anisette_url?: string;
}

export interface SignIPARequest {
  ipa_path: string;
  /** Required when sign_mode is "certificate" (default). */
  certificate_id?: string;
  device_udid?: string;
  output_dir?: string;
  bundle_id?: string;
  /** "certificate" (default) or "adhoc" for editor export without developer cert. */
  sign_mode?: "certificate" | "adhoc";
  editor_options?: SigningOptions;
  icon_path?: string;
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

export interface TaskProgressEvent {
  type: "task_progress";
  task_id: string;
  task_type: string;
  status: string;
  progress: number;
  message: string;
  data?: Record<string, any>;
}

export type WebSocketEvent =
  | DeviceAttachedEvent
  | DeviceDetachedEvent
  | TaskProgressEvent;

export interface AuthResponse {
  success: boolean;
  requires_2fa?: boolean;
  email?: string;
  cookie_file?: string;
  message: string;
  error_code?: string;
}

export interface AppSearchResult {
  id: number;
  bundle_id: string;
  name: string;
  subtitle?: string;
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
  is_loading?: boolean;
  error?: string;
}

export interface AppVersionHistory {
  bundle_id: string;
  app_name: string;
  latest_version: string;
  versions: AppVersion[];
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
  file_size?: number;
  certificate_name?: string;
  certificate_expiry?: string;
  certificate_status?: string;
  provision_name?: string;
  provision_team_id?: string;
  provision_app_id?: string;
  has_provision_profile: boolean;

  is_encrypted?: boolean;
  crypt_id?: number;
  signer_identity?: string;
  team_id?: string;
  organization?: string;
  purchaser_email?: string;
  signer_name?: string;
}

export interface IpaFileInfo {
  name: string;
  path: string;
  size: number;
  source: "native" | "downloaded" | "signed";
  bundleId?: string;
  version?: string;
  download_date?: string;
}

interface RawIpaFileInfo {
  name: string;
  path: string;
  size: number;
  source: "native" | "downloaded" | "signed";
  bundle_id?: string;
  version?: string;
  download_date?: string;
}

export interface FileItem {
  path: string;
  size: number;
  is_directory: boolean;
}

export interface DylibItem {
  name: string;        // Dylib file name (e.g., "demo.dylib")
  path: string;        // Full load path (e.g., "@rpath/demo.dylib")
  enabled: boolean;    // Whether to keep this dylib (disable = remove from Mach-O)
  is_system: boolean;  // System dylib (e.g., /usr/lib/libSystem.B.dylib)
  is_injected: boolean; // User-injected dylib (via Tweaks)
}

export interface FrameworkItem {
  name: string;    // Framework name (e.g., "CydiaSubstrate.framework")
  path: string;    // Relative path in .app (e.g., "Frameworks/CydiaSubstrate.framework")
  enabled: boolean; // Whether to keep this framework (disable = remove from .app)
}

export interface PluginItem {
  name: string;       // Plugin name (e.g., "ShareExtension.appex")
  path: string;       // Relative path in .app (e.g., "PlugIns/ShareExtension.appex")
  bundle_id: string;  // Plugin bundle identifier
  is_appex: boolean;  // Whether it's an App Extension (.appex)
  target_dir: string; // Target directory ("PlugIns" or custom)
  enabled: boolean;   // Whether to keep this plugin (disable = remove from .app)
}

export interface IPADetails {
  entitlements_xml: string;
  files: FileItem[];
  dylibs: DylibItem[];     // All dylibs from Mach-O load commands
  frameworks: FrameworkItem[]; // All frameworks from .app/Frameworks/
  plugins: PluginItem[];    // All plugins from .app/PlugIns/
  properties: Record<string, any>;
  icon_base64?: string;     // largest app icon, base64 PNG
}

export type InjectPath = "@executable_path" | "@rpath";
export type InjectFolder = "/" | "/Frameworks/";

export interface SigningOptions {
  // Pre Modifications
  app_name?: string;
  app_version?: string;
  app_identifier?: string;
  app_build_version?: string;
  minimum_os_version?: string;
  appearance?: string;

  // Injection Options
  inject_path?: InjectPath;      // @executable_path or @rpath
  inject_folder?: InjectFolder;  // root (/) or frameworks (/Frameworks/)

  // File Lists
  injection_files?: string[];      // Array of files (.dylib, .deb) to extract and inject
  dis_injection_files?: string[];  // Mach-O load paths to remove
  remove_files?: string[];         // App files to remove

  // Common capabilities
  file_sharing: boolean;       // Enable UISupportsDocumentBrowser
  itunes_file_sharing: boolean; // Enable UIFileSharingEnabled
  remove_url_scheme: boolean;  // Remove CFBundleURLTypes
  remove_provisioning: boolean; // Remove embedded.mobileprovision

  // Display & status bar
  status_bar_hidden: boolean;
  view_controller_based_status_bar: boolean;
  prerendered_icon: boolean;

  // Network & behavior
  requires_persistent_wifi: boolean;
  exits_on_suspend: boolean;
  allows_arbitrary_loads: boolean;
  no_encryption_decl: boolean;

  // Interface orientations
  orientation_portrait: boolean;
  orientation_landscape_left: boolean;
  orientation_landscape_right: boolean;
  orientation_portrait_upside_down: boolean;

  // Background modes
  bg_audio: boolean;
  bg_location: boolean;
  bg_fetch: boolean;
  bg_voip: boolean;

  // Advanced parameters
  required_device_capabilities?: string;
  remove_supported_devices: boolean;
  bundle_localizations?: string;
  development_region?: string;
  application_category_type?: string;
  supports_multiple_scenes?: boolean | null;
  custom_url_scheme?: string;
  remove_document_types: boolean;
  remove_exported_type_declarations: boolean;
  remove_application_queries_schemes: boolean;
  privacy_overrides?: Record<string, string>;
  remove_launch_screen: boolean;
  remove_watch_app: boolean;
  remove_plug_ins: boolean;
}

export interface SimulatedDeviceProfile {
  id: string;
  info: DeviceInfo;
  apps: AppInfo[];
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

  async checkHealth(): Promise<{ status: string; ready: boolean; message: string }> {
    await this.init();
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      return await response.json();
    } catch (error: any) {
      throw new Error(`Health check failed: ${error.message || "Unknown error"}`);
    }
  }

  async waitForServiceReady(maxAttempts: number = 30, intervalMs: number = 200): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const health = await this.checkHealth();
        if (health.ready) {
          console.log(`Go service is ready after ${attempt} attempt(s)`);
          return;
        }
      } catch (error) {
        // Service not ready yet, continue
      }
      
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
    
    throw new Error(`Go service failed to become ready after ${maxAttempts} attempts`);
  }

  private async handleErrorResponse(response: Response, defaultMessage: string): Promise<never> {
    try {
      const error = await response.json();
      const errorMessage = error.error || defaultMessage;
      
      console.log('[handleErrorResponse] Received error message:', errorMessage);
      const lower = String(errorMessage || '').toLowerCase();
      // Match variants like "password token expired", "password token is expired", etc.
      if (/(?:password\s+)?token.*expired/.test(lower)) {
        console.log('[handleErrorResponse] Throwing TokenExpiredError');
        throw new TokenExpiredError(errorMessage);
      }
      
      console.log('[handleErrorResponse] Throwing generic Error');
      throw new Error(errorMessage);
    } catch (e) {
      if (e instanceof TokenExpiredError) {
        throw e; // Re-throw TokenExpiredError
      }
      if (e instanceof Error && e.message !== defaultMessage) {
        throw e; // Re-throw if it's our formatted error
      }
      // If JSON parsing fails, use status text
      throw new Error(`${defaultMessage}: ${response.statusText || response.status}`);
    }
  }

  async getWebSocketUrl(): Promise<string> {
    await this.init();
    if (this.baseUrl.startsWith("/")) {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${protocol}//${window.location.host}${this.baseUrl}/ws`;
    }
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

  async installApp(
    udid: string,
    ipaPath: string,
    bundleId?: string,
    version?: string,
    certificateId?: string | null,
  ): Promise<{ task_id: string }> {
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
        certificate_id: certificateId || undefined,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Failed to install app");
    }
    return result.data;
  }

  async signIPA(req: SignIPARequest): Promise<{ task_id: string }> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/ipa/sign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req),
    });
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to sign IPA");
      throw new Error("Unreachable");
    }
    const result = await response.json();
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

  async uninstallApp(udid: string, bundleId: string): Promise<{ task_id: string }> {
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
    return result.data;
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

      const wsUrl = await this.getWebSocketUrl();
      console.log(`Connecting to WebSocket: ${wsUrl} (attempt ${this.reconnectAttempts + 1})`);
      
      this.notifyStatus("connecting");
      this.ws = new WebSocket(wsUrl);

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
    const settings = isTauriRuntime() ? await invoke<any>("get_settings") : null;
    const anisetteUrl = settings?.anisette_url || "";
    console.log("[GoService] Login - anisette_url from settings:", anisetteUrl);
    
    const response = await fetch(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, anisette_url: anisetteUrl }),
    });
    
    if (!response.ok) {
      await this.handleErrorResponse(response, "Login failed");
      // The above will throw, so this line is unreachable
      throw new Error("Unreachable");
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
      await this.handleErrorResponse(response, "2FA verification failed");
      // The above will throw, so this line is unreachable
      throw new Error("Unreachable");
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
      await this.handleErrorResponse(response, "Logout failed");
      throw new Error("Unreachable");
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
      await this.handleErrorResponse(response, "Failed to get account info");
      throw new Error("Unreachable");
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
      await this.handleErrorResponse(response, "Failed to get country code");
      throw new Error("Unreachable");
    }
    
    const result = await response.json();
    return result.data.country_code;
  }

  async listAccounts(): Promise<string[]> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/auth/accounts`);
    if (!response.ok) {
      return [];
    }
    const result = await response.json();
    return result.data?.accounts || [];
  }

  async checkLicense(bundleId: string, email: string): Promise<boolean> {
    await this.init();
    const params = new URLSearchParams({
      bundle_id: bundleId,
      email: email,
    });
    const response = await fetch(
      `${this.baseUrl}/apps/check-license?${params}`
    );
    
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to check license");
      throw new Error("Unreachable");
    }
    
    const result = await response.json();
    return result.data.has_license;
  }

  async searchApps(
    keyword: string,
    countryCode: string,
    limit: number = 10
  ): Promise<AppSearchResult[]> {
    await this.init();
    const params = new URLSearchParams({
      keyword,
      country: countryCode.toLowerCase(),
      limit: limit.toString(),
    });
    
    const response = await fetch(`${this.baseUrl}/apps/search?${params}`);
    
    if (!response.ok) {
      await this.handleErrorResponse(response, "Search failed");
      throw new Error("Unreachable");
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
      await this.handleErrorResponse(response, "Failed to get app details");
      throw new Error("Unreachable");
    }
    
    const result = await response.json();
    return result.data;
  }

  async getAppSubtitles(bundleIds: string[], countryCode: string): Promise<Record<string, string>> {
    await this.init();
    const params = new URLSearchParams();
    params.set("country", countryCode.toLowerCase());
    bundleIds.forEach((bundleId) => {
      if (bundleId) {
        params.append("bundle_id", bundleId);
      }
    });

    const response = await fetch(`${this.baseUrl}/apps/subtitles?${params}`);

    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to get app subtitles");
      throw new Error("Unreachable");
    }

    const result = await response.json();
    return result.data.subtitles || {};
  }

  async getAppVersionHistory(bundleId: string, email: string): Promise<{ task_id: string }> {
    await this.init();
    const params = new URLSearchParams({
      bundle_id: bundleId,
      email,
    });
    
    const response = await fetch(`${this.baseUrl}/apps/versions?${params}`);
    
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to get version history");
      throw new Error("Unreachable");
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
      await this.handleErrorResponse(response, "Failed to get version details");
      throw new Error("Unreachable");
    }
    
    const result = await response.json();
    return result.data.versions || [];
  }

  async downloadApp(
    bundleId: string,
    email: string,
    outputDir: string,
    appName?: string,
    iconUrl?: string,
    externalVersionId?: string
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
        icon_url: iconUrl,
        external_version_id: externalVersionId,
      }),
    });
    
    if (!response.ok) {
      await this.handleErrorResponse(response, "Download failed");
      throw new Error("Unreachable");
    }
    
    const result = await response.json();
    return result.data;
  }

  async cancelTask(taskId: string): Promise<void> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/tasks/${taskId}/cancel`, {
      method: "POST",
    });
    
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to cancel task");
      throw new Error("Unreachable");
    }
  }

  async checkPairingStatus(udid: string): Promise<{ is_paired: boolean; waiting_for_trust: boolean; needs_pairing: boolean }> {
    const url = await ensureServiceRunning();
    const response = await fetch(`${url}/device/${udid}/pair-status`);
    
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to check pairing status");
      throw new Error("Unreachable");
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
      await this.handleErrorResponse(response, "Failed to pair device");
      throw new Error("Unreachable");
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
      await this.handleErrorResponse(response, "Failed to parse IPA file");
      throw new Error("Unreachable");
    }
    
    const result = await response.json();
    return result.data;
  }

  async listIPAFiles(directory?: string): Promise<IpaFileInfo[]> {
    await this.init();
    const params = new URLSearchParams();
    if (directory) {
      params.set("directory", directory);
    }

    const query = params.toString();
    const response = await fetch(`${this.baseUrl}/ipa/files${query ? `?${query}` : ""}`);
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to list IPA files");
      throw new Error("Unreachable");
    }

    const result = await response.json();
    return (result.data || []).map((item: RawIpaFileInfo) => ({
      name: item.name,
      path: item.path,
      size: item.size,
      source: item.source,
      bundleId: item.bundle_id || "",
      version: item.version || "",
      download_date: item.download_date || "",
    }));
  }

  async getIpaDetails(filePath: string): Promise<IPADetails> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/ipa/details`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file_path: filePath }),
    });
    
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to get IPA details");
      throw new Error("Unreachable");
    }
    
    const result = await response.json();
    return result.data;
  }

  async extractFileFromIpa(ipaPath: string, filePath: string): Promise<string> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/ipa/extract-file`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ipa_path: ipaPath, file_path: filePath }),
    });
    
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to extract file");
      throw new Error("Unreachable");
    }
    
    const result = await response.json();
    return result.data.content;
  }

  async parsePlist(input: { path?: string; dataBase64?: string }): Promise<PlistParseResult> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/plist/parse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: input.path,
        data_base64: input.dataBase64,
      }),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to parse plist");
      throw new Error("Unreachable");
    }

    const result = await response.json();
    return result.data as PlistParseResult;
  }

  async writePlist(input: {
    path: string;
    root: PlistNode;
    format?: "preserve" | "xml" | "binary" | string;
  }): Promise<void> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/plist/write`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: input.path,
        root: input.root,
        format: input.format || "preserve",
      }),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to write plist");
      throw new Error("Unreachable");
    }
  }

  async renderPlistXML(root: PlistNode): Promise<string> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/plist/render-xml`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ root }),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to render plist XML");
      throw new Error("Unreachable");
    }

    const result = await response.json();
    return String(result.data?.xml_preview || "");
  }

  async parsePlistXml(xml: string): Promise<PlistParseResult> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/plist/parse-xml`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ xml }),
    });

    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to parse plist XML");
      throw new Error("Unreachable");
    }

    const result = await response.json();
    return result.data as PlistParseResult;
  }

  async extractFilesFromIpa(ipaPath: string, filePaths: string[], outputDir: string): Promise<string[]> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/ipa/extract-files`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        ipa_path: ipaPath, 
        file_paths: filePaths,
        output_dir: outputDir,
      }),
    });
    
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to extract files");
      throw new Error("Unreachable");
    }
    
    const result = await response.json();
    return result.data.files;
  }
  
  // Debug APIs
  async listSimProfiles(): Promise<SimulatedDeviceProfile[]> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/debug/sim-profiles`);
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to list sim profiles");
      throw new Error("Unreachable");
    }
    const result = await response.json();
    return result.data || [];
  }

  async saveSimProfile(profile: SimulatedDeviceProfile): Promise<SimulatedDeviceProfile> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/debug/save-sim-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to save sim profile");
      throw new Error("Unreachable");
    }
    return await response.json();
  }

  async deleteSimProfile(id: string): Promise<void> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/debug/sim-profiles/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to delete sim profile");
      throw new Error("Unreachable");
    }
  }

  async simulateDevice(info: DeviceInfo, apps: AppInfo[]): Promise<DeviceInfo> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/debug/simulate-device`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ info, apps }),
    });
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to simulate device");
      throw new Error("Unreachable");
    }
    const result = await response.json();
    return result.data;
  }

  async removeSimulatedDevice(udid: string): Promise<void> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/debug/simulated/${udid}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to remove simulated device");
      throw new Error("Unreachable");
    }
  }

  async clearAllSimulatedDevices(): Promise<number> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/debug/clear-simulated`, {
      method: "POST",
    });
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to clear all simulated devices");
      throw new Error("Unreachable");
    }
    const result = await response.json();
    return result.data;
  }

  async generateRandomDevice(): Promise<SimulatedDeviceProfile> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/debug/generate-random-device`);
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to generate random device");
      throw new Error("Unreachable");
    }
    const result = await response.json();
    return result.data;
  }

  async testTask(): Promise<string> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/debug/test-task`, {
      method: "POST",
    });
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to start test task");
      throw new Error("Unreachable");
    }
    const result = await response.json();
    return result.data.task_id;
  }

  async loadDeviceProfile(udid: string): Promise<SimulatedDeviceProfile> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/debug/load-device-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ udid }),
    });
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to load device profile");
      throw new Error("Unreachable");
    }
    const result = await response.json();
    return result.data;
  }

  // Certificate Management

  async listCertificates(): Promise<Certificate[]> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/certs`);
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to list certificates");
      throw new Error("Unreachable");
    }
    const result = await response.json();
    return result.data;
  }

  async getCertificate(id: string): Promise<Certificate> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/certs/${id}`);
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to get certificate");
      throw new Error("Unreachable");
    }
    const result = await response.json();
    return result.data;
  }

  async exportCertificate(id: string): Promise<ExportedCertificate> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/certs/${id}/export`);
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to export certificate");
      throw new Error("Unreachable");
    }

    const disposition = response.headers.get("Content-Disposition") || "";
    const contentType = response.headers.get("Content-Type") || "application/octet-stream";
    const fileNameMatch = disposition.match(/filename="?([^\"]+)"?/i);
    const fileName = fileNameMatch?.[1] || `${id}.p12`;
    const data = new Uint8Array(await response.arrayBuffer());

    return { fileName, contentType, data };
  }

  async importP12Certificate(req: ImportP12Request): Promise<Certificate> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/certs/import-p12`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req),
    });
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to import P12 certificate");
      throw new Error("Unreachable");
    }
    const result = await response.json();
    return result.data;
  }

  async importFreeSignCertificate(req: ImportFreeSignRequest): Promise<Certificate> {
    await this.init();
    const settings = await invoke<any>("get_settings");
    const anisetteUrl = settings.anisette_url || "";
    console.log("[GoService] ImportFreeSign - anisette_url from settings:", anisetteUrl);
    
    const response = await fetch(`${this.baseUrl}/certs/import-free`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...req, anisette_url: anisetteUrl }),
    });
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to import free signing certificate");
      throw new Error("Unreachable");
    }
    const result = await response.json();
    return result.data;
  }

  async deleteCertificate(id: string): Promise<void> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/certs/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to delete certificate");
      throw new Error("Unreachable");
    }
  }

  async setDefaultCertificate(id: string): Promise<void> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/certs/${id}/set-default`, {
      method: "POST",
    });
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to set default certificate");
      throw new Error("Unreachable");
    }
  }

  async getCertificateForAppleID(email: string): Promise<Certificate | null> {
    await this.init();
    const response = await fetch(`${this.baseUrl}/certs/apple-id/${encodeURIComponent(email)}`);
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to get certificate for Apple ID");
      throw new Error("Unreachable");
    }
    const result = await response.json();
    return result.data;
  }

  async getTopApps(countryCode: string = "cn", limit: number = 20): Promise<AppSearchResult[]> {
    await this.init();
    const params = new URLSearchParams({
      country: countryCode,
      limit: limit.toString(),
    });
    
    const response = await fetch(`${this.baseUrl}/apps/top?${params}`);
    
    if (!response.ok) {
      await this.handleErrorResponse(response, "Failed to get top apps");
      throw new Error("Unreachable");
    }
    
    const result = await response.json();
    return result.data.apps || [];
  }
}

export const goServiceClient = new GoServiceClient();

export async function parseIPA(filePath: string): Promise<IPAInfo> {
  return goServiceClient.parseIPA(filePath);
}
