package sign

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"go.mozilla.org/pkcs7"
	"howett.net/plist"
)

func ExtractEntitlementsFromIPA(ipaPath string) (map[string]interface{}, error) {
	return ExtractEntitlementsFromIPAWithProgress(ipaPath, nil)
}

func ExtractEntitlementsFromIPAWithProgress(ipaPath string, progressCallback func(progress float64, message string)) (map[string]interface{}, error) {
	if progressCallback == nil {
		progressCallback = func(float64, string) {}
	}

	tmpDir, err := os.MkdirTemp("", "entitlements-extract-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	progressCallback(10, "Extracting IPA...")
	err = extractZipWithProgress(ipaPath, tmpDir, func(progress float64) {
		progressCallback(10+progress*70/100, "Extracting IPA...")
	})
	if err != nil {
		return nil, fmt.Errorf("failed to extract IPA: %w", err)
	}

	progressCallback(80, "Locating app folder...")
	payloadFolder := filepath.Join(tmpDir, "Payload")
	appFolder, err := locateAppFolder(payloadFolder)
	if err != nil {
		return nil, fmt.Errorf("failed to locate app folder: %w", err)
	}

	progressCallback(90, "Reading mobileprovision...")
	mobileprovisionPath := filepath.Join(appFolder, "embedded.mobileprovision")

	if _, err := os.Stat(mobileprovisionPath); err == nil {
		progressCallback(95, "Parsing entitlements from mobileprovision...")
		entitlements, err := ExtractEntitlementsFromMobileprovision(mobileprovisionPath)
		if err == nil {
			progressCallback(100, "Complete")
			return entitlements, nil
		}
	}

	progressCallback(92, "No mobileprovision, trying to extract from executable signature...")
	entitlements, err := ExtractEntitlementsFromAppFolder(appFolder)
	if err != nil {
		return nil, fmt.Errorf("failed to extract entitlements: no embedded.mobileprovision and can't read from signature: %w", err)
	}

	progressCallback(100, "Complete")
	return entitlements, nil
}

func ExtractEntitlementsFromMobileprovision(mobileprovisionPath string) (map[string]interface{}, error) {
	profile, err := ParseProvisioningProfile(mobileprovisionPath)
	if err != nil {
		return nil, fmt.Errorf("failed to parse provisioning profile: %w", err)
	}

	return profile.Entitlements, nil
}

func ParseProvisioningProfile(filename string) (*ProvisioningProfile, error) {
	var profile ProvisioningProfile
	profile.Path = filename
	profile.Filename = filepath.Base(filename)

	content, err := os.ReadFile(filename)
	if err != nil {
		return nil, fmt.Errorf("failed to read mobileprovision file: %w", err)
	}

	profile.rawData = content

	xmlContent, err := extractPlistFromMobileprovision(content)
	if err != nil {
		return nil, fmt.Errorf("failed to extract plist from mobileprovision: %w", err)
	}

	var mobileProvision struct {
		ExpirationDate time.Time              `plist:"ExpirationDate"`
		CreationDate   time.Time              `plist:"CreationDate"`
		Name           string                 `plist:"Name"`
		Entitlements   map[string]interface{} `plist:"Entitlements"`
	}

	_, err = plist.Unmarshal([]byte(xmlContent), &mobileProvision)
	if err != nil {
		return nil, fmt.Errorf("failed to parse plist: %w", err)
	}

	if appID, ok := mobileProvision.Entitlements["application-identifier"].(string); ok {
		periodIndex := strings.Index(appID, ".")
		if periodIndex > 0 {
			profile.TeamID = appID[:periodIndex]
			profile.AppID = appID[periodIndex+1:]
		}
	}

	profile.Expires = mobileProvision.ExpirationDate
	profile.Created = mobileProvision.CreationDate
	profile.Name = mobileProvision.Name
	profile.Entitlements = mobileProvision.Entitlements

	return &profile, nil
}

func extractPlistFromMobileprovision(data []byte) (string, error) {
	p7, err := pkcs7.Parse(data)
	if err == nil && p7.Content != nil {
		return string(p7.Content), nil
	}

	contentStr := string(data)
	xmlIndex := strings.Index(contentStr, "<?xml")
	if xmlIndex == -1 {
		return "", fmt.Errorf("no XML content found in mobileprovision")
	}

	plistEnd := strings.LastIndex(contentStr, "</plist>")
	if plistEnd == -1 {
		return "", fmt.Errorf("no plist end tag found in mobileprovision")
	}

	return contentStr[xmlIndex : plistEnd+8], nil
}

func SaveEntitlementsToFile(entitlements map[string]interface{}, outputPath string) error {
	file, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("failed to create entitlements file: %w", err)
	}
	defer file.Close()

	encoder := plist.NewEncoder(file)
	encoder.Indent("\t")
	err = encoder.Encode(entitlements)
	if err != nil {
		return fmt.Errorf("failed to encode entitlements: %w", err)
	}

	return nil
}

func (profile *ProvisioningProfile) GetEntitlements() map[string]interface{} {
	return profile.Entitlements
}

func (profile *ProvisioningProfile) RemoveGetTaskAllow() {
	delete(profile.Entitlements, "get-task-allow")
}

func (profile *ProvisioningProfile) Update(trueAppID string) {
	if _, ok := profile.Entitlements["application-identifier"].(string); ok {
		newIdentifier := profile.TeamID + "." + trueAppID
		profile.Entitlements["application-identifier"] = newIdentifier
	}
}

func ExtractEntitlementsFromAppFolder(appFolder string) (map[string]interface{}, error) {
	infoPlistPath := filepath.Join(appFolder, "Info.plist")
	data, err := os.ReadFile(infoPlistPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read Info.plist: %w", err)
	}

	var infoPlist map[string]interface{}
	_, err = plist.Unmarshal(data, &infoPlist)
	if err != nil {
		return nil, fmt.Errorf("failed to parse Info.plist: %w", err)
	}

	executableName, ok := infoPlist["CFBundleExecutable"].(string)
	if !ok || executableName == "" {
		return nil, fmt.Errorf("CFBundleExecutable not found in Info.plist")
	}

	executablePath := filepath.Join(appFolder, executableName)
	return ExtractEntitlementsFromExecutable(executablePath)
}

func ExtractEntitlementsFromExecutable(executablePath string) (map[string]interface{}, error) {
	data, err := os.ReadFile(executablePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read executable: %w", err)
	}

	csOffset, csSize, err := FindCodeSignatureOffset(data, 0)
	if err != nil {
		return nil, fmt.Errorf("failed to find code signature: %w", err)
	}

	if csOffset == 0 || csSize == 0 {
		return nil, fmt.Errorf("no code signature found in executable")
	}

	csData := data[csOffset : csOffset+csSize]
	return ExtractEntitlementsFromCodeSignature(csData)
}

func ExtractEntitlementsFromCodeSignature(csData []byte) (map[string]interface{}, error) {
	if len(csData) < 12 {
		return nil, fmt.Errorf("code signature data too small")
	}

	magic := binary.BigEndian.Uint32(csData[0:4])
	if magic != CSMAGIC_EMBEDDED_SIGNATURE {
		return nil, fmt.Errorf("invalid code signature magic: 0x%x", magic)
	}

	count := binary.BigEndian.Uint32(csData[8:12])

	for i := uint32(0); i < count; i++ {
		offset := 12 + i*8
		if offset+8 > uint32(len(csData)) {
			break
		}

		slotType := binary.BigEndian.Uint32(csData[offset : offset+4])
		slotOffset := binary.BigEndian.Uint32(csData[offset+4 : offset+8])

		if slotType == CSSLOT_ENTITLEMENTS {
			if slotOffset+8 > uint32(len(csData)) {
				return nil, fmt.Errorf("invalid entitlements slot offset")
			}

			entitlementsBlob := csData[slotOffset:]
			if len(entitlementsBlob) < 8 {
				return nil, fmt.Errorf("entitlements blob too small")
			}

			blobMagic := binary.BigEndian.Uint32(entitlementsBlob[0:4])
			blobLength := binary.BigEndian.Uint32(entitlementsBlob[4:8])

			if blobMagic != CSMAGIC_EMBEDDED_ENTITLEMENTS {
				return nil, fmt.Errorf("invalid entitlements blob magic: 0x%x", blobMagic)
			}

			if blobLength > uint32(len(entitlementsBlob)) {
				return nil, fmt.Errorf("invalid entitlements blob length")
			}

			plistData := entitlementsBlob[8:blobLength]

			var entitlements map[string]interface{}
			_, err := plist.Unmarshal(plistData, &entitlements)
			if err != nil {
				return nil, fmt.Errorf("failed to parse entitlements plist: %w", err)
			}

			return entitlements, nil
		}
	}

	return nil, fmt.Errorf("entitlements slot not found in code signature")
}
