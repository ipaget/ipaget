package ipa

import (
	"archive/zip"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ipaget-service/internal/logger"
	"ipaget-service/internal/models"
	"ipaget-service/internal/sign"
)

const (
	LC_LOAD_DYLIB      = 0x0c
	LC_LOAD_WEAK_DYLIB = 0x18
)

// ExtractDylibsFromIPA extracts dylib information from the main executable in an IPA
func ExtractDylibsFromIPA(ipaPath string) ([]*models.DylibItem, error) {
	zipReader, err := zip.OpenReader(ipaPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open IPA file: %w", err)
	}
	defer zipReader.Close()

	// Find the main executable
	var execFile *zip.File
	var appDir string

	for _, file := range zipReader.File {
		normalizedName := normalizeZipPath(file.Name)
		// Find .app directory
		if strings.Contains(normalizedName, "Payload/") && strings.HasSuffix(normalizedName, ".app/") {
			appDir = extractAppDirFromZipPath(file.Name)
		}
	}

	if appDir == "" {
		return nil, fmt.Errorf("failed to find .app directory in IPA")
	}

	// Read Info.plist to get executable name
	var executableName string
	for _, file := range zipReader.File {
		if zipPathsEqual(file.Name, appDir+"Info.plist") {
			rc, err := file.Open()
			if err != nil {
				logger.Warn().Err(err).Msg("Failed to open Info.plist")
				break
			}
			defer rc.Close()

			// Parse plist to get CFBundleExecutable
			// For simplicity, we'll try to find the executable by checking all files
			break
		}
	}

	// Find executable file (usually the file without extension in .app root)
	for _, file := range zipReader.File {
		normalizedName := normalizeZipPath(file.Name)
		if strings.HasPrefix(normalizedName, appDir) && !file.FileInfo().IsDir() {
			relPath := strings.TrimPrefix(normalizedName, appDir)
			// Check if it's in the root of .app and has no extension
			if !strings.Contains(relPath, "/") && !strings.Contains(relPath, ".") {
				execFile = file
				executableName = relPath
				logger.Debug().Str("executable", relPath).Msg("Found main executable")
				break
			}
		}
	}

	if execFile == nil {
		return nil, fmt.Errorf("failed to find main executable in IPA")
	}

	// Extract executable to temp file
	tempDir := os.TempDir()
	tempExecPath := filepath.Join(tempDir, "temp_exec_"+executableName)
	defer os.Remove(tempExecPath)

	rc, err := execFile.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to open executable: %w", err)
	}
	defer rc.Close()

	tempFile, err := os.Create(tempExecPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create temp file: %w", err)
	}
	defer tempFile.Close()

	_, err = tempFile.ReadFrom(rc)
	if err != nil {
		return nil, fmt.Errorf("failed to write temp file: %w", err)
	}

	// Parse Mach-O and extract dylibs
	dylibs, err := extractDylibsFromMachO(tempExecPath)
	if err != nil {
		return nil, fmt.Errorf("failed to extract dylibs from Mach-O: %w", err)
	}

	logger.Info().Int("dylib_count", len(dylibs)).Msg("Extracted dylibs from IPA")
	return dylibs, nil
}

// extractDylibsFromMachO reads dylib load commands from a Mach-O binary
func extractDylibsFromMachO(filePath string) ([]*models.DylibItem, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	if len(data) < 4 {
		return nil, fmt.Errorf("file too small to be a Mach-O binary")
	}

	magic := binary.LittleEndian.Uint32(data[0:4])

	// Check if it's a FAT binary
	switch magic {
	case sign.FAT_MAGIC, sign.FAT_CIGAM, sign.FAT_MAGIC_64, sign.FAT_CIGAM_64:
		// For FAT binary, parse the first architecture (usually arm64)
		return extractDylibsFromFatBinary(data)
	case sign.MH_MAGIC, sign.MH_CIGAM, sign.MH_MAGIC_64, sign.MH_CIGAM_64:
		return extractDylibsFromSingleArch(data, 0)
	default:
		return nil, fmt.Errorf("not a valid Mach-O binary: magic=%x", magic)
	}
}

func extractDylibsFromFatBinary(data []byte) ([]*models.DylibItem, error) {
	if len(data) < 8 {
		return nil, fmt.Errorf("invalid FAT header")
	}

	nfatArch := binary.BigEndian.Uint32(data[4:8])
	if nfatArch == 0 {
		return nil, fmt.Errorf("no architectures in FAT binary")
	}

	// Read first architecture
	if len(data) < 8+20 {
		return nil, fmt.Errorf("invalid FAT architecture table")
	}

	offset := binary.BigEndian.Uint32(data[8+8 : 8+12])
	return extractDylibsFromSingleArch(data, uint64(offset))
}

func extractDylibsFromSingleArch(data []byte, offset uint64) ([]*models.DylibItem, error) {
	if uint64(len(data)) < offset+28 {
		return nil, fmt.Errorf("invalid Mach-O header")
	}

	headerOffset := offset
	magic := binary.LittleEndian.Uint32(data[headerOffset : headerOffset+4])

	var headerSize uint64
	switch magic {
	case sign.MH_MAGIC, sign.MH_CIGAM:
		headerSize = 28
	case sign.MH_MAGIC_64, sign.MH_CIGAM_64:
		headerSize = 32
	default:
		return nil, fmt.Errorf("invalid Mach-O magic: 0x%x", magic)
	}

	if uint64(len(data)) < headerOffset+headerSize {
		return nil, fmt.Errorf("invalid header size")
	}

	ncmds := binary.LittleEndian.Uint32(data[headerOffset+16 : headerOffset+20])

	var dylibs []*models.DylibItem
	cmdOffset := headerOffset + headerSize

	for i := uint32(0); i < ncmds; i++ {
		if uint64(len(data)) < cmdOffset+8 {
			break
		}

		cmd := binary.LittleEndian.Uint32(data[cmdOffset : cmdOffset+4])
		cmdsize := binary.LittleEndian.Uint32(data[cmdOffset+4 : cmdOffset+8])

		if cmd == LC_LOAD_DYLIB || cmd == LC_LOAD_WEAK_DYLIB {
			if uint64(len(data)) >= cmdOffset+24 {
				nameOffset := binary.LittleEndian.Uint32(data[cmdOffset+8 : cmdOffset+12])
				dylibNamePos := cmdOffset + uint64(nameOffset)

				if dylibNamePos < uint64(len(data)) {
					endPos := dylibNamePos
					for endPos < uint64(len(data)) && data[endPos] != 0 {
						endPos++
					}

					dylibPath := string(data[dylibNamePos:endPos])

					// Extract filename from path
					dylibName := filepath.Base(dylibPath)

					// Determine if it's a system dylib
					isSystem := isSystemDylib(dylibPath)

					dylibs = append(dylibs, &models.DylibItem{
						Name:       dylibName,
						Path:       dylibPath,
						Enabled:    true,
						IsSystem:   isSystem,
						IsInjected: false, // Will be set during signing if it's injected
					})
				}
			}
		}

		cmdOffset += uint64(cmdsize)
	}

	return dylibs, nil
}

// isSystemDylib checks if a dylib path is a system dylib
func isSystemDylib(path string) bool {
	systemPrefixes := []string{
		"/usr/lib/",
		"/System/Library/",
		"/System/iOSSupport/",
	}

	for _, prefix := range systemPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}

	return false
}
