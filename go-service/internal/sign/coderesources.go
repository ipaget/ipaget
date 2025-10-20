package sign

import (
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"howett.net/plist"
)

type CodeResources struct {
	Files  map[string]interface{} `plist:"files"`
	Files2 map[string]interface{} `plist:"files2"`
	Rules  map[string]interface{} `plist:"rules"`
	Rules2 map[string]interface{} `plist:"rules2"`
}

func GenerateCodeResources(appDir string) (string, error) {
	infoPlistPath := filepath.Join(appDir, "Info.plist")
	infoPlistData, err := os.ReadFile(infoPlistPath)
	if err != nil {
		return "", fmt.Errorf("failed to read Info.plist: %w", err)
	}

	var infoPlist map[string]interface{}
	_, err = plist.Unmarshal(infoPlistData, &infoPlist)
	if err != nil {
		return "", fmt.Errorf("failed to parse Info.plist: %w", err)
	}

	execName, ok := infoPlist["CFBundleExecutable"].(string)
	if !ok {
		return "", fmt.Errorf("CFBundleExecutable not found")
	}

	codeRes := CodeResources{
		Files:  make(map[string]interface{}),
		Files2: make(map[string]interface{}),
		Rules:  make(map[string]interface{}),
		Rules2: make(map[string]interface{}),
	}

	// Setup rules (matching zsign logic)
	codeRes.Rules["^.*"] = true
	codeRes.Rules["^.*\\.lproj/"] = map[string]interface{}{
		"optional": true,
		"weight":   float64(1000),
	}
	codeRes.Rules["^.*\\.lproj/locversion.plist$"] = map[string]interface{}{
		"omit": true,
	}
	codeRes.Rules["^Base\\.lproj/"] = map[string]interface{}{
		"weight": float64(1010),
	}
	codeRes.Rules["^version.plist$"] = true

	codeRes.Rules2["^.*"] = true
	codeRes.Rules2["^.*\\.lproj/"] = map[string]interface{}{
		"optional": true,
		"weight":   float64(1000),
	}
	codeRes.Rules2["^.*\\.lproj/locversion.plist$"] = map[string]interface{}{
		"omit":   true,
		"weight": float64(1100),
	}
	codeRes.Rules2["^Base\\.lproj/"] = map[string]interface{}{
		"weight": float64(1010),
	}
	codeRes.Rules2["^Info\\.plist$"] = map[string]interface{}{
		"omit":   true,
		"weight": float64(20),
	}
	codeRes.Rules2["^PkgInfo$"] = map[string]interface{}{
		"omit":   true,
		"weight": float64(20),
	}
	codeRes.Rules2["^embedded\\.provisionprofile$"] = map[string]interface{}{
		"weight": float64(20),
	}
	codeRes.Rules2["^version\\.plist$"] = map[string]interface{}{
		"weight": float64(20),
	}

	// Walk through all files
	err = filepath.Walk(appDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		relPath, err := filepath.Rel(appDir, path)
		if err != nil {
			return err
		}

		// Convert Windows path separators to Unix
		relPath = strings.ReplaceAll(relPath, "\\", "/")

		// Skip certain files
		if relPath == "_CodeSignature/CodeResources" {
			return nil
		}
		if relPath == execName {
			return nil
		}
		if strings.HasPrefix(relPath, "_CodeSignature/") {
			return nil
		}

		// Read file and calculate hashes
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}

		sha1Hash := sha1.Sum(data)
		sha256Hash := sha256.Sum256(data)
		_ = base64.StdEncoding.EncodeToString(sha1Hash[:])
		_ = base64.StdEncoding.EncodeToString(sha256Hash[:])

		// Check if should omit from files (rules for files)
		omit1 := false
		omit2 := false

		if strings.HasSuffix(relPath, ".lproj/locversion.plist") {
			omit1 = true
			omit2 = true
		}

		if strings.HasSuffix(relPath, ".DS_Store") || relPath == "Info.plist" || relPath == "PkgInfo" {
			omit2 = true
		}

		// Add to files
		if !omit1 {
			if strings.Contains(relPath, ".lproj/") {
				codeRes.Files[relPath] = map[string]interface{}{
					"hash":     []byte(sha1Hash[:]),
					"optional": true,
				}
			} else {
				codeRes.Files[relPath] = []byte(sha1Hash[:])
			}
		}

		// Add to files2
		if !omit2 {
			fileEntry := map[string]interface{}{
				"hash":  []byte(sha1Hash[:]),
				"hash2": []byte(sha256Hash[:]),
			}
			if strings.Contains(relPath, ".lproj/") {
				fileEntry["optional"] = true
			}
			codeRes.Files2[relPath] = fileEntry
		}

		return nil
	})

	if err != nil {
		return "", fmt.Errorf("failed to walk app directory: %w", err)
	}

	// Marshal to plist XML
	plistData, err := plist.MarshalIndent(codeRes, plist.XMLFormat, "\t")
	if err != nil {
		return "", fmt.Errorf("failed to marshal CodeResources: %w", err)
	}

	return string(plistData), nil
}

func WriteCodeResources(appDir, codeResourcesData string) error {
	codeSignDir := filepath.Join(appDir, "_CodeSignature")
	err := os.MkdirAll(codeSignDir, 0755)
	if err != nil {
		return fmt.Errorf("failed to create _CodeSignature directory: %w", err)
	}

	codeResPath := filepath.Join(codeSignDir, "CodeResources")
	err = os.WriteFile(codeResPath, []byte(codeResourcesData), 0644)
	if err != nil {
		return fmt.Errorf("failed to write CodeResources: %w", err)
	}

	return nil
}
