package ipa

import (
	"archive/zip"
	"encoding/base64"
	"fmt"
	"io"
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

func NewService() *Service {
	return &Service{}
}

func (s *Service) ParseIPA(ipaPath string) (*models.IPAInfo, error) {
	logger.Debug().Str("ipa_path", ipaPath).Msg("Parsing IPA file")

	zipReader, err := zip.OpenReader(ipaPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open IPA file as ZIP: %w", err)
	}
	defer zipReader.Close()

	var infoPlistFile *zip.File
	var iconFiles []*zip.File

	for _, file := range zipReader.File {
		if strings.Contains(file.Name, ".app/Info.plist") && !strings.Contains(file.Name, "/Watch/") {
			infoPlistFile = file
			logger.Debug().Str("info_plist", file.Name).Msg("Found Info.plist")
		}
		if strings.Contains(file.Name, ".app/AppIcon") && strings.HasSuffix(file.Name, ".png") {
			iconFiles = append(iconFiles, file)
			logger.Debug().Str("icon_file", file.Name).Uint64("size", file.UncompressedSize64).Msg("Found icon file")
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
			Str("selected_icon", largestIconFile.Name).
			Uint64("size", largestIconFile.UncompressedSize64).
			Int("total_icons", len(iconFiles)).
			Msg("Selected largest icon file")

		iconRC, err := largestIconFile.Open()
		if err != nil {
			logger.Warn().Err(err).Str("icon_file", largestIconFile.Name).Msg("Failed to open icon file")
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

	logger.Info().
		Str("bundle_id", ipaInfo.BundleID).
		Str("name", ipaInfo.Name).
		Str("version", ipaInfo.Version).
		Msg("IPA file parsed successfully")

	return ipaInfo, nil
}

func (s *Service) GetIPADetails(ipaPath string, progressCallback func(progress float64, message string)) (*models.IPADetails, error) {
	logger.Debug().Str("ipa_path", ipaPath).Msg("Getting IPA details")

	progressCallback(5, "Reading IPA file...")

	zipReader, err := zip.OpenReader(ipaPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open IPA file as ZIP: %w", err)
	}
	defer zipReader.Close()

	totalFiles := len(zipReader.File)
	var extractedFiles []*models.FileItem
	var resourceFiles []*models.ResourceItem

	resourceExtensions := map[string]string{
		".png":         "Image",
		".jpg":         "Image",
		".jpeg":        "Image",
		".gif":         "Image",
		".svg":         "Image",
		".mp3":         "Audio",
		".m4a":         "Audio",
		".wav":         "Audio",
		".mp4":         "Video",
		".mov":         "Video",
		".avi":         "Video",
		".json":        "Data",
		".xml":         "Data",
		".plist":       "Data",
		".strings":     "Localization",
		".ttf":         "Font",
		".otf":         "Font",
		".car":         "Asset Catalog",
		".nib":         "Interface",
		".storyboard":  "Interface",
		".storyboardc": "Interface",
	}

	progressCallback(10, "Analyzing files...")

	for i, file := range zipReader.File {
		progress := 10 + float64(i+1)/float64(totalFiles)*70
		if i%50 == 0 {
			progressCallback(progress, fmt.Sprintf("Analyzing files... (%d/%d)", i+1, totalFiles))
		}

		fileItem := &models.FileItem{
			Path:        file.Name,
			Size:        int64(file.UncompressedSize64),
			IsDirectory: file.FileInfo().IsDir(),
		}
		extractedFiles = append(extractedFiles, fileItem)

		if !file.FileInfo().IsDir() {
			ext := strings.ToLower(filepath.Ext(file.Name))
			if resType, ok := resourceExtensions[ext]; ok {
				resourceFiles = append(resourceFiles, &models.ResourceItem{
					Name: filepath.Base(file.Name),
					Type: resType,
					Size: int64(file.UncompressedSize64),
				})
			}
		}
	}

	progressCallback(80, "Extracting entitlements...")

	var entitlementsXML string
	entitlements, err := sign.ExtractEntitlementsFromIPAWithProgress(ipaPath, func(subProgress float64, message string) {
		overallProgress := 80 + subProgress*15/100
		progressCallback(overallProgress, message)
	})
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

	progressCallback(95, "Processing details...")

	details := &models.IPADetails{
		EntitlementsXML: entitlementsXML,
		Files:           extractedFiles,
		Resources:       resourceFiles,
	}

	progressCallback(100, "Complete")

	logger.Info().
		Int("files_count", len(extractedFiles)).
		Int("resources_count", len(resourceFiles)).
		Bool("has_entitlements", entitlementsXML != "").
		Msg("IPA details retrieved successfully")

	return details, nil
}
