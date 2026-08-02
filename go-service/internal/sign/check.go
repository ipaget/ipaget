package sign

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"

	"howett.net/plist"
)

// CheckSignature checks if a file or IPA is properly signed
func CheckSignature(path string) error {
	// Check if it's an IPA file
	if filepath.Ext(path) == ".ipa" {
		return checkIPASignature(path)
	}

	// Check if it's a Mach-O file
	return checkMachoSignature(path)
}

func checkIPASignature(ipaPath string) error {
	tmpDir, err := os.MkdirTemp("", "ipa-check-*")
	if err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	workDir := filepath.Join(tmpDir, "work")
	err = extractZip(ipaPath, workDir)
	if err != nil {
		return fmt.Errorf("failed to extract IPA: %w", err)
	}

	payloadDir := filepath.Join(workDir, "Payload")
	appDir, err := locateAppFolder(payloadDir)
	if err != nil {
		return fmt.Errorf("failed to locate app folder: %w", err)
	}

	// Find the main executable
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

	execName, ok := infoPlist["CFBundleExecutable"].(string)
	if !ok {
		return fmt.Errorf("CFBundleExecutable not found in Info.plist")
	}

	execPath := filepath.Join(appDir, execName)
	return checkMachoSignature(execPath)
}

func checkMachoSignature(machoPath string) error {
	data, err := os.ReadFile(machoPath)
	if err != nil {
		return fmt.Errorf("failed to read file: %w", err)
	}

	// Extract and verify signature structure
	sigData, err := extractSignatureData(data)
	if err != nil {
		return fmt.Errorf("failed to extract signature: %w", err)
	}

	if len(sigData) < 8 {
		return fmt.Errorf("invalid signature data")
	}

	// Check SuperBlob magic
	magic := binary.BigEndian.Uint32(sigData[0:4])
	if magic != CSMAGIC_EMBEDDED_SIGNATURE {
		return fmt.Errorf("invalid signature magic: 0x%x", magic)
	}

	// Verify CodeDirectory exists
	if !hasCodeDirectory(sigData) {
		return fmt.Errorf("CodeDirectory not found in signature")
	}

	return nil
}

func hasCodeDirectory(superBlob []byte) bool {
	if len(superBlob) < 12 {
		return false
	}

	count := binary.BigEndian.Uint32(superBlob[8:12])
	offset := uint32(12)

	for i := uint32(0); i < count; i++ {
		if offset+8 > uint32(len(superBlob)) {
			break
		}

		slotType := binary.BigEndian.Uint32(superBlob[offset : offset+4])
		if slotType == CSSLOT_CODEDIRECTORY || slotType == 0x1000 {
			return true
		}

		offset += 8
	}

	return false
}

// InstallIPA installs an IPA file to a connected device using ideviceinstaller
func InstallIPA(ipaPath string) error {
	// On Windows, we need to call ideviceinstaller.exe
	// This requires libimobiledevice to be installed

	// Check if ideviceinstaller is available
	_, err := os.Stat("ideviceinstaller.exe")
	if err != nil {
		// Try system PATH
		return fmt.Errorf("ideviceinstaller not found. Please install libimobiledevice tools")
	}

	// For now, just return a message
	// Full implementation would call: ideviceinstaller -i <ipa_path>
	return fmt.Errorf("Installation requires libimobiledevice tools. Please use: ideviceinstaller -i %s", ipaPath)
}

func extractSignatureData(data []byte) ([]byte, error) {
	if len(data) < 28 {
		return nil, fmt.Errorf("file too small")
	}

	magic := binary.LittleEndian.Uint32(data[0:4])
	var isFat bool
	var offset uint32

	switch magic {
	case MH_MAGIC, MH_CIGAM, MH_MAGIC_64, MH_CIGAM_64:
		isFat = false
		offset = 0
	case FAT_MAGIC, FAT_CIGAM, FAT_MAGIC_64, FAT_CIGAM_64:
		isFat = true
		if len(data) < 28 {
			return nil, fmt.Errorf("FAT binary too small")
		}
		nfat := binary.BigEndian.Uint32(data[4:8])
		if nfat > 0 {
			offset = binary.BigEndian.Uint32(data[8:12])
		}
	default:
		return nil, fmt.Errorf("not a Mach-O file")
	}

	// Find LC_CODE_SIGNATURE
	headerOffset := offset
	if isFat && uint32(len(data)) <= headerOffset+28 {
		return nil, fmt.Errorf("invalid offset")
	}

	headerMagic := binary.LittleEndian.Uint32(data[headerOffset : headerOffset+4])
	var ncmds uint32
	var cmdOffset uint32

	switch headerMagic {
	case MH_MAGIC, MH_CIGAM:
		ncmds = binary.LittleEndian.Uint32(data[headerOffset+16 : headerOffset+20])
		cmdOffset = headerOffset + 28
	case MH_MAGIC_64, MH_CIGAM_64:
		ncmds = binary.LittleEndian.Uint32(data[headerOffset+16 : headerOffset+20])
		cmdOffset = headerOffset + 32
	default:
		return nil, fmt.Errorf("invalid Mach-O header")
	}

	// Search for LC_CODE_SIGNATURE command
	for i := uint32(0); i < ncmds; i++ {
		if cmdOffset+8 > uint32(len(data)) {
			break
		}

		cmd := binary.LittleEndian.Uint32(data[cmdOffset : cmdOffset+4])
		cmdsize := binary.LittleEndian.Uint32(data[cmdOffset+4 : cmdOffset+8])

		if cmd == 0x1d { // LC_CODE_SIGNATURE
			if cmdOffset+16 > uint32(len(data)) {
				return nil, fmt.Errorf("invalid LC_CODE_SIGNATURE command")
			}

			dataoff := binary.LittleEndian.Uint32(data[cmdOffset+8 : cmdOffset+12])
			datasize := binary.LittleEndian.Uint32(data[cmdOffset+12 : cmdOffset+16])

			if dataoff+datasize > uint32(len(data)) {
				return nil, fmt.Errorf("code signature extends beyond file")
			}

			return data[dataoff : dataoff+datasize], nil
		}

		cmdOffset += cmdsize
	}

	return nil, fmt.Errorf("no code signature found")
}
