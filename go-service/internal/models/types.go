package models

type DeviceInfo struct {
	UDID               string                 `json:"udid"`
	Name               string                 `json:"name"`
	Model              string                 `json:"model"`                     // Friendly model name (e.g., "iPhone 13")
	Version            string                 `json:"version"`                   // iOS version (e.g., "18.7.1")
	Color              string                 `json:"color,omitempty"`           // Device color
	EnclosureColor     string                 `json:"enclosure_color,omitempty"` // Device enclosure color
	ProductType        string                 `json:"product_type"`              // Internal identifier (e.g., "iPhone14,5")
	ProductName        string                 `json:"product_name"`              // e.g., "A2634"
	BuildVersion       string                 `json:"build_version"`             // e.g., "22H31"
	FirmwareVersion    string                 `json:"firmware_version"`          // Firmware version (e.g., "iBoot-11881.140.96")
	SerialNumber       string                 `json:"serial_number"`             // Device serial number
	IMEI               string                 `json:"imei,omitempty"`            // International Mobile Equipment Identity
	PhoneNumber        string                 `json:"phone_number"`              // Phone number
	ECID               string                 `json:"ecid,omitempty"`            // Exclusive Chip ID (last 16 chars of UDID)
	RegionInfo         string                 `json:"region_info"`               // e.g., "CH/A"
	ModelNumber        string                 `json:"model_number"`              // e.g., "MLE03"
	SalesModel         string                 `json:"sales_model"`               // Sales model (ModelNumber + RegionInfo, e.g., "MLE03 CH/A")
	TimeZone           string                 `json:"time_zone"`                 // Time zone (e.g., "Asia/Shanghai")
	ActivationState    string                 `json:"activation_state"`          // Activated/Unactivated
	IsPaired           bool                   `json:"is_paired"`                 // Device pairing status
	IsJailbroken       bool                   `json:"is_jailbroken"`             // Jailbreak status
	CPUArchitecture    string                 `json:"cpu_architecture"`          // CPU type
	DiskType           string                 `json:"disk_type,omitempty"`       // Storage type
	BatteryLevel       int                    `json:"battery_level"`             // Battery percentage
	BatteryHealth      int                    `json:"battery_health"`            // Battery health percentage
	BatteryCycleCount  int                    `json:"battery_cycle_count"`       // Charge cycles
	ManufactureDate    string                 `json:"manufacture_date"`          // Production date
	WarrantyExpiration string                 `json:"warranty_expiration"`       // Warranty expiration
	AppleIDLocked      bool                   `json:"apple_id_locked"`           // Apple ID lock status
	ICloudEnabled      bool                   `json:"icloud_enabled"`            // iCloud status
	WiFiAddress        string                 `json:"wifi_address"`              // WiFi MAC address
	BluetoothAddress   string                 `json:"bluetooth_address"`         // Bluetooth MAC address
	StorageInfo        *StorageInfo           `json:"storage_info,omitempty"`    // Device storage information
	RawData            map[string]interface{} `json:"raw_data,omitempty"`        // All raw device data from GetValues
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

type AppSizeUpdate struct {
	Type     string `json:"type"` // "app_size_update"
	UDID     string `json:"udid"`
	BundleID string `json:"bundle_id"`
	AppSize  uint64 `json:"app_size"`
	DataSize uint64 `json:"data_size"`
}

type TaskProgress struct {
	Type     string                 `json:"type"` // "task_progress"
	TaskID   string                 `json:"task_id"`
	TaskType string                 `json:"task_type"` // "install", "uninstall", "download", etc.
	Status   string                 `json:"status"`    // "started", "progress", "completed", "error"
	Progress float64                `json:"progress"`  // 0-100
	Message  string                 `json:"message"`
	UDID     string                 `json:"udid,omitempty"`
	BundleID string                 `json:"bundle_id,omitempty"`
	FilePath string                 `json:"file_path,omitempty"`
	Data     map[string]interface{} `json:"data,omitempty"` // Additional task-specific data
}

type InstallProgress struct {
	Status   string  `json:"status"`
	Progress float64 `json:"progress"`
	Message  string  `json:"message"`
	BundleID string  `json:"bundle_id,omitempty"`
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
	Error         string `json:"error,omitempty"`
}

type AppVersionHistory struct {
	BundleID           string       `json:"bundle_id"`
	AppName            string       `json:"app_name"`
	LatestVersion      string       `json:"latest_version"`
	VersionIdentifiers []string     `json:"version_identifiers"`
	Versions           []AppVersion `json:"versions,omitempty"`
}

type DownloadProgress struct {
	Status   string  `json:"status"`
	Progress float64 `json:"progress"`
	Message  string  `json:"message"`
}

type IPAInfo struct {
	Name             string `json:"name"`
	BundleID         string `json:"bundle_id"`
	Version          string `json:"version"`
	MinimumOSVersion string `json:"minimum_os_version,omitempty"`
	IconBase64       string `json:"icon_base64,omitempty"`
	FilePath         string `json:"file_path"`
}

type FileItem struct {
	Path        string `json:"path"`
	Size        int64  `json:"size"`
	IsDirectory bool   `json:"is_directory"`
}

type ResourceItem struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Size int64  `json:"size"`
}

type IPADetails struct {
	EntitlementsXML string          `json:"entitlements_xml"`
	Files           []*FileItem     `json:"files"`
	Resources       []*ResourceItem `json:"resources"`
}
