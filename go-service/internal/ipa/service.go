package ipa

import (
	"archive/zip"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"ipaget-service/internal/cgbipng"
	"ipaget-service/internal/logger"
	"ipaget-service/internal/models"
	"ipaget-service/internal/sign"

	"howett.net/plist"
)

type Service struct {
}

func normalizeZipPath(path string) string {
	return strings.ReplaceAll(path, "\\", "/")
}

func zipPathHasPrefix(path string, prefix string) bool {
	return strings.HasPrefix(normalizeZipPath(path), normalizeZipPath(prefix))
}

func zipPathHasSuffix(path string, suffix string) bool {
	return strings.HasSuffix(normalizeZipPath(path), suffix)
}

func zipPathContains(path string, fragment string) bool {
	return strings.Contains(normalizeZipPath(path), fragment)
}

func zipPathRel(path string, base string) string {
	return strings.TrimPrefix(normalizeZipPath(path), normalizeZipPath(base))
}

func zipPathsEqual(left string, right string) bool {
	return normalizeZipPath(left) == normalizeZipPath(right)
}

func extractAppDirFromZipPath(path string) string {
	normalizedPath := normalizeZipPath(path)
	parts := strings.Split(normalizedPath, "/")
	for i, part := range parts {
		if strings.HasSuffix(part, ".app") {
			return strings.Join(parts[:i+1], "/") + "/"
		}
	}

	return ""
}

func NewService() *Service {
	return &Service{}
}

func (s *Service) ParseIPA(ipaPath string) (*models.IPAInfo, error) {
	logger.Debug().Str("ipa_path", ipaPath).Msg("Parsing IPA file")

	var fileSize int64
	if info, statErr := os.Stat(ipaPath); statErr == nil {
		fileSize = info.Size()
	}

	zipReader, err := zip.OpenReader(ipaPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open IPA file as ZIP: %w", err)
	}
	defer zipReader.Close()

	var infoPlistFile *zip.File
	var iconFiles []*zip.File
	var provisionFile *zip.File
	var itunesMetadataFile *zip.File
	var appDir string

	for _, file := range zipReader.File {
		normalizedName := normalizeZipPath(file.Name)

		if strings.Contains(normalizedName, ".app/Info.plist") && !strings.Contains(normalizedName, "/Watch/") {
			infoPlistFile = file
			appDir = extractAppDirFromZipPath(file.Name)
			logger.Debug().Str("info_plist", normalizedName).Str("app_dir", appDir).Msg("Found Info.plist")
		}
		if strings.Contains(normalizedName, ".app/embedded.mobileprovision") {
			provisionFile = file
			logger.Debug().Str("provision_file", normalizedName).Msg("Found embedded.mobileprovision")
		}
		if strings.HasSuffix(normalizedName, "iTunesMetadata.plist") {
			itunesMetadataFile = file
			logger.Debug().Str("file", normalizedName).Msg("Found iTunesMetadata.plist")
		}
	}

	if infoPlistFile == nil {
		return nil, fmt.Errorf("Info.plist not found in IPA file")
	}

	rc, err := infoPlistFile.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open Info.plist: %w", err)
	}
	defer rc.Close()

	plistData, err := io.ReadAll(rc)
	if err != nil {
		return nil, fmt.Errorf("failed to read Info.plist: %w", err)
	}

	var plistDict map[string]interface{}
	_, err = plist.Unmarshal(plistData, &plistDict)
	if err != nil {
		return nil, fmt.Errorf("failed to parse Info.plist: %w", err)
	}

	ipaInfo := &models.IPAInfo{
		FilePath: ipaPath,
		FileSize: fileSize,
	}

	if bundleID, ok := plistDict["CFBundleIdentifier"].(string); ok {
		ipaInfo.BundleID = bundleID
	}

	if displayName, ok := plistDict["CFBundleDisplayName"].(string); ok && displayName != "" {
		ipaInfo.Name = displayName
	} else if bundleName, ok := plistDict["CFBundleName"].(string); ok && bundleName != "" {
		ipaInfo.Name = bundleName
	} else {
		ipaInfo.Name = ipaInfo.BundleID
	}

	if version, ok := plistDict["CFBundleShortVersionString"].(string); ok {
		ipaInfo.Version = version
	} else if version, ok := plistDict["CFBundleVersion"].(string); ok {
		ipaInfo.Version = version
	}

	if minOSVersion, ok := plistDict["MinimumOSVersion"].(string); ok {
		ipaInfo.MinimumOSVersion = minOSVersion
	}

	// Find icon files based on Info.plist or fallbacks
	iconPatterns := getIconPatterns(plistDict)
	if len(iconPatterns) == 0 {
		iconPatterns = []string{"AppIcon", "Icon"}
	}

	for _, file := range zipReader.File {
		// Check if file is in app directory and is a PNG
		normalizedName := normalizeZipPath(file.Name)
		if strings.HasPrefix(normalizedName, appDir) && strings.HasSuffix(strings.ToLower(normalizedName), ".png") {
			relName := strings.TrimPrefix(normalizedName, appDir)
			// Check if matches any pattern
			for _, pattern := range iconPatterns {
				if strings.HasPrefix(relName, pattern) {
					iconFiles = append(iconFiles, file)
					logger.Debug().Str("icon_file", normalizedName).Str("pattern", pattern).Uint64("size", file.UncompressedSize64).Msg("Found icon file")
					break
				}
			}
		}
	}

	// Parse iTunesMetadata.plist if exists
	if itunesMetadataFile != nil {
		rc, err := itunesMetadataFile.Open()
		if err == nil {
			data, err := io.ReadAll(rc)
			rc.Close()
			if err == nil {
				var metadata map[string]interface{}
				if _, err := plist.Unmarshal(data, &metadata); err == nil {
					if appleID, ok := metadata["appleId"].(string); ok {
						ipaInfo.PurchaserEmail = appleID
					} else if userName, ok := metadata["userName"].(string); ok {
						ipaInfo.PurchaserEmail = userName
					}
				}
			}
		}
	}

	// Extract Mach-O info (Encryption, Signature)
	if execName, ok := plistDict["CFBundleExecutable"].(string); ok {
		execPath := appDir + execName

		var execFile *zip.File
		for _, file := range zipReader.File {
			if zipPathsEqual(file.Name, execPath) {
				execFile = file
				break
			}
		}

		if execFile != nil {
			// Extract to temp file to parse Mach-O
			tmpFile, err := os.CreateTemp("", "macho-*")
			if err == nil {
				// We need to close and remove the temp file when done
				// But we can't defer remove here because we are in a loop/function scope that might be long
				// So we handle it explicitly

				rc, err := execFile.Open()
				if err == nil {
					_, err = io.Copy(tmpFile, rc)
					rc.Close()
					tmpFile.Close()

					if err == nil {
						machoInfo, err := sign.GetMachOInfo(tmpFile.Name())
						if err == nil {
							ipaInfo.IsEncrypted = machoInfo.IsEncrypted
							ipaInfo.CryptID = machoInfo.CryptID
							ipaInfo.SignerIdentity = machoInfo.Authority
							ipaInfo.TeamID = machoInfo.TeamID
							ipaInfo.Organization = machoInfo.Organization

							logger.Debug().
								Bool("encrypted", ipaInfo.IsEncrypted).
								Uint32("crypt_id", ipaInfo.CryptID).
								Str("signer", ipaInfo.SignerIdentity).
								Msg("Mach-O info extracted")
						} else {
							logger.Warn().Err(err).Msg("Failed to get Mach-O info")
						}
					}
				}
				os.Remove(tmpFile.Name())
			}
		}
	}

	if len(iconFiles) > 0 {
		largestIconFile := iconFiles[0]
		largestSize := uint64(0)

		for _, iconFile := range iconFiles {
			if iconFile.UncompressedSize64 > largestSize {
				largestSize = iconFile.UncompressedSize64
				largestIconFile = iconFile
			}
		}

		logger.Debug().
			Str("selected_icon", normalizeZipPath(largestIconFile.Name)).
			Uint64("size", largestIconFile.UncompressedSize64).
			Int("total_icons", len(iconFiles)).
			Msg("Selected largest icon file")

		iconRC, err := largestIconFile.Open()
		if err != nil {
			logger.Warn().Err(err).Str("icon_file", normalizeZipPath(largestIconFile.Name)).Msg("Failed to open icon file")
		} else {
			iconData, err := io.ReadAll(iconRC)
			iconRC.Close()
			if err != nil {
				logger.Warn().Err(err).Msg("Failed to read icon data")
			} else {
				isCgBI := false
				if len(iconData) > 12 && string(iconData[12:16]) == "CgBI" {
					isCgBI = true
					logger.Debug().Msg("Detected CgBI PNG, converting to standard PNG")

					convertedData, err := cgbipng.ConvertToStandardPNG(iconData)
					if err != nil {
						logger.Warn().Err(err).Msg("Failed to convert CgBI PNG, using original")
					} else {
						iconData = convertedData
						logger.Debug().
							Int("original_size", len(iconData)).
							Int("converted_size", len(convertedData)).
							Msg("CgBI PNG converted successfully")
					}
				}

				ipaInfo.IconBase64 = base64.StdEncoding.EncodeToString(iconData)
				logger.Debug().
					Int("icon_size_bytes", len(iconData)).
					Int("base64_length", len(ipaInfo.IconBase64)).
					Bool("was_cgbi", isCgBI).
					Msg("Icon extracted and encoded successfully")
			}
		}
	} else {
		logger.Warn().Str("bundle_id", ipaInfo.BundleID).Msg("No icon files found in IPA")
	}

	if provisionFile != nil {
		provisionRC, err := provisionFile.Open()
		if err != nil {
			logger.Warn().Err(err).Msg("Failed to open provision file")
		} else {
			provisionData, err := io.ReadAll(provisionRC)
			provisionRC.Close()
			if err != nil {
				logger.Warn().Err(err).Msg("Failed to read provision data")
			} else {
				profile, err := sign.ParseProvisioningProfileFromData(provisionData)
				if err != nil {
					logger.Warn().Err(err).Msg("Failed to parse provisioning profile")
					// Fallback logic if profile parsing fails
					if ipaInfo.PurchaserEmail != "" {
						ipaInfo.CertificateStatus = "App Store"
					} else if ipaInfo.SignerIdentity != "" {
						ipaInfo.CertificateStatus = "Unknown"
					} else {
						ipaInfo.CertificateStatus = "Unsigned"
					}
				} else {
					ipaInfo.HasProvisionProfile = true
					ipaInfo.ProvisionName = profile.Name
					ipaInfo.ProvisionTeamID = profile.TeamID
					ipaInfo.ProvisionAppID = profile.AppID
					ipaInfo.CertificateExpiry = profile.Expires.Format("2006-01-02")

					if len(profile.DeveloperCertificates) > 0 {
						ipaInfo.CertificateName = profile.Name
					} else {
						ipaInfo.CertificateName = "Unknown Certificate"
					}

					// Determine Signer Name from SignerIdentity if available
					if ipaInfo.SignerIdentity != "" {
						// Format: "iPhone Distribution: Company Name (TeamID)"
						parts := strings.Split(ipaInfo.SignerIdentity, ":")
						if len(parts) > 1 {
							namePart := strings.TrimSpace(parts[1])
							// Remove TeamID in parenthesis if present
							if idx := strings.LastIndex(namePart, "("); idx > 0 {
								ipaInfo.SignerName = strings.TrimSpace(namePart[:idx])
							} else {
								ipaInfo.SignerName = namePart
							}
						} else {
							ipaInfo.SignerName = ipaInfo.SignerIdentity
						}
					}

					// Determine Certificate Status
					if ipaInfo.PurchaserEmail != "" {
						ipaInfo.CertificateStatus = "App Store"
					} else if profile.ProvisionsAllDevices {
						ipaInfo.CertificateStatus = "Enterprise"
					} else {
						// Check get-task-allow
						getTaskAllow := false
						if val, ok := profile.Entitlements["get-task-allow"].(bool); ok {
							getTaskAllow = val
						}

						if getTaskAllow {
							ipaInfo.CertificateStatus = "Developer"
						} else {
							if len(profile.ProvisionedDevices) > 0 {
								ipaInfo.CertificateStatus = "Ad-Hoc"
							} else {
								// Fallback
								ipaInfo.CertificateStatus = "Enterprise"
							}
						}
					}

					logger.Debug().
						Str("provision_name", profile.Name).
						Str("team_id", profile.TeamID).
						Str("app_id", profile.AppID).
						Str("expires", profile.Expires.Format("2006-01-02")).
						Str("status", ipaInfo.CertificateStatus).
						Msg("Provisioning profile parsed successfully")
				}
			}
		}
	} else {
		logger.Debug().Str("bundle_id", ipaInfo.BundleID).Msg("No provisioning profile found in IPA")
		ipaInfo.HasProvisionProfile = false

		if ipaInfo.PurchaserEmail != "" {
			ipaInfo.CertificateStatus = "App Store"
		} else if ipaInfo.SignerIdentity != "" {
			ipaInfo.CertificateStatus = "Unknown"
		} else {
			ipaInfo.CertificateStatus = "Unsigned"
		}
	}

	logger.Info().
		Str("bundle_id", ipaInfo.BundleID).
		Str("name", ipaInfo.Name).
		Str("version", ipaInfo.Version).
		Bool("has_provision", ipaInfo.HasProvisionProfile).
		Msg("IPA file parsed successfully")

	return ipaInfo, nil
}

func (s *Service) GetIPADetails(ipaPath string, progressCallback func(progress float64, message string)) (*models.IPADetails, error) {
	// Intentionally avoid duplicating the API-level debug log for "Getting IPA details"

	zipReader, err := zip.OpenReader(ipaPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open IPA file as ZIP: %w", err)
	}
	defer zipReader.Close()

	var extractedFiles []*models.FileItem
	var frameworks []*models.FrameworkItem
	var plugins []*models.PluginItem
	var infoPlistFile *zip.File
	var appDir string

	for _, file := range zipReader.File {
		normalizedName := normalizeZipPath(file.Name)
		fileItem := &models.FileItem{
			Path:        normalizedName,
			Size:        int64(file.UncompressedSize64),
			IsDirectory: file.FileInfo().IsDir(),
		}
		extractedFiles = append(extractedFiles, fileItem)

		if strings.Contains(normalizedName, "Payload/") && strings.HasSuffix(normalizedName, ".app/") {
			appDir = extractAppDirFromZipPath(file.Name)
		}

		if appDir != "" && strings.HasPrefix(normalizedName, appDir) {
			relPath := strings.TrimPrefix(normalizedName, appDir)

			if strings.Contains(relPath, "Frameworks/") && strings.HasSuffix(normalizedName, ".framework/") {
				name := filepath.Base(strings.TrimSuffix(normalizedName, "/"))
				frameworks = append(frameworks, &models.FrameworkItem{
					Name:    name,
					Path:    relPath,
					Enabled: true,
				})
			}

			if strings.Contains(relPath, "PlugIns/") && (strings.HasSuffix(normalizedName, ".appex/") || strings.HasSuffix(normalizedName, ".bundle/")) {
				name := filepath.Base(strings.TrimSuffix(normalizedName, "/"))
				isAppex := strings.HasSuffix(normalizedName, ".appex/")
				plugins = append(plugins, &models.PluginItem{
					Name:      name,
					Path:      relPath,
					BundleID:  "",
					IsAppex:   isAppex,
					TargetDir: "PlugIns",
					Enabled:   true,
				})
			}
		}

		if strings.Contains(normalizedName, ".app/Info.plist") && !strings.Contains(normalizedName, "/Watch/") {
			infoPlistFile = file
		}
	}

	// Extract dylibs from Mach-O executable
	dylibs, err := ExtractDylibsFromIPA(ipaPath)
	if err != nil {
		logger.Warn().Err(err).Msg("Failed to extract dylibs from IPA, continuing without them")
		dylibs = []*models.DylibItem{} // Empty list if extraction fails
	}

	var entitlementsXML string
	entitlements, err := sign.ExtractEntitlementsFromIPA(ipaPath)
	if err != nil {
		logger.Warn().Err(err).Msg("Failed to extract entitlements from IPA, will continue without them")
	} else {
		xmlBytes, err := plist.MarshalIndent(entitlements, plist.XMLFormat, "\t")
		if err == nil {
			entitlementsXML = string(xmlBytes)
		} else {
			logger.Warn().Err(err).Msg("Failed to marshal entitlements to XML")
		}
	}

	properties := make(map[string]interface{})
	if infoPlistFile != nil {
		rc, err := infoPlistFile.Open()
		if err == nil {
			defer rc.Close()
			plistData, err := io.ReadAll(rc)
			if err == nil {
				var plistDict map[string]interface{}
				_, err = plist.Unmarshal(plistData, &plistDict)
				if err == nil {
					properties = plistDict
				}
			}
		}
	}

	details := &models.IPADetails{
		EntitlementsXML: entitlementsXML,
		Files:           extractedFiles,
		Dylibs:          dylibs,
		Frameworks:      frameworks,
		Plugins:         plugins,
		Properties:      properties,
	}

	// Reuse ParseIPA's icon extraction (largest icon, CgBI-converted)
	if info, err := s.ParseIPA(ipaPath); err == nil && info.IconBase64 != "" {
		details.IconBase64 = info.IconBase64
	}

	logger.Info().
		Int("files_count", len(extractedFiles)).
		Int("dylibs_count", len(dylibs)).
		Int("frameworks_count", len(frameworks)).
		Int("plugins_count", len(plugins)).
		Bool("has_entitlements", entitlementsXML != "").
		Msg("IPA details retrieved successfully")

	return details, nil
}

func (s *Service) ExtractFile(ipaPath string, filePath string) (string, error) {
	logger.Debug().
		Str("ipa_path", ipaPath).
		Str("file_path", filePath).
		Msg("Extracting file from IPA")

	zipReader, err := zip.OpenReader(ipaPath)
	if err != nil {
		return "", fmt.Errorf("failed to open IPA file as ZIP: %w", err)
	}
	defer zipReader.Close()

	for _, file := range zipReader.File {
		if zipPathsEqual(file.Name, filePath) {
			if file.FileInfo().IsDir() {
				return "", fmt.Errorf("cannot extract directory as file")
			}

			rc, err := file.Open()
			if err != nil {
				return "", fmt.Errorf("failed to open file in ZIP: %w", err)
			}
			defer rc.Close()

			content, err := io.ReadAll(rc)
			if err != nil {
				return "", fmt.Errorf("failed to read file content: %w", err)
			}

			return string(content), nil
		}
	}

	return "", fmt.Errorf("file not found in IPA: %s", filePath)
}

func (s *Service) ExtractFiles(ipaPath string, filePaths []string, outputDir string) ([]string, error) {
	logger.Debug().
		Str("ipa_path", ipaPath).
		Int("file_count", len(filePaths)).
		Str("output_dir", outputDir).
		Msg("Extracting multiple files from IPA")

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create output directory: %w", err)
	}

	zipReader, err := zip.OpenReader(ipaPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open IPA file as ZIP: %w", err)
	}
	defer zipReader.Close()

	// Build a set of exact paths and directory prefixes
	exactPaths := make(map[string]bool)
	dirPrefixes := make([]string, 0)

	for _, path := range filePaths {
		normalizedPath := normalizeZipPath(path)
		exactPaths[normalizedPath] = true
		// Add both with and without trailing slash for directory matching
		if !strings.HasSuffix(normalizedPath, "/") {
			dirPrefixes = append(dirPrefixes, normalizedPath+"/")
		} else {
			dirPrefixes = append(dirPrefixes, normalizedPath)
		}
	}

	var extractedFiles []string

	for _, file := range zipReader.File {
		normalizedName := normalizeZipPath(file.Name)
		shouldExtract := false

		// Check if it's an exact match
		if exactPaths[normalizedName] {
			shouldExtract = true
		} else {
			// Check if it's inside a requested directory
			for _, prefix := range dirPrefixes {
				if strings.HasPrefix(normalizedName, prefix) {
					shouldExtract = true
					break
				}
			}
		}

		if !shouldExtract {
			continue
		}

		if file.FileInfo().IsDir() {
			continue
		}

		// Keep directory structure
		outputPath := filepath.Join(outputDir, filepath.FromSlash(normalizedName))

		// Create parent directories
		if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
			logger.Warn().Err(err).Str("dir", filepath.Dir(outputPath)).Msg("Failed to create parent directory")
			continue
		}

		rc, err := file.Open()
		if err != nil {
			logger.Warn().Err(err).Str("file", file.Name).Msg("Failed to open file in ZIP")
			continue
		}

		outFile, err := os.Create(outputPath)
		if err != nil {
			rc.Close()
			logger.Warn().Err(err).Str("output", outputPath).Msg("Failed to create output file")
			continue
		}

		_, err = io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()

		if err != nil {
			logger.Warn().Err(err).Str("file", file.Name).Msg("Failed to copy file content")
			os.Remove(outputPath)
			continue
		}

		extractedFiles = append(extractedFiles, outputPath)
		logger.Debug().Str("file", file.Name).Str("output", outputPath).Msg("File extracted")
	}

	logger.Info().
		Int("requested", len(filePaths)).
		Int("extracted", len(extractedFiles)).
		Msg("Files extraction completed")

	return extractedFiles, nil
}

// extractLocalizedName extracts the localized app name from InfoPlist.strings files
// Priority: zh-Hans (Simplified Chinese) > zh-Hant (Traditional Chinese) > zh > en > Base > first available
func (s *Service) extractLocalizedName(localizationFiles map[string]*zip.File, infoPlist map[string]interface{}) string {
	if len(localizationFiles) == 0 {
		return ""
	}

	// Language priority list
	langPriority := []string{"zh-Hans", "zh-Hant", "zh_CN", "zh_TW", "zh", "en", "Base"}

	// Try each language in priority order
	for _, lang := range langPriority {
		if file, ok := localizationFiles[lang]; ok {
			name := s.parseInfoPlistStrings(file, infoPlist)
			if name != "" {
				logger.Debug().Str("lang", lang).Str("name", name).Msg("Using localized app name")
				return name
			}
		}
	}

	// If no priority language found, try any available language
	for lang, file := range localizationFiles {
		name := s.parseInfoPlistStrings(file, infoPlist)
		if name != "" {
			logger.Debug().Str("lang", lang).Str("name", name).Msg("Using localized app name (fallback)")
			return name
		}
	}

	return ""
}

// parseInfoPlistStrings parses InfoPlist.strings file and extracts CFBundleDisplayName or CFBundleName
func (s *Service) parseInfoPlistStrings(file *zip.File, infoPlist map[string]interface{}) string {
	rc, err := file.Open()
	if err != nil {
		logger.Warn().Err(err).Str("file", file.Name).Msg("Failed to open localization file")
		return ""
	}
	defer rc.Close()

	data, err := io.ReadAll(rc)
	if err != nil {
		logger.Warn().Err(err).Str("file", file.Name).Msg("Failed to read localization file")
		return ""
	}

	// Parse as plist
	var stringsDict map[string]interface{}
	_, err = plist.Unmarshal(data, &stringsDict)
	if err != nil {
		logger.Warn().Err(err).Str("file", file.Name).Msg("Failed to parse localization file as plist")
		return ""
	}

	// First try CFBundleDisplayName
	if displayName, ok := stringsDict["CFBundleDisplayName"].(string); ok && displayName != "" {
		return displayName
	}

	// Then try CFBundleName
	if bundleName, ok := stringsDict["CFBundleName"].(string); ok && bundleName != "" {
		return bundleName
	}

	// If the InfoPlist has a localization key reference (e.g., "AppName"), try to find it
	if displayNameKey, ok := infoPlist["CFBundleDisplayName"].(string); ok && displayNameKey != "" {
		if localizedName, ok := stringsDict[displayNameKey].(string); ok && localizedName != "" {
			return localizedName
		}
	}

	if bundleNameKey, ok := infoPlist["CFBundleName"].(string); ok && bundleNameKey != "" {
		if localizedName, ok := stringsDict[bundleNameKey].(string); ok && localizedName != "" {
			return localizedName
		}
	}

	return ""
}

// getIconPatterns extracts icon patterns from Info.plist
func getIconPatterns(plistDict map[string]interface{}) []string {
	var patterns []string
	seen := make(map[string]bool)

	add := func(s string) {
		if s != "" && !seen[s] {
			patterns = append(patterns, s)
			seen[s] = true
		}
	}

	// 1. CFBundleIconFiles (Legacy but still common)
	if files, ok := plistDict["CFBundleIconFiles"].([]interface{}); ok {
		for _, f := range files {
			if s, ok := f.(string); ok {
				add(s)
			}
		}
	}

	// 2. CFBundleIcons -> CFBundlePrimaryIcon -> CFBundleIconFiles (Modern)
	if icons, ok := plistDict["CFBundleIcons"].(map[string]interface{}); ok {
		if primary, ok := icons["CFBundlePrimaryIcon"].(map[string]interface{}); ok {
			if files, ok := primary["CFBundleIconFiles"].([]interface{}); ok {
				for _, f := range files {
					if s, ok := f.(string); ok {
						add(s)
					}
				}
			}
		}
	}

	// 3. CFBundleIconFile (Older legacy)
	if file, ok := plistDict["CFBundleIconFile"].(string); ok {
		add(file)
	}

	return patterns
}
