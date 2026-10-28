package app

import (
	"encoding/base64"
	"fmt"
	"sort"
	"strings"

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

	// Request group-container attributes explicitly. Disk usage is intentionally
	// omitted here: asking installation_proxy for StaticDiskUsage forces a full
	// on-device disk scan that blocks this request for a long time. Sizes are
	// filled asynchronously by CalculateAppSizesAsync instead.
	apps, err := svc.Browse(installationproxy.Options{
		ShowLaunchProhibitedApps: true,
		ReturnAttributes: []string{
			"CFBundleIdentifier",
			"CFBundleDisplayName",
			"CFBundleName",
			"CFBundleShortVersionString",
			"CFBundleExecutable",
			"CFBundleNumericVersion",
			"ApplicationType",
			"Path",
			"Container",
			"SignerIdentity",
			"MinimumOSVersion",
			"BuildMachineOSBuild",
			"SequenceNumber",
			"GroupContainers",
			"AppGroupContainers",
			"ApplicationGroupContainers",
			"Entitlements",
			"iTunesMetadata",
			"iTunesArtwork",
			"ProfileValidated",
			"ApplicationDSID",
			"ITSDRMScheme",
			"EnvironmentVariables",
		},
	})
	if err != nil {
		// Fallback to full browse if attribute filtering is rejected.
		apps, err = svc.BrowseAllApps()
		if err != nil {
			return nil, fmt.Errorf("failed to browse apps: %w", err)
		}
	}

	result := make([]models.AppInfo, 0, len(apps))
	groupOwners := make(map[string][]string)
	groupPaths := make(map[string]string)

	for _, app := range apps {
		appInfo := models.AppInfo{
			BundleID: app.CFBundleIdentifier(),
			Name:     getBestName(app),
			Version:  getBestVersion(app),
			AuthType: detectAuthType(app),
		}

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
		if appPath, ok := app["Path"].(string); ok {
			appInfo.Path = appPath
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

		appInfo.AppSize = coerceUint64(app["StaticDiskUsage"])
		appInfo.DataSize = coerceUint64(app["DynamicDiskUsage"])
		// Initial browse may omit usage on some iOS builds; mark unmeasured so UI
		// shows "calculating" instead of a misleading 0 B until async fill completes.
		appInfo.SizeMeasured = appInfo.AppSize > 0 || appInfo.DataSize > 0
		appInfo.PurchaserAppleID = extractPurchaserAppleID(app)
		appInfo.StoreVersionID, appInfo.StoreItemID = extractStoreIdentifiers(app)

		// Track App Group containers shared by multiple apps (e.g. LiveContainer).
		for groupID, groupPath := range extractGroupContainers(app) {
			if groupID == "" {
				continue
			}
			groupOwners[groupID] = appendUniqueString(groupOwners[groupID], appInfo.BundleID)
			if pathText := strings.TrimSpace(fmt.Sprintf("%v", groupPath)); pathText != "" {
				if _, exists := groupPaths[groupID]; !exists {
					groupPaths[groupID] = pathText
				}
			}
		}

		rawData := make(map[string]interface{})
		for key, value := range app {
			if key == "iTunesMetadata" || key == "iTunesArtwork" {
				if bytes, ok := value.([]byte); ok {
					// Keep a compact text preview for purchaser extraction debugging.
					if key == "iTunesMetadata" {
						if parsed := parseITunesMetadata(bytes); parsed != nil {
							rawData["iTunesMetadataParsed"] = parsed
						}
					}
					rawData[key] = fmt.Sprintf("<binary data: %d bytes>", len(bytes))
				} else {
					rawData[key] = value
				}
			} else {
				rawData[key] = value
			}
		}
		appInfo.RawData = rawData

		if entitlements, ok := app["Entitlements"].(map[string]interface{}); ok && len(entitlements) > 0 {
			xmlBytes, err := plist.MarshalIndent(entitlements, plist.XMLFormat, "\t")
			if err == nil {
				appInfo.EntitlementsXML = string(xmlBytes)
			}
		}

		result = append(result, appInfo)
	}

	// Build synthetic shared-library rows for multi-app groups.
	sharedGroupIDs := make([]string, 0)
	for groupID, owners := range groupOwners {
		if len(owners) >= 2 {
			sharedGroupIDs = append(sharedGroupIDs, groupID)
		}
	}
	sort.Strings(sharedGroupIDs)

	for _, groupID := range sharedGroupIDs {
		owners := groupOwners[groupID]
		sort.Strings(owners)
		// Size is filled asynchronously; leave 0 so UI can show calculating until measured.
		sharedEntry := models.AppInfo{
			BundleID:          "shared-group:" + groupID,
			Name:              "Shared Library",
			Version:           "-",
			AuthType:          "shared_library",
			IsSharedLibrary:   true,
			SharedGroupID:     groupID,
			SharedByBundleIDs: owners,
			DataSize:          0,
			AppSize:           0,
			SizeMeasured:      false,
			RawData: map[string]interface{}{
				"group_path": groupPaths[groupID],
			},
		}
		result = append(result, sharedEntry)
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

		options := installationproxy.Options{
			ShowLaunchProhibitedApps: true,
			ReturnAttributes: []string{
				"CFBundleIdentifier",
				"StaticDiskUsage",
				"DynamicDiskUsage",
				"GroupContainers",
				"AppGroupContainers",
				"ApplicationGroupContainers",
				"iTunesMetadata",
				"ApplicationDSID",
				"AppleID",
			},
		}

		apps, err := svc.Browse(options)
		if err != nil {
			logger.Error().Err(err).Str("udid", udid).Msg("Failed to browse apps for size calculation")
			return
		}

		appsByBundleID := make(map[string]installationproxy.AppInfo)
		groupOwners := make(map[string][]string)
		groupSizeHints := make(map[string]uint64)
		for _, app := range apps {
			bundleID := app.CFBundleIdentifier()
			if bundleID == "" {
				continue
			}
			appsByBundleID[bundleID] = app
			for groupID, groupPath := range extractGroupContainers(app) {
				if groupID == "" {
					continue
				}
				groupOwners[groupID] = appendUniqueString(groupOwners[groupID], bundleID)
				if size := coerceUint64(groupPath); size > 0 && groupSizeHints[groupID] < size {
					groupSizeHints[groupID] = size
				}
			}
		}

		for _, bundleID := range bundleIDs {
			if strings.HasPrefix(bundleID, "shared-group:") {
				continue
			}
			app, ok := appsByBundleID[bundleID]
			if !ok {
				continue
			}

			appSize := coerceUint64(app["StaticDiskUsage"])
			dataSize := coerceUint64(app["DynamicDiskUsage"])
			logger.Debug().
				Str("udid", udid).
				Str("bundle_id", bundleID).
				Uint64("app_size", appSize).
				Uint64("data_size", dataSize).
				Msg("Size calculation result")

			broadcastFunc(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   fmt.Sprintf("app_size_%s_%s", udid, bundleID),
				TaskType: "app_size_calculation",
				Status:   "completed",
				Progress: 100,
				Message:  "App size calculated",
				Data: map[string]interface{}{
					"udid":               udid,
					"bundle_id":          bundleID,
					"app_size":           appSize,
					"data_size":          dataSize,
					"size_measured":      true,
					"purchaser_apple_id": extractPurchaserAppleID(app),
				},
			})
		}

		// Emit sizes for synthetic shared-library rows created in ListApps.
		for groupID, owners := range groupOwners {
			if len(owners) < 2 {
				continue
			}
			sharedBundleID := "shared-group:" + groupID
			requested := false
			for _, id := range bundleIDs {
				if id == sharedBundleID {
					requested = true
					break
				}
			}
			if !requested {
				continue
			}

			sharedSize := groupSizeHints[groupID]
			broadcastFunc(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   fmt.Sprintf("app_size_%s_%s", udid, sharedBundleID),
				TaskType: "app_size_calculation",
				Status:   "completed",
				Progress: 100,
				Message:  "Shared library size calculated",
				Data: map[string]interface{}{
					"udid":                 udid,
					"bundle_id":            sharedBundleID,
					"app_size":             uint64(0),
					"data_size":            sharedSize,
					"size_measured":        true,
					"is_shared_library":    true,
					"shared_group_id":      groupID,
					"shared_by_bundle_ids": owners,
				},
			})
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

func coerceUint64(value interface{}) uint64 {
	switch typed := value.(type) {
	case uint64:
		return typed
	case uint32:
		return uint64(typed)
	case int64:
		if typed < 0 {
			return 0
		}
		return uint64(typed)
	case int:
		if typed < 0 {
			return 0
		}
		return uint64(typed)
	case float64:
		if typed < 0 {
			return 0
		}
		return uint64(typed)
	case float32:
		if typed < 0 {
			return 0
		}
		return uint64(typed)
	default:
		return 0
	}
}

func appendUniqueString(values []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return values
	}
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func extractGroupContainers(app installationproxy.AppInfo) map[string]interface{} {
	candidates := []string{"GroupContainers", "AppGroupContainers", "ApplicationGroupContainers"}
	for _, key := range candidates {
		if raw, ok := app[key]; ok && raw != nil {
			if asMap, ok := raw.(map[string]interface{}); ok {
				return asMap
			}
		}
	}
	return nil
}

func parseITunesMetadata(raw []byte) map[string]interface{} {
	if len(raw) == 0 {
		return nil
	}
	var parsed map[string]interface{}
	if _, err := plist.Unmarshal(raw, &parsed); err != nil {
		return nil
	}
	return parsed
}

func extractPurchaserAppleID(app installationproxy.AppInfo) string {
	for _, metadata := range iTunesMetadataMaps(app) {
		if email := findPurchaserEmail(metadata); email != "" {
			return email
		}
	}

	// Fallbacks occasionally exposed by installation_proxy.
	if email := findPurchaserEmail(map[string]interface{}(app)); email != "" {
		return email
	}
	return ""
}

// iTunesMetadataMaps returns the parsed iTunesMetadata dictionary of an
// installed app, accepting the byte, decoded and text forms that
// installation_proxy can hand back.
func iTunesMetadataMaps(app installationproxy.AppInfo) []map[string]interface{} {
	raw, ok := app["iTunesMetadata"]
	if !ok || raw == nil {
		return nil
	}

	switch typed := raw.(type) {
	case []byte:
		if parsed := parseITunesMetadata(typed); parsed != nil {
			return []map[string]interface{}{parsed}
		}
	case map[string]interface{}:
		return []map[string]interface{}{typed}
	case string:
		// Sometimes metadata arrives already as XML/text.
		if parsed := parseITunesMetadata([]byte(typed)); parsed != nil {
			return []map[string]interface{}{parsed}
		}
	}

	return nil
}

// extractStoreIdentifiers reads the App Store handles Apple records in an
// installed app's iTunesMetadata. softwareVersionExternalIdentifier names the
// build the store delivered, which is the same identifier a download request can
// be pinned to, and itemId is the catalog id that keeps a delisted app
// addressable after bundle-identifier lookup stops returning it.
func extractStoreIdentifiers(app installationproxy.AppInfo) (string, int64) {
	for _, metadata := range iTunesMetadataMaps(app) {
		versionID := models.NormalizeStoreVersionID(metadata["softwareVersionExternalIdentifier"])
		itemID := int64(coerceUint64(metadata["itemId"]))
		if itemID == 0 {
			itemID = int64(coerceUint64(metadata["itemID"]))
		}

		if versionID != "" || itemID > 0 {
			return versionID, itemID
		}
	}

	return "", 0
}

func firstString(values map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if raw, ok := values[key]; ok {
			if text, ok := raw.(string); ok {
				text = strings.TrimSpace(text)
				if text != "" {
					return text
				}
			}
		}
	}
	return ""
}

func findPurchaserEmail(root map[string]interface{}) string {
	if root == nil {
		return ""
	}
	preferredKeys := []string{
		"appleId", "appleID", "AppleID", "purchaseDateAccount",
		"PurchaseAppleID", "ownerAppleId", "ownerAppleID", "accountName",
	}
	if email := firstString(root, preferredKeys...); email != "" && strings.Contains(email, "@") {
		return email
	}

	var walk func(map[string]interface{}) string
	walk = func(node map[string]interface{}) string {
		for key, raw := range node {
			keyLower := strings.ToLower(key)
			switch typed := raw.(type) {
			case string:
				text := strings.TrimSpace(typed)
				if text == "" || !strings.Contains(text, "@") {
					continue
				}
				if strings.Contains(keyLower, "apple") ||
					strings.Contains(keyLower, "purchase") ||
					strings.Contains(keyLower, "account") ||
					strings.Contains(keyLower, "owner") {
					return text
				}
			case map[string]interface{}:
				if email := walk(typed); email != "" {
					return email
				}
			}
		}
		return ""
	}
	return walk(root)
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
