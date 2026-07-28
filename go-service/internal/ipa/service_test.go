package ipa

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testInfoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleIdentifier</key>
	<string>com.example.livecontainer</string>
	<key>CFBundleDisplayName</key>
	<string>LiveContainer</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleExecutable</key>
	<string>LiveContainer</string>
</dict>
</plist>
`

func createBackslashIPA(t *testing.T) string {
	t.Helper()

	tempDir := t.TempDir()
	ipaPath := filepath.Join(tempDir, "backslash.ipa")

	file, err := os.Create(ipaPath)
	if err != nil {
		t.Fatalf("create ipa: %v", err)
	}
	defer file.Close()

	writer := zip.NewWriter(file)

	entries := map[string]string{
		`Payload\LiveContainer.app\Info.plist`:            testInfoPlist,
		`Payload\LiveContainer.app\LiveContainer`:         "dummy-mach-o",
		`Payload\LiveContainer.app\iTunesMetadata.plist`: `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>appleId</key><string>user@example.com</string></dict></plist>`,
	}

	for name, content := range entries {
		entryWriter, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create zip entry %s: %v", name, err)
		}
		if _, err := entryWriter.Write([]byte(content)); err != nil {
			t.Fatalf("write zip entry %s: %v", name, err)
		}
	}

	if err := writer.Close(); err != nil {
		t.Fatalf("close zip writer: %v", err)
	}

	return ipaPath
}

func TestParseIPASupportsBackslashZipPaths(t *testing.T) {
	service := NewService()
	ipaPath := createBackslashIPA(t)

	info, err := service.ParseIPA(ipaPath)
	if err != nil {
		t.Fatalf("ParseIPA() error = %v", err)
	}

	if info.BundleID != "com.example.livecontainer" {
		t.Fatalf("BundleID = %q, want %q", info.BundleID, "com.example.livecontainer")
	}

	if info.Name != "LiveContainer" {
		t.Fatalf("Name = %q, want %q", info.Name, "LiveContainer")
	}

	if info.PurchaserEmail != "user@example.com" {
		t.Fatalf("PurchaserEmail = %q, want %q", info.PurchaserEmail, "user@example.com")
	}
}

func TestGetIPADetailsNormalizesBackslashPaths(t *testing.T) {
	service := NewService()
	ipaPath := createBackslashIPA(t)

	details, err := service.GetIPADetails(ipaPath, nil)
	if err != nil {
		t.Fatalf("GetIPADetails() error = %v", err)
	}

	if len(details.Files) == 0 {
		t.Fatal("GetIPADetails() returned no files")
	}

	for _, file := range details.Files {
		if strings.Contains(file.Path, `\`) {
			t.Fatalf("file path %q still contains backslashes", file.Path)
		}
	}

	if got := details.Properties["CFBundleIdentifier"]; got != "com.example.livecontainer" {
		t.Fatalf("Properties[CFBundleIdentifier] = %v, want %q", got, "com.example.livecontainer")
	}
	}

func TestExtractFileAcceptsNormalizedPathForBackslashEntry(t *testing.T) {
	service := NewService()
	ipaPath := createBackslashIPA(t)

	content, err := service.ExtractFile(ipaPath, "Payload/LiveContainer.app/Info.plist")
	if err != nil {
		t.Fatalf("ExtractFile() error = %v", err)
	}

	if !strings.Contains(content, "com.example.livecontainer") {
		t.Fatalf("ExtractFile() returned unexpected content: %q", content)
	}
}