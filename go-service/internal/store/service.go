package store

import (
	"encoding/json"
	"fmt"
	"os"

	"ipaget-service/internal/models"

	"github.com/99designs/keyring"
	"github.com/majd/ipatool/v2/pkg/appstore"
	ipatoolKeychain "github.com/majd/ipatool/v2/pkg/keychain"
	"github.com/majd/ipatool/v2/pkg/util/machine"
	"github.com/majd/ipatool/v2/pkg/util/operatingsystem"
	"github.com/schollz/progressbar/v3"
)

const (
	keychainServiceName = "ipaget-service"
	keychainAccountKey  = "account"
)

type Service struct {
	appStore  appstore.AppStore
	keychain  ipatoolKeychain.Keychain
	configDir string
}

func NewService(configDir string) *Service {
	os.MkdirAll(configDir, 0700)

	// Create keyring (following ipatool's implementation)
	kr, err := keyring.Open(keyring.Config{
		AllowedBackends: []keyring.BackendType{
			keyring.KeychainBackend,
			keyring.SecretServiceBackend,
			keyring.FileBackend,
		},
		ServiceName: keychainServiceName,
		FileDir:     configDir,
		FilePasswordFunc: func(s string) (string, error) {
			// Use fixed passphrase for non-interactive mode
			return "ipaget-keychain-passphrase", nil
		},
	})
	if err != nil {
		panic(fmt.Errorf("failed to open keyring: %w", err))
	}

	// Create keychain
	kc := ipatoolKeychain.New(ipatoolKeychain.Args{
		Keyring: kr,
	})

	// Create machine and OS
	osInstance := operatingsystem.New()
	machineInstance := machine.New(machine.Args{OS: osInstance})

	// Create AppStore client
	as := appstore.NewAppStore(appstore.Args{
		Keychain:        kc,
		OperatingSystem: osInstance,
		Machine:         machineInstance,
	})

	return &Service{
		appStore:  as,
		keychain:  kc,
		configDir: configDir,
	}
}

func (s *Service) Login(email, password string) (*models.AuthResponse, error) {
	output, err := s.appStore.Login(appstore.LoginInput{
		Email:    email,
		Password: password,
		AuthCode: "",
	})

	if err != nil {
		// Check if 2FA is required
		if err == appstore.ErrAuthCodeRequired {
			return &models.AuthResponse{
				Success:     false,
				Requires2FA: true,
				Message:     "Two-factor authentication required",
			}, nil
		}
		return nil, fmt.Errorf("login failed: %w", err)
	}

	// Save account to keychain
	accountData, err := json.Marshal(output.Account)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal account: %w", err)
	}

	err = s.keychain.Set(s.getAccountKey(email), accountData)
	if err != nil {
		return nil, fmt.Errorf("failed to save account: %w", err)
	}

	return &models.AuthResponse{
		Success: true,
		Email:   email,
		Message: "Login successful",
	}, nil
}

func (s *Service) Verify2FA(email, password, code string) (*models.AuthResponse, error) {
	output, err := s.appStore.Login(appstore.LoginInput{
		Email:    email,
		Password: password,
		AuthCode: code,
	})

	if err != nil {
		return nil, fmt.Errorf("2FA verification failed: %w", err)
	}

	// Save account to keychain
	accountData, err := json.Marshal(output.Account)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal account: %w", err)
	}

	err = s.keychain.Set(s.getAccountKey(email), accountData)
	if err != nil {
		return nil, fmt.Errorf("failed to save account: %w", err)
	}

	return &models.AuthResponse{
		Success: true,
		Email:   email,
		Message: "Authentication successful",
	}, nil
}

func (s *Service) CheckAuth(email string) (bool, error) {
	_, err := s.getAccount(email)
	if err != nil {
		return false, nil
	}
	return true, nil
}

func (s *Service) Logout(email string) error {
	err := s.keychain.Remove(s.getAccountKey(email))
	if err != nil {
		return fmt.Errorf("failed to remove account: %w", err)
	}
	return nil
}

func (s *Service) GetAccountInfo(email string) (*models.AccountInfo, error) {
	account, err := s.getAccount(email)
	if err != nil {
		return nil, err
	}

	return &models.AccountInfo{
		Email:      account.Email,
		Name:       account.Name,
		StoreFront: account.StoreFront,
	}, nil
}

func (s *Service) ListAccounts() ([]string, error) {
	accounts := []string{}

	return accounts, nil
}

func (s *Service) SearchApps(keyword, limit, email string) ([]models.AppSearchResult, error) {
	account, err := s.getAccount(email)
	if err != nil {
		return nil, fmt.Errorf("failed to get account: %w", err)
	}

	limitInt := int64(10)
	fmt.Sscanf(limit, "%d", &limitInt)

	output, err := s.appStore.Search(appstore.SearchInput{
		Account: account,
		Term:    keyword,
		Limit:   limitInt,
	})

	if err != nil {
		return nil, fmt.Errorf("search failed: %w", err)
	}

	apps := make([]models.AppSearchResult, 0, len(output.Results))
	for _, app := range output.Results {
		apps = append(apps, s.convertAppToSearchResult(app))
	}

	return apps, nil
}

func (s *Service) GetAppDetails(bundleID, email string) (*models.AppDetails, error) {
	account, err := s.getAccount(email)
	if err != nil {
		return nil, fmt.Errorf("failed to get account: %w", err)
	}

	lookupOutput, err := s.appStore.Lookup(appstore.LookupInput{
		Account:  account,
		BundleID: bundleID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to lookup app: %w", err)
	}

	app := lookupOutput.App
	details := &models.AppDetails{
		AppSearchResult:   s.convertAppToSearchResult(app),
		Screenshots:       app.ScreenshotUrls,
		ScreenshotsIPad:   app.IpadScreenshotUrls,
		SupportedDevices:  app.SupportedDevices,
		LanguageCodes:     app.LanguageCodesISO2A,
		HasInAppPurchases: contains(app.Features, "iosUniversal"),
	}

	return details, nil
}

func (s *Service) GetAppVersionHistory(bundleID, email string) (*models.AppVersionHistory, error) {
	account, err := s.getAccount(email)
	if err != nil {
		return nil, fmt.Errorf("failed to get account: %w", err)
	}

	lookupOutput, err := s.appStore.Lookup(appstore.LookupInput{
		Account:  account,
		BundleID: bundleID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to lookup app: %w", err)
	}

	app := lookupOutput.App

	versionsOutput, err := s.appStore.ListVersions(appstore.ListVersionsInput{
		Account: account,
		App:     app,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list versions: %w", err)
	}

	return &models.AppVersionHistory{
		BundleID:           bundleID,
		AppName:            app.Name,
		LatestVersion:      versionsOutput.LatestExternalVersionID,
		VersionIdentifiers: versionsOutput.ExternalVersionIdentifiers,
	}, nil
}

func (s *Service) GetVersionDetails(bundleID, email string, versionIDs []string) ([]models.AppVersion, error) {
	account, err := s.getAccount(email)
	if err != nil {
		return nil, fmt.Errorf("failed to get account: %w", err)
	}

	lookupOutput, err := s.appStore.Lookup(appstore.LookupInput{
		Account:  account,
		BundleID: bundleID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to lookup app: %w", err)
	}

	app := lookupOutput.App
	versions := make([]models.AppVersion, 0, len(versionIDs))

	for _, versionID := range versionIDs {
		metadata, err := s.appStore.GetVersionMetadata(appstore.GetVersionMetadataInput{
			Account:   account,
			App:       app,
			VersionID: versionID,
		})

		if err != nil {
			versions = append(versions, models.AppVersion{
				VersionID:     versionID,
				VersionString: "",
				Success:       false,
				Error:         err.Error(),
			})
		} else {
			versions = append(versions, models.AppVersion{
				VersionID:     versionID,
				VersionString: metadata.DisplayVersion,
				ReleaseDate:   metadata.ReleaseDate.Format("2006-01-02"),
				Success:       true,
			})
		}
	}

	return versions, nil
}

func (s *Service) GetCountryCode(email string) (string, error) {
	account, err := s.getAccount(email)
	if err != nil {
		return "", fmt.Errorf("failed to get account: %w", err)
	}

	countryCode, err := s.extractCountryCode(account.StoreFront)
	if err != nil {
		return "", fmt.Errorf("failed to extract country code: %w", err)
	}

	return countryCode, nil
}

func (s *Service) convertAppToSearchResult(app appstore.App) models.AppSearchResult {
	iconURL := app.IconURL512
	if iconURL == "" {
		iconURL = app.IconURL100
	}
	if iconURL == "" {
		iconURL = app.IconURL60
	}

	fileSize := int64(0)
	fmt.Sscanf(app.FileSizeBytes, "%d", &fileSize)

	fileSizeFormatted := formatFileSize(fileSize)

	return models.AppSearchResult{
		ID:                        app.ID,
		BundleID:                  app.BundleID,
		Name:                      app.Name,
		Version:                   app.Version,
		Price:                     app.Price,
		FormattedPrice:            app.FormattedPrice,
		IconURL:                   iconURL,
		IconURL60:                 app.IconURL60,
		IconURL100:                app.IconURL100,
		IconURL512:                app.IconURL512,
		Description:               app.Description,
		ReleaseNotes:              app.ReleaseNotes,
		DeveloperName:             app.SellerName,
		DeveloperID:               app.ArtistID,
		Genres:                    app.Genres,
		PrimaryGenre:              app.PrimaryGenreName,
		ContentRating:             app.ContentAdvisoryRating,
		AverageRating:             app.AverageUserRating,
		RatingCount:               app.UserRatingCount,
		FileSize:                  fileSize,
		FileSizeFormatted:         fileSizeFormatted,
		MinimumOSVersion:          app.MinimumOsVersion,
		ReleaseDate:               app.ReleaseDate,
		CurrentVersionReleaseDate: app.CurrentVersionReleaseDate,
	}
}

func (s *Service) extractCountryCode(storeFront string) (string, error) {
	storeFronts := map[string]string{
		"143481": "AE", "143540": "AG", "143538": "AI", "143575": "AL",
		"143524": "AM", "143564": "AO", "143505": "AR", "143445": "AT",
		"143460": "AU", "143568": "AZ", "143541": "BB", "143490": "BD",
		"143446": "BE", "143526": "BG", "143559": "BH", "143542": "BM",
		"143560": "BN", "143556": "BO", "143503": "BR", "143539": "BS",
		"143525": "BW", "143565": "BY", "143555": "BZ", "143455": "CA",
		"143459": "CH", "143527": "CI", "143483": "CL", "143465": "CN",
		"143501": "CO", "143495": "CR", "143557": "CY", "143489": "CZ",
		"143443": "DE", "143458": "DK", "143545": "DM", "143508": "DO",
		"143563": "DZ", "143509": "EC", "143518": "EE", "143516": "EG",
		"143454": "ES", "143447": "FI", "143442": "FR", "143444": "GB",
		"143546": "GD", "143615": "GE", "143573": "GH", "143448": "GR",
		"143504": "GT", "143553": "GY", "143463": "HK", "143510": "HN",
		"143494": "HR", "143482": "HU", "143476": "ID", "143449": "IE",
		"143491": "IL", "143467": "IN", "143558": "IS", "143450": "IT",
		"143617": "IQ", "143511": "JM", "143528": "JO", "143462": "JP",
		"143529": "KE", "143548": "KN", "143466": "KR", "143493": "KW",
		"143544": "KY", "143517": "KZ", "143497": "LB", "143549": "LC",
		"143522": "LI", "143486": "LK", "143520": "LT", "143451": "LU",
		"143519": "LV", "143523": "MD", "143531": "MG", "143530": "MK",
		"143532": "ML", "143592": "MN", "143515": "MO", "143547": "MS",
		"143521": "MT", "143533": "MU", "143488": "MV", "143468": "MX",
		"143473": "MY", "143534": "NE", "143561": "NG", "143512": "NI",
		"143452": "NL", "143457": "NO", "143484": "NP", "143461": "NZ",
		"143562": "OM", "143485": "PA", "143507": "PE", "143474": "PH",
		"143477": "PK", "143478": "PL", "143453": "PT", "143513": "PY",
		"143498": "QA", "143487": "RO", "143500": "RS", "143469": "RU",
		"143479": "SA", "143456": "SE", "143464": "SG", "143499": "SI",
		"143496": "SK", "143535": "SN", "143554": "SR", "143506": "SV",
		"143552": "TC", "143475": "TH", "143536": "TN", "143480": "TR",
		"143551": "TT", "143470": "TW", "143572": "TZ", "143492": "UA",
		"143537": "UG", "143441": "US", "143514": "UY", "143566": "UZ",
		"143550": "VC", "143502": "VE", "143543": "VG", "143471": "VN",
		"143571": "YE", "143472": "ZA",
	}

	parts := []rune{}
	for _, ch := range storeFront {
		if ch >= '0' && ch <= '9' {
			parts = append(parts, ch)
		} else {
			break
		}
	}

	storeFrontID := string(parts)
	if code, ok := storeFronts[storeFrontID]; ok {
		return code, nil
	}

	return "", fmt.Errorf("unknown storefront: %s", storeFront)
}

func formatFileSize(bytes int64) string {
	if bytes == 0 {
		return "0 B"
	}

	units := []string{"B", "KB", "MB", "GB"}
	size := float64(bytes)
	unitIndex := 0

	for size >= 1024 && unitIndex < len(units)-1 {
		size /= 1024
		unitIndex++
	}

	return fmt.Sprintf("%.2f %s", size, units[unitIndex])
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func (s *Service) Download(bundleID, email, outputDir string, progress chan<- models.DownloadProgress) error {
	account, err := s.getAccount(email)
	if err != nil {
		return fmt.Errorf("failed to get account: %w", err)
	}

	// Lookup app by bundle ID
	lookupOutput, err := s.appStore.Lookup(appstore.LookupInput{
		Account:  account,
		BundleID: bundleID,
	})
	if err != nil {
		return fmt.Errorf("failed to lookup app: %w", err)
	}

	app := lookupOutput.App

	// Check if license exists, if not, purchase it
	if progress != nil {
		progress <- models.DownloadProgress{
			Status:  "purchasing",
			Message: "Acquiring app license...",
		}
	}

	err = s.appStore.Purchase(appstore.PurchaseInput{
		Account: account,
		App:     app,
	})
	if err != nil && err != appstore.ErrLicenseRequired {
		// Ignore license already exists error
		if progress != nil {
			progress <- models.DownloadProgress{
				Status:  "error",
				Message: fmt.Sprintf("Purchase failed: %v", err),
			}
		}
		return fmt.Errorf("failed to purchase app: %w", err)
	}

	// Create progress bar
	bar := progressbar.NewOptions64(-1,
		progressbar.OptionSetDescription("Downloading"),
		progressbar.OptionSetWriter(os.Stderr),
		progressbar.OptionShowBytes(true),
		progressbar.OptionSetWidth(10),
		progressbar.OptionThrottle(100),
		progressbar.OptionShowCount(),
		progressbar.OptionOnCompletion(func() {
			fmt.Fprint(os.Stderr, "\n")
		}),
		progressbar.OptionSpinnerType(14),
		progressbar.OptionFullWidth(),
	)

	if progress != nil {
		progress <- models.DownloadProgress{
			Status:  "downloading",
			Message: "Downloading IPA...",
		}
	}

	// Download app
	downloadOutput, err := s.appStore.Download(appstore.DownloadInput{
		Account:    account,
		App:        app,
		OutputPath: outputDir,
		Progress:   bar,
	})

	if err != nil {
		if progress != nil {
			progress <- models.DownloadProgress{
				Status:  "error",
				Message: fmt.Sprintf("Download failed: %v", err),
			}
		}
		return fmt.Errorf("failed to download app: %w", err)
	}

	if progress != nil {
		progress <- models.DownloadProgress{
			Status:   "completed",
			Progress: 100,
			Message:  fmt.Sprintf("Download completed: %s", downloadOutput.DestinationPath),
		}
	}

	return nil
}

func (s *Service) getAccount(email string) (appstore.Account, error) {
	data, err := s.keychain.Get(s.getAccountKey(email))
	if err != nil {
		return appstore.Account{}, fmt.Errorf("account not found, please login first")
	}

	var account appstore.Account
	err = json.Unmarshal(data, &account)
	if err != nil {
		return appstore.Account{}, fmt.Errorf("failed to unmarshal account: %w", err)
	}

	return account, nil
}

func (s *Service) getAccountKey(email string) string {
	return fmt.Sprintf("%s:%s", keychainAccountKey, email)
}
