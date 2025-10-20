package device

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"sync"

	"ipaget-service/internal/logger"
	"ipaget-service/internal/models"

	"github.com/danielpaulus/go-ios/ios"
	"github.com/danielpaulus/go-ios/ios/diagnostics"
)

type Service struct {
	mu        sync.RWMutex
	devices   map[string]*ios.DeviceEntry
	listeners []chan models.DeviceEvent
}

func NewService() *Service {
	return &Service{
		devices:   make(map[string]*ios.DeviceEntry),
		listeners: make([]chan models.DeviceEvent, 0),
	}
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
			go s.refreshDeviceCache()
		} else if event.MessageType == "Detached" {
			// Find device by DeviceID and get its UDID
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
			} else {
				logger.Warn().Int("device_id", event.DeviceID).Msg("Could not find device UDID for detached device")
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

func (s *Service) refreshDeviceCache() {
	list, err := ios.ListDevices()
	if err != nil {
		logger.Error().Err(err).Msg("Failed to list devices for cache refresh")
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range list.DeviceList {
		device := &list.DeviceList[i]
		s.devices[device.Properties.SerialNumber] = device
	}

	logger.Debug().Int("devices", len(s.devices)).Msg("Device cache refreshed")
}

func (s *Service) ListAllConnectedDeviceUDIDs() []string {
	s.refreshDeviceCache()

	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]string, 0, len(s.devices))
	for serialNumber := range s.devices {
		result = append(result, serialNumber)
	}

	return result
}

func (s *Service) ListDevices() ([]models.DeviceInfo, error) {
	s.refreshDeviceCache()

	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]models.DeviceInfo, 0, len(s.devices))
	for _, device := range s.devices {
		// Get device info
		allValues, err := ios.GetValues(*device)
		if err != nil {
			// Skip devices that can't provide info (unpaired, locked, etc.)
			logger.Debug().Err(err).Str("udid", device.Properties.SerialNumber).Msg("Failed to get device values, skipping")
			continue
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

		// Extract hardware model (e.g., A2634)
		hardwareModel := getStringValue(allValues.Value.HardwareModel)

		// Extract additional info with safe type assertions
		color := getStringValue(allValues.Value.DeviceColor)
		enclosureColor := getStringValue(allValues.Value.DeviceEnclosureColor)
		buildVersion := getStringValue(allValues.Value.BuildVersion)
		firmwareVersion := getStringValue(allValues.Value.FirmwareVersion)
		regionInfo := getStringValue(allValues.Value.RegionInfo)
		modelNumber := getStringValue(allValues.Value.ModelNumber)
		timeZone := getStringValue(allValues.Value.TimeZone)

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
		lockdownConn, err := ios.ConnectLockdownWithSession(*device)
		if err == nil {
			// Try to get PhoneNumber
			if val, err := lockdownConn.GetValueForDomain("PhoneNumber", ""); err == nil {
				phoneNumber = getStringValue(val)
			}
			// Try to get HumanReadableProductVersionString (prefer this over ProductVersion)
			if val, err := lockdownConn.GetValueForDomain("HumanReadableProductVersionString", ""); err == nil {
				humanReadableVersion = getStringValue(val)
			}
			// Try to get iCloud settings from various domains
			if icloudVal, err := lockdownConn.GetValueForDomain("", "com.apple.mobile.backup"); err == nil && icloudVal != nil {
				if backupMap, ok := icloudVal.(map[string]interface{}); ok {
					if enabled, ok := backupMap["WillEncrypt"].(bool); ok && enabled {
						icloudEnabled = true
					}
				}
			}
			lockdownConn.Close()
		}

		// Use HumanReadableProductVersionString if available
		if humanReadableVersion != "" {
			version = humanReadableVersion
		}

		// Get storage information
		var storageInfo *models.StorageInfo
		if diskUsage, err := lockdownConn.GetValueForDomain("", "com.apple.disk_usage"); err == nil {
			diskUsageFactory, _ := lockdownConn.GetValueForDomain("", "com.apple.disk_usage.factory")
			storageInfo = parseStorageInfo(diskUsage, diskUsageFactory)
		}

		// Convert allValues to map for raw data
		rawData := make(map[string]interface{})
		if jsonBytes, err := json.Marshal(allValues.Value); err == nil {
			json.Unmarshal(jsonBytes, &rawData)
		}

		deviceInfo := models.DeviceInfo{
			UDID:             udid,
			Name:             name,
			Model:            model,
			Version:          version,
			Color:            color,
			EnclosureColor:   enclosureColor,
			ProductType:      productType,
			ProductName:      hardwareModel,
			BuildVersion:     buildVersion,
			FirmwareVersion:  firmwareVersion,
			SerialNumber:     serialNumber,
			IMEI:             imei,
			PhoneNumber:      phoneNumber,
			ECID:             ecid,
			RegionInfo:       regionInfo,
			ModelNumber:      modelNumber,
			SalesModel:       salesModel,
			TimeZone:         timeZone,
			ActivationState:  activationState,
			IsPaired:         true,
			CPUArchitecture:  cpuArch,
			WiFiAddress:      wifiAddr,
			BluetoothAddress: btAddr,
			ICloudEnabled:    icloudEnabled,
			StorageInfo:      storageInfo,
			RawData:          rawData,
			// Note: Battery info, jailbreak detection, and warranty info
			// require additional API calls or cannot be reliably detected
			IsJailbroken:      false, // Placeholder
			BatteryLevel:      0,     // Requires battery diagnostics
			BatteryHealth:     0,     // Requires battery diagnostics
			BatteryCycleCount: 0,     // Requires battery diagnostics
		}

		result = append(result, deviceInfo)
	}

	logger.Info().Int("total_devices", len(result)).Msg("Device list completed")
	return result, nil
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

	if diskUsageMap, ok := diskUsage.(map[string]interface{}); ok {
		info.TotalDiskCapacity = getUint64Value(diskUsageMap["TotalDiskCapacity"])
		info.TotalDataCapacity = getUint64Value(diskUsageMap["TotalDataCapacity"])
		info.TotalSystemCapacity = getUint64Value(diskUsageMap["TotalSystemCapacity"])
		info.TotalDataAvailable = getUint64Value(diskUsageMap["TotalDataAvailable"])
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

	if info.TotalDataCapacity > 0 {
		info.UsedSpace = info.TotalDataCapacity - info.TotalDataAvailable
		info.UsedPercentage = float64(info.UsedSpace) / float64(info.TotalDataCapacity) * 100
		info.AvailablePercentage = float64(info.TotalDataAvailable) / float64(info.TotalDataCapacity) * 100
	}

	info.FormattedTotal = formatBytes(info.TotalDiskCapacity)
	info.FormattedUsed = formatBytes(info.UsedSpace)
	info.FormattedAvailable = formatBytes(info.TotalDataAvailable)

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
