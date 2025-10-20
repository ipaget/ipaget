package sign

import (
	"crypto"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/x509"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ipaget-service/internal/logger"

	"howett.net/plist"
)

var validBinaryExtensions = []string{".app", ".framework", ".dylib", ".appex", ".so", "0", ".vis", ".pvr"}

func SignIPAAdhoc(inputIPA, outputIPA string) error {
	options := SignerOptions{
		InputPath:  inputIPA,
		OutputPath: outputIPA,
	}
	return SignIPA(options)
}

func SignIPAWithP12(inputIPA, outputIPA, p12Path, p12Password string, profile *ProvisioningProfile) error {
	options := SignerOptions{
		InputPath:     inputIPA,
		OutputPath:    outputIPA,
		P12File:       p12Path,
		P12Password:   p12Password,
		ProvisionFile: "",
	}

	if profile != nil {
		tmpProvision := filepath.Join(os.TempDir(), "temp.mobileprovision")
		err := os.WriteFile(tmpProvision, profile.rawData, 0644)
		if err != nil {
			return fmt.Errorf("failed to write temp provisioning profile: %w", err)
		}
		defer os.Remove(tmpProvision)
		options.ProvisionFile = tmpProvision
	}

	return SignIPA(options)
}

var globalDebugOptions struct {
	Enabled bool
	Folder  string
}

func SignIPA(options SignerOptions) error {
	globalDebugOptions.Enabled = options.Debug
	globalDebugOptions.Folder = options.DebugFolder

	// Use custom temp folder if specified
	tempPrefix := ""
	if options.TempFolder != "" {
		tempPrefix = options.TempFolder
	}

	tmpDir, err := os.MkdirTemp(tempPrefix, "zsign_folder_*")
	if err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// Log unzip start
	fileInfo, _ := os.Stat(options.InputPath)
	sizeMB := float64(fileInfo.Size()) / 1024 / 1024
	logger.Info().Msgf("Unzip:      %s (%.2f MB) -> %s ...", options.InputPath, sizeMB, tmpDir)
	unzipStart := time.Now()

	workDir := filepath.Join(tmpDir, "work")
	err = extractZip(options.InputPath, workDir)
	if err != nil {
		return fmt.Errorf("failed to extract IPA: %w", err)
	}

	// Log unzip OK
	unzipElapsed := time.Since(unzipStart)
	logger.Info().Msgf("Unzip OK! (%.3fs, %dus)", unzipElapsed.Seconds(), unzipElapsed.Microseconds())

	payloadDir := filepath.Join(workDir, "Payload")
	appDir, err := locateAppFolder(payloadDir)
	if err != nil {
		return fmt.Errorf("failed to locate app folder: %w", err)
	}

	var profile *ProvisioningProfile
	var certData []byte
	var privateKey crypto.PrivateKey
	var teamID, bundleID string

	isAdhoc := (options.P12File == "")

	if !isAdhoc {
		_, certData, privateKey, err = LoadP12Certificate(options.P12File, options.P12Password)
		if err != nil {
			return fmt.Errorf("failed to load P12 certificate: %w", err)
		}

		if options.ProvisionFile != "" {
			profile, err = ParseProvisioningProfile(options.ProvisionFile)
			if err != nil {
				return fmt.Errorf("failed to parse provisioning profile: %w", err)
			}
			teamID = profile.TeamID
			bundleID = profile.AppID
		} else {
			mobileprovisionPath := filepath.Join(appDir, "embedded.mobileprovision")
			if _, err := os.Stat(mobileprovisionPath); err == nil {
				profile, err = ParseProvisioningProfile(mobileprovisionPath)
				if err != nil {
					return fmt.Errorf("failed to parse existing mobileprovision: %w", err)
				}
				teamID = profile.TeamID
				bundleID = profile.AppID
			}
		}
	} else {
		mobileprovisionPath := filepath.Join(appDir, "embedded.mobileprovision")
		os.Remove(mobileprovisionPath)
	}

	infoPlistPath := filepath.Join(appDir, "Info.plist")
	infoPlistData, err := os.ReadFile(infoPlistPath)
	if err != nil {
		return fmt.Errorf("failed to read Info.plist: %w", err)
	}

	var infoPlist map[string]interface{}
	_, err = plist.Unmarshal(infoPlistData, &infoPlist)
	if err != nil {
		return fmt.Errorf("failed to parse Info.plist: %w", err)
	}

	if bundleID == "" {
		if bid, ok := infoPlist["CFBundleIdentifier"].(string); ok {
			bundleID = bid
		}
	}

	// Log signing info
	logger.Info().Msgf("Signing:    %s ...", appDir)
	appName := ""
	if name, ok := infoPlist["CFBundleName"].(string); ok {
		appName = name
	} else if name, ok := infoPlist["CFBundleDisplayName"].(string); ok {
		appName = name
	}
	version := ""
	if ver, ok := infoPlist["CFBundleVersion"].(string); ok {
		version = ver
	}
	subjectCN := ""
	if !isAdhoc && certData != nil {
		if cert, err := x509.ParseCertificate(certData); err == nil {
			subjectCN = cert.Subject.CommonName
		}
	}
	logger.Info().Msgf("AppName:    %s", appName)
	logger.Info().Msgf("BundleId:   %s", bundleID)
	logger.Info().Msgf("Version:    %s", version)
	logger.Info().Msgf("TeamId:     %s", teamID)
	logger.Info().Msgf("SubjectCN:  %s", subjectCN)
	logger.Info().Msgf("ReadCache:  NO")

	signStart := time.Now()

	needUpdateInfoPlist := false

	if options.NewBundleID != "" {
		bundleID = options.NewBundleID
		infoPlist["CFBundleIdentifier"] = bundleID
		needUpdateInfoPlist = true
	}

	if options.NewBundleName != "" {
		infoPlist["CFBundleDisplayName"] = options.NewBundleName
		needUpdateInfoPlist = true

		// Also update localized InfoPlist.strings files if they exist
		localizedDirs := []string{"zh_CN.lproj", "zh-Hans.lproj", "en.lproj"}
		for _, localDir := range localizedDirs {
			stringsPath := filepath.Join(appDir, localDir, "InfoPlist.strings")
			if _, err := os.Stat(stringsPath); err == nil {
				stringsData, err := os.ReadFile(stringsPath)
				if err == nil {
					var stringsDict map[string]interface{}
					if _, err := plist.Unmarshal(stringsData, &stringsDict); err == nil {
						stringsDict["CFBundleDisplayName"] = options.NewBundleName
						if newStringsData, err := plist.MarshalIndent(stringsDict, plist.XMLFormat, "\t"); err == nil {
							os.WriteFile(stringsPath, newStringsData, 0644)
						}
					}
				}
			}
		}
	}

	if options.NewBundleVersion != "" {
		infoPlist["CFBundleVersion"] = options.NewBundleVersion
		infoPlist["CFBundleShortVersionString"] = options.NewBundleVersion
		needUpdateInfoPlist = true
	}

	if needUpdateInfoPlist {
		newInfoPlistData, err := plist.MarshalIndent(infoPlist, plist.XMLFormat, "\t")
		if err == nil {
			os.WriteFile(infoPlistPath, newInfoPlistData, 0644)
		}
	}

	if profile != nil && profile.rawData != nil {
		mobileprovisionPath := filepath.Join(appDir, "embedded.mobileprovision")
		err = os.WriteFile(mobileprovisionPath, profile.rawData, 0644)
		if err != nil {
			return fmt.Errorf("failed to write mobileprovision: %w", err)
		}
	}

	var entitlements map[string]interface{}

	// Priority: custom entitlements file > provisioning profile > default
	if options.EntitlementsFile != "" {
		entData, err := os.ReadFile(options.EntitlementsFile)
		if err != nil {
			return fmt.Errorf("failed to read entitlements file: %w", err)
		}
		_, err = plist.Unmarshal(entData, &entitlements)
		if err != nil {
			return fmt.Errorf("failed to parse entitlements file: %w", err)
		}
	} else if options.Entitlements != nil && len(options.Entitlements) > 0 {
		entitlements = options.Entitlements
	} else if profile != nil {
		entitlements = profile.GetEntitlements()
	} else {
		entitlements = map[string]interface{}{
			"get-task-allow": true,
		}
	}

	// Inject dylibs into main executable before signing
	if len(options.DylibFiles) > 0 {
		execName, ok := infoPlist["CFBundleExecutable"].(string)
		if !ok {
			return fmt.Errorf("CFBundleExecutable not found in Info.plist")
		}

		mainExecPath := filepath.Join(appDir, execName)
		execData, err := os.ReadFile(mainExecPath)
		if err != nil {
			return fmt.Errorf("failed to read main executable: %w", err)
		}

		for _, dylibFile := range options.DylibFiles {
			weakStr := ""
			if options.WeakInject {
				weakStr = " (weak)"
			}
			logger.Info().Msgf("InjectDylib: %s%s... ", dylibFile, weakStr)
			execData, err = InjectDylib(execData, dylibFile, options.WeakInject)
			if err != nil {
				logger.Error().Msg("Failed!")
				return fmt.Errorf("failed to inject dylib %s: %w", dylibFile, err)
			}
			logger.Info().Msg("Success!")
		}

		err = os.WriteFile(mainExecPath, execData, 0755)
		if err != nil {
			return fmt.Errorf("failed to write modified executable: %w", err)
		}
	}

	// Generate CodeResources before signing
	codeResourcesData, err := GenerateCodeResources(appDir)
	if err != nil {
		return fmt.Errorf("failed to generate CodeResources: %w", err)
	}

	err = WriteCodeResources(appDir, codeResourcesData)
	if err != nil {
		return fmt.Errorf("failed to write CodeResources: %w", err)
	}

	err = signDirectory(appDir, bundleID, teamID, entitlements, certData, privateKey, isAdhoc, codeResourcesData)
	if err != nil {
		return fmt.Errorf("failed to sign app directory: %w", err)
	}

	// Log signed OK
	signElapsed := time.Since(signStart)
	logger.Info().Msgf("Signed OK! (%.3fs, %dus)", signElapsed.Seconds(), signElapsed.Microseconds())

	// Log archiving start
	logger.Info().Msgf("Archiving:  %s ...", options.OutputPath)
	archiveStart := time.Now()

	err = createZipWithLevel(options.OutputPath, payloadDir, options.ZipLevel)
	if err != nil {
		return fmt.Errorf("failed to create output IPA: %w", err)
	}

	// Log archive OK
	outputInfo, _ := os.Stat(options.OutputPath)
	outputSizeMB := float64(outputInfo.Size()) / 1024 / 1024
	archiveElapsed := time.Since(archiveStart)
	logger.Info().Msgf("Archive OK! (%.2f MB) (%.3fs, %dus)", outputSizeMB, archiveElapsed.Seconds(), archiveElapsed.Microseconds())

	return nil
}

func signDirectory(dirPath, bundleID, teamID string, entitlements map[string]interface{}, certData []byte, privateKey crypto.PrivateKey, isAdhoc bool, codeResourcesData string) error {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		entryPath := filepath.Join(dirPath, entry.Name())
		if entry.IsDir() {
			err = signDirectory(entryPath, bundleID, teamID, entitlements, certData, privateKey, isAdhoc, "")
			if err != nil {
				return err
			}
		}
	}

	ext := filepath.Ext(dirPath)
	if !stringInSlice(ext, validBinaryExtensions) {
		return nil
	}

	return signBundle(dirPath, bundleID, teamID, entitlements, certData, privateKey, isAdhoc, codeResourcesData)
}

func signBundle(bundlePath, bundleID, teamID string, entitlements map[string]interface{}, certData []byte, privateKey crypto.PrivateKey, isAdhoc bool, codeResourcesData string) error {
	var executablePath string
	var execName string
	ext := filepath.Ext(bundlePath)

	switch ext {
	case ".app", ".appex":
		infoPlistPath := filepath.Join(bundlePath, "Info.plist")
		infoPlistData, err := os.ReadFile(infoPlistPath)
		if err != nil {
			return fmt.Errorf("failed to read Info.plist: %w", err)
		}

		var infoPlist map[string]interface{}
		_, err = plist.Unmarshal(infoPlistData, &infoPlist)
		if err != nil {
			return fmt.Errorf("failed to parse Info.plist: %w", err)
		}

		var ok bool
		execName, ok = infoPlist["CFBundleExecutable"].(string)
		if !ok {
			return fmt.Errorf("CFBundleExecutable not found in Info.plist")
		}

		executablePath = filepath.Join(bundlePath, execName)

	case ".framework":
		frameworkName := filepath.Base(bundlePath)
		frameworkName = strings.TrimSuffix(frameworkName, ext)
		executablePath = filepath.Join(bundlePath, frameworkName)
		execName = frameworkName

	case ".dylib", ".so":
		executablePath = bundlePath
		execName = filepath.Base(bundlePath)

	default:
		return nil
	}

	if _, err := os.Stat(executablePath); os.IsNotExist(err) {
		return nil
	}

	// Log SignFolder
	folderName := filepath.Base(bundlePath)
	logger.Info().Msgf("SignFolder: %s, (%s)", folderName, execName)

	return signExecutable(executablePath, bundleID, teamID, entitlements, certData, privateKey, isAdhoc, codeResourcesData)
}

func signExecutable(execPath, bundleID, teamID string, entitlements map[string]interface{}, certData []byte, privateKey crypto.PrivateKey, isAdhoc bool, codeResourcesData string) error {
	data, err := os.ReadFile(execPath)
	if err != nil {
		return fmt.Errorf("failed to read executable: %w", err)
	}

	isExecutable := isExecutableFile(data)

	data, err = RemoveCodeSignature(data, 0)
	if err != nil {
		return fmt.Errorf("failed to remove existing signature: %w", err)
	}

	subjectCN := ""
	if certData != nil {
		cert, err := x509.ParseCertificate(certData)
		if err == nil {
			subjectCN = cert.Subject.CommonName
		}
	}

	requirementsBlob := BuildRequirementsBlob(bundleID, subjectCN)
	requirementsHash1 := hashData(requirementsBlob, CS_HASHTYPE_SHA1)
	requirementsHash256 := hashData(requirementsBlob, CS_HASHTYPE_SHA256)

	if globalDebugOptions.Enabled {
		os.WriteFile(filepath.Join(globalDebugOptions.Folder, "Requirements.slot.new"), requirementsBlob, 0644)
	}

	// CodeResources hash
	var codeResourcesHash1, codeResourcesHash256 []byte
	if codeResourcesData != "" {
		codeResourcesHash1 = hashData([]byte(codeResourcesData), CS_HASHTYPE_SHA1)
		codeResourcesHash256 = hashData([]byte(codeResourcesData), CS_HASHTYPE_SHA256)
	} else {
		codeResourcesHash1 = make([]byte, 20)
		codeResourcesHash256 = make([]byte, 32)
	}

	var entitlementsToUse map[string]interface{}
	if isExecutable {
		entitlementsToUse = entitlements
	} else {
		entitlementsToUse = make(map[string]interface{})
	}

	entitlementsBlob, err := BuildEntitlementsBlob(entitlementsToUse)
	if err != nil {
		return fmt.Errorf("failed to build entitlements blob: %w", err)
	}
	entitlementsHash1 := hashData(entitlementsBlob, CS_HASHTYPE_SHA1)
	entitlementsHash256 := hashData(entitlementsBlob, CS_HASHTYPE_SHA256)

	if globalDebugOptions.Enabled {
		os.WriteFile(filepath.Join(globalDebugOptions.Folder, "Entitlements.slot.new"), entitlementsBlob, 0644)
		if len(entitlementsBlob) > 8 {
			os.WriteFile(filepath.Join(globalDebugOptions.Folder, "Entitlements.plist.new"), entitlementsBlob[8:], 0644)
		}
	}

	var derEntitlementsBlob []byte
	var derEntitlementsHash1, derEntitlementsHash256 []byte

	if isExecutable {
		derEntitlementsBlob, err = BuildDEREntitlementsBlob(entitlements)
		if err != nil {
			return fmt.Errorf("failed to build DER entitlements blob: %w", err)
		}
		if derEntitlementsBlob != nil {
			derEntitlementsHash1 = hashData(derEntitlementsBlob, CS_HASHTYPE_SHA1)
			derEntitlementsHash256 = hashData(derEntitlementsBlob, CS_HASHTYPE_SHA256)

			if globalDebugOptions.Enabled {
				os.WriteFile(filepath.Join(globalDebugOptions.Folder, "Entitlements.der.slot.new"), derEntitlementsBlob, 0644)
			}
		}
	}

	infoPlistHash1 := make([]byte, 20)
	infoPlistHash256 := make([]byte, 32)
	resourcesHash1 := codeResourcesHash1
	resourcesHash256 := codeResourcesHash256

	slots := make(map[uint32][]byte)

	var codeDirectory1, codeDirectory256 []byte

	// Check if SHA256-only mode
	sha256Only := false // Get from global options if available

	if !sha256Only {
		codeDirectory1, err = BuildCodeDirectory(
			CS_HASHTYPE_SHA1,
			bundleID,
			teamID,
			data,
			infoPlistHash1,
			requirementsHash1,
			resourcesHash1,
			entitlementsHash1,
			derEntitlementsHash1,
			isAdhoc,
			isExecutable,
			entitlementsBlob,
		)
		if err != nil {
			return fmt.Errorf("failed to build SHA1 code directory: %w", err)
		}

		if globalDebugOptions.Enabled {
			os.WriteFile(filepath.Join(globalDebugOptions.Folder, "CodeDirectory_SHA1.slot.new"), codeDirectory1, 0644)
		}
		slots[CSSLOT_CODEDIRECTORY] = codeDirectory1
	}

	codeDirectory256, err = BuildCodeDirectory(
		CS_HASHTYPE_SHA256,
		bundleID,
		teamID,
		data,
		infoPlistHash256,
		requirementsHash256,
		resourcesHash256,
		entitlementsHash256,
		derEntitlementsHash256,
		isAdhoc,
		isExecutable,
		entitlementsBlob,
	)
	if err != nil {
		return fmt.Errorf("failed to build SHA256 code directory: %w", err)
	}

	if globalDebugOptions.Enabled {
		os.WriteFile(filepath.Join(globalDebugOptions.Folder, "CodeDirectory_SHA256.slot.new"), codeDirectory256, 0644)
	}

	if sha256Only {
		slots[CSSLOT_CODEDIRECTORY] = codeDirectory256
	} else {
		slots[0x1000] = codeDirectory256
	}
	slots[CSSLOT_REQUIREMENTS] = requirementsBlob
	slots[CSSLOT_ENTITLEMENTS] = entitlementsBlob

	if isExecutable && derEntitlementsBlob != nil {
		slots[CSSLOT_DER_ENTITLEMENTS] = derEntitlementsBlob
	}

	if !isAdhoc && certData != nil && privateKey != nil {
		cdHash1 := sha1.Sum(codeDirectory1)
		cdHash256 := sha256.Sum256(codeDirectory256)

		cmsBlob, err := BuildCMSSignature(cdHash1[:], cdHash256[:], certData, privateKey)
		if err != nil {
			return fmt.Errorf("failed to build CMS signature: %w", err)
		}
		slots[CSSLOT_SIGNATURESLOT] = cmsBlob

		if globalDebugOptions.Enabled {
			os.WriteFile(filepath.Join(globalDebugOptions.Folder, "CMSSignature.slot.new"), cmsBlob, 0644)
			if len(cmsBlob) > 8 {
				os.WriteFile(filepath.Join(globalDebugOptions.Folder, "CMSSignature.der.new"), cmsBlob[8:], 0644)
			}
		}
	}

	superBlob := BuildSuperBlob(slots)

	if globalDebugOptions.Enabled {
		os.WriteFile(filepath.Join(globalDebugOptions.Folder, "CodeSignature.blob.new"), superBlob, 0644)
	}

	newData := append(data, superBlob...)

	err = os.WriteFile(execPath, newData, 0755)
	if err != nil {
		return fmt.Errorf("failed to write signed executable: %w", err)
	}

	return nil
}

func isExecutableFile(data []byte) bool {
	if len(data) < 28 {
		return false
	}

	magic := binary.LittleEndian.Uint32(data[0:4])

	var offset uint32
	switch magic {
	case MH_MAGIC, MH_CIGAM:
		offset = 0
	case MH_MAGIC_64, MH_CIGAM_64:
		offset = 0
	case FAT_MAGIC, FAT_CIGAM, FAT_MAGIC_64, FAT_CIGAM_64:
		if len(data) < 8 {
			return false
		}
		nfat := binary.BigEndian.Uint32(data[4:8])
		if nfat > 0 && len(data) >= 28 {
			offset = binary.BigEndian.Uint32(data[8:12])
			if uint32(len(data)) <= offset+28 {
				return false
			}
		} else {
			return false
		}
	default:
		return false
	}

	var fileType uint32
	headerMagic := binary.LittleEndian.Uint32(data[offset : offset+4])

	switch headerMagic {
	case MH_MAGIC, MH_CIGAM:
		fileType = binary.LittleEndian.Uint32(data[offset+12 : offset+16])
	case MH_MAGIC_64, MH_CIGAM_64:
		fileType = binary.LittleEndian.Uint32(data[offset+12 : offset+16])
	default:
		return false
	}

	const MH_EXECUTE = 0x2
	return fileType == MH_EXECUTE
}

func stringInSlice(str string, list []string) bool {
	for _, item := range list {
		if item == str {
			return true
		}
	}
	return false
}
