package device

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
	"strings"
	"sync"
	"time"

	"ipaget-service/internal/logger"
	"ipaget-service/internal/models"

	"github.com/danielpaulus/go-ios/ios"
	"github.com/danielpaulus/go-ios/ios/diagnostics"
)

type Service struct {
	mu        sync.RWMutex
	devices   map[string]*ios.DeviceEntry
	listeners []chan models.DeviceEvent
	Simulated map[string]models.SimulatedDevice
	ConfigDir string

	// listCache holds the assembled /devices response so list refreshes stay
	// fast; it is invalidated whenever the connected device set changes.
	listCacheMu   sync.Mutex
	listCache     []models.DeviceInfo
	listCacheTime time.Time
}

// deviceListCacheTTL bounds how stale the /devices response may be.
const deviceListCacheTTL = 5 * time.Second

func NewService(configDir string) *Service {
	return &Service{
		devices:   make(map[string]*ios.DeviceEntry),
		listeners: make([]chan models.DeviceEvent, 0),
		Simulated: make(map[string]models.SimulatedDevice),
		ConfigDir: configDir,
	}
}

type batteryMetrics struct {
	level             int
	health            int
	cycleCount        int
	watts             float64
	isCharging        bool
	externalConnected bool
	fullyCharged      bool
}

func (s *Service) StartListener() {
	logger.Info().Msg("Starting iOS device listener")

	listenerFunc, closeFunc, err := ios.Listen()
	if err != nil {
		logger.Error().Err(err).Msg("Failed to start device listener")
		return
	}
	defer closeFunc()

	logger.Info().Msg("Device listener started successfully, waiting for events...")

	for {
		event, err := listenerFunc()
		if err != nil {
			logger.Error().Err(err).Msg("Error reading device event")
			continue
		}

		logger.Info().
			Str("type", event.MessageType).
			Str("serial", event.Properties.SerialNumber).
			Msg("Device event")

		// Update device cache
		s.mu.Lock()
		if event.MessageType == "Attached" {
			// Rebuild cache from usbmux so reconnects update DeviceID mappings.
			s.refreshDeviceCacheLocked()
		} else if event.MessageType == "Detached" {
			// Prefer DeviceID match; fall back to full usbmux resync because
			// DeviceID can change across reconnects and leave stale cache entries.
			var udid string
			for key, dev := range s.devices {
				if dev.DeviceID == event.DeviceID {
					udid = key
					break
				}
			}

			if udid != "" {
				delete(s.devices, udid)
				// Update event properties with UDID for broadcasting
				event.Properties.SerialNumber = udid
			}
			// Always rebuild from usbmux so any stale entries left by DeviceID
			// mismatch or missed events are pruned immediately.
			s.refreshDeviceCacheLocked()
			if udid == "" {
				logger.Warn().Int("device_id", event.DeviceID).Msg("Could not map detached DeviceID to UDID before usbmux resync")
			}
		}
		s.mu.Unlock()

		// Broadcast event with normalized event type
		eventType := normalizeEventType(event.MessageType)
		deviceEvent := models.DeviceEvent{
			Type:         eventType,
			DeviceID:     event.DeviceID,
			SerialNumber: event.Properties.SerialNumber,
			Properties:   event.Properties,
		}

		s.broadcastEvent(deviceEvent)
	}
}

func normalizeEventType(messageType string) string {
	switch messageType {
	case "Attached":
		return "device_attached"
	case "Detached":
		return "device_detached"
	default:
		return strings.ToLower(messageType)
	}
}

// normalizeConnectionType maps usbmux ConnectionType to a stable UI value.
// Typical values from usbmuxd are "USB" and "Network".
func normalizeConnectionType(connectionType string) string {
	switch strings.ToLower(strings.TrimSpace(connectionType)) {
	case "usb":
		return "usb"
	case "network":
		return "network"
	case "":
		return "unknown"
	default:
		return strings.ToLower(strings.TrimSpace(connectionType))
	}
}

// isUSBConnection reports whether the usbmux connection type is a cable link.
func isUSBConnection(connectionType string) bool {
	return strings.EqualFold(strings.TrimSpace(connectionType), "USB")
}

func (s *Service) refreshDeviceCache() {
	list, err := ios.ListDevices()
	if err != nil {
		logger.Error().Err(err).Msg("Failed to list devices for cache refresh")
		return
	}

	s.mu.Lock()
	newDevices := s.refreshDeviceCacheLockedFromList(list)
	s.mu.Unlock()

	logger.Debug().Int("devices", len(s.devices)).Msg("Device cache refreshed")

	// Preload DDI for newly connected devices in background
	for udid := range newDevices {
		go s.preloadDDIForDevice(udid)
	}
}

// refreshDeviceCacheLocked rebuilds the connected-device map from usbmux.
// Caller must hold s.mu.
func (s *Service) refreshDeviceCacheLocked() map[string]bool {
	list, err := ios.ListDevices()
	if err != nil {
		logger.Error().Err(err).Msg("Failed to list devices for locked cache refresh")
		return nil
	}
	return s.refreshDeviceCacheLockedFromList(list)
}

// refreshDeviceCacheLockedFromList replaces the cache with currently connected
// devices only (removes disconnected entries). Caller must hold s.mu.
func (s *Service) refreshDeviceCacheLockedFromList(list ios.DeviceList) map[string]bool {
	previous := s.devices
	next := make(map[string]*ios.DeviceEntry, len(list.DeviceList))
	newlyAttached := make(map[string]bool)

	for i := range list.DeviceList {
		device := list.DeviceList[i]
		udid := device.Properties.SerialNumber
		if udid == "" {
			continue
		}

		// The same UDID can appear twice (USB + Network) when the device is
		// both cable-attached and WiFi-paired. Keep only one entry and prefer
		// the USB connection so the UI switches back automatically.
		if existing, ok := next[udid]; ok {
			if isUSBConnection(device.Properties.ConnectionType) && !isUSBConnection(existing.Properties.ConnectionType) {
				deviceCopy := device
				next[udid] = &deviceCopy
			}
			continue
		}

		// Store a copy so later list mutations do not affect the cache.
		deviceCopy := device
		next[udid] = &deviceCopy

		if _, existed := previous[udid]; !existed {
			newlyAttached[udid] = true
		}
	}

	for udid := range previous {
		if _, stillConnected := next[udid]; !stillConnected {
			logger.Info().Str("udid", udid).Msg("Removing disconnected device from cache")
		}
	}

	setChanged := len(previous) != len(next)
	if !setChanged {
		for udid := range next {
			if _, ok := previous[udid]; !ok {
				setChanged = true
				break
			}
		}
	}
	if setChanged {
		s.invalidateListCacheLocked()
	}

	s.devices = next
	return newlyAttached
}

// preloadDDIForDevice is a placeholder when device connects
func (s *Service) preloadDDIForDevice(udid string) {
	// Device connected, no action needed
	logger.Debug().Str("udid", udid).Msg("Device connected")
}

func (s *Service) ListAllConnectedDeviceUDIDs() []string {
	s.refreshDeviceCache()

	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]string, 0, len(s.devices))
	for serialNumber := range s.devices {
		result = append(result, serialNumber)
	}

	// Include simulated devices
	for udid := range s.Simulated {
		result = append(result, udid)
	}

	return result
}

func (s *Service) ListDevices() ([]models.DeviceInfo, error) {
	s.refreshDeviceCache()

	s.listCacheMu.Lock()
	if s.listCache != nil && time.Since(s.listCacheTime) < deviceListCacheTTL {
		cached := s.listCache
		s.listCacheMu.Unlock()
		return cached, nil
	}
	s.listCacheMu.Unlock()

	s.mu.RLock()
	devices := make([]*ios.DeviceEntry, 0, len(s.devices))
	for _, d := range s.devices {
		devices = append(devices, d)
	}
	simulated := make([]models.DeviceInfo, 0, len(s.Simulated))
	for _, sim := range s.Simulated {
		simulated = append(simulated, sim.Info)
	}
	s.mu.RUnlock()

	result := make([]models.DeviceInfo, 0, len(devices)+len(simulated))
	const deviceConcurrency = 4
	sem := make(chan struct{}, deviceConcurrency)
	var wg sync.WaitGroup
	var resultMu sync.Mutex
	for _, d := range devices {
		sem <- struct{}{}
		wg.Add(1)
		go func(d *ios.DeviceEntry) {
			defer wg.Done()
			defer func() { <-sem }()
			info, ok := collectDeviceInfo(d)
			if !ok {
				return
			}
			resultMu.Lock()
			result = append(result, info)
			resultMu.Unlock()
		}(d)
	}
	wg.Wait()

	result = append(result, simulated...)

	s.listCacheMu.Lock()
	s.listCache = result
	s.listCacheTime = time.Now()
	s.listCacheMu.Unlock()

	logger.Info().Int("total_devices", len(result)).Msg("Device list completed")
	return result, nil
}

// collectDeviceInfo gathers the lightweight detail fields for one device.
// Full-dump collection (raw plist, hardware details) lives in the
// /device/:udid/device-info endpoint instead, keeping list refreshes fast.
func collectDeviceInfo(device *ios.DeviceEntry) (models.DeviceInfo, bool) {
	allValues, err := ios.GetValues(*device)
	if err != nil {
		// Skip devices that can't provide info (unpaired, locked, etc.)
		logger.Debug().Err(err).Str("udid", device.Properties.SerialNumber).Msg("Failed to get device values, skipping")
		return models.DeviceInfo{}, false
	}

	// Extract basic info
	productType := allValues.Value.ProductType
	version := allValues.Value.ProductVersion
	name := allValues.Value.DeviceName
	model := productType

	// Use the correct UDID, Serial Number, and ECID fields
	udid := getStringValue(allValues.Value.UniqueDeviceID)
	serialNumber := getStringValue(allValues.Value.SerialNumber)

	// ECID: Extract last 16 characters from UDID (e.g., 00008110-001410523650401E -> 001410523650401E)
	ecid := ""
	if len(udid) >= 16 {
		ecid = udid[len(udid)-16:]
	}

	// IMEI: Get from InternationalMobileEquipmentIdentity
	imei := getStringValue(allValues.Value.InternationalMobileEquipmentIdentity)
	imei2 := ""

	// Extract hardware model (e.g., A2634 or D17AP)
	hardwareModel := getStringValue(allValues.Value.HardwareModel)
	regulatoryModel := ""

	// Extract additional info with safe type assertions
	color := getStringValue(allValues.Value.DeviceColor)
	enclosureColor := getStringValue(allValues.Value.DeviceEnclosureColor)
	buildVersion := getStringValue(allValues.Value.BuildVersion)
	firmwareVersion := getStringValue(allValues.Value.FirmwareVersion)
	regionInfo := getStringValue(allValues.Value.RegionInfo)
	modelNumber := getStringValue(allValues.Value.ModelNumber)
	timeZone := getStringValue(allValues.Value.TimeZone)
	ethernetAddress := getStringValue(allValues.Value.EthernetAddress)

	// Sales Model: Combine ModelNumber and RegionInfo (e.g., MLE03 CH/A)
	salesModel := ""
	if modelNumber != "" {
		if regionInfo != "" {
			salesModel = modelNumber + " " + regionInfo
		} else {
			salesModel = modelNumber
		}
	}

	// Extract activation state
	activationState := getStringValue(allValues.Value.ActivationState)
	if activationState == "" {
		activationState = "Unknown"
	}

	// CPU Architecture
	cpuArch := getStringValue(allValues.Value.CPUArchitecture)

	// WiFi and Bluetooth addresses
	wifiAddr := getStringValue(allValues.Value.WiFiAddress)
	btAddr := getStringValue(allValues.Value.BluetoothAddress)

	// Get additional fields via lockdown connection
	phoneNumber := ""
	humanReadableVersion := ""
	icloudEnabled := false
	appleIDLocked := false
	imsi := ""
	simStatus := ""
	simTrayStatus := ""
	sim1Info := ""
	sim2Info := ""
	batteryLevel := 0
	batteryHealth := 0
	batteryCycleCount := 0
	batteryWatts := 0.0
	batteryIsCharging := false
	batteryExternalConnected := false
	batteryFullyCharged := false
	wifiDebuggingEnabled := false
	wirelessTechnology := ""

	var storageInfo *models.StorageInfo
	batteryCh := make(chan batteryMetrics, 1)
	go func() { batteryCh <- collectBatteryMetrics(*device) }()
	lockdownConn, err := ios.ConnectLockdownWithSession(*device)
	if err == nil {
		if val, err := lockdownConn.GetValueForDomain("EnableWifiDebugging", "com.apple.mobile.wireless_lockdown"); err == nil {
			wifiDebuggingEnabled, _ = val.(bool)
		}
		// ActiveWirelessTechnology lives in the lockdownd root domain
		// (GetValue request without a Domain field).
		if val, err := lockdownConn.GetValueForDomain("ActiveWirelessTechnology", ""); err == nil {
			wirelessTechnology = getStringValue(val)
		}
		// Try to get PhoneNumber
		if val, err := lockdownConn.GetValueForDomain("PhoneNumber", ""); err == nil {
			phoneNumber = getStringValue(val)
		}
		// Try to get HumanReadableProductVersionString (prefer this over ProductVersion)
		if val, err := lockdownConn.GetValueForDomain("HumanReadableProductVersionString", ""); err == nil {
			humanReadableVersion = getStringValue(val)
		}
		// Try to get RegulatoryModelNumber (e.g. A2634)
		if val, err := lockdownConn.GetValueForDomain("RegulatoryModelNumber", ""); err == nil {
			regulatoryModel = getStringValue(val)
		}
		// Try to get IMEI2
		if val, err := lockdownConn.GetValueForDomain("InternationalMobileEquipmentIdentity2", ""); err == nil {
			imei2 = getStringValue(val)
		}
		// Try to get IMSI
		if val, err := lockdownConn.GetValueForDomain("InternationalMobileSubscriberIdentity", ""); err == nil {
			imsi = getStringValue(val)
		}
		// Try to get EthernetAddress if missing
		if ethernetAddress == "" {
			if val, err := lockdownConn.GetValueForDomain("EthernetAddress", ""); err == nil {
				ethernetAddress = getStringValue(val)
			}
		}
		// Try to get SIM info (carrier info, sim status, etc)
		// Note: These might be in com.apple.commcenter or other domains
		if val, err := lockdownConn.GetValueForDomain("SIMStatus", ""); err == nil {
			simStatus = getStringValue(val)
		}
		if val, err := lockdownConn.GetValueForDomain("SIMTrayStatus", ""); err == nil {
			simTrayStatus = getStringValue(val)
		}
		// Extract carrier info from CarrierBundleInfoArray (it's an array of SIM info)
		if val, err := lockdownConn.GetValueForDomain("CarrierBundleInfoArray", ""); err == nil {
			if carrierArray, ok := val.([]interface{}); ok {
				logger.Info().Msgf("Found CarrierBundleInfoArray with %d items", len(carrierArray))
				for idx, item := range carrierArray {
					if carrierDict, ok := item.(map[string]interface{}); ok {
						slot := getStringValue(carrierDict["Slot"])
						bundleID := getStringValue(carrierDict["CFBundleIdentifier"])
						logger.Info().Msgf("CarrierBundleInfo[%d]: Slot=%s, BundleID=%s", idx, slot, bundleID)

						// Extract carrier name from bundle ID (e.g., "com.apple.ChinaTelecom_USIM_cn" -> "ChinaTelecom_USIM_cn")
						carrierName := bundleID
						if len(bundleID) > 0 {
							// Remove "com.apple." prefix only
							if idx := strings.Index(bundleID, "com.apple."); idx == 0 {
								carrierName = bundleID[10:]
							}
						}
						// Assign to sim1Info or sim2Info based on Slot
						if slot == "kOne" {
							sim1Info = carrierName
							logger.Info().Msgf("Set SIM1Info: %s", sim1Info)
							// Also get IMSI for slot 1 if available
							if imsiVal := getStringValue(carrierDict["InternationalMobileSubscriberIdentity"]); imsiVal != "" {
								imsi = imsiVal
							}
						} else if slot == "kTwo" {
							sim2Info = carrierName
							logger.Info().Msgf("Set SIM2Info: %s", sim2Info)
						}
					}
				}
			} else {
				logger.Warn().Msg("CarrierBundleInfoArray is not an array")
			}
		} else {
			logger.Warn().Msgf("Failed to get CarrierBundleInfoArray: %v", err)
		}

		// Determine iCloud login status (best-effort)
		// Prefer com.apple.mobile.data_sync: AccountNames often contains iCloud and/or iCloud email addresses.
		if val, err := lockdownConn.GetValueForDomain("", "com.apple.mobile.data_sync"); err == nil && val != nil {
			icloudEnabled = isICloudAccountPresent(val)
		}

		// Fallback iCloud signals via iTunes store domains (some systems expose AppleID/DSID there)
		if !icloudEnabled {
			for _, domain := range []string{"com.apple.mobile.iTunes.store", "com.apple.mobile.iTunes", "com.apple.itunesstored"} {
				if v, err := lockdownConn.GetValueForDomain("AppleID", domain); err == nil {
					if s := strings.TrimSpace(getStringValue(v)); s != "" {
						icloudEnabled = true
						break
					}
				}

				if v, err := lockdownConn.GetValueForDomain("DSPersonID", domain); err == nil {
					s := strings.TrimSpace(getStringValue(v))
					if s != "" && s != "0" {
						icloudEnabled = true
						break
					}
				}

				if v, err := lockdownConn.GetValueForDomain("AccountID", domain); err == nil {
					s := strings.TrimSpace(getStringValue(v))
					if s != "" && s != "0" {
						icloudEnabled = true
						break
					}
				}
			}
		}

		// Determine Find My status / Activation Lock state
		// Prefer NVRAM exports: NonVolatileRAM has keys like fm-spstatus and fm-activation-locked.
		// Keep the existing field name apple_id_locked for UI compatibility.
		appleIDLocked = isFindMyEnabledFromAllValues(allValues.Value)
		if !appleIDLocked {
			// Fallback: old lockdown domain (may not exist on newer systems)
			if fmipVal, err := lockdownConn.GetValueForDomain("FMIPEnabled", "com.apple.fmip"); err == nil {
				if enabled, ok := fmipVal.(bool); ok && enabled {
					appleIDLocked = true
				}
			}
		}

		// Get storage information
		if diskUsage, err := lockdownConn.GetValueForDomain("", "com.apple.disk_usage"); err == nil {
			diskUsageFactory, _ := lockdownConn.GetValueForDomain("", "com.apple.disk_usage.factory")
			storageInfo = parseStorageInfo(diskUsage, diskUsageFactory)
		}
	}

	battery := <-batteryCh
	if battery.level > 0 {
		batteryLevel = battery.level
	}
	batteryHealth = battery.health
	batteryCycleCount = battery.cycleCount
	batteryWatts = battery.watts
	batteryIsCharging = battery.isCharging
	batteryExternalConnected = battery.externalConnected
	batteryFullyCharged = battery.fullyCharged

	// Use HumanReadableProductVersionString if available
	if humanReadableVersion != "" {
		version = humanReadableVersion
	}

	// Use RegulatoryModelNumber as ProductName if available (e.g. A2634)
	// Otherwise fallback to HardwareModel (e.g. D17AP)
	productName := hardwareModel
	if regulatoryModel != "" {
		productName = regulatoryModel
	}

	if lockdownConn != nil {
		lockdownConn.Close()
	}

	deviceInfo := models.DeviceInfo{
		UDID:                 udid,
		Name:                 name,
		Model:                model,
		Version:              version,
		Color:                color,
		EnclosureColor:       enclosureColor,
		ProductType:          productType,
		ProductName:          productName,
		RegulatoryModel:      regulatoryModel,
		BuildVersion:         buildVersion,
		FirmwareVersion:      firmwareVersion,
		SerialNumber:         serialNumber,
		IMEI:                 imei,
		IMEI2:                imei2,
		PhoneNumber:          phoneNumber,
		ECID:                 ecid,
		RegionInfo:           regionInfo,
		ModelNumber:          modelNumber,
		SalesModel:           salesModel,
		TimeZone:             timeZone,
		ActivationState:      activationState,
		IsPaired:             true,
		ConnectionType:       normalizeConnectionType(device.Properties.ConnectionType),
		WiFiDebuggingEnabled: wifiDebuggingEnabled,
		WirelessTechnology:   wirelessTechnology,
		CPUArchitecture:      cpuArch,
		WiFiAddress:          wifiAddr,
		EthernetAddress:      ethernetAddress,
		BluetoothAddress:     btAddr,
		ICloudEnabled:        icloudEnabled,
		AppleIDLocked:        appleIDLocked,
		IMSI:                 imsi,
		SIMStatus:            simStatus,
		SIMTrayStatus:        simTrayStatus,
		SIM1Info:             sim1Info,
		SIM2Info:             sim2Info,
		StorageInfo:          storageInfo,
		// Note: Battery info, jailbreak detection, and warranty info
		// require additional API calls or cannot be reliably detected
		IsJailbroken:             false, // Placeholder
		BatteryLevel:             batteryLevel,
		BatteryIsCharging:        batteryIsCharging,
		BatteryExternalConnected: batteryExternalConnected,
		BatteryFullyCharged:      batteryFullyCharged,
		BatteryHealth:            batteryHealth,
		BatteryCycleCount:        batteryCycleCount,
		BatteryWatts:             batteryWatts,
		CrashLogCount:            0, // Requires CrashReportMover service
	}

	return deviceInfo, true
}

func isICloudAccountPresent(domainValue interface{}) bool {
	if domainValue == nil {
		return false
	}

	root, ok := domainValue.(map[string]interface{})
	if !ok {
		return false
	}

	for _, sectionValue := range root {
		section, ok := sectionValue.(map[string]interface{})
		if !ok {
			continue
		}

		accountNames, ok := section["AccountNames"].([]interface{})
		if !ok {
			continue
		}

		for _, item := range accountNames {
			name := strings.ToLower(strings.TrimSpace(getStringValue(item)))
			if name == "icloud" || strings.Contains(name, "@icloud.com") || strings.Contains(name, "@me.com") || strings.Contains(name, "@mac.com") {
				return true
			}
		}
	}

	return false
}

func isFindMyEnabledFromAllValues(values ios.AllValuesType) bool {
	// NVRAM keys are usually base64-encoded bytes in lockdown exports.
	// We treat any of these markers as enabled:
	// - fm-spstatus == "YES" (Find My enabled)
	// - fm-activation-locked == "YES" (activation lock enabled)
	// - fm-account-masked present (an account is configured)

	if decoded := strings.TrimSpace(decodeBase64String(values.NonVolatileRAM.FMServiceProvider)); strings.EqualFold(decoded, "YES") {
		return true
	}

	if decoded := strings.TrimSpace(decodeBase64String(values.NonVolatileRAM.FMActivationLocked)); strings.EqualFold(decoded, "YES") {
		return true
	}

	if decoded := strings.TrimSpace(decodeBase64String(values.NonVolatileRAM.FMAccountMasked)); decoded != "" {
		return true
	}

	return false
}

// getStringValue safely converts interface{} to string
func getStringValue(val interface{}) string {
	if val == nil {
		return ""
	}
	if str, ok := val.(string); ok {
		return str
	}
	return fmt.Sprintf("%v", val)
}

func (s *Service) GetDeviceByUDID(udid string) (*ios.DeviceEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	device, ok := s.devices[udid]
	if !ok {
		return nil, fmt.Errorf("device not found: %s", udid)
	}

	return device, nil
}

func (s *Service) IsSimulatedUDID(udid string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	_, ok := s.Simulated[udid]
	return ok
}

func (s *Service) Subscribe() chan models.DeviceEvent {
	s.mu.Lock()
	defer s.mu.Unlock()

	ch := make(chan models.DeviceEvent, 10)
	s.listeners = append(s.listeners, ch)
	return ch
}

func (s *Service) Unsubscribe(ch chan models.DeviceEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i, listener := range s.listeners {
		if listener == ch {
			close(ch)
			s.listeners = append(s.listeners[:i], s.listeners[i+1:]...)
			break
		}
	}
}

func (s *Service) broadcastEvent(event models.DeviceEvent) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for _, ch := range s.listeners {
		select {
		case ch <- event:
		default:
			logger.Warn().Msg("Listener channel full, event dropped")
		}
	}
}

// AddSimulatedDevice registers a simulated device in memory
func (s *Service) AddSimulatedDevice(info models.DeviceInfo, apps []models.AppInfo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Simulated == nil {
		s.Simulated = make(map[string]models.SimulatedDevice)
	}
	s.Simulated[info.UDID] = models.SimulatedDevice{Info: info, Apps: apps}
	s.invalidateListCacheLocked()
}

// ClearSimulatedDevices removes all simulated devices and returns their UDIDs
func (s *Service) ClearSimulatedDevices() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	udids := make([]string, 0, len(s.Simulated))
	for udid := range s.Simulated {
		udids = append(udids, udid)
		delete(s.Simulated, udid)
	}
	s.invalidateListCacheLocked()
	return udids
}

// RemoveSimulatedDevice removes a single simulated device by UDID
func (s *Service) RemoveSimulatedDevice(udid string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Simulated == nil {
		return false
	}
	if _, exists := s.Simulated[udid]; exists {
		delete(s.Simulated, udid)
		s.invalidateListCacheLocked()
		return true
	}
	return false
}

// invalidateListCacheLocked drops the cached /devices response. Caller must
// hold s.mu.
func (s *Service) invalidateListCacheLocked() {
	s.listCacheMu.Lock()
	s.listCache = nil
	s.listCacheMu.Unlock()
}

// ListSimulatedProfiles reads saved profiles from disk
func (s *Service) ListSimulatedProfiles() ([]models.SimulatedDeviceProfile, error) {
	path := s.getProfilesPath()
	var profiles []models.SimulatedDeviceProfile
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []models.SimulatedDeviceProfile{}, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(data, &profiles); err != nil {
		return nil, err
	}
	return profiles, nil
}

// SaveSimulatedProfile saves or updates a profile by ID
func (s *Service) SaveSimulatedProfile(p models.SimulatedDeviceProfile) error {
	profiles, err := s.ListSimulatedProfiles()
	if err != nil {
		return err
	}
	replaced := false
	for i := range profiles {
		if profiles[i].ID == p.ID {
			profiles[i] = p
			replaced = true
			break
		}
	}
	if !replaced {
		profiles = append(profiles, p)
	}
	data, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.ConfigDir, 0755); err != nil {
		return err
	}
	return os.WriteFile(s.getProfilesPath(), data, 0644)
}

// DeleteSimulatedProfile removes a profile by ID
func (s *Service) DeleteSimulatedProfile(id string) error {
	profiles, err := s.ListSimulatedProfiles()
	if err != nil {
		return err
	}
	filtered := make([]models.SimulatedDeviceProfile, 0, len(profiles))
	for _, p := range profiles {
		if p.ID != id {
			filtered = append(filtered, p)
		}
	}
	data, err := json.MarshalIndent(filtered, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.ConfigDir, 0755); err != nil {
		return err
	}
	return os.WriteFile(s.getProfilesPath(), data, 0644)
}

func (s *Service) getProfilesPath() string {
	return s.ConfigDir + string(os.PathSeparator) + "simulated_devices.json"
}

// GenerateRandomDeviceInfo creates a random device info for testing
func (s *Service) GenerateRandomDeviceInfo() models.DeviceInfo {
	deviceModels := []string{"iPhone14,5", "iPhone15,2", "iPhone13,4", "iPhone14,2", "iPhone12,3", "iPhone11,8", "iPhone10,6", "iPhone9,1"}
	versions := []string{"18.1", "17.5", "17.0.3", "16.7", "17.2.1", "16.7.2"}
	names := []string{"John's iPhone", "Test Device", "Mary's iPhone", "QA Phone", "Developer iPhone", "Testing iPhone"}
	regions := []string{"CH/A", "LL/A", "ZP/A", "J/A", "EU/A"}

	modelIdx := randomInt(len(deviceModels))
	selectedModel := deviceModels[modelIdx]
	selectedVersion := versions[randomInt(len(versions))]
	selectedName := names[randomInt(len(names))]
	selectedRegion := regions[randomInt(len(regions))]

	udid := generateSimulatedUDID()
	serialNumber := fmt.Sprintf("F%d%s", randomInt(900)+100, randomString(8))

	return models.DeviceInfo{
		UDID:                     udid,
		Name:                     selectedName,
		Model:                    selectedModel,
		Version:                  selectedVersion,
		Color:                    "1",
		EnclosureColor:           "1",
		ProductType:              selectedModel,
		ProductName:              fmt.Sprintf("A%d", randomInt(3000)+1000),
		RegulatoryModel:          fmt.Sprintf("A%d", randomInt(3000)+1000),
		BuildVersion:             fmt.Sprintf("%dH%d", randomInt(30)+20, randomInt(100)),
		FirmwareVersion:          fmt.Sprintf("iBoot-%d.%d.%d", randomInt(15000)+10000, randomInt(200)+100, randomInt(100)),
		SerialNumber:             serialNumber,
		IMEI:                     fmt.Sprintf("35%d", randomInt(10000000000000)),
		IMEI2:                    fmt.Sprintf("35%d", randomInt(10000000000000)),
		PhoneNumber:              fmt.Sprintf("+86138%08d", randomInt(100000000)),
		RegionInfo:               selectedRegion,
		ModelNumber:              fmt.Sprintf("ML%s%d", randomString(1), randomInt(10)),
		SalesModel:               fmt.Sprintf("ML%s%d %s", randomString(1), randomInt(10), selectedRegion),
		TimeZone:                 "Asia/Shanghai",
		ActivationState:          "Simulated",
		IsPaired:                 true,
		IsJailbroken:             false,
		CPUArchitecture:          "arm64e",
		BatteryLevel:             randomInt(100),
		BatteryIsCharging:        false,
		BatteryExternalConnected: false,
		BatteryFullyCharged:      false,
		BatteryHealth:            randomInt(20) + 80,
		BatteryCycleCount:        randomInt(500),
		ManufactureDate:          time.Now().AddDate(-randomInt(3), -randomInt(12), 0).Format("2006-01-02"),
		WarrantyExpiration:       time.Now().AddDate(randomInt(2), 0, 0).Format("2006-01-02"),
		AppleIDLocked:            false,
		ICloudEnabled:            randomInt(2) == 1,
		WiFiAddress:              fmt.Sprintf("%02x:%02x:%02x:%02x:%02x:%02x", randomInt(256), randomInt(256), randomInt(256), randomInt(256), randomInt(256), randomInt(256)),
		EthernetAddress:          fmt.Sprintf("%02x:%02x:%02x:%02x:%02x:%02x", randomInt(256), randomInt(256), randomInt(256), randomInt(256), randomInt(256), randomInt(256)),
		BluetoothAddress:         fmt.Sprintf("%02x:%02x:%02x:%02x:%02x:%02x", randomInt(256), randomInt(256), randomInt(256), randomInt(256), randomInt(256), randomInt(256)),
		IMSI:                     fmt.Sprintf("4600%d", randomInt(10000000000)),
		SIMStatus:                "kCTSIMSupportSIMStatusReady",
		SIMTrayStatus:            "kCTSIMSupportSIMTrayInsertedWithSIM",
		SIM1Info:                 "ChinaTelecom_USIM_cn",
		SIM2Info:                 "ChinaMobile_USIM_cn",
		RawData:                  map[string]interface{}{"simulated": true, "random": true},
	}
}

func collectBatteryMetrics(device ios.DeviceEntry) batteryMetrics {
	metrics := batteryMetrics{}

	if batteryInfo, err := ios.GetBatteryDiagnostics(device); err == nil {
		metrics.level = int(batteryInfo.BatteryCurrentCapacity)
		metrics.isCharging = batteryInfo.BatteryIsCharging
		metrics.externalConnected = batteryInfo.ExternalConnected || batteryInfo.ExternalChargeCapable
		metrics.fullyCharged = batteryInfo.FullyCharged
	} else {
		logger.Debug().Err(err).Str("udid", device.Properties.SerialNumber).Msg("Failed to get battery diagnostics")
	}

	diagnosticsConn, err := diagnostics.New(device)
	if err != nil {
		logger.Debug().Err(err).Str("udid", device.Properties.SerialNumber).Msg("Failed to connect diagnostics relay")
		return metrics
	}
	defer diagnosticsConn.Close()

	batteryStats, err := diagnosticsConn.Battery()
	if err != nil {
		logger.Debug().Err(err).Str("udid", device.Properties.SerialNumber).Msg("Failed to get battery registry stats")
		return metrics
	}

	if metrics.level <= 0 && batteryStats.CurrentCapacity > 0 {
		metrics.level = batteryStats.CurrentCapacity
	}
	if !metrics.isCharging {
		metrics.isCharging = batteryStats.IsCharging
	}
	if batteryStats.CycleCount > 0 {
		metrics.cycleCount = int(batteryStats.CycleCount)
	}
	if batteryStats.DesignCapacity > 0 && batteryStats.NominalChargeCapacity > 0 {
		// Ceil to match iOS Settings-style display on this device
		// (e.g. 3589/3652 = 98.27% → 99%).
		health := int(math.Ceil(float64(batteryStats.NominalChargeCapacity) / float64(batteryStats.DesignCapacity) * 100))
		if health < 0 {
			health = 0
		}
		if health > 100 {
			health = 100
		}
		metrics.health = health
	}

	// Prefer GasGauge FullChargeCapacity when available; it is closer to the
	// maximum capacity percentage shown in iOS Settings on many devices.
	if allDiagnostics, err := diagnosticsConn.AllValues(); err == nil {
		gasGauge := allDiagnostics.Diagnostics.GasGauge
		if gasGauge.DesignCapacity > 0 && gasGauge.FullChargeCapacity > 0 {
			health := int(math.Ceil(float64(gasGauge.FullChargeCapacity) / float64(gasGauge.DesignCapacity) * 100))
			if health < 0 {
				health = 0
			}
			if health > 100 {
				health = 100
			}
			// Only accept plausible health values. Some iOS builds return GasGauge
			// numbers in incompatible units that produce nonsense percentages.
			if health >= 50 && health <= 100 {
				metrics.health = health
			}
		}
		if gasGauge.CycleCount > 0 {
			metrics.cycleCount = int(gasGauge.CycleCount)
		}
	}

	// InstantAmperage is typically mA (signed), Voltage is mV.
	// Power (W) = |mA| * mV / 1_000_000. This is an instantaneous sample from
	// IOPMPowerSource and often reads near-zero during trickle/taper charging,
	// so only surface meaningful values while actually charging.
	if batteryStats.Voltage > 0 {
		watts := math.Abs(float64(batteryStats.InstantAmperage)*float64(batteryStats.Voltage)) / 1_000_000
		activelyCharging := metrics.isCharging || batteryStats.IsCharging
		if activelyCharging && watts >= 1.0 {
			metrics.watts = math.Round(watts*10) / 10
		}
	}
	if !metrics.externalConnected {
		metrics.externalConnected = metrics.isCharging || metrics.watts > 0
	}

	return metrics
}

func generateSimulatedUDID() string {
	// Match a common iPhone UDID shape like 00008110-001A2B3C4D5E001E.
	return fmt.Sprintf("00008110-%s", randomString(16))
}

// GenerateRandomApps creates a set of random apps for testing (2 system apps + 2 app store apps)
func (s *Service) GenerateRandomApps() []models.AppInfo {
	apps := []models.AppInfo{}

	// Generate 2 system apps
	systemApps := []struct {
		name       string
		bundleID   string
		executable string
		path       string
	}{
		{"Settings", "com.apple.Preferences", "Preferences", "/Applications/Preferences.app"},
		{"Photos", "com.apple.mobileslideshow", "MobileSlideShow", "/Applications/MobileSlideShow.app"},
		{"Camera", "com.apple.camera", "Camera", "/Applications/Camera.app"},
		{"Messages", "com.apple.MobileSMS", "MobileSMS", "/Applications/MobileSMS.app"},
		{"Safari", "com.apple.mobilesafari", "MobileSafari", "/Applications/MobileSafari.app"},
	}

	// Create shuffled indices for system apps
	systemIndices := shuffleIndices(len(systemApps))

	// Select first 2 unique system apps
	for i := 0; i < 2 && i < len(systemIndices); i++ {
		sysApp := systemApps[systemIndices[i]]
		apps = append(apps, models.AppInfo{
			BundleID:               sysApp.bundleID,
			Name:                   sysApp.name,
			Version:                "1.0",
			AuthType:               "system",
			BuildMachineOSBuild:    fmt.Sprintf("23%s%d", randomString(1), randomInt(900000)+100000),
			CFBundleExecutable:     sysApp.executable,
			MinimumOSVersion:       fmt.Sprintf("%d.%d", randomInt(3)+16, randomInt(8)),
			ApplicationType:        "System",
			Path:                   sysApp.path,
			SequenceNumber:         uint64(randomInt(500) + 100),
			CFBundleNumericVersion: uint64(randomInt(900000) + 16000000),
		})
	}

	// Generate 2 app store apps
	appStoreApps := []struct {
		name     string
		bundleID string
	}{
		{"WeChat", "com.tencent.xin"},
		{"QQ", "com.tencent.mqq"},
		{"Alipay", "com.alipay.iphoneclient"},
		{"Taobao", "com.taobao.taobao4iphone"},
		{"Douyin", "com.ss.iphone.ugc.Aweme"},
		{"Bilibili", "tv.danmaku.bilibilihd"},
	}

	// Create shuffled indices for app store apps
	storeIndices := shuffleIndices(len(appStoreApps))

	// Select first 2 unique app store apps
	for i := 0; i < 2 && i < len(storeIndices); i++ {
		storeApp := appStoreApps[storeIndices[i]]
		apps = append(apps, models.AppInfo{
			BundleID:            storeApp.bundleID,
			Name:                storeApp.name,
			Version:             fmt.Sprintf("%d.%d.%d", randomInt(10)+1, randomInt(20), randomInt(10)),
			AuthType:            "apple_store",
			BuildMachineOSBuild: fmt.Sprintf("23%s%d", randomString(1), randomInt(90)),
			CFBundleExecutable:  "OTSAppModule",
			SignerIdentity:      "Apple iPhone OS Application Signing",
			MinimumOSVersion:    fmt.Sprintf("%d.0", randomInt(6)+13),
			ApplicationType:     "User",
			SequenceNumber:      uint64(randomInt(5000) + 1000),
		})
	}

	return apps
}

// shuffleIndices creates a shuffled array of indices from 0 to n-1
func shuffleIndices(n int) []int {
	indices := make([]int, n)
	for i := 0; i < n; i++ {
		indices[i] = i
	}

	// Fisher-Yates shuffle
	for i := n - 1; i > 0; i-- {
		j := randomInt(i + 1)
		indices[i], indices[j] = indices[j], indices[i]
	}

	return indices
}

func randomInt(max int) int {
	if max <= 0 {
		return 0
	}
	return rand.Intn(max)
}

func randomString(length int) string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	result := make([]byte, length)
	for i := 0; i < length; i++ {
		result[i] = chars[randomInt(len(chars))]
	}
	return string(result)
}

// GetLockdownValues retrieves all lockdown values for debugging Apple ID info
func (s *Service) GetLockdownValues(udid string) (map[string]interface{}, error) {
	device, err := s.GetDeviceByUDID(udid)
	if err != nil {
		return nil, err
	}

	// Get all values using lockdown
	allValues, err := ios.GetValuesPlist(*device)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Failed to get lockdown values")
		return nil, err
	}

	// Try to get specific account-related domains/keys
	lockdownConnection, err := ios.ConnectLockdownWithSession(*device)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Failed to connect lockdown")
		return allValues, nil
	}
	defer lockdownConnection.Close()

	// Try various domains that might contain account info
	domains := []string{
		"com.apple.mobile.iTunes.store",
		"com.apple.mobile.iTunes",
		"com.apple.itunesstored",
		"com.apple.accounts",
		"com.apple.AppleAccount",
		"com.apple.mobile.data_sync",
		"com.apple.mobile.sync_data_class",
	}

	keys := []string{
		"AppleID",
		"AccountID",
		"DSPersonID",
		"AccountInfo",
		"Accounts",
	}

	result := make(map[string]interface{})
	result["AllValues"] = allValues

	for _, domain := range domains {
		for _, key := range keys {
			val, err := lockdownConnection.GetValueForDomain(key, domain)
			if err == nil && val != nil {
				if result[domain] == nil {
					result[domain] = make(map[string]interface{})
				}
				result[domain].(map[string]interface{})[key] = val
			}
		}

		// Also try getting the entire domain value
		val, err := lockdownConnection.GetValueForDomain("", domain)
		if err == nil && val != nil {
			result[domain+"_all"] = val
		}
	}

	logger.Debug().Str("udid", udid).Int("domain_count", len(result)).Msg("Lockdown values retrieved")
	return result, nil
}

// RestartDevice restarts the specified device
func (s *Service) RestartDevice(udid string) error {
	device, err := s.GetDeviceByUDID(udid)
	if err != nil {
		return err
	}

	logger.Info().Str("udid", udid).Msg("Restarting device")

	// Use diagnostics.Reboot function
	err = diagnostics.Reboot(*device)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Failed to restart device")
		return fmt.Errorf("failed to restart device: %w", err)
	}

	logger.Info().Str("udid", udid).Msg("Device restart command sent successfully")
	return nil
}

// ShutdownDevice shuts down the specified device
func (s *Service) ShutdownDevice(udid string) error {
	device, err := s.GetDeviceByUDID(udid)
	if err != nil {
		return err
	}

	logger.Info().Str("udid", udid).Msg("Shutting down device")

	// Use diagnostics.Shutdown function
	err = diagnostics.Shutdown(*device)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Failed to shutdown device")
		return fmt.Errorf("failed to shutdown device: %w", err)
	}

	logger.Info().Str("udid", udid).Msg("Device shutdown command sent successfully")
	return nil
}

func (s *Service) CheckPairingStatus(udid string) (bool, bool, error) {
	device, err := s.GetDeviceByUDID(udid)
	if err != nil {
		return false, false, err
	}

	logger.Debug().Str("udid", udid).Msg("API: Checking pairing status")

	// First check if we have a pair record (doesn't require device to be unlocked)
	_, err = ios.ReadPairRecord(udid)
	if err == nil {
		// Pair record exists, device is already paired
		logger.Debug().Str("udid", udid).Msg("Device is already paired (pair record found)")
		return true, false, nil
	}

	// No pair record found, try to pair
	logger.Debug().Str("udid", udid).Str("error", err.Error()).Msg("No pair record found, attempting to pair")

	err = ios.Pair(*device)
	if err != nil {
		errMsg := err.Error()
		logger.Debug().Str("udid", udid).Str("error", errMsg).Msg("Pair attempt result")

		if strings.Contains(errMsg, "PairingDialog") {
			return false, true, nil
		}

		if strings.Contains(errMsg, "InvalidHostID") || strings.Contains(errMsg, "not paired") {
			return false, false, nil
		}

		// Device is locked but not paired yet
		if strings.Contains(errMsg, "PasswordProtected") {
			logger.Debug().Str("udid", udid).Msg("Device is locked and not paired")
			return false, false, nil
		}

		return false, false, err
	}

	return true, false, nil
}

func (s *Service) PairDevice(udid string) error {
	device, err := s.GetDeviceByUDID(udid)
	if err != nil {
		return err
	}

	logger.Info().Str("udid", udid).Msg("Attempting to pair device")

	err = ios.Pair(*device)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "PairingDialog") {
			return fmt.Errorf("waiting_for_trust")
		}
		return err
	}

	logger.Info().Str("udid", udid).Msg("Device paired successfully")
	return nil
}

func (s *Service) SetWiFiDebugging(udid string, enabled bool) error {
	device, err := s.GetDeviceByUDID(udid)
	if err != nil {
		return err
	}

	if strings.ToLower(strings.TrimSpace(device.Properties.ConnectionType)) != "usb" {
		return fmt.Errorf("Wi-Fi debugging can only be configured over USB")
	}

	lockdownConn, err := ios.ConnectLockdownWithSession(*device)
	if err != nil {
		return fmt.Errorf("failed to connect lockdown: %w", err)
	}
	defer lockdownConn.Close()

	if err := lockdownConn.SetValueForDomain("EnableWifiDebugging", "com.apple.mobile.wireless_lockdown", enabled); err != nil {
		return fmt.Errorf("failed to set Wi-Fi debugging: %w", err)
	}

	return nil
}

// GetStorageInfo retrieves detailed storage information from device
func (s *Service) GetStorageInfo(udid string) (*models.StorageInfo, error) {
	device, err := s.GetDeviceByUDID(udid)
	if err != nil {
		return nil, err
	}

	logger.Info().Str("udid", udid).Msg("Retrieving storage information")

	lockdownConn, err := ios.ConnectLockdownWithSession(*device)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Failed to connect lockdown for storage info")
		return nil, fmt.Errorf("failed to connect lockdown: %w", err)
	}
	defer lockdownConn.Close()

	diskUsage, err := lockdownConn.GetValueForDomain("", "com.apple.disk_usage")
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Failed to get disk usage info")
		return nil, fmt.Errorf("failed to get disk usage: %w", err)
	}

	diskUsageFactory, err := lockdownConn.GetValueForDomain("", "com.apple.disk_usage.factory")
	if err != nil {
		logger.Warn().Err(err).Str("udid", udid).Msg("Failed to get factory disk usage info, using basic info only")
	}

	storageInfo := parseStorageInfo(diskUsage, diskUsageFactory)
	logger.Info().
		Str("udid", udid).
		Str("total", storageInfo.FormattedTotal).
		Str("used", storageInfo.FormattedUsed).
		Str("available", storageInfo.FormattedAvailable).
		Float64("used_percentage", storageInfo.UsedPercentage).
		Msg("Storage information retrieved")

	return storageInfo, nil
}

// parseStorageInfo parses disk usage data into StorageInfo struct
func parseStorageInfo(diskUsage interface{}, diskUsageFactory interface{}) *models.StorageInfo {
	info := &models.StorageInfo{}
	hasAmountDataAvailable := false

	if diskUsageMap, ok := diskUsage.(map[string]interface{}); ok {
		info.TotalDiskCapacity = getUint64Value(diskUsageMap["TotalDiskCapacity"])
		info.TotalDataCapacity = getUint64Value(diskUsageMap["TotalDataCapacity"])
		info.TotalSystemCapacity = getUint64Value(diskUsageMap["TotalSystemCapacity"])
		info.TotalDataAvailable = getUint64Value(diskUsageMap["TotalDataAvailable"])
		_, hasAmountDataAvailable = diskUsageMap["AmountDataAvailable"]
		info.AmountDataAvailable = getUint64Value(diskUsageMap["AmountDataAvailable"])
		info.AmountDataReserved = getUint64Value(diskUsageMap["AmountDataReserved"])
		info.TotalSystemAvailable = getUint64Value(diskUsageMap["TotalSystemAvailable"])

		if status, ok := diskUsageMap["CalculateDiskUsage"].(string); ok {
			info.CalculateDiskUsage = status
		}
	}

	if factoryMap, ok := diskUsageFactory.(map[string]interface{}); ok {
		info.CameraUsage = getUint64Value(factoryMap["CameraUsage"])
		info.PhotoUsage = getUint64Value(factoryMap["PhotoUsage"])
		info.CalendarUsage = getUint64Value(factoryMap["CalendarUsage"])
		info.NotesUsage = getUint64Value(factoryMap["NotesUsage"])
		info.VoicemailUsage = getUint64Value(factoryMap["VoicemailUsage"])
		info.WebAppCacheUsage = getUint64Value(factoryMap["WebAppCacheUsage"])
		info.MediaCacheUsage = getUint64Value(factoryMap["MediaCacheUsage"])
	}

	totalForDisplay := info.TotalDataCapacity
	if totalForDisplay == 0 {
		totalForDisplay = info.TotalDiskCapacity
	}

	freeOnData := info.AmountDataAvailable
	if !hasAmountDataAvailable {
		freeOnData = info.TotalDataAvailable
	}

	if totalForDisplay > 0 && freeOnData > totalForDisplay {
		freeOnData = totalForDisplay
	}

	var usedSpace, availableForDisplay uint64
	if totalForDisplay > 0 {
		availableForDisplay = freeOnData
		usedSpace = totalForDisplay - availableForDisplay
	} else {
		availableForDisplay = freeOnData
	}

	info.UsedSpace = usedSpace
	if totalForDisplay > 0 {
		info.UsedPercentage = float64(usedSpace) / float64(totalForDisplay) * 100
		info.AvailablePercentage = float64(availableForDisplay) / float64(totalForDisplay) * 100
	}

	// Decimal GB labels match Apple marketing / Settings (1000-based).
	info.FormattedTotal = formatStorageBytes(totalForDisplay)
	info.FormattedUsed = formatStorageBytes(usedSpace)
	info.FormattedAvailable = formatStorageBytes(availableForDisplay)

	return info
}

// getUint64Value safely converts interface{} to uint64
func getUint64Value(val interface{}) uint64 {
	if val == nil {
		return 0
	}
	switch v := val.(type) {
	case uint64:
		return v
	case int64:
		return uint64(v)
	case int:
		return uint64(v)
	case float64:
		return uint64(v)
	case float32:
		return uint64(v)
	default:
		return 0
	}
}

// formatBytes converts bytes to human-readable format
func formatBytes(bytes uint64) string {
	if bytes == 0 {
		return "0 B"
	}

	units := []string{"B", "KB", "MB", "GB", "TB"}
	base := 1024.0

	if bytes < 1024 {
		return fmt.Sprintf("%d B", bytes)
	}

	exp := int(math.Floor(math.Log(float64(bytes)) / math.Log(base)))
	if exp >= len(units) {
		exp = len(units) - 1
	}

	value := float64(bytes) / math.Pow(base, float64(exp))
	return fmt.Sprintf("%.1f %s", value, units[exp])
}

// formatStorageBytes formats disk capacity using decimal units (1000),
// matching Apple marketing capacity labels (e.g. 256000000000 -> "256.0 GB").
func formatStorageBytes(bytes uint64) string {
	if bytes == 0 {
		return "0 B"
	}

	units := []string{"B", "KB", "MB", "GB", "TB"}
	base := 1000.0

	if bytes < 1000 {
		return fmt.Sprintf("%d B", bytes)
	}

	exp := int(math.Floor(math.Log(float64(bytes)) / math.Log(base)))
	if exp >= len(units) {
		exp = len(units) - 1
	}

	value := float64(bytes) / math.Pow(base, float64(exp))
	// Two decimals for GB/TB so values like 246.89 match Settings-style precision.
	if exp >= 3 {
		return fmt.Sprintf("%.2f %s", value, units[exp])
	}
	return fmt.Sprintf("%.1f %s", value, units[exp])
}

// FormatStorageProgressBar creates a visual progress bar for storage usage
func FormatStorageProgressBar(storageInfo *models.StorageInfo, width int) string {
	if storageInfo == nil || storageInfo.TotalDataCapacity == 0 {
		return ""
	}

	percentage := storageInfo.UsedPercentage
	filledWidth := int(float64(width) * percentage / 100)
	if filledWidth > width {
		filledWidth = width
	}

	emptyWidth := width - filledWidth
	if emptyWidth < 0 {
		emptyWidth = 0
	}

	progressBar := "["
	progressBar += strings.Repeat("█", filledWidth)
	progressBar += strings.Repeat("░", emptyWidth)
	progressBar += "]"

	return fmt.Sprintf("%s %.1f%% (%s / %s)",
		progressBar,
		percentage,
		storageInfo.FormattedUsed,
		storageInfo.FormattedTotal)
}

// extractHardwareDetails extracts detailed hardware information from device
// ExtractHardwareDetails derives hardware details from a full lockdown values
// dump, plus a few extra keys queried over the provided lockdown connection.
func ExtractHardwareDetails(allValues interface{}, lockdownConn *ios.LockDownConnection) *models.HardwareDetails {
	details := &models.HardwareDetails{}

	// Try to convert allValues to a map for easier access
	var valueMap map[string]interface{}
	if jsonBytes, err := json.Marshal(allValues); err == nil {
		json.Unmarshal(jsonBytes, &valueMap)
	} else {
		return details
	}

	// Extract mainboard & chip info
	details.MLBSerialNumber = getStringValue(valueMap["MLBSerialNumber"])
	details.HardwareModel = getStringValue(valueMap["HardwareModel"])
	details.HardwarePlatform = getStringValue(valueMap["HardwarePlatform"])
	details.ChipID = getInt64Value(valueMap["ChipID"])
	details.DieID = getInt64Value(valueMap["DieID"])
	details.BoardID = getIntValue(valueMap["BoardID"])

	// Extract baseband & cellular info
	details.BasebandVersion = getStringValue(valueMap["BasebandVersion"])
	details.BasebandChipID = getInt64Value(valueMap["BasebandChipID"])
	details.BasebandCertID = getInt64Value(valueMap["BasebandCertId"])

	// BasebandSerialNumber is usually base64 encoded
	if bsn := valueMap["BasebandSerialNumber"]; bsn != nil {
		details.BasebandSerialNumber = formatBinaryIdentifier(bsn)
	}

	details.ICCID = getStringValue(valueMap["IntegratedCircuitCardIdentity"])
	details.ICCID2 = getStringValue(valueMap["IntegratedCircuitCardIdentity2"])
	details.IMSI2 = getStringValue(valueMap["InternationalMobileSubscriberIdentity2"])
	details.MEID = getStringValue(valueMap["MobileEquipmentIdentifier"])

	// Extract partition and APFS info
	details.PartitionType = getStringValue(valueMap["PartitionType"])
	details.BootSessionID = getStringValue(valueMap["BootSessionID"])

	// If lockdown connection is available, get additional info
	if lockdownConn != nil {
		// Try to get wireless board serial if not already set
		if wbsn, err := lockdownConn.GetValueForDomain("WirelessBoardSerialNumber", ""); err == nil {
			details.WirelessBoardSerial = getStringValue(wbsn)
		}

		// Try to get APFS container UUID from disk_usage domain
		if apfsInfo, err := lockdownConn.GetValueForDomain("", "com.apple.disk_usage"); err == nil {
			if apfsMap, ok := apfsInfo.(map[string]interface{}); ok {
				// APFS UUID might be in this domain or need to query IORegistry
				if uuid := getStringValue(apfsMap["ContainerUUID"]); uuid != "" {
					details.APFSContainerUUID = uuid
				}
			}
		}

		// Get battery info from battery domain
		if _, err := lockdownConn.GetValueForDomain("", "com.apple.mobile.battery"); err == nil {
			// Battery info is typically in IORegistry, but we can get basic info here
			// More detailed info would need IORegistry access (via diagnostics.GetIORegistryEntry)
		}
	}

	// Try to extract sensor serials and other hardware info from IORegistry-like data
	// These are typically accessed through diagnostics.IORegistry but may be in rawData
	// For now, mark these as requiring IORegistry access
	// In a production system, you'd use diagnostics.GetIORegistryEntry()

	return details
}

// decodeBase64String decodes a base64 encoded value
func decodeBase64String(val interface{}) string {
	if val == nil {
		return ""
	}

	var base64Str string
	if str, ok := val.(string); ok {
		base64Str = str
	} else if data, ok := val.([]byte); ok {
		base64Str = string(data)
	} else {
		return ""
	}

	// Remove whitespace
	base64Str = strings.TrimSpace(base64Str)
	if base64Str == "" {
		return ""
	}

	// Try to decode
	decoded, err := base64.StdEncoding.DecodeString(base64Str)
	if err != nil {
		return base64Str // Return original if decode fails
	}

	// Convert to string, removing null bytes
	result := strings.TrimRight(string(decoded), "\x00")
	return result
}

// formatBinaryIdentifier turns lockdown binary identifiers (often base64-encoded
// opaque bytes, e.g. BasebandSerialNumber) into a stable human-readable form.
// Printable ASCII is kept as text; otherwise uppercase hex is used.
func formatBinaryIdentifier(val interface{}) string {
	if val == nil {
		return ""
	}

	var raw []byte
	switch typed := val.(type) {
	case []byte:
		raw = typed
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return ""
		}
		if decoded, err := base64.StdEncoding.DecodeString(trimmed); err == nil && len(decoded) > 0 {
			raw = decoded
		} else if decoded, err := base64.RawStdEncoding.DecodeString(trimmed); err == nil && len(decoded) > 0 {
			raw = decoded
		} else {
			raw = []byte(trimmed)
		}
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", val))
	}

	raw = bytes.Trim(raw, "\x00")
	if len(raw) == 0 {
		return ""
	}

	printable := true
	for _, b := range raw {
		if b < 0x20 || b > 0x7e {
			printable = false
			break
		}
	}
	if printable {
		return string(raw)
	}

	return strings.ToUpper(hex.EncodeToString(raw))
}

// getInt64Value safely converts interface{} to int64
func getInt64Value(val interface{}) int64 {
	if val == nil {
		return 0
	}
	switch v := val.(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case uint64:
		return int64(v)
	case float64:
		return int64(v)
	case float32:
		return int64(v)
	default:
		return 0
	}
}

// getIntValue safely converts interface{} to int
func getIntValue(val interface{}) int {
	if val == nil {
		return 0
	}
	switch v := val.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case uint64:
		return int(v)
	case float64:
		return int(v)
	case float32:
		return int(v)
	default:
		return 0
	}
}
