package sign

import (
	"crypto/x509"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"go.mozilla.org/pkcs7"
	"howett.net/plist"
)

type IPAInfo struct {
	Info            *MachOInfo
	MobileProvision *ProvisioningProfile
}

type MachOInfo struct {
	IsEncrypted  bool
	CryptID      uint32
	TeamID       string
	Authority    string
	Organization string
	Certificates []*x509.Certificate
}

type EncryptionInfoCmd struct {
	Cmd       uint32
	CmdSize   uint32
	CryptOff  uint32
	CryptSize uint32
	CryptID   uint32
}

type EncryptionInfo64Cmd struct {
	Cmd       uint32
	CmdSize   uint32
	CryptOff  uint32
	CryptSize uint32
	CryptID   uint32
	Pad       uint32
}

func GetIPAInfo(ipaPath string) (*IPAInfo, error) {
	tmpDir, err := os.MkdirTemp("", "ipa-info-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	workDir := filepath.Join(tmpDir, "work")
	err = extractZip(ipaPath, workDir)
	if err != nil {
		return nil, fmt.Errorf("failed to extract IPA: %w", err)
	}

	payloadDir := filepath.Join(workDir, "Payload")
	appDir, err := locateAppFolder(payloadDir)
	if err != nil {
		return nil, fmt.Errorf("failed to locate app folder: %w", err)
	}

	// Find the main executable
	infoPlistPath := filepath.Join(appDir, "Info.plist")
	infoPlistData, err := os.ReadFile(infoPlistPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read Info.plist: %w", err)
	}

	var infoPlist map[string]interface{}
	_, err = plist.Unmarshal(infoPlistData, &infoPlist)
	if err != nil {
		return nil, fmt.Errorf("failed to parse Info.plist: %w", err)
	}

	execName, ok := infoPlist["CFBundleExecutable"].(string)
	if !ok {
		return nil, fmt.Errorf("CFBundleExecutable not found in Info.plist")
	}

	execPath := filepath.Join(appDir, execName)
	machoInfo, err := GetMachOInfo(execPath)
	if err != nil {
		return nil, fmt.Errorf("failed to get Mach-O info: %w", err)
	}

	// Parse embedded.mobileprovision if exists
	var profile *ProvisioningProfile
	// provisionPath := filepath.Join(appDir, "embedded.mobileprovision")
	// if _, err := os.Stat(provisionPath); err == nil {
	// 	// TODO: Implement mobileprovision parsing
	// }

	return &IPAInfo{
		Info:            machoInfo,
		MobileProvision: profile,
	}, nil
}

func GetMachOInfo(machoPath string) (*MachOInfo, error) {
	data, err := os.ReadFile(machoPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	if len(data) < 4 {
		return nil, fmt.Errorf("file too small")
	}

	magic := binary.LittleEndian.Uint32(data[0:4])
	var offset uint64 = 0
	var is64 bool

	// Handle FAT binary
	macho, err := ParseMachO(machoPath)
	if err != nil {
		return nil, err
	}

	if macho.IsFat {
		// Use the first architecture
		if len(macho.Architectures) > 0 {
			offset = macho.Architectures[0].Offset
			// Check if it is 64-bit
			cpuType := macho.Architectures[0].CPUType
			if cpuType == CPU_TYPE_ARM64 || cpuType == CPU_TYPE_X86_64 {
				is64 = true
			}
		}
	} else {
		// Check magic for 64-bit
		if magic == MH_MAGIC_64 || magic == MH_CIGAM_64 {
			is64 = true
		}
	}

	// Re-read magic at offset to be sure (in case of FAT)
	if uint64(len(data)) < offset+4 {
		return nil, fmt.Errorf("invalid offset")
	}
	magic = binary.LittleEndian.Uint32(data[offset : offset+4])
	if magic == MH_MAGIC_64 || magic == MH_CIGAM_64 {
		is64 = true
	}

	headerSize := uint64(28)
	if is64 {
		headerSize = 32
	}

	if uint64(len(data)) < offset+headerSize {
		return nil, fmt.Errorf("header out of bounds")
	}

	ncmds := binary.LittleEndian.Uint32(data[offset+16 : offset+20])

	cmdOffset := offset + headerSize

	info := &MachOInfo{}

	for i := uint32(0); i < ncmds; i++ {
		if uint64(len(data)) < cmdOffset+8 {
			break
		}

		cmd := binary.LittleEndian.Uint32(data[cmdOffset : cmdOffset+4])
		cmdSize := binary.LittleEndian.Uint32(data[cmdOffset+4 : cmdOffset+8])

		if cmd == LC_ENCRYPTION_INFO || cmd == LC_ENCRYPTION_INFO_64 {
			if uint64(len(data)) < cmdOffset+20 {
				continue
			}
			cryptID := binary.LittleEndian.Uint32(data[cmdOffset+16 : cmdOffset+20])
			info.CryptID = cryptID
			if cryptID != 0 {
				info.IsEncrypted = true
			}
		} else if cmd == LC_CODE_SIGNATURE {
			if uint64(len(data)) < cmdOffset+16 {
				continue
			}
			dataOff := binary.LittleEndian.Uint32(data[cmdOffset+8 : cmdOffset+12])
			dataSize := binary.LittleEndian.Uint32(data[cmdOffset+12 : cmdOffset+16])

			if uint64(dataOff)+uint64(dataSize) <= uint64(len(data)) {
				parseCodeSignature(data[dataOff:dataOff+dataSize], info)
			}
		}

		cmdOffset += uint64(cmdSize)
	}

	return info, nil
}

func parseCodeSignature(data []byte, info *MachOInfo) {
	// Parse SuperBlob
	if len(data) < 12 {
		return
	}

	// magic := binary.BigEndian.Uint32(data[0:4])
	count := binary.BigEndian.Uint32(data[8:12])

	idxOffset := uint32(12)
	for i := uint32(0); i < count; i++ {
		if uint32(len(data)) < idxOffset+8 {
			break
		}

		slotType := binary.BigEndian.Uint32(data[idxOffset : idxOffset+4])
		blobOffset := binary.BigEndian.Uint32(data[idxOffset+4 : idxOffset+8])

		if slotType == CSSLOT_SIGNATURESLOT { // 0x10000
			// Parse CMS Blob
			if uint32(len(data)) > blobOffset {
				parseCMSBlob(data[blobOffset:], info)
			}
		}

		idxOffset += 8
	}
}

func parseCMSBlob(data []byte, info *MachOInfo) {
	// BlobWrapper
	if len(data) < 8 {
		return
	}
	// magic := binary.BigEndian.Uint32(data[0:4]) // 0xfade0b01
	length := binary.BigEndian.Uint32(data[4:8])

	if uint32(len(data)) < length {
		return
	}

	cmsData := data[8:length]

	p7, err := pkcs7.Parse(cmsData)
	if err != nil {
		return
	}

	// Extract certificates
	info.Certificates = p7.Certificates

	// Try to find the leaf certificate (signer)
	// Usually the first one or the one that verifies the signature
	// For simplicity, we look for the one with "iPhone Distribution" or "iPhone Developer" or "Apple Development"

	for _, cert := range p7.Certificates {
		subject := cert.Subject.CommonName
		if strings.Contains(subject, "iPhone Distribution") ||
			strings.Contains(subject, "iPhone Developer") ||
			strings.Contains(subject, "Apple Development") ||
			strings.Contains(subject, "Apple iPhone OS Application Signing") {

			info.Authority = subject
			if len(cert.Subject.Organization) > 0 {
				info.Organization = cert.Subject.Organization[0]
			}
			if len(cert.Subject.OrganizationalUnit) > 0 {
				info.TeamID = cert.Subject.OrganizationalUnit[0]
			}
			break
		}
	}

	// If not found, just take the first one
	if info.Authority == "" && len(p7.Certificates) > 0 {
		cert := p7.Certificates[0]
		info.Authority = cert.Subject.CommonName
		if len(cert.Subject.Organization) > 0 {
			info.Organization = cert.Subject.Organization[0]
		}
		if len(cert.Subject.OrganizationalUnit) > 0 {
			info.TeamID = cert.Subject.OrganizationalUnit[0]
		}
	}
}
