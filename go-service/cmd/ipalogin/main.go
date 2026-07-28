package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"ipaget-service/internal/logger"
	"ipaget-service/internal/store"

	"golang.org/x/term"
)

func usage() {
	fmt.Println("Usage: ipalogin [options]")
	fmt.Println("options:")
	fmt.Println("-e, --email\t\tApple ID email (required)")
	fmt.Println("-p, --password\t\tApple ID password")
	fmt.Println("-2, --2fa\t\tTwo-factor authentication code")
	fmt.Println("-c, --config\t\tConfig directory for storing credentials")
	fmt.Println("-g, --gsa\t\tUse GSA authentication (default: true)")
	fmt.Println("    --use-ipatool\tUse ipatool authentication (disable GSA)")
	fmt.Println("-d, --debug\t\tEnable debug logging")
	fmt.Println("-q, --quiet\t\tQuiet mode")
	fmt.Println("-h, --help\t\tShow this help message")
}

func main() {
	var (
		email      string
		password   string
		authCode   string
		configDir  string
		useGSA     bool
		useIpatool bool
		debug      bool
		quiet      bool
		showHelp   bool
	)

	flag.StringVar(&email, "e", "", "")
	flag.StringVar(&email, "email", "", "")
	flag.StringVar(&password, "p", "", "")
	flag.StringVar(&password, "password", "", "")
	flag.StringVar(&authCode, "2", "", "")
	flag.StringVar(&authCode, "2fa", "", "")
	flag.StringVar(&configDir, "c", "", "")
	flag.StringVar(&configDir, "config", "", "")
	flag.BoolVar(&useGSA, "g", true, "")
	flag.BoolVar(&useGSA, "gsa", true, "")
	flag.BoolVar(&useIpatool, "use-ipatool", false, "")
	flag.BoolVar(&debug, "d", false, "")
	flag.BoolVar(&debug, "debug", false, "")
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

	if email == "" {
		usage()
		os.Exit(1)
	}

	// If --use-ipatool is specified, disable GSA
	if useIpatool {
		useGSA = false
	}

	// Initialize logger - always use pretty output for CLI tool
	logger.Init(true, quiet)

	// Get password if not provided
	if password == "" {
		fmt.Print("Enter password: ")
		passBytes, err := term.ReadPassword(int(os.Stdin.Fd()))
		if err != nil {
			logger.Error().Msgf("Failed to read password: %v", err)
			os.Exit(1)
		}
		fmt.Println()
		password = string(passBytes)
	}

	// Determine config directory
	var cfgDir string
	if configDir != "" {
		cfgDir = configDir
	} else {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			logger.Error().Msgf("Failed to get home directory: %v", err)
			os.Exit(1)
		}
		cfgDir = filepath.Join(homeDir, ".ipaget-test")
	}

	logger.Info().Msgf("Config directory: %s", cfgDir)
	logger.Info().Msgf("Email: %s", email)
	logger.Info().Msgf("Using GSA: %v", useGSA)

	// Create store service
	logger.Info().Msg("Initializing store service...")
	storeService := store.NewService(cfgDir, nil)

	// Perform login
	if useGSA {
		loginWithGSA(storeService, email, password, authCode)
	} else {
		loginWithIpatool(storeService, email, password, authCode)
	}
}

func loginWithGSA(storeService *store.Service, email, password, authCode string) {
	logger.Info().Msg("Starting GSA authentication...")

	resp, err := storeService.LoginWithGSA(email, password, "")
	if err != nil {
		logger.Error().Msgf("GSA authentication failed: %v", err)
		os.Exit(1)
	}

	// Check if 2FA is required
	if resp.Requires2FA {
		logger.Info().Msg("Two-factor authentication required")

		var code string
		if authCode != "" {
			code = authCode
		} else {
			fmt.Print("Enter 2FA code: ")
			reader := bufio.NewReader(os.Stdin)
			code, err = reader.ReadString('\n')
			if err != nil {
				logger.Error().Msgf("Failed to read 2FA code: %v", err)
				os.Exit(1)
			}
			code = strings.TrimSpace(code)
		}

		logger.Info().Msg("Verifying 2FA code...")
		resp, err = storeService.Verify2FA(email, password, code)
		if err != nil {
			logger.Error().Msgf("2FA verification failed: %v", err)
			os.Exit(1)
		}
	}

	if !resp.Success {
		logger.Error().Msgf("Login failed: %s", resp.Message)
		os.Exit(1)
	}

	logger.Info().Msg("Login successful!")

	// Get account info
	accountInfo, err := storeService.GetAccountInfo(email)
	if err != nil {
		logger.Warn().Msgf("Failed to get account info: %v", err)
	} else {
		logger.Info().Msgf("Email: %s", accountInfo.Email)
		logger.Info().Msgf("Name: %s", accountInfo.Name)
		logger.Info().Msgf("Storefront: %s", accountInfo.StoreFront)

		countryCode, err := storeService.GetCountryCode(email)
		if err == nil {
			logger.Info().Msgf("Country: %s", countryCode)
		}
	}

	logger.Info().Msg("GSA authentication completed!")
}

func loginWithIpatool(storeService *store.Service, email, password, authCode string) {
	logger.Info().Msg("Starting ipatool authentication...")

	resp, err := storeService.Login(email, password)
	if err != nil {
		logger.Error().Msgf("Login failed: %v", err)
		os.Exit(1)
	}

	// Check if 2FA is required
	if resp.Requires2FA {
		logger.Info().Msg("Two-factor authentication required")

		var code string
		if authCode != "" {
			code = authCode
		} else {
			fmt.Print("Enter 2FA code: ")
			reader := bufio.NewReader(os.Stdin)
			code, err = reader.ReadString('\n')
			if err != nil {
				logger.Error().Msgf("Failed to read 2FA code: %v", err)
				os.Exit(1)
			}
			code = strings.TrimSpace(code)
		}

		logger.Info().Msg("Verifying 2FA code...")
		resp, err = storeService.Verify2FA(email, password, code)
		if err != nil {
			logger.Error().Msgf("2FA verification failed: %v", err)
			os.Exit(1)
		}
	}

	if !resp.Success {
		logger.Error().Msgf("Login failed: %s", resp.Message)
		os.Exit(1)
	}

	logger.Info().Msg("Login successful!")

	// Get account info
	accountInfo, err := storeService.GetAccountInfo(email)
	if err != nil {
		logger.Warn().Msgf("Failed to get account info: %v", err)
	} else {
		logger.Info().Msgf("Email: %s", accountInfo.Email)
		logger.Info().Msgf("Name: %s", accountInfo.Name)
		logger.Info().Msgf("Storefront: %s", accountInfo.StoreFront)

		countryCode, err := storeService.GetCountryCode(email)
		if err == nil {
			logger.Info().Msgf("Country: %s", countryCode)
		}
	}

	logger.Info().Msg("Authentication completed!")
}
