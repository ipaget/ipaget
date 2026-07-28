package app

import (
	"encoding/base64"
	"fmt"

	"ipaget-service/internal/logger"
	"ipaget-service/internal/models"

	"github.com/danielpaulus/go-ios/ios"
	"github.com/danielpaulus/go-ios/ios/installationproxy"
	"github.com/danielpaulus/go-ios/ios/instruments"
	"github.com/danielpaulus/go-ios/ios/springboard"
	"github.com/danielpaulus/go-ios/ios/zipconduit"
	"howett.net/plist"
)

type Service struct {
}

func NewService() *Service {
	return &Service{}
}

func (s *Service) ListApps(device ios.DeviceEntry, deviceAppleID string) ([]models.AppInfo, error) {
	svc, err := installationproxy.New(device)
	if err != nil {
		return nil, fmt.Errorf("failed to create installation proxy: %w", err)
	}
	defer svc.Close()

	apps, err := svc.BrowseAllApps()
	if err != nil {
		return nil, fmt.Errorf("failed to browse apps: %w", err)
	}

	result := make([]models.AppInfo, 0, len(apps))
	for _, app := range apps {
		appInfo := models.AppInfo{
			BundleID: app.CFBundleIdentifier(),
			Name:     getBestName(app),
			Version:  getBestVersion(app),
			AuthType: detectAuthType(app),
		}

		// Extract additional details
		if buildOS, ok := app["BuildMachineOSBuild"].(string); ok {
			appInfo.BuildMachineOSBuild = buildOS
		}
		if executable, ok := app["CFBundleExecutable"].(string); ok {
			appInfo.CFBundleExecutable = executable
		}
		if signer, ok := app["SignerIdentity"].(string); ok {
			appInfo.SignerIdentity = signer
		}
		if minOS, ok := app["MinimumOSVersion"].(string); ok {
			appInfo.MinimumOSVersion = minOS
		}
		if appType, ok := app["ApplicationType"].(string); ok {
			appInfo.ApplicationType = appType
		}
		if path, ok := app["Path"].(string); ok {
			appInfo.Path = path
		}
		if container, ok := app["Container"].(string); ok {
			appInfo.Container = container
		}
		if numericVersion, ok := app["CFBundleNumericVersion"].(uint64); ok {
			appInfo.CFBundleNumericVersion = numericVersion
		}
		if seqNum, ok := app["SequenceNumber"].(uint64); ok {
			appInfo.SequenceNumber = seqNum
		}

		if size, ok := app["StaticDiskUsage"].(uint64); ok {
			appInfo.AppSize = size
		} else if size, ok := app["StaticDiskUsage"].(float64); ok {
			appInfo.AppSize = uint64(size)
		} else if size, ok := app["StaticDiskUsage"].(int64); ok {
			appInfo.AppSize = uint64(size)
		}

		if size, ok := app["DynamicDiskUsage"].(uint64); ok {
			appInfo.DataSize = size
		} else if size, ok := app["DynamicDiskUsage"].(float64); ok {
			appInfo.DataSize = uint64(size)
		} else if size, ok := app["DynamicDiskUsage"].(int64); ok {
			appInfo.DataSize = uint64(size)
		}

		// Extract raw data (convert to serializable format)
		rawData := make(map[string]interface{})
		for key, value := range app {
			// Skip binary data fields to avoid bloating the response
			if key == "iTunesMetadata" || key == "iTunesArtwork" {
				if bytes, ok := value.([]byte); ok {
					rawData[key] = fmt.Sprintf("<binary data: %d bytes>", len(bytes))
				} else {
					rawData[key] = value
				}
			} else {
				rawData[key] = value
			}
		}
		appInfo.RawData = rawData

		// Extract Entitlements as XML
		if entitlements, ok := app["Entitlements"].(map[string]interface{}); ok && len(entitlements) > 0 {
			xmlBytes, err := plist.MarshalIndent(entitlements, plist.XMLFormat, "\t")
			if err == nil {
				appInfo.EntitlementsXML = string(xmlBytes)
			}
		}

		result = append(result, appInfo)
	}

	return result, nil
}

func (s *Service) GetAppIcons(device ios.DeviceEntry, bundleIDs []string) (map[string]string, error) {
	client, err := springboard.NewClient(device)
	if err != nil {
		return nil, fmt.Errorf("failed to create springboard client: %w", err)
	}
	defer client.Close()

	icons := make(map[string]string)
	for _, bundleID := range bundleIDs {
		pngData, err := client.GetIconPNGData(bundleID)
		if err != nil {
			// Skip apps that don't have icons or fail to retrieve
			continue
		}
		// Encode PNG data as base64
		icons[bundleID] = base64.StdEncoding.EncodeToString(pngData)
	}

	return icons, nil
}

// CalculateAppSizesAsync calculates app sizes asynchronously and broadcasts updates
func (s *Service) CalculateAppSizesAsync(device ios.DeviceEntry, udid string, bundleIDs []string, broadcastFunc func(interface{})) {
	go func() {
		svc, err := installationproxy.New(device)
		if err != nil {
			logger.Error().Err(err).Str("udid", udid).Msg("Failed to create installation proxy for size calculation")
			return
		}
		defer svc.Close()

		// Use Browse with specific attributes to ensure we get disk usage
		options := installationproxy.Options{
			ReturnAttributes: []string{
				"CFBundleIdentifier",
				"StaticDiskUsage",
				"DynamicDiskUsage",
			},
		}

		apps, err := svc.Browse(options)
		if err != nil {
			logger.Error().Err(err).Str("udid", udid).Msg("Failed to browse apps for size calculation")
			return
		}

		// Create a map for quick lookup
		appsByBundleID := make(map[string]installationproxy.AppInfo)
		for _, app := range apps {
			appsByBundleID[app.CFBundleIdentifier()] = app
		}

		// Process each bundle ID
		for _, bundleID := range bundleIDs {
			app, ok := appsByBundleID[bundleID]
			if !ok {
				continue
			}

			var appSize, dataSize uint64
			if size, ok := app["StaticDiskUsage"].(uint64); ok {
				appSize = size
			} else if size, ok := app["StaticDiskUsage"].(float64); ok {
				appSize = uint64(size)
			} else if size, ok := app["StaticDiskUsage"].(int64); ok {
				appSize = uint64(size)
			}

			if size, ok := app["DynamicDiskUsage"].(uint64); ok {
				dataSize = size
			} else if size, ok := app["DynamicDiskUsage"].(float64); ok {
				dataSize = uint64(size)
			} else if size, ok := app["DynamicDiskUsage"].(int64); ok {
				dataSize = uint64(size)
			}

			// Log the sizes found
			logger.Debug().
				Str("udid", udid).
				Str("bundle_id", bundleID).
				Uint64("app_size", appSize).
				Uint64("data_size", dataSize).
				Msg("Size calculation result")

			// Only broadcast if we have size data
			if appSize > 0 || dataSize > 0 {
				broadcastFunc(models.TaskProgress{
					Type:     "task_progress",
					TaskID:   fmt.Sprintf("app_size_%s_%s", udid, bundleID),
					TaskType: "app_size_calculation",
					Status:   "completed",
					Progress: 100,
					Message:  "App size calculated",
					Data: map[string]interface{}{
						"udid":      udid,
						"bundle_id": bundleID,
						"app_size":  appSize,
						"data_size": dataSize,
					},
				})
			}
		}

		logger.Info().Str("udid", udid).Int("apps", len(bundleIDs)).Msg("App size calculation completed")
	}()
}

func (s *Service) InstallApp(device ios.DeviceEntry, ipaPath string, taskID string, bundleID string, broadcastFunc func(interface{})) error {
	udid := device.Properties.SerialNumber

	if broadcastFunc != nil {
		broadcastFunc(models.TaskProgress{
			Type:     "task_progress",
			TaskID:   taskID,
			TaskType: "install",
			Status:   "started",
			Progress: 0,
			Message:  "Starting installation...",
			Data: map[string]interface{}{
				"udid":      udid,
				"bundle_id": bundleID,
				"file_path": ipaPath,
			},
		})
	}

	conn, err := zipconduit.New(device)
	if err != nil {
		if broadcastFunc != nil {
			broadcastFunc(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   taskID,
				TaskType: "install",
				Status:   "error",
				Progress: 0,
				Message:  fmt.Sprintf("Failed to create zipconduit: %v", err),
				Data: map[string]interface{}{
					"udid":      udid,
					"bundle_id": bundleID,
					"file_path": ipaPath,
				},
			})
		}
		return fmt.Errorf("failed to create zipconduit: %w", err)
	}
	defer conn.Close()

	if broadcastFunc != nil {
		broadcastFunc(models.TaskProgress{
			Type:     "task_progress",
			TaskID:   taskID,
			TaskType: "install",
			Status:   "progress",
			Progress: 20,
			Message:  "Preparing IPA file...",
			Data: map[string]interface{}{
				"udid":      udid,
				"bundle_id": bundleID,
				"file_path": ipaPath,
			},
		})
	}

	if broadcastFunc != nil {
		broadcastFunc(models.TaskProgress{
			Type:     "task_progress",
			TaskID:   taskID,
			TaskType: "install",
			Status:   "progress",
			Progress: 40,
			Message:  "Uploading IPA to device...",
			Data: map[string]interface{}{
				"udid":      udid,
				"bundle_id": bundleID,
				"file_path": ipaPath,
			},
		})
	}

	err = conn.SendFile(ipaPath)
	if err != nil {
		if broadcastFunc != nil {
			broadcastFunc(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   taskID,
				TaskType: "install",
				Status:   "error",
				Progress: 0,
				Message:  fmt.Sprintf("Failed to install: %v", err),
				Data: map[string]interface{}{
					"udid":      udid,
					"bundle_id": bundleID,
					"file_path": ipaPath,
				},
			})
		}
		return fmt.Errorf("failed to send file: %w", err)
	}

	if broadcastFunc != nil {
		broadcastFunc(models.TaskProgress{
			Type:     "task_progress",
			TaskID:   taskID,
			TaskType: "install",
			Status:   "progress",
			Progress: 80,
			Message:  "Finalizing installation...",
			Data: map[string]interface{}{
				"udid":      udid,
				"bundle_id": bundleID,
				"file_path": ipaPath,
			},
		})
	}

	if broadcastFunc != nil {
		broadcastFunc(models.TaskProgress{
			Type:     "task_progress",
			TaskID:   taskID,
			TaskType: "install",
			Status:   "completed",
			Progress: 100,
			Message:  "App installed successfully",
			Data: map[string]interface{}{
				"udid":      udid,
				"bundle_id": bundleID,
				"file_path": ipaPath,
			},
		})
	}

	return nil
}

func (s *Service) LaunchApp(device ios.DeviceEntry, bundleID string) error {
	pControl, err := instruments.NewProcessControl(device)
	if err != nil {
		return fmt.Errorf("failed to create process control: %w", err)
	}
	defer pControl.Close()

	_, err = pControl.LaunchApp(bundleID, nil)
	if err != nil {
		return fmt.Errorf("failed to launch app: %w", err)
	}

	return nil
}

func (s *Service) UninstallApp(device ios.DeviceEntry, bundleID string, taskID string, broadcastFunc func(interface{})) error {
	udid := device.Properties.SerialNumber

	if broadcastFunc != nil {
		broadcastFunc(models.TaskProgress{
			Type:     "task_progress",
			TaskID:   taskID,
			TaskType: "uninstall",
			Status:   "started",
			Progress: 0,
			Message:  "Starting uninstall process...",
			Data: map[string]interface{}{
				"udid":      udid,
				"bundle_id": bundleID,
			},
		})
	}

	if broadcastFunc != nil {
		broadcastFunc(models.TaskProgress{
			Type:     "task_progress",
			TaskID:   taskID,
			TaskType: "uninstall",
			Status:   "progress",
			Progress: 30,
			Message:  "Connecting to device...",
			Data: map[string]interface{}{
				"udid":      udid,
				"bundle_id": bundleID,
			},
		})
	}

	svc, err := installationproxy.New(device)
	if err != nil {
		if broadcastFunc != nil {
			broadcastFunc(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   taskID,
				TaskType: "uninstall",
				Status:   "error",
				Progress: 0,
				Message:  fmt.Sprintf("Failed to create installation proxy: %v", err),
				Data: map[string]interface{}{
					"udid":      udid,
					"bundle_id": bundleID,
				},
			})
		}
		return fmt.Errorf("failed to create installation proxy: %w", err)
	}
	defer svc.Close()

	if broadcastFunc != nil {
		broadcastFunc(models.TaskProgress{
			Type:     "task_progress",
			TaskID:   taskID,
			TaskType: "uninstall",
			Status:   "progress",
			Progress: 60,
			Message:  "Removing application...",
			Data: map[string]interface{}{
				"udid":      udid,
				"bundle_id": bundleID,
			},
		})
	}

	err = svc.Uninstall(bundleID)
	if err != nil {
		if broadcastFunc != nil {
			broadcastFunc(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   taskID,
				TaskType: "uninstall",
				Status:   "error",
				Progress: 0,
				Message:  fmt.Sprintf("Failed to uninstall: %v", err),
				Data: map[string]interface{}{
					"udid":      udid,
					"bundle_id": bundleID,
				},
			})
		}
		return fmt.Errorf("failed to uninstall app: %w", err)
	}

	if broadcastFunc != nil {
		broadcastFunc(models.TaskProgress{
			Type:     "task_progress",
			TaskID:   taskID,
			TaskType: "uninstall",
			Status:   "completed",
			Progress: 100,
			Message:  "App uninstalled successfully",
			Data: map[string]interface{}{
				"udid":      udid,
				"bundle_id": bundleID,
			},
		})
	}

	return nil
}

func (s *Service) KillApp(device ios.DeviceEntry, bundleID string) error {
	// First get the process name
	svc, err := installationproxy.New(device)
	if err != nil {
		return fmt.Errorf("failed to create installation proxy: %w", err)
	}
	defer svc.Close()

	apps, err := svc.BrowseAllApps()
	if err != nil {
		return fmt.Errorf("failed to browse apps: %w", err)
	}

	var processName string
	for _, app := range apps {
		if app.CFBundleIdentifier() == bundleID {
			processName = app.CFBundleExecutable()
			break
		}
	}

	if processName == "" {
		return fmt.Errorf("app not found: %s", bundleID)
	}

	// Get process list and find PID
	deviceInfoService, err := instruments.NewDeviceInfoService(device)
	if err != nil {
		return fmt.Errorf("failed to create device info service: %w", err)
	}
	defer deviceInfoService.Close()

	processList, err := deviceInfoService.ProcessList()
	if err != nil {
		return fmt.Errorf("failed to get process list: %w", err)
	}

	// Find and kill the process
	pControl, err := instruments.NewProcessControl(device)
	if err != nil {
		return fmt.Errorf("failed to create process control: %w", err)
	}
	defer pControl.Close()

	for _, p := range processList {
		if p.Name == processName {
			err = pControl.KillProcess(p.Pid)
			if err != nil {
				return fmt.Errorf("failed to kill process: %w", err)
			}
			return nil
		}
	}

	return fmt.Errorf("app is not running: %s", bundleID)
}

func getBestName(app installationproxy.AppInfo) string {
	bundleID := app.CFBundleIdentifier()

	// Try to get localized name from CFBundleLocalizations
	localizedName := extractLocalizedNameFromApp(app)
	if localizedName != "" {
		return localizedName
	}

	// Priority: CFBundleDisplayName > CFBundleName > BundleID
	if displayName, ok := app["CFBundleDisplayName"].(string); ok && displayName != "" {
		return displayName
	}
	if name := app.CFBundleName(); name != "" {
		return name
	}

	// No name found, use BundleID as fallback
	logger.Debug().Str("bundle_id", bundleID).Msg("App has no display name, using BundleID")
	return bundleID
}

func getBestVersion(app installationproxy.AppInfo) string {
	if version := app.CFBundleShortVersionString(); version != "" {
		return version
	}
	return ""
}

func detectAuthType(app installationproxy.AppInfo) string {
	bundleID := app.CFBundleIdentifier()

	signerIdentity, hasSignerIdentity := app["SignerIdentity"].(string)
	appType, hasAppType := app["ApplicationType"].(string)
	_, hasITunesMetadata := app["iTunesMetadata"]
	_, hasITunesArtwork := app["iTunesArtwork"]
	profileValidated, hasProfileValidated := app["ProfileValidated"].(bool)
	_, hasApplicationDSID := app["ApplicationDSID"]
	_, hasITSDRMScheme := app["ITSDRMScheme"]

	// Check for iTunes metadata (App Store apps)
	if hasITunesMetadata {
		logger.Debug().
			Str("bundle_id", bundleID).
			Bool("has_itunes_metadata", true).
			Msg("Detected app as apple_store: has iTunes metadata")
		return "apple_store"
	}

	// Check for SignerIdentity
	if hasSignerIdentity && signerIdentity != "" {
		// Check if it's an Apple Development or Distribution certificate
		if contains(signerIdentity, "Apple Development") || contains(signerIdentity, "iPhone Developer") {
			logger.Debug().
				Str("bundle_id", bundleID).
				Str("signer_identity", signerIdentity).
				Bool("profile_validated", profileValidated).
				Msg("Detected app as development: signed with development certificate")
			return "development"
		}
		if contains(signerIdentity, "Apple Distribution") || contains(signerIdentity, "iPhone Distribution") {
			logger.Debug().
				Str("bundle_id", bundleID).
				Str("signer_identity", signerIdentity).
				Msg("Detected app as unknown: signed with distribution certificate")
			return "unknown"
		}
	}

	// Check for profile type
	if hasProfileValidated && profileValidated {
		logger.Debug().
			Str("bundle_id", bundleID).
			Bool("profile_validated", true).
			Str("signer_identity", signerIdentity).
			Msg("Detected app as development: has valid provisioning profile")
		return "development"
	}

	// Check if it's from another account (has store metadata but different account)
	if hasITunesArtwork {
		logger.Debug().
			Str("bundle_id", bundleID).
			Bool("has_itunes_artwork", true).
			Bool("has_itunes_metadata", false).
			Msg("Detected app as shared: has iTunes artwork but no metadata")
		return "shared"
	}

	// Additional checks for App Store apps
	// If has ApplicationDSID but no ITSDRMScheme and signed by Apple, it's likely shared from another account
	if hasApplicationDSID && !hasITSDRMScheme && hasSignerIdentity &&
		contains(signerIdentity, "Apple iPhone OS Application Signing") {
		logger.Debug().
			Str("bundle_id", bundleID).
			Bool("has_application_dsid", true).
			Bool("has_its_drm_scheme", false).
			Str("signer_identity", signerIdentity).
			Msg("Detected app as shared: has ApplicationDSID but no DRM scheme")
		return "shared"
	}

	// If has both ApplicationDSID and ITSDRMScheme, it's apple_store
	if hasApplicationDSID && hasITSDRMScheme {
		logger.Debug().
			Str("bundle_id", bundleID).
			Bool("has_application_dsid", true).
			Bool("has_its_drm_scheme", true).
			Msg("Detected app as apple_store: has both ApplicationDSID and DRM scheme")
		return "apple_store"
	}

	// Check for system apps (BEFORE jailbreak detection)
	// System apps have System/Hidden type
	if hasAppType && (appType == "System" || appType == "Hidden") {
		logger.Debug().
			Str("bundle_id", bundleID).
			Str("application_type", appType).
			Str("signer_identity", signerIdentity).
			Msg("Detected app as system: System/Hidden type")
		return "system"
	}

	// Check for jailbreak/TrollStore apps
	// These apps have no App Store metadata, and either:
	// 1. No SignerIdentity at all
	// 2. Have a custom signer that's not Apple Development/Distribution
	// 3. Have "Decrypted" or similar markers
	hasNoStoreMetadata := !hasApplicationDSID && !hasITunesMetadata && !hasITunesArtwork
	hasDecryptedMarker := app["DecryptedBy"] != nil

	// Check if it has a non-standard signer (not Apple Dev/Dist, not Apple Store signing)
	hasNonStandardSigner := false
	if hasSignerIdentity && signerIdentity != "" {
		isAppleDev := contains(signerIdentity, "Apple Development") || contains(signerIdentity, "iPhone Developer")
		isAppleDist := contains(signerIdentity, "Apple Distribution") || contains(signerIdentity, "iPhone Distribution")
		isAppleStoreSigning := contains(signerIdentity, "Apple iPhone OS Application Signing")
		hasNonStandardSigner = !isAppleDev && !isAppleDist && !isAppleStoreSigning
	}

	if hasNoStoreMetadata && (hasDecryptedMarker || hasNonStandardSigner || !hasSignerIdentity) {
		reason := ""
		if hasDecryptedMarker {
			reason = "has decrypted marker"
		} else if hasNonStandardSigner {
			reason = "non-standard signer"
		} else {
			reason = "no signer identity"
		}
		logger.Debug().
			Str("bundle_id", bundleID).
			Bool("has_application_dsid", false).
			Bool("has_itunes_metadata", false).
			Bool("has_itunes_artwork", false).
			Bool("has_decrypted_marker", hasDecryptedMarker).
			Bool("has_non_standard_signer", hasNonStandardSigner).
			Bool("has_signer_identity", hasSignerIdentity).
			Str("signer_identity", signerIdentity).
			Msgf("Detected app as jailbreak: no store metadata and %s", reason)
		return "jailbreak"
	}

	logger.Debug().
		Str("bundle_id", bundleID).
		Bool("has_signer_identity", hasSignerIdentity).
		Str("signer_identity", signerIdentity).
		Str("application_type", appType).
		Bool("has_itunes_metadata", hasITunesMetadata).
		Bool("has_itunes_artwork", hasITunesArtwork).
		Bool("has_application_dsid", hasApplicationDSID).
		Bool("has_its_drm_scheme", hasITSDRMScheme).
		Msg("Detected app as unknown: no matching criteria")
	return "unknown"
}

func contains(s, substr string) bool {
	return len(s) > 0 && len(substr) > 0 && (s == substr || len(s) >= len(substr) && s[:len(substr)] == substr || len(s) > len(substr) && s[len(s)-len(substr):] == substr || (len(s) > len(substr) && findInString(s, substr)))
}

func findInString(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// extractLocalizedNameFromApp tries to extract localized app name from installed app metadata
// Note: This is best-effort since we don't have direct access to InfoPlist.strings files for installed apps
func extractLocalizedNameFromApp(app installationproxy.AppInfo) string {
	// Check if there's a CFBundleDisplayName dict with localized values
	if displayNameObj, ok := app["CFBundleDisplayName"]; ok {
		// If it's already a string, return it
		if displayName, ok := displayNameObj.(string); ok && displayName != "" {
			return displayName
		}
		// If it's a dict with localized values (rare but possible)
		if displayNameDict, ok := displayNameObj.(map[string]interface{}); ok {
			// Try Chinese first
			for _, lang := range []string{"zh-Hans", "zh-Hant", "zh_CN", "zh_TW", "zh", "en"} {
				if name, ok := displayNameDict[lang].(string); ok && name != "" {
					return name
				}
			}
			// Return any available localization
			for _, v := range displayNameDict {
				if name, ok := v.(string); ok && name != "" {
					return name
				}
			}
		}
	}

	// Similar check for CFBundleName
	if bundleNameObj, ok := app["CFBundleName"]; ok {
		if bundleName, ok := bundleNameObj.(string); ok && bundleName != "" {
			return bundleName
		}
		if bundleNameDict, ok := bundleNameObj.(map[string]interface{}); ok {
			for _, lang := range []string{"zh-Hans", "zh-Hant", "zh_CN", "zh_TW", "zh", "en"} {
				if name, ok := bundleNameDict[lang].(string); ok && name != "" {
					return name
				}
			}
			for _, v := range bundleNameDict {
				if name, ok := v.(string); ok && name != "" {
					return name
				}
			}
		}
	}

	return ""
}
