package plistutil

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"howett.net/plist"
)

func TestParseAndWriteRoundTripXML(t *testing.T) {
	service := NewService()
	tempDir := t.TempDir()
	inputPath := filepath.Join(tempDir, "sample.plist")

	original := map[string]interface{}{
		"Name":    "iPAGet",
		"Version": 1,
		"Enabled": true,
		"Ratio":   1.5,
		"Tags":    []interface{}{"a", "b"},
		"Nested": map[string]interface{}{
			"Created": time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC),
			"Blob":    []byte{0x01, 0x02, 0x03},
		},
	}

	encoded, err := plist.MarshalIndent(original, plist.XMLFormat, "\t")
	if err != nil {
		t.Fatalf("marshal original: %v", err)
	}
	if err := os.WriteFile(inputPath, encoded, 0644); err != nil {
		t.Fatalf("write original: %v", err)
	}

	parsed, err := service.ParseFile(inputPath)
	if err != nil {
		t.Fatalf("parse file: %v", err)
	}
	if parsed.Format != "xml" {
		t.Fatalf("expected xml format, got %s", parsed.Format)
	}

	outputPath := filepath.Join(tempDir, "output.plist")
	if err := service.WriteFile(WriteRequest{
		Path:   outputPath,
		Root:   parsed.Root,
		Format: "preserve",
	}); err != nil {
		t.Fatalf("write file: %v", err)
	}

	rewritten, err := service.ParseFile(outputPath)
	if err != nil {
		t.Fatalf("reparse written file: %v", err)
	}
	if rewritten.Format != "xml" {
		t.Fatalf("expected rewritten xml format, got %s", rewritten.Format)
	}
}

func TestParseBinaryPlist(t *testing.T) {
	service := NewService()
	tempDir := t.TempDir()
	inputPath := filepath.Join(tempDir, "binary.plist")

	original := map[string]interface{}{
		"BundleID": "wiki.qaq.demo",
		"Count":    uint64(42),
	}
	encoded, err := plist.Marshal(original, plist.BinaryFormat)
	if err != nil {
		t.Fatalf("marshal binary: %v", err)
	}
	if err := os.WriteFile(inputPath, encoded, 0644); err != nil {
		t.Fatalf("write binary: %v", err)
	}

	parsed, err := service.ParseFile(inputPath)
	if err != nil {
		t.Fatalf("parse binary: %v", err)
	}
	if parsed.Format != "binary" {
		t.Fatalf("expected binary format, got %s", parsed.Format)
	}
}
