package models

type DeviceInfo struct {
	UDID               string                 `json:"udid"`
	Name               string                 `json:"name"`
	Model              string                 `json:"model"`                      // Friendly model name (e.g., "iPhone 13")
	Version            string                 `json:"version"`                    // iOS version (e.g., "18.7.1")
	Color              string                 `json:"color,omitempty"`            // Device color
	EnclosureColor     string                 `json:"enclosure_color,omitempty"`  // Device enclosure color
	ProductType        string                 `json:"product_type"`               // Internal identifier (e.g., "iPhone14,5")
	ProductName        string                 `json:"product_name"`               // e.g., "A2634"
	BuildVersion       string                 `json:"build_version"`              // e.g., "22H31"
	FirmwareVersion    string                 `json:"firmware_version"`           // Firmware version (e.g., "iBoot-11881.140.96")
	SerialNumber       string                 `json:"serial_number"`              // Device serial number
	IMEI               string                 `json:"imei,omitempty"`             // International Mobile Equipment Identity
	IMEI2              string                 `json:"imei2,omitempty"`            // International Mobile Equipment Identity 2
	PhoneNumber        string                 `json:"phone_number"`               // Phone number
	ECID               string                 `json:"ecid,omitempty"`             // Exclusive Chip ID (last 16 chars of UDID)
	RegionInfo         string                 `json:"region_info"`                // e.g., "CH/A"
	ModelNumber        string                 `json:"model_number"`               // e.g., "MLE03"
	RegulatoryModel    string                 `json:"regulatory_model"`           // e.g., "A2634"
	SalesModel         string                 `json:"sales_model"`                // Sales model (ModelNumber + RegionInfo, e.g., "MLE03 CH/A")
	TimeZone           string                 `json:"time_zone"`                  // Time zone (e.g., "Asia/Shanghai")
	ActivationState    string                 `json:"activation_state"`           // Activated/Unactivated
	IsPaired           bool                   `json:"is_paired"`                  // Device pairing status
	IsJailbroken       bool                   `json:"is_jailbroken"`              // Jailbreak status
	CPUArchitecture    string                 `json:"cpu_architecture"`           // CPU type
	DiskType           string                 `json:"disk_type,omitempty"`        // Storage type
	BatteryLevel       int                    `json:"battery_level"`              // Battery percentage
	BatteryIsCharging  bool                   `json:"battery_is_charging"`        // Battery is actively charging
	BatteryExternalConnected bool             `json:"battery_external_connected"` // External power is connected
	BatteryFullyCharged bool                  `json:"battery_fully_charged"`      // Battery is fully charged
	BatteryHealth      int                    `json:"battery_health"`             // Battery health percentage
	BatteryCycleCount  int                    `json:"battery_cycle_count"`        // Charge cycles
	BatteryWatts       float64                `json:"battery_watts,omitempty"`    // Charging wattage
	ManufactureDate    string                 `json:"manufacture_date"`           // Production date
	WarrantyExpiration string                 `json:"warranty_expiration"`        // Warranty expiration
	AppleIDLocked      bool                   `json:"apple_id_locked"`            // Apple ID lock status (FMIP)
	ICloudEnabled      bool                   `json:"icloud_enabled"`             // iCloud status
	WiFiAddress        string                 `json:"wifi_address"`               // WiFi MAC address
	EthernetAddress    string                 `json:"ethernet_address"`           // Cellular/Ethernet MAC address
	BluetoothAddress   string                 `json:"bluetooth_address"`          // Bluetooth MAC address
	IMSI               string                 `json:"imsi,omitempty"`             // International Mobile Subscriber Identity
	SIMStatus          string                 `json:"sim_status,omitempty"`       // SIM Status
	SIMTrayStatus      string                 `json:"sim_tray_status,omitempty"`  // SIM Tray Status
	SIM1Info           string                 `json:"sim1_info,omitempty"`        // SIM 1 Carrier Info
	SIM2Info           string                 `json:"sim2_info,omitempty"`        // SIM 2 Carrier Info
	CrashLogCount      int                    `json:"crash_log_count"`            // Number of crash logs
	StorageInfo        *StorageInfo           `json:"storage_info,omitempty"`     // Device storage information
	HardwareDetails    *HardwareDetails       `json:"hardware_details,omitempty"` // Detailed hardware information
	RawData            map[string]interface{} `json:"raw_data,omitempty"`         // All raw device data from GetValues
}

// HardwareDetails contains detailed hardware information
type HardwareDetails struct {
	// Mainboard & Chip
	MLBSerialNumber  string `json:"mlb_serial_number,omitempty"` // Main Logic Board serial number
	HardwareModel    string `json:"hardware_model,omitempty"`    // Hardware model (e.g., D17AP)
	HardwarePlatform string `json:"hardware_platform,omitempty"` // Platform (e.g., t8110)
	ChipID           int64  `json:"chip_id,omitempty"`           // Chip ID (e.g., 33040)
	DieID            int64  `json:"die_id,omitempty"`            // Die ID / Unique Chip ID (ECID)
	BoardID          int    `json:"board_id,omitempty"`          // Board ID

	// Baseband & Cellular
	BasebandVersion      string `json:"baseband_version,omitempty"`       // Baseband firmware version
	BasebandChipID       int64  `json:"baseband_chip_id,omitempty"`       // Baseband chip ID
	BasebandCertID       int64  `json:"baseband_cert_id,omitempty"`       // Baseband certificate ID
	BasebandSerialNumber string `json:"baseband_serial_number,omitempty"` // Baseband serial number
	ICCID                string `json:"iccid,omitempty"`                  // SIM 1 card number
	ICCID2               string `json:"iccid2,omitempty"`                 // SIM 2 card number
	IMSI2                string `json:"imsi2,omitempty"`                  // SIM 2 IMSI
	MEID                 string `json:"meid,omitempty"`                   // Mobile Equipment Identifier

	// Sensors
	AmbientLightSensor string `json:"ambient_light_sensor,omitempty"` // Ambient light sensor serial
	ProximitySensor    string `json:"proximity_sensor,omitempty"`     // Proximity sensor serial (Rosaline)
	CoverGlassSerial   string `json:"cover_glass_serial,omitempty"`   // Cover glass serial number

	// Battery
	BatterySerial       string `json:"battery_serial,omitempty"`       // Battery serial number
	BatteryManufacturer string `json:"battery_manufacturer,omitempty"` // Battery manufacturer data

	// WiFi & Network
	WiFiChipset         string `json:"wifi_chipset,omitempty"`          // WiFi chipset (e.g., 4387)
	WiFiModuleSerial    string `json:"wifi_module_serial,omitempty"`    // WiFi module serial number
	WiFiDriverVersion   string `json:"wifi_driver_version,omitempty"`   // WiFi driver version
	WirelessBoardSerial string `json:"wireless_board_serial,omitempty"` // Wireless board serial number

	// Display
	DisplayMaxBrightness int    `json:"display_max_brightness,omitempty"` // Max brightness in nits
	DisplayType          string `json:"display_type,omitempty"`           // Display type (e.g., OLED)

	// Other
	PartitionType     string `json:"partition_type,omitempty"`      // Partition type (e.g., GUID_partition_scheme)
	APFSContainerUUID string `json:"apfs_container_uuid,omitempty"` // APFS container UUID
	BootSessionID     string `json:"boot_session_id,omitempty"`     // Boot session ID
}

// Simulated device profile saved on disk for future simulations
type SimulatedDeviceProfile struct {
	ID   string     `json:"id"`
	Info DeviceInfo `json:"info"`
	Apps []AppInfo  `json:"apps,omitempty"`
}

// Active simulated device instance
type SimulatedDevice struct {
	Info DeviceInfo `json:"info"`
	Apps []AppInfo  `json:"apps"`
}

type StorageInfo struct {
	TotalDiskCapacity    uint64  `json:"total_disk_capacity"`         // Total disk capacity in bytes
	TotalDataCapacity    uint64  `json:"total_data_capacity"`         // Data partition capacity in bytes
	TotalSystemCapacity  uint64  `json:"total_system_capacity"`       // System partition capacity in bytes
	TotalDataAvailable   uint64  `json:"total_data_available"`        // Total available space in bytes
	AmountDataAvailable  uint64  `json:"amount_data_available"`       // Available data space in bytes
	AmountDataReserved   uint64  `json:"amount_data_reserved"`        // Reserved data space in bytes
	TotalSystemAvailable uint64  `json:"total_system_available"`      // System available space in bytes
	UsedSpace            uint64  `json:"used_space"`                  // Used space in bytes
	UsedPercentage       float64 `json:"used_percentage"`             // Used space percentage (0-100)
	AvailablePercentage  float64 `json:"available_percentage"`        // Available space percentage (0-100)
	FormattedTotal       string  `json:"formatted_total"`             // Human-readable total (e.g., "256 GB")
	FormattedUsed        string  `json:"formatted_used"`              // Human-readable used (e.g., "42.9 GB")
	FormattedAvailable   string  `json:"formatted_available"`         // Human-readable available (e.g., "191.8 GB")
	CameraUsage          uint64  `json:"camera_usage,omitempty"`      // Camera/Photos app usage
	PhotoUsage           uint64  `json:"photo_usage,omitempty"`       // Photo library usage
	CalendarUsage        uint64  `json:"calendar_usage,omitempty"`    // Calendar data usage
	NotesUsage           uint64  `json:"notes_usage,omitempty"`       // Notes app usage
	VoicemailUsage       uint64  `json:"voicemail_usage,omitempty"`   // Voicemail usage
	WebAppCacheUsage     uint64  `json:"web_cache_usage,omitempty"`   // Web app cache usage
	MediaCacheUsage      uint64  `json:"media_cache_usage,omitempty"` // Media cache usage
	CalculateDiskUsage   string  `json:"calculate_status,omitempty"`  // Status string (e.g., "OkilyDokily")
}

type AppInfo struct {
	BundleID               string                 `json:"bundle_id"`
	Name                   string                 `json:"name"`
	Version                string                 `json:"version"`
	IconURL                *string                `json:"icon_url,omitempty"`
	IconData               *string                `json:"icon_data,omitempty"` // Base64 encoded
	AuthType               string                 `json:"auth_type"`           // apple_store, shared, development, unknown
	BuildMachineOSBuild    string                 `json:"build_machine_os_build,omitempty"`
	CFBundleExecutable     string                 `json:"cf_bundle_executable,omitempty"`
	SignerIdentity         string                 `json:"signer_identity,omitempty"`
	MinimumOSVersion       string                 `json:"minimum_os_version,omitempty"`
	ApplicationType        string                 `json:"application_type,omitempty"`
	Path                   string                 `json:"path,omitempty"`
	Container              string                 `json:"container,omitempty"`
	CFBundleNumericVersion uint64                 `json:"cf_bundle_numeric_version,omitempty"`
	SequenceNumber         uint64                 `json:"sequence_number,omitempty"`
	AppSize                uint64                 `json:"app_size,omitempty"`         // Static disk usage (app binary)
	DataSize               uint64                 `json:"data_size,omitempty"`        // Dynamic disk usage (documents)
	RawData                map[string]interface{} `json:"raw_data,omitempty"`         // All raw app data
	EntitlementsXML        string                 `json:"entitlements_xml,omitempty"` // Entitlements as XML string
}

type DeviceEvent struct {
	Type         string      `json:"type"` // "device_attached" or "device_detached"
	DeviceID     int         `json:"device_id"`
	SerialNumber string      `json:"serial_number"`
	Properties   interface{} `json:"properties"`
	IsLocked     bool        `json:"is_locked,omitempty"` // Device is locked and needs unlock before pairing
}

type TaskProgress struct {
	Type     string                 `json:"type"` // "task_progress"
	TaskID   string                 `json:"task_id"`
	TaskType string                 `json:"task_type"` // "install", "uninstall", "download", "app_size_calculation", etc.
	Status   string                 `json:"status"`    // "started", "progress", "completed", "error"
	Progress float64                `json:"progress"`  // 0-100
	Message  string                 `json:"message"`
	Data     map[string]interface{} `json:"data,omitempty"` // Task-specific data: udid, bundle_id, file_path, app_size, data_size, etc.
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type SuccessResponse struct {
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

type AuthResponse struct {
	Success     bool   `json:"success"`
	Requires2FA bool   `json:"requires_2fa,omitempty"`
	Email       string `json:"email,omitempty"`
	CookieFile  string `json:"cookie_file,omitempty"`
	Message     string `json:"message"`
	ErrorCode   string `json:"error_code,omitempty"` // Error code for frontend i18n
}

type AccountInfo struct {
	Email      string `json:"email"`
	Name       string `json:"name"`
	StoreFront string `json:"storefront"`
}

type AppSearchResult struct {
	ID                        int64    `json:"id"`
	BundleID                  string   `json:"bundle_id"`
	Name                      string   `json:"name"`
	Subtitle                  string   `json:"subtitle,omitempty"`
	Version                   string   `json:"version"`
	Price                     float64  `json:"price"`
	FormattedPrice            string   `json:"formatted_price"`
	IconURL                   string   `json:"icon_url"`
	IconURL60                 string   `json:"icon_url_60,omitempty"`
	IconURL100                string   `json:"icon_url_100,omitempty"`
	IconURL512                string   `json:"icon_url_512,omitempty"`
	Description               string   `json:"description"`
	ReleaseNotes              string   `json:"release_notes,omitempty"`
	DeveloperName             string   `json:"developer_name"`
	DeveloperID               int64    `json:"developer_id,omitempty"`
	Genres                    []string `json:"genres,omitempty"`
	PrimaryGenre              string   `json:"primary_genre,omitempty"`
	ContentRating             string   `json:"content_rating,omitempty"`
	AverageRating             float64  `json:"average_rating,omitempty"`
	RatingCount               int      `json:"rating_count,omitempty"`
	FileSize                  int64    `json:"file_size,omitempty"`
	FileSizeFormatted         string   `json:"file_size_formatted,omitempty"`
	MinimumOSVersion          string   `json:"minimum_os_version,omitempty"`
	ReleaseDate               string   `json:"release_date,omitempty"`
	CurrentVersionReleaseDate string   `json:"current_version_release_date,omitempty"`
}

type AppDetails struct {
	AppSearchResult
	Screenshots       []string `json:"screenshots,omitempty"`
	ScreenshotsIPad   []string `json:"screenshots_ipad,omitempty"`
	SupportedDevices  []string `json:"supported_devices,omitempty"`
	LanguageCodes     []string `json:"language_codes,omitempty"`
	HasInAppPurchases bool     `json:"has_in_app_purchases"`
}

type AppVersion struct {
	VersionID     string `json:"version_id"`
	VersionString string `json:"version_string"`
	ReleaseDate   string `json:"release_date,omitempty"`
	Success       bool   `json:"success"`
	IsLoading     bool   `json:"is_loading,omitempty"`
	Error         string `json:"error,omitempty"`
}

type AppVersionHistory struct {
	BundleID      string       `json:"bundle_id"`
	AppName       string       `json:"app_name"`
	LatestVersion string       `json:"latest_version"`
	Versions      []AppVersion `json:"versions"`
}

type DownloadProgress struct {
	Status   string  `json:"status"`
	Progress float64 `json:"progress"`
	Message  string  `json:"message"`
	FilePath string  `json:"file_path,omitempty"`
}

type IPAInfo struct {
	Name                string `json:"name"`
	BundleID            string `json:"bundle_id"`
	Version             string `json:"version"`
	MinimumOSVersion    string `json:"minimum_os_version,omitempty"`
	IconBase64          string `json:"icon_base64,omitempty"`
	FilePath            string `json:"file_path"`
	FileSize            int64  `json:"file_size,omitempty"`
	CertificateName     string `json:"certificate_name,omitempty"`
	CertificateExpiry   string `json:"certificate_expiry,omitempty"`
	CertificateStatus   string `json:"certificate_status,omitempty"`
	ProvisionName       string `json:"provision_name,omitempty"`
	ProvisionTeamID     string `json:"provision_team_id,omitempty"`
	ProvisionAppID      string `json:"provision_app_id,omitempty"`
	HasProvisionProfile bool   `json:"has_provision_profile"`

	IsEncrypted    bool   `json:"is_encrypted"`
	CryptID        uint32 `json:"crypt_id"`
	SignerIdentity string `json:"signer_identity,omitempty"`
	TeamID         string `json:"team_id,omitempty"`
	Organization   string `json:"organization,omitempty"`

	PurchaserEmail string `json:"purchaser_email,omitempty"`
	SignerName     string `json:"signer_name,omitempty"`
}

type FileItem struct {
	Path        string `json:"path"`
	Size        int64  `json:"size"`
	IsDirectory bool   `json:"is_directory"`
}

type DylibItem struct {
	Name       string `json:"name"`        // Dylib file name (e.g., "demo.dylib")
	Path       string `json:"path"`        // Full load path (e.g., "@rpath/demo.dylib" or "@executable_path/Frameworks/demo.dylib")
	Enabled    bool   `json:"enabled"`     // Whether to keep this dylib (disable = remove from Mach-O)
	IsSystem   bool   `json:"is_system"`   // System dylib (e.g., /usr/lib/libSystem.B.dylib)
	IsInjected bool   `json:"is_injected"` // User-injected dylib (via Tweaks)
}

type FrameworkItem struct {
	Name    string `json:"name"`    // Framework name (e.g., "CydiaSubstrate.framework")
	Path    string `json:"path"`    // Relative path in .app (e.g., "Frameworks/CydiaSubstrate.framework")
	Enabled bool   `json:"enabled"` // Whether to keep this framework (disable = remove from .app)
}

type PluginItem struct {
	Name      string `json:"name"`       // Plugin name (e.g., "ShareExtension.appex")
	Path      string `json:"path"`       // Relative path in .app (e.g., "PlugIns/ShareExtension.appex")
	BundleID  string `json:"bundle_id"`  // Plugin bundle identifier
	IsAppex   bool   `json:"is_appex"`   // Whether it's an App Extension (.appex)
	TargetDir string `json:"target_dir"` // Target directory ("PlugIns" or custom)
	Enabled   bool   `json:"enabled"`    // Whether to keep this plugin (disable = remove from .app)
}

type IPADetails struct {
	EntitlementsXML string                 `json:"entitlements_xml"`
	Files           []*FileItem            `json:"files"`
	Dylibs          []*DylibItem           `json:"dylibs"`     // All dylibs from Mach-O load commands
	Frameworks      []*FrameworkItem       `json:"frameworks"` // All frameworks from .app/Frameworks/
	Plugins         []*PluginItem          `json:"plugins"`    // All plugins from .app/PlugIns/
	Properties      map[string]interface{} `json:"properties"`
	IconBase64      string                 `json:"icon_base64,omitempty"` // largest app icon, standard PNG, base64
}

// SigningOptions represents the signing configuration similar to Feather's Options
type SigningOptions struct {
	// Pre Modifications
	AppName       *string `json:"app_name,omitempty"` // CFBundleDisplayName
	AppVersion    *string `json:"app_version,omitempty"` // CFBundleShortVersionString
	AppIdentifier *string `json:"app_identifier,omitempty"`
	AppBuildVersion *string `json:"app_build_version,omitempty"` // CFBundleVersion
	MinimumOSVersion *string `json:"minimum_os_version,omitempty"`
	Appearance       *string `json:"appearance,omitempty"` // UIUserInterfaceStyle: Light/Dark/empty=default

	// Injection Options
	InjectPath   InjectPath   `json:"inject_path"`   // @executable_path or @rpath
	InjectFolder InjectFolder `json:"inject_folder"` // root (/) or frameworks (/Frameworks/)

	// File Lists
	InjectionFiles    []string `json:"injection_files"`     // Array of files (.dylib, .deb) to extract and inject
	DisInjectionFiles []string `json:"dis_injection_files"` // Mach-O load paths to remove (e.g., "@executable_path/demo1.dylib")
	RemoveFiles       []string `json:"remove_files"`        // App files to remove (e.g., "Frameworks/CydiaSubstrate.framework")

	// Options (common capabilities)
	FileSharing        bool `json:"file_sharing"`        // Enable UISupportsDocumentBrowser
	ITunesFileSharing  bool `json:"itunes_file_sharing"` // Enable UIFileSharingEnabled
	RemoveURLScheme    bool `json:"remove_url_scheme"`   // Remove CFBundleURLTypes
	RemoveProvisioning bool `json:"remove_provisioning"` // Remove embedded.mobileprovision

	// Display & status bar
	StatusBarHidden              bool `json:"status_bar_hidden"`               // UIStatusBarHidden
	ViewControllerBasedStatusBar bool `json:"view_controller_based_status_bar"` // UIViewControllerBasedStatusBarAppearance
	PrerenderedIcon              bool `json:"prerendered_icon"`                // UIPrerenderedIcon

	// Network & behavior
	RequiresPersistentWiFi bool `json:"requires_persistent_wifi"` // UIRequiresPersistentWiFi
	ExitsOnSuspend         bool `json:"exits_on_suspend"`        // UIApplicationExitsOnSuspend
	AllowsArbitraryLoads   bool `json:"allows_arbitrary_loads"`  // NSAppTransportSecurity.NSAllowsArbitraryLoads
	NoEncryptionDecl       bool `json:"no_encryption_decl"`      // ITSAppUsesNonExemptEncryption = false

	// Interface orientations (empty = keep original)
	OrientationPortrait           bool `json:"orientation_portrait"`
	OrientationLandscapeLeft      bool `json:"orientation_landscape_left"`
	OrientationLandscapeRight     bool `json:"orientation_landscape_right"`
	OrientationPortraitUpsideDown bool `json:"orientation_portrait_upside_down"`

	// Background modes (empty = keep original)
	BgAudio    bool `json:"bg_audio"`
	BgLocation bool `json:"bg_location"`
	BgFetch    bool `json:"bg_fetch"`
	BgVoip     bool `json:"bg_voip"`

	// Advanced parameters
	RequiredDeviceCapabilities          string            `json:"required_device_capabilities,omitempty"` // comma-separated
	RemoveSupportedDevices              bool              `json:"remove_supported_devices"`
	BundleLocalizations                 string            `json:"bundle_localizations,omitempty"` // comma-separated
	DevelopmentRegion                   string            `json:"development_region,omitempty"`
	ApplicationCategoryType             string            `json:"application_category_type,omitempty"`
	SupportsMultipleScenes             *bool             `json:"supports_multiple_scenes,omitempty"` // tri-state: nil = keep
	CustomURLScheme                     string            `json:"custom_url_scheme,omitempty"`
	RemoveDocumentTypes                 bool              `json:"remove_document_types"`
	RemoveExportedTypeDeclarations      bool              `json:"remove_exported_type_declarations"`
	RemoveApplicationQueriesSchemes      bool              `json:"remove_application_queries_schemes"`
	PrivacyOverrides                    map[string]string `json:"privacy_overrides,omitempty"` // key=NSxxx, value="" => remove
	RemoveLaunchScreen                  bool              `json:"remove_launch_screen"`
	RemoveWatchApp                      bool              `json:"remove_watch_app"`
	RemovePlugIns                      bool              `json:"remove_plug_ins"`
}

// InjectPath represents the dylib injection path prefix
type InjectPath string

const (
	InjectPathExecutable InjectPath = "@executable_path"
	InjectPathRPath      InjectPath = "@rpath"
)

// InjectFolder represents the dylib injection folder
type InjectFolder string

const (
	InjectFolderRoot       InjectFolder = "/"
	InjectFolderFrameworks InjectFolder = "/Frameworks/"
)
