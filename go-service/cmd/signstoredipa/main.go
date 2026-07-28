package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ipaget-service/internal/certifi"
	"ipaget-service/internal/ipa"
	"ipaget-service/internal/sign"
	"ipaget-service/internal/store"
)

func main() {
	var (
		configDir     string
		certificateID string
		udid          string
		deviceName    string
		inputPath     string
		outputPath    string
		bundleID      string
	)

	flag.StringVar(&configDir, "config", "", "Path to iPAGet config directory")
	flag.StringVar(&certificateID, "certificate", "", "Stored certificate ID")
	flag.StringVar(&udid, "udid", "", "Target device UDID")
	flag.StringVar(&deviceName, "device-name", "", "Target device name")
	flag.StringVar(&inputPath, "input", "", "Input IPA path")
	flag.StringVar(&outputPath, "output", "", "Output IPA path")
	flag.StringVar(&bundleID, "bundle-id", "", "Override bundle ID for signing")
	flag.Parse()

	if strings.TrimSpace(configDir) == "" || strings.TrimSpace(certificateID) == "" || strings.TrimSpace(udid) == "" || strings.TrimSpace(inputPath) == "" || strings.TrimSpace(outputPath) == "" {
		fmt.Fprintln(os.Stderr, "missing required flags: -config -certificate -udid -input -output")
		os.Exit(1)
	}

	certService, err := certifi.NewService(configDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to initialize certificate service: %v\n", err)
		os.Exit(1)
	}

	storeService := store.NewService(configDir, nil)
	ipaService := ipa.NewService()

	parsedIPA, err := ipaService.ParseIPA(inputPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to parse ipa: %v\n", err)
		os.Exit(1)
	}
	bundleID = strings.TrimSpace(bundleID)
	if bundleID == "" {
		bundleID = strings.TrimSpace(parsedIPA.BundleID)
	}
	if bundleID == "" {
		fmt.Fprintln(os.Stderr, "bundle ID is empty")
		os.Exit(1)
	}

	cert, err := certService.GetCertificate(certificateID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to get certificate: %v\n", err)
		os.Exit(1)
	}
	if cert.Type == "free_sign" {
		bundleID = certifi.DeriveFreeSignBundleID(bundleID, cert.TeamID)
	}

	var creds *store.GSACredentials
	if cert.Type == "free_sign" {
		appleID, _ := cert.RawData["apple_id"].(string)
		if strings.TrimSpace(appleID) == "" {
			fmt.Fprintln(os.Stderr, "free-sign certificate is missing apple_id metadata")
			os.Exit(1)
		}
		creds, err = storeService.GetGSACredentials(appleID)
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed to get gsa credentials: %v\n", err)
			os.Exit(1)
		}
	}

	if strings.TrimSpace(deviceName) == "" {
		deviceName = "ipaget-" + udid
	}

	assets, err := certService.PrepareSigningAssets(certificateID, bundleID, deviceName, udid, creds)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to prepare signing assets: %v\n", err)
		os.Exit(1)
	}

	tempDir, err := os.MkdirTemp("", "ipaget-signstoredipa-*")
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to create temp directory: %v\n", err)
		os.Exit(1)
	}
	defer os.RemoveAll(tempDir)

	p12Path := filepath.Join(tempDir, "cert.p12")
	if err := os.WriteFile(p12Path, assets.P12Data, 0600); err != nil {
		fmt.Fprintf(os.Stderr, "failed to write temp p12: %v\n", err)
		os.Exit(1)
	}

	provisionPath := filepath.Join(tempDir, "profile.mobileprovision")
	if err := os.WriteFile(provisionPath, assets.ProvisionData, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "failed to write temp provisioning profile: %v\n", err)
		os.Exit(1)
	}

	options := sign.SignerOptions{
		InputPath:     inputPath,
		OutputPath:    outputPath,
		P12File:       p12Path,
		P12Password:   assets.P12Password,
		ProvisionFile: provisionPath,
		NewBundleID:   bundleID,
	}

	if err := sign.SignIPA(options); err != nil {
		fmt.Fprintf(os.Stderr, "failed to sign ipa: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("signed ipa written to %s with bundle id %s\n", outputPath, bundleID)
}
