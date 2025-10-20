package sign

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

func TestExtractPlistFromMobileprovision(t *testing.T) {
	tests := []struct {
		name    string
		data    []byte
		wantErr bool
	}{
		{
			name: "valid xml content",
			data: []byte(`some binary data<?xml version="1.0"?>
<!DOCTYPE plist>
<plist version="1.0">
<dict>
<key>test</key>
<string>value</string>
</dict>
</plist>
more binary data`),
			wantErr: false,
		},
		{
			name:    "no xml content",
			data:    []byte("no xml here"),
			wantErr: true,
		},
		{
			name:    "xml without plist end",
			data:    []byte("<?xml version='1.0'?><dict>"),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := extractPlistFromMobileprovision(tt.data)
			if (err != nil) != tt.wantErr {
				t.Errorf("extractPlistFromMobileprovision() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && len(result) == 0 {
				t.Error("extractPlistFromMobileprovision() returned empty string")
			}
		})
	}
}

func TestDEREncoding(t *testing.T) {
	tests := []struct {
		name    string
		input   interface{}
		wantErr bool
	}{
		{
			name:    "encode boolean true",
			input:   true,
			wantErr: false,
		},
		{
			name:    "encode boolean false",
			input:   false,
			wantErr: false,
		},
		{
			name:    "encode integer",
			input:   42,
			wantErr: false,
		},
		{
			name:    "encode string",
			input:   "test string",
			wantErr: false,
		},
		{
			name:    "encode array",
			input:   []interface{}{"item1", "item2"},
			wantErr: false,
		},
		{
			name: "encode dict",
			input: map[string]interface{}{
				"key1": "value1",
				"key2": 123,
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := EncodeDER(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("EncodeDER() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && len(result) == 0 {
				t.Error("EncodeDER() returned empty result")
			}
		})
	}
}

func TestBuildRequirementsBlob(t *testing.T) {
	tests := []struct {
		name     string
		bundleID string
		teamID   string
		wantLen  int
	}{
		{
			name:     "empty bundle id (adhoc)",
			bundleID: "",
			teamID:   "",
			wantLen:  12,
		},
		{
			name:     "with bundle id and team id",
			bundleID: "com.example.app",
			teamID:   "ABCDE12345",
			wantLen:  96,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := BuildRequirementsBlob(tt.bundleID, tt.teamID)
			if len(result) < tt.wantLen {
				t.Errorf("BuildRequirementsBlob() length = %d, want >= %d", len(result), tt.wantLen)
			}
		})
	}
}

func TestBuildCodeDirectory(t *testing.T) {
	execData := make([]byte, 8192)
	for i := range execData {
		execData[i] = byte(i % 256)
	}

	bundleID := "com.test.app"
	teamID := "TEST123456"

	emptyEntitlements, _ := BuildEntitlementsBlob(make(map[string]interface{}))

	cd1, err := BuildCodeDirectory(
		CS_HASHTYPE_SHA1,
		bundleID,
		teamID,
		execData,
		make([]byte, 20),
		make([]byte, 20),
		make([]byte, 20),
		make([]byte, 20),
		make([]byte, 20),
		false,
		true,
		emptyEntitlements,
	)

	if err != nil {
		t.Fatalf("BuildCodeDirectory() SHA1 failed: %v", err)
	}

	if len(cd1) == 0 {
		t.Error("BuildCodeDirectory() SHA1 returned empty result")
	}

	cd256, err := BuildCodeDirectory(
		CS_HASHTYPE_SHA256,
		bundleID,
		teamID,
		execData,
		make([]byte, 32),
		make([]byte, 32),
		make([]byte, 32),
		make([]byte, 32),
		make([]byte, 32),
		false,
		true,
		emptyEntitlements,
	)

	if err != nil {
		t.Fatalf("BuildCodeDirectory() SHA256 failed: %v", err)
	}

	if len(cd256) == 0 {
		t.Error("BuildCodeDirectory() SHA256 returned empty result")
	}

	if len(cd256) <= len(cd1) {
		t.Error("SHA256 code directory should be larger than SHA1")
	}
}

func TestBuildSuperBlob(t *testing.T) {
	slots := map[uint32][]byte{
		CSSLOT_CODEDIRECTORY: make([]byte, 100),
		CSSLOT_REQUIREMENTS:  make([]byte, 50),
		CSSLOT_ENTITLEMENTS:  make([]byte, 200),
	}

	result := BuildSuperBlob(slots)

	if len(result) < 12 {
		t.Error("BuildSuperBlob() result too small")
	}

	expectedSize := 12 + 8*len(slots) + 100 + 50 + 200
	if len(result) != expectedSize {
		t.Errorf("BuildSuperBlob() size = %d, want %d", len(result), expectedSize)
	}
}

func TestUtilityFunctions(t *testing.T) {
	t.Run("uint32ToBytes", func(t *testing.T) {
		val := uint32(0x12345678)
		bytes := uint32ToBytes(val)
		if len(bytes) != 4 {
			t.Errorf("uint32ToBytes() length = %d, want 4", len(bytes))
		}
		result := bytesToUint32(bytes)
		if result != val {
			t.Errorf("bytesToUint32() = %x, want %x", result, val)
		}
	})

	t.Run("uint64ToBytes", func(t *testing.T) {
		val := uint64(0x123456789ABCDEF0)
		bytes := uint64ToBytes(val)
		if len(bytes) != 8 {
			t.Errorf("uint64ToBytes() length = %d, want 8", len(bytes))
		}
		result := bytesToUint64(bytes)
		if result != val {
			t.Errorf("bytesToUint64() = %x, want %x", result, val)
		}
	})

	t.Run("padTo", func(t *testing.T) {
		data := []byte{1, 2, 3}
		padded := padTo(data, 4)
		if len(padded) != 4 {
			t.Errorf("padTo() length = %d, want 4", len(padded))
		}

		data2 := []byte{1, 2, 3, 4}
		padded2 := padTo(data2, 4)
		if len(padded2) != 4 {
			t.Errorf("padTo() length = %d, want 4 (already aligned)", len(padded2))
		}
	})
}

func TestFindCodeSignatureOffset(t *testing.T) {
	data := make([]byte, 1000)

	binary.LittleEndian.PutUint32(data[0:4], MH_MAGIC_64)
	binary.LittleEndian.PutUint32(data[16:20], 1)
	binary.LittleEndian.PutUint32(data[32:36], LC_CODE_SIGNATURE)
	binary.LittleEndian.PutUint32(data[36:40], 16)
	binary.LittleEndian.PutUint32(data[40:44], 500)
	binary.LittleEndian.PutUint32(data[44:48], 100)

	offset, size, err := FindCodeSignatureOffset(data, 0)
	if err != nil {
		t.Fatalf("FindCodeSignatureOffset() error = %v", err)
	}

	if offset != 500 || size != 100 {
		t.Errorf("FindCodeSignatureOffset() = (%d, %d), want (500, 100)", offset, size)
	}
}

func TestCreateAndExtractZip(t *testing.T) {
	tmpDir := t.TempDir()

	testDir := filepath.Join(tmpDir, "test")
	os.MkdirAll(testDir, 0755)

	testFile := filepath.Join(testDir, "test.txt")
	testContent := []byte("test content")
	err := os.WriteFile(testFile, testContent, 0644)
	if err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	zipPath := filepath.Join(tmpDir, "test.zip")
	err = createZip(zipPath, testDir)
	if err != nil {
		t.Fatalf("createZip() error = %v", err)
	}

	if _, err := os.Stat(zipPath); os.IsNotExist(err) {
		t.Error("ZIP file was not created")
	}

	extractDir := filepath.Join(tmpDir, "extracted")
	err = extractZip(zipPath, extractDir)
	if err != nil {
		t.Fatalf("extractZip() error = %v", err)
	}

	extractedFile := filepath.Join(extractDir, "test", "test.txt")
	content, err := os.ReadFile(extractedFile)
	if err != nil {
		t.Fatalf("Failed to read extracted file: %v", err)
	}

	if string(content) != string(testContent) {
		t.Errorf("Extracted content = %q, want %q", content, testContent)
	}
}

func TestBuildEntitlementsBlob(t *testing.T) {
	entitlements := map[string]interface{}{
		"application-identifier": "TEAM123456.com.example.app",
		"get-task-allow":         true,
		"keychain-access-groups": []interface{}{
			"TEAM123456.*",
		},
	}

	blob, err := BuildEntitlementsBlob(entitlements)
	if err != nil {
		t.Fatalf("BuildEntitlementsBlob() error = %v", err)
	}

	if len(blob) < 8 {
		t.Error("BuildEntitlementsBlob() result too small")
	}

	magic := binary.BigEndian.Uint32(blob[0:4])
	if magic != CSMAGIC_EMBEDDED_ENTITLEMENTS {
		t.Errorf("BuildEntitlementsBlob() magic = %x, want %x", magic, CSMAGIC_EMBEDDED_ENTITLEMENTS)
	}
}

func TestBuildDEREntitlementsBlob(t *testing.T) {
	entitlements := map[string]interface{}{
		"application-identifier": "TEAM123456.com.example.app",
		"get-task-allow":         true,
	}

	blob, err := BuildDEREntitlementsBlob(entitlements)
	if err != nil {
		t.Fatalf("BuildDEREntitlementsBlob() error = %v", err)
	}

	if len(blob) < 8 {
		t.Error("BuildDEREntitlementsBlob() result too small")
	}

	magic := binary.BigEndian.Uint32(blob[0:4])
	if magic != CSMAGIC_EMBEDDED_DER_ENTITLEMENTS {
		t.Errorf("BuildDEREntitlementsBlob() magic = %x, want %x", magic, CSMAGIC_EMBEDDED_DER_ENTITLEMENTS)
	}
}
