package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"ipaget-service/internal/logger"
	"ipaget-service/internal/sign"
)

func usage() {
	fmt.Println("Usage: ipasign [-options] [-k privkey.pem] [-m dev.prov] [-o output.ipa] file|folder")
	fmt.Println("options:")
	fmt.Println("-k, --pkey\t\tPath to private key or p12 file. (PEM or DER format)")
	fmt.Println("-m, --prov\t\tPath to mobile provisioning profile.")
	fmt.Println("-c, --cert\t\tPath to certificate file. (PEM or DER format)")
	fmt.Println("-a, --adhoc\t\tPerform ad-hoc signature only.")
	fmt.Println("-d, --debug\t\tGenerate debug output files. (.ipasign_debug folder)")
	fmt.Println("-f, --force\t\tForce sign without cache when signing folder.")
	fmt.Println("-o, --output\t\tPath to output ipa file.")
	fmt.Println("-p, --password\t\tPassword for private key or p12 file.")
	fmt.Println("-b, --bundle_id\t\tNew bundle id to change.")
	fmt.Println("-n, --bundle_name\tNew bundle name to change.")
	fmt.Println("-r, --bundle_version\tNew bundle version to change.")
	fmt.Println("-e, --entitlements\tNew entitlements to change.")
	fmt.Println("-z, --zip_level\t\tCompressed level when output the ipa file. (0-9)")
	fmt.Println("-l, --dylib\t\tPath to inject dylib file.")
	fmt.Println("-w, --weak\t\tInject dylib as LC_LOAD_WEAK_DYLIB.")
	fmt.Println("-i, --install\t\tInstall ipa file using ideviceinstaller command for test.")
	fmt.Println("-t, --temp_folder\tPath to temporary folder for intermediate files.")
	fmt.Println("-2, --sha256_only\tSerialize a single code directory that uses SHA256.")
	fmt.Println("-C, --check\t\tCheck if the file is signed.")
	fmt.Println("-q, --quiet\t\tQuiet operation.")
	fmt.Println("-v, --version\t\tShows version.")
	fmt.Println("-h, --help\t\tShows help (this message).")
}

func main() {
	var (
		pkeyFile      string
		provFile      string
		certFile      string
		outputFile    string
		password      string
		bundleID      string
		bundleName    string
		bundleVersion string
		entitlements  string
		dylibFile     string
		tempFolder    string
		zipLevel      int
		adhoc         bool
		debug         bool
		force         bool
		weak          bool
		install       bool
		sha256Only    bool
		check         bool
		quiet         bool
		showHelp      bool
	)

	flag.StringVar(&pkeyFile, "k", "", "")
	flag.StringVar(&pkeyFile, "pkey", "", "")
	flag.StringVar(&provFile, "m", "", "")
	flag.StringVar(&provFile, "prov", "", "")
	flag.StringVar(&certFile, "c", "", "")
	flag.StringVar(&certFile, "cert", "", "")
	flag.StringVar(&outputFile, "o", "", "")
	flag.StringVar(&outputFile, "output", "", "")
	flag.StringVar(&password, "p", "", "")
	flag.StringVar(&password, "password", "", "")
	flag.StringVar(&bundleID, "b", "", "")
	flag.StringVar(&bundleID, "bundle_id", "", "")
	flag.StringVar(&bundleName, "n", "", "")
	flag.StringVar(&bundleName, "bundle_name", "", "")
	flag.StringVar(&bundleVersion, "r", "", "")
	flag.StringVar(&bundleVersion, "bundle_version", "", "")
	flag.StringVar(&entitlements, "e", "", "")
	flag.StringVar(&entitlements, "entitlements", "", "")
	flag.StringVar(&dylibFile, "l", "", "")
	flag.StringVar(&dylibFile, "dylib", "", "")
	flag.IntVar(&zipLevel, "z", 0, "")
	flag.IntVar(&zipLevel, "zip_level", 0, "")
	flag.BoolVar(&adhoc, "a", false, "")
	flag.BoolVar(&adhoc, "adhoc", false, "")
	flag.BoolVar(&debug, "d", false, "")
	flag.BoolVar(&debug, "debug", false, "")
	flag.BoolVar(&force, "f", false, "")
	flag.BoolVar(&force, "force", false, "")
	flag.BoolVar(&weak, "w", false, "")
	flag.BoolVar(&weak, "weak", false, "")
	flag.BoolVar(&install, "i", false, "")
	flag.BoolVar(&install, "install", false, "")
	flag.StringVar(&tempFolder, "t", "", "")
	flag.StringVar(&tempFolder, "temp_folder", "", "")
	flag.BoolVar(&sha256Only, "2", false, "")
	flag.BoolVar(&sha256Only, "sha256_only", false, "")
	flag.BoolVar(&check, "C", false, "")
	flag.BoolVar(&check, "check", false, "")
	flag.BoolVar(&quiet, "q", false, "")
	flag.BoolVar(&quiet, "quiet", false, "")
	flag.BoolVar(&showHelp, "h", false, "")
	flag.BoolVar(&showHelp, "help", false, "")

	flag.Usage = usage
	flag.Parse()

	if showHelp {
		usage()
		return
	}

	if flag.NArg() < 1 {
		usage()
		os.Exit(1)
	}

	inputPath := flag.Arg(0)

	// Handle -C, --check flag first
	if check {
		if !fileExists(inputPath) {
			logger.Error().Msgf("Invalid path! %s", inputPath)
			os.Exit(1)
		}
		if err := sign.CheckSignature(inputPath); err != nil {
			logger.Error().Msgf("Check failed: %v", err)
			os.Exit(2)
		}
		logger.Info().Msg("Signature is valid!")
		return
	}

	if !fileExists(inputPath) {
		logger.Error().Msgf("Invalid path! %s", inputPath)
		os.Exit(1)
	}

	if zipLevel < 0 || zipLevel > 9 {
		logger.Error().Msg("Invalid zip level! Please input 0 - 9.")
		os.Exit(1)
	}

	isZipFile := filepath.Ext(inputPath) == ".ipa"
	isFolder := isDirectory(inputPath)

	if !isZipFile && !isFolder {
		logger.Error().Msg("Only IPA files and folders are supported in this version.")
		logger.Error().Msg("For single Mach-O file signing, please extract from IPA first.")
		os.Exit(1)
	}

	if isZipFile && outputFile == "" {
		logger.Error().Msg("Use -o option to specify the output file.")
		os.Exit(1)
	}

	if debug {
		debugFolder := "./.ipasign_debug"
		if err := os.MkdirAll(debugFolder, 0755); err != nil {
			logger.Error().Msgf("Failed to create debug folder: %v", err)
			os.Exit(1)
		}
		logger.Info().Msgf("Debug mode enabled, output folder: %s", debugFolder)
	}

	// Initialize logger
	logger.Init(debug, quiet)

	startTime := time.Now()

	var dylibFiles []string
	if dylibFile != "" {
		dylibFiles = append(dylibFiles, dylibFile)
	}

	tempDir := tempFolder
	if tempDir == "" {
		tempDir = os.TempDir()
	}

	options := sign.SignerOptions{
		InputPath:        inputPath,
		OutputPath:       outputFile,
		P12File:          pkeyFile,
		P12Password:      password,
		ProvisionFile:    provFile,
		NewBundleID:      bundleID,
		NewBundleName:    bundleName,
		NewBundleVersion: bundleVersion,
		EntitlementsFile: entitlements,
		DylibFiles:       dylibFiles,
		TempFolder:       tempDir,
		ZipLevel:         zipLevel,
		Force:            force,
		WeakInject:       weak,
		SHA256Only:       sha256Only,
		Debug:            debug,
		DebugFolder:      "./.ipasign_debug",
	}

	if err := sign.SignIPA(options); err != nil {
		logger.Error().Msgf("Failed: %v", err)
		os.Exit(1)
	}

	elapsed := time.Since(startTime)
	logger.Info().Msgf("Done. (%.3fs, %dus)", elapsed.Seconds(), elapsed.Microseconds())

	// Handle -i, --install flag
	if install && outputFile != "" {
		logger.Info().Msgf("Installing: %s", outputFile)
		if err := sign.InstallIPA(outputFile); err != nil {
			logger.Error().Msgf("Install failed: %v", err)
			os.Exit(1)
		}
		logger.Info().Msg("Installed OK!")
	}
}

func getSignModeString(adhoc bool, pkeyFile string) string {
	if adhoc || pkeyFile == "" {
		return "(Ad-hoc)"
	}
	return ""
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func isDirectory(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.IsDir()
}
