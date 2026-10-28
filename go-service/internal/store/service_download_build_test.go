package store

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"howett.net/plist"
)

// writeTestPackage creates a minimal IPA whose iTunesMetadata carries the given
// store build identifier. A zero identifier omits the field entirely.
func writeTestPackage(t *testing.T, path string, storeVersionID uint64) {
	t.Helper()

	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	writer := zip.NewWriter(file)
	metadataFile, err := writer.Create("iTunesMetadata.plist")
	if err != nil {
		t.Fatal(err)
	}

	metadata := map[string]interface{}{"bundleShortVersionString": "1.2.3"}
	if storeVersionID > 0 {
		metadata["softwareVersionExternalIdentifier"] = storeVersionID
	}

	data, err := plist.Marshal(metadata, plist.BinaryFormat)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := metadataFile.Write(data); err != nil {
		t.Fatal(err)
	}

	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyDownloadedBuildAcceptsRequestedBuild(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.ipa")
	writeTestPackage(t, path, 812345678)

	if err := verifyDownloadedBuild(path, "812345678"); err != nil {
		t.Fatalf("the requested build should pass verification: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("a matching package must be kept: %v", err)
	}
}

func TestVerifyDownloadedBuildRejectsOtherBuild(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.ipa")
	writeTestPackage(t, path, 812345678)

	err := verifyDownloadedBuild(path, "999999999")
	if err == nil {
		t.Fatal("expected the mismatched build to be reported")
	}
	if !strings.Contains(err.Error(), "999999999") || !strings.Contains(err.Error(), "812345678") {
		t.Fatalf("the mismatch must name both builds, got %v", err)
	}
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Fatal("a mismatched package must be removed")
	}
}

func TestVerifyDownloadedBuildSkipsPackageWithoutIdentifier(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.ipa")
	writeTestPackage(t, path, 0)

	if err := verifyDownloadedBuild(path, "812345678"); err != nil {
		t.Fatalf("a package without an identifier cannot be judged: %v", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("an unverifiable package must be kept: %v", err)
	}
}

func TestVerifyDownloadedBuildSkipsUnrequestedBuild(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.ipa")
	writeTestPackage(t, path, 812345678)

	if err := verifyDownloadedBuild(path, ""); err != nil {
		t.Fatalf("an unpinned download must not be verified: %v", err)
	}
}

func TestVerifyDownloadedBuildToleratesUnreadablePackage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.ipa")
	if err := os.WriteFile(path, []byte("not a zip"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := verifyDownloadedBuild(path, "812345678"); err != nil {
		t.Fatalf("an unreadable package cannot be judged: %v", err)
	}
}
