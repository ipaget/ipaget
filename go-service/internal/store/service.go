package store

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"ipaget-service/internal/logger"
	"ipaget-service/internal/models"

	"github.com/99designs/keyring"
	cookiejar "github.com/juju/persistent-cookiejar"
	"github.com/majd/ipatool/v2/pkg/appstore"
	ipatoolKeychain "github.com/majd/ipatool/v2/pkg/keychain"
	"github.com/majd/ipatool/v2/pkg/util/machine"
	"github.com/majd/ipatool/v2/pkg/util/operatingsystem"
	"howett.net/plist"
)

const (
	keychainServiceName         = "ipaget-service"
	keychainAccountKey          = "account"
	appSubtitleFetchConcurrency = 8
	appSubtitleFetchTimeout     = 8 * time.Second
)

var appSubtitleHTTPClient = &http.Client{Timeout: appSubtitleFetchTimeout}

type Service struct {
	appStore  appstore.AppStore
	keychain  ipatoolKeychain.Keychain
	keyring   keyring.Keyring // raw keyring for listing persisted account keys
	cookieJar interface {
		http.CookieJar
		Save() error
	}
	configDir          string
	machine            machine.Machine
	anisetteURL        string
	appStoreHeadersMu  sync.Mutex
	appStoreDeviceIDMu sync.RWMutex
	appStoreDeviceID   string
	appSubtitleCacheMu sync.RWMutex
	appSubtitleCache   map[string]string
	accountsMu         sync.RWMutex
	currentAccounts    map[string]*appstore.Account
	onGSAAuthenticated func(email, password, dsid, authToken, anisetteURL string, anisetteData *AnisetteData)
}

type anisetteAwareMachine struct {
	base        machine.Machine
	getDeviceID func() string
}

func (m *anisetteAwareMachine) MacAddress() (string, error) {
	if m != nil && m.getDeviceID != nil {
		if mac := deviceIDToMacLike(m.getDeviceID()); mac != "" {
			return mac, nil
		}
	}

	return m.base.MacAddress()
}

func (m *anisetteAwareMachine) HomeDirectory() string {
	return m.base.HomeDirectory()
}

func (m *anisetteAwareMachine) ReadPassword(fd int) ([]byte, error) {
	return m.base.ReadPassword(fd)
}

type appVersionCache struct {
	BundleID     string             `json:"bundle_id"`
	AppName      string             `json:"app_name"`
	LastFetchAt  time.Time          `json:"last_fetch_at"`
	VersionCount int                `json:"version_count"`
	Versions     []versionCacheItem `json:"versions"`
}

type versionCacheItem struct {
	VersionID     string `json:"version_id"`
	VersionString string `json:"version_string"`
	ReleaseDate   string `json:"release_date"`
}

type versionHistoryProgressReporter struct {
	taskID        string
	broadcastFunc func(interface{})
}

type GSAError struct {
	Code    int
	Message string
}

type TwoFactorError struct {
	Message   string
	ErrorCode string
}

func (e *GSAError) Error() string {
	if e == nil {
		return ""
	}
	if e.Message == "" {
		return fmt.Sprintf("GSA error (%d)", e.Code)
	}
	return fmt.Sprintf("GSA error (code %d): %s", e.Code, e.Message)
}

func (e *TwoFactorError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

func (r *versionHistoryProgressReporter) send(progress int, message string) {
	if r == nil || r.broadcastFunc == nil {
		return
	}

	r.broadcastFunc(models.TaskProgress{
		Type:     "task_progress",
		TaskID:   r.taskID,
		TaskType: "version_history",
		Status:   "progress",
		Progress: float64(progress),
		Message:  message,
	})
}

func (s *Service) acquireLicenseForVersionHistory(account **appstore.Account, email, bundleID string, app appstore.App) error {
	log := logger.Logger

	if app.Price > 0 {
		return fmt.Errorf("paid apps must be acquired from the App Store account before listing versions")
	}

	const maxRetries = 2
	var err error

	for attempt := 1; attempt <= maxRetries; attempt++ {
		if attempt > 1 {
			log.Info().Str("bundle_id", bundleID).Int("attempt", attempt).Int("max_retries", maxRetries).Msg("Retrying license acquisition for version history")
			time.Sleep(time.Duration(attempt-1) * 2 * time.Second)
		}

		err = s.appStore.Purchase(appstore.PurchaseInput{Account: **account, App: app})
		if err == nil || err.Error() == "license already exists" {
			if err != nil {
				log.Info().Str("bundle_id", bundleID).Msg("License already exists")
			} else {
				log.Info().Str("bundle_id", bundleID).Int("attempt", attempt).Msg("License acquired successfully for version history")
			}
			return nil
		}

		if errors.Is(err, appstore.ErrPasswordTokenExpired) {
			log.Warn().Err(err).Str("bundle_id", bundleID).Msg("Password token expired during license acquisition - attempting refresh and retry")
			newAccount, refreshErr := s.refreshAccountToken(email, *account)
			if refreshErr != nil {
				return fmt.Errorf("session expired. Please log out and log in again: %w", refreshErr)
			}
			*account = newAccount
			continue
		}

		if errors.Is(err, appstore.ErrNoAccount) {
			return fmt.Errorf("the Apple ID does not have a payment account configured for App Store purchases: %w", err)
		}

		if errors.Is(err, appstore.ErrSubscriptionRequired) {
			return fmt.Errorf("the app requires an active subscription before version history can be listed: %w", err)
		}

		errMsgLower := strings.ToLower(err.Error())
		if strings.Contains(errMsgLower, "could not be verified") {
			return fmt.Errorf("device or computer could not be verified. Please log out and log in again: %w", err)
		}

		return fmt.Errorf("failed to acquire app license for version history: %w", err)
	}

	return fmt.Errorf("failed to acquire app license for version history: %w", err)
}

func (s *Service) fetchVersionHistory(account **appstore.Account, email, bundleID string, app appstore.App, progress *versionHistoryProgressReporter) (appstore.ListVersionsOutput, error) {
	log := logger.Logger

	progress.send(30, "Fetching version list...")
	log.Info().Str("bundle_id", bundleID).Str("app_name", app.Name).Bool("is_paid", app.Price > 0).Msg("Listing app versions")

	versionsOutput, err := s.appStore.ListVersions(appstore.ListVersionsInput{Account: **account, App: app})
	if err != nil && errors.Is(err, appstore.ErrPasswordTokenExpired) {
		log.Warn().Err(err).Str("bundle_id", bundleID).Msg("Password token expired during list versions - attempting refresh and retry")
		if newAccount, refreshErr := s.refreshAccountToken(email, *account); refreshErr == nil {
			*account = newAccount
			versionsOutput, err = s.appStore.ListVersions(appstore.ListVersionsInput{Account: **account, App: app})
		}
	}

	if err == nil {
		return versionsOutput, nil
	}

	if errors.Is(err, appstore.ErrLicenseRequired) {
		progress.send(50, "Acquiring app license, please wait...")
		log.Info().Str("bundle_id", bundleID).Str("app_name", app.Name).Bool("is_paid", app.Price > 0).Msg("Version listing requires a license; attempting to acquire one")

		purchaseErr := s.acquireLicenseForVersionHistory(account, email, bundleID, app)
		if purchaseErr != nil {
			log.Warn().Err(purchaseErr).Str("bundle_id", bundleID).Msg("License acquisition failed before retrying version listing")
			return appstore.ListVersionsOutput{}, purchaseErr
		}

		versionsOutput, err = s.appStore.ListVersions(appstore.ListVersionsInput{Account: **account, App: app})
		if err != nil && errors.Is(err, appstore.ErrPasswordTokenExpired) {
			log.Warn().Err(err).Str("bundle_id", bundleID).Msg("Password token expired during list versions retry - attempting refresh and retry")
			if newAccount, refreshErr := s.refreshAccountToken(email, *account); refreshErr == nil {
				*account = newAccount
				versionsOutput, err = s.appStore.ListVersions(appstore.ListVersionsInput{Account: **account, App: app})
			}
		}

		if err != nil {
			log.Error().Err(err).Str("bundle_id", bundleID).Msg("Failed to list versions after acquiring license")
			return appstore.ListVersionsOutput{}, fmt.Errorf("failed to list versions: %w", err)
		}

		return versionsOutput, nil
	}

	const maxRetries = 5
	for attempt := 2; attempt <= maxRetries; attempt++ {
		log.Warn().Err(err).Str("bundle_id", bundleID).Int("attempt", attempt).Int("max_retries", maxRetries).Msg("Failed to list versions, retrying")
		time.Sleep(time.Duration(attempt-1) * 2 * time.Second)

		versionsOutput, err = s.appStore.ListVersions(appstore.ListVersionsInput{Account: **account, App: app})
		if err == nil {
			log.Info().Str("bundle_id", bundleID).Int("attempt", attempt).Msg("Successfully listed versions after retry")
			return versionsOutput, nil
		}

		if errors.Is(err, appstore.ErrPasswordTokenExpired) {
			log.Warn().Err(err).Str("bundle_id", bundleID).Msg("Password token expired during list versions retry - attempting refresh")
			if newAccount, refreshErr := s.refreshAccountToken(email, *account); refreshErr == nil {
				*account = newAccount
				versionsOutput, err = s.appStore.ListVersions(appstore.ListVersionsInput{Account: **account, App: app})
				if err == nil {
					log.Info().Str("bundle_id", bundleID).Int("attempt", attempt).Msg("Successfully listed versions after token refresh")
					return versionsOutput, nil
				}
			}
		}
	}

	log.Error().Err(err).Str("bundle_id", bundleID).Str("app_name", app.Name).Int("attempts", maxRetries).Msg("Failed to list versions after max retries")
	return appstore.ListVersionsOutput{}, fmt.Errorf("failed to list versions: %w", err)
}

func (s *Service) acquireLicenseForDownload(account **appstore.Account, email, bundleID string, app appstore.App, progressChan chan<- models.DownloadProgress) error {
	log := logger.Logger

	if app.Price > 0 {
		return fmt.Errorf("paid apps must be acquired from the App Store account before download")
	}

	if progressChan != nil {
		progressChan <- models.DownloadProgress{
			Status:  "progress",
			Message: "Checking app license...",
		}
	}

	const maxRetries = 2
	var err error

	for attempt := 1; attempt <= maxRetries; attempt++ {
		if attempt > 1 {
			log.Info().Str("bundle_id", bundleID).Int("attempt", attempt).Int("max_retries", maxRetries).Msg("Retrying license acquisition for download")
			time.Sleep(time.Duration(attempt-1) * 2 * time.Second)
		}

		err = s.appStore.Purchase(appstore.PurchaseInput{Account: **account, App: app})
		if err == nil || err.Error() == "license already exists" {
			if err != nil {
				log.Info().Str("bundle_id", bundleID).Msg("License already exists")
			} else {
				log.Info().Str("bundle_id", bundleID).Int("attempt", attempt).Msg("License acquired successfully for download")
			}
			return nil
		}

		if errors.Is(err, appstore.ErrPasswordTokenExpired) {
			log.Warn().Err(err).Str("bundle_id", bundleID).Msg("Password token expired during download license acquisition - attempting refresh and retry")

			if progressChan != nil {
				progressChan <- models.DownloadProgress{
					Status:  "progress",
					Message: "Refreshing login session...",
				}
			}

			newAccount, refreshErr := s.refreshAccountToken(email, *account)
			if refreshErr != nil {
				return fmt.Errorf("session expired. Please log out and log in again: %w", refreshErr)
			}
			*account = newAccount
			continue
		}

		if errors.Is(err, appstore.ErrNoAccount) {
			return fmt.Errorf("the Apple ID does not have a payment account configured for App Store purchases: %w", err)
		}

		if errors.Is(err, appstore.ErrSubscriptionRequired) {
			return fmt.Errorf("the app requires an active subscription before it can be downloaded: %w", err)
		}

		errMsgLower := strings.ToLower(err.Error())
		if strings.Contains(errMsgLower, "could not be verified") {
			return fmt.Errorf("device or computer could not be verified. Please log out and log in again: %w", err)
		}

		return fmt.Errorf("failed to acquire app license for download: %w", err)
	}

	return fmt.Errorf("failed to acquire app license for download: %w", err)
}

func isUnknownAppStoreDownloadError(err error) bool {
	if err == nil {
		return false
	}

	errMsg := strings.ToLower(err.Error())
	return strings.Contains(errMsg, strings.ToLower(appstore.CustomerMessageUnknownError))
}

type AnisetteStored struct {
	MachineID          string `json:"machineID"`
	OneTimePassword    string `json:"oneTimePassword"`
	LocalUserID        string `json:"localUserID"`
	RoutingInfo        string `json:"routingInfo"`
	DeviceUniqueID     string `json:"deviceUniqueIdentifier"`
	DeviceSerialNumber string `json:"deviceSerialNumber"`
	DeviceDescription  string `json:"deviceDescription"`
	ClientTime         string `json:"date"`
	Locale             string `json:"locale"`
	TimeZone           string `json:"timeZone"`
	ClientIdentifier   string `json:"clientIdentifier"`
}

type GSACredentials struct {
	DSID         string        `json:"dsid"`
	AuthToken    string        `json:"auth_token"`
	AnisetteURL  string        `json:"anisette_url"`
	AnisetteData *AnisetteData `json:"anisette_data"`
}

type GSAPending2FA struct {
	DSID         string        `json:"dsid"`
	IDMSToken    string        `json:"idms_token"`
	AuthType     string        `json:"auth_type"`
	AnisetteURL  string        `json:"anisette_url"`
	AnisetteData *AnisetteData `json:"anisette_data"`
	CreatedAt    time.Time     `json:"created_at"`
}

func normalizeEmailKey(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func (s *Service) getAnisetteKey(email string) string {
	return fmt.Sprintf("anisette:%s", normalizeEmailKey(email))
}

func (s *Service) saveAnisetteData(email string, data *AnisetteStored) error {
	b, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("failed to marshal anisette: %w", err)
	}
	if err := s.keychain.Set(s.getAnisetteKey(email), b); err != nil {
		return fmt.Errorf("failed to save anisette: %w", err)
	}
	return nil
}

func (s *Service) loadAnisetteData(email string) (*AnisetteStored, error) {
	b, err := s.keychain.Get(s.getAnisetteKey(email))
	if err != nil {
		return nil, fmt.Errorf("anisette not found: %w", err)
	}
	var data AnisetteStored
	if err := json.Unmarshal(b, &data); err != nil {
		return nil, fmt.Errorf("failed to unmarshal anisette: %w", err)
	}
	return &data, nil
}

func (s *Service) getGSAKey(email string) string {
	return fmt.Sprintf("gsa:%s", normalizeEmailKey(email))
}

func (s *Service) getPending2FAKey(email string) string {
	return fmt.Sprintf("gsa-2fa:%s", normalizeEmailKey(email))
}

func (s *Service) SavePending2FA(email string, pending *GSAPending2FA) error {
	if strings.TrimSpace(email) == "" {
		return fmt.Errorf("email is required to save pending 2FA")
	}
	if pending == nil {
		return fmt.Errorf("pending 2FA payload is nil")
	}

	payload, err := json.Marshal(pending)
	if err != nil {
		return fmt.Errorf("failed to marshal pending 2FA: %w", err)
	}

	if err := s.keychain.Set(s.getPending2FAKey(email), payload); err != nil {
		return fmt.Errorf("failed to store pending 2FA: %w", err)
	}

	return nil
}

func (s *Service) GetPending2FA(email string) (*GSAPending2FA, error) {
	b, err := s.keychain.Get(s.getPending2FAKey(email))
	if err != nil {
		return nil, fmt.Errorf("pending 2FA not found: %w", err)
	}

	var pending GSAPending2FA
	if err := json.Unmarshal(b, &pending); err != nil {
		return nil, fmt.Errorf("failed to unmarshal pending 2FA: %w", err)
	}

	return &pending, nil
}

func (s *Service) ClearPending2FA(email string) {
	_ = s.keychain.Remove(s.getPending2FAKey(email))
}

func (s *Service) SaveGSACredentials(email string, creds *GSACredentials) error {
	if strings.TrimSpace(email) == "" {
		return fmt.Errorf("email is required to save GSA credentials")
	}
	if creds == nil {
		return fmt.Errorf("credentials payload is nil")
	}

	payload, err := json.Marshal(creds)
	if err != nil {
		return fmt.Errorf("failed to marshal GSA credentials: %w", err)
	}

	if err := s.keychain.Set(s.getGSAKey(email), payload); err != nil {
		return fmt.Errorf("failed to store GSA credentials: %w", err)
	}

	return nil
}

func (s *Service) GetGSACredentials(email string) (*GSACredentials, error) {
	b, err := s.keychain.Get(s.getGSAKey(email))
	if err != nil {
		return nil, fmt.Errorf("GSA credentials not found: %w", err)
	}
	var creds GSACredentials
	if err := json.Unmarshal(b, &creds); err != nil {
		return nil, fmt.Errorf("failed to unmarshal GSA credentials: %w", err)
	}
	return &creds, nil
}

func toAcceptLanguage(locale string) string {
	if strings.TrimSpace(locale) == "" {
		return "en-us"
	}
	return strings.ToLower(strings.ReplaceAll(locale, "_", "-"))
}

func normalizeDeviceID(deviceID string) string {
	deviceID = strings.TrimSpace(deviceID)
	deviceID = strings.ReplaceAll(deviceID, "-", "")
	deviceID = strings.ReplaceAll(deviceID, ":", "")
	return strings.ToLower(deviceID)
}

func canonicalDeviceID(deviceID string) string {
	return strings.TrimSpace(deviceID)
}

func normalizeAppStoreGUID(deviceID string) string {
	deviceID = strings.ToUpper(normalizeDeviceID(deviceID))
	if len(deviceID) != 12 {
		return ""
	}

	for _, ch := range deviceID {
		if (ch < '0' || ch > '9') && (ch < 'A' || ch > 'F') {
			return ""
		}
	}

	return deviceID
}

func deviceIDToMacLike(deviceID string) string {
	deviceID = normalizeAppStoreGUID(deviceID)
	if deviceID == "" {
		return ""
	}

	parts := make([]string, 0, (len(deviceID)+1)/2)
	for i := 0; i < len(deviceID); i += 2 {
		end := i + 2
		if end > len(deviceID) {
			end = len(deviceID)
		}
		parts = append(parts, deviceID[i:end])
	}

	return strings.Join(parts, ":")
}

func NewService(configDir string, onGSAAuthenticated func(email, password, dsid, authToken, anisetteURL string, anisetteData *AnisetteData)) *Service {
	log := logger.Logger
	log.Info().Str("config_dir", configDir).Msg("Initializing store service")

	os.MkdirAll(configDir, 0700)

	kr, err := keyring.Open(keyring.Config{
		AllowedBackends: []keyring.BackendType{
			keyring.KeychainBackend,
			keyring.SecretServiceBackend,
			keyring.FileBackend,
		},
		ServiceName: keychainServiceName,
		FileDir:     configDir,
		FilePasswordFunc: func(string) (string, error) {
			return "ipaget-keychain-passphrase", nil
		},
	})
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to open keyring")
		panic(fmt.Errorf("failed to open keyring: %w", err))
	}
	log.Info().Msg("Keyring opened successfully")

	kc := ipatoolKeychain.New(ipatoolKeychain.Args{Keyring: kr})
	if kc == nil {
		log.Fatal().Msg("Failed to create keychain - returned nil")
		panic(fmt.Errorf("failed to create keychain: returned nil"))
	}
	log.Info().Msg("Keychain created successfully")

	osInstance := operatingsystem.New()
	if osInstance == nil {
		log.Fatal().Msg("Failed to create OS instance - returned nil")
		panic(fmt.Errorf("failed to create OS instance: returned nil"))
	}

	machineInstance := machine.New(machine.Args{OS: osInstance})
	if machineInstance == nil {
		log.Fatal().Msg("Failed to create machine instance - returned nil")
		panic(fmt.Errorf("failed to create machine instance: returned nil"))
	}
	log.Info().Msg("Machine and OS instances created successfully")

	service := &Service{
		keychain:           kc,
		keyring:            kr,
		configDir:          configDir,
		anisetteURL:        getAnisetteURL(configDir),
		appSubtitleCache:   make(map[string]string),
		currentAccounts:    make(map[string]*appstore.Account),
		onGSAAuthenticated: onGSAAuthenticated,
	}

	wrappedMachine := &anisetteAwareMachine{
		base:        machineInstance,
		getDeviceID: service.getAppStoreDeviceIDOverride,
	}
	service.machine = wrappedMachine
	service.setAppStoreDeviceIDOverride(service.loadOrCreatePersistentAppStoreDeviceID())

	cookieJarPath := filepath.Join(configDir, "cookies.json")
	cj, err := cookiejar.New(&cookiejar.Options{Filename: cookieJarPath})
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to create cookie jar")
		panic(fmt.Errorf("failed to create cookie jar: %w", err))
	}

	cjWrapper := NewCookieJarWrapper(cj, 5, 200*time.Millisecond)
	log.Info().Str("path", cookieJarPath).Msg("Cookie jar created successfully with retry wrapper")

	as := appstore.NewAppStore(appstore.Args{
		Keychain:        kc,
		CookieJar:       cjWrapper,
		OperatingSystem: osInstance,
		Machine:         wrappedMachine,
	})
	if as == nil {
		log.Fatal().Msg("Failed to create AppStore client - returned nil")
		panic(fmt.Errorf("failed to create AppStore client: returned nil"))
	}
	log.Info().Msg("AppStore client created successfully")

	service.appStore = as
	service.cookieJar = cjWrapper

	log.Info().Msg("Store service initialized successfully")
	return service
}

func getAnisetteURL(configDir string) string {
	configPath := filepath.Join(configDir, "anisette.json")
	data, err := os.ReadFile(configPath)
	if err == nil {
		var config struct {
			URL string `json:"url"`
		}
		if json.Unmarshal(data, &config) == nil && config.URL != "" {
			return config.URL
		}
	}

	for _, server := range GetDefaultAnisetteServers() {
		if _, err := FetchAnisetteData(server); err == nil {
			return server
		}
	}

	return ""
}

func (s *Service) getAnisetteServerURL() string {
	return s.anisetteURL
}

func (s *Service) setAppStoreDeviceIDOverride(deviceID string) {
	if s == nil {
		return
	}

	deviceID = normalizeAppStoreGUID(deviceID)
	if deviceID == "" {
		return
	}

	s.appStoreDeviceIDMu.Lock()
	s.appStoreDeviceID = deviceID
	s.appStoreDeviceIDMu.Unlock()
}

func (s *Service) getAppStoreDeviceIDOverride() string {
	if s == nil {
		return ""
	}

	s.appStoreDeviceIDMu.RLock()
	defer s.appStoreDeviceIDMu.RUnlock()
	return s.appStoreDeviceID
}

func (s *Service) withTemporaryAppStoreHeaders(anisetteData *AnisetteData, fn func() (appstore.LoginOutput, error)) (appstore.LoginOutput, error) {
	if anisetteData == nil {
		return fn()
	}

	return fn()
}

func (s *Service) loadAppStoreAnisetteData(email string) *AnisetteData {
	if strings.TrimSpace(email) == "" {
		return nil
	}

	stored, err := s.loadAnisetteData(email)
	if err != nil {
		logger.Logger.Warn().Err(err).Str("email", email).Msg("No stored anisette data available for App Store login")
		return nil
	}

	return &AnisetteData{
		ClientTime: stored.ClientTime,
		MD:         stored.OneTimePassword,
		MDM:        stored.MachineID,
		MDRINFO:    stored.RoutingInfo,
		MDLU:       stored.LocalUserID,
		SRLNO:      stored.DeviceSerialNumber,
		ClientInfo: stored.DeviceDescription,
		TimeZone:   stored.TimeZone,
		Locale:     stored.Locale,
		DeviceID:   canonicalDeviceID(stored.DeviceUniqueID),
	}
}

func (s *Service) restoreAppStoreAccountContext(email string) *AnisetteData {
	anisetteData := s.loadAppStoreAnisetteData(email)
	if anisetteData != nil {
		logger.Logger.Debug().Str("email", email).Msg("Restored stored anisette context for account")
		return anisetteData
	}

	deviceID := s.loadOrCreatePersistentAppStoreDeviceID()
	if deviceID != "" {
		s.setAppStoreDeviceIDOverride(deviceID)
		logger.Logger.Debug().Str("email", email).Str("device_id", normalizeDeviceID(deviceID)).Msg("Restored App Store device context from persistent fallback identifier")
	}

	return nil
}

func (s *Service) persistentAppStoreDeviceIDPath() string {
	return filepath.Join(s.configDir, "appstore_device_id.txt")
}

func (s *Service) loadOrCreatePersistentAppStoreDeviceID() string {
	if s == nil {
		return ""
	}

	path := s.persistentAppStoreDeviceIDPath()
	if data, err := os.ReadFile(path); err == nil {
		deviceID := normalizeAppStoreGUID(strings.TrimSpace(string(data)))
		if deviceID != "" {
			return deviceID
		}
	}

	randomBytes := make([]byte, 6)
	if _, err := rand.Read(randomBytes); err != nil {
		logger.Logger.Warn().Err(err).Str("path", path).Msg("Failed to generate persistent App Store device identifier")
		return ""
	}

	deviceID := normalizeAppStoreGUID(hex.EncodeToString(randomBytes))
	if deviceID == "" {
		return ""
	}

	if err := os.WriteFile(path, []byte(deviceID), 0600); err != nil {
		logger.Logger.Warn().Err(err).Str("path", path).Msg("Failed to persist App Store device identifier")
	}

	return deviceID
}

func (s *Service) Login(email, password string) (*models.AuthResponse, error) {
	return s.loginWithIpatool(email, password, "", nil)
}

func (s *Service) LoginWithGSA(email, password, anisetteURL string) (*models.AuthResponse, error) {
	return s.loginWithGSAAndAppStoreCode(email, password, anisetteURL, "")
}

func (s *Service) loginWithGSAAndAppStoreCode(email, password, anisetteURL, appStoreAuthCode string) (*models.AuthResponse, error) {
	log := logger.Logger

	macAddr, err := s.machine.MacAddress()
	if err != nil {
		return nil, fmt.Errorf("failed to get mac address: %w", err)
	}

	anisetteURL = strings.TrimSpace(anisetteURL)
	if anisetteURL == "" {
		anisetteURL = s.getAnisetteServerURL()
	} else {
		s.anisetteURL = anisetteURL
		log.Info().Str("final_anisette_url", anisetteURL).Msg("Using override Anisette URL")
	}

	if anisetteURL != "" {
		log.Info().Str("anisette_server", anisetteURL).Msg("Using Anisette server for device metadata")
	} else {
		log.Info().Msg("Using fallback device metadata (no Anisette server)")
	}

	// CRITICAL: Fetch Anisette data ONCE at the beginning (matching SideStore's approach)
	// This same anisetteData will be used for:
	// 1. GSA authentication (both init and complete steps)
	// 2. App token request
	// 3. Stored with GSA credentials for later Developer Portal API calls
	var sessionAnisetteData *AnisetteData
	if anisetteURL != "" {
		data, err := FetchAnisetteData(anisetteURL)
		if err != nil {
			log.Warn().Err(err).Str("email", email).Str("anisette_server", anisetteURL).Msg("Failed to fetch anisette data from configured server - trying default servers")
		} else {
			sessionAnisetteData = data
			log.Info().Str("email", email).Str("anisette_server", anisetteURL).Msg("Fetched session Anisette data for GSA authentication")
		}
	}

	if sessionAnisetteData == nil {
		for _, server := range GetDefaultAnisetteServers() {
			if strings.TrimSpace(server) == "" {
				continue
			}
			data, err := FetchAnisetteData(server)
			if err != nil {
				log.Warn().Err(err).Str("email", email).Str("anisette_server", server).Msg("Failed to fetch anisette data from default server")
				continue
			}
			sessionAnisetteData = data
			anisetteURL = server
			log.Info().Str("email", email).Str("anisette_server", server).Msg("Fetched session Anisette data from default server")
			break
		}
	}

	// Try to load existing device metadata for this account
	var deviceMeta *DeviceMetadata
	deviceMeta, err = s.loadDeviceMetadata(email)
	if err == nil && deviceMeta != nil {
		// Found existing device metadata, reuse it
		deviceMeta.UseCount++
		deviceMeta.LastUsedAt = time.Now()
		log.Info().Str("email", email).Str("udid", deviceMeta.UDID).Int("use_count", deviceMeta.UseCount).Msg("Reusing existing device metadata for account")
	} else {
		// No existing metadata, generate new one
		deviceMeta, err = GenerateDeviceMetadata(macAddr, anisetteURL)
		if err != nil {
			return nil, fmt.Errorf("failed to generate device metadata: %w", err)
		}

		// Set initial metadata
		deviceMeta.Email = email
		deviceMeta.CreatedAt = time.Now()
		deviceMeta.LastUsedAt = time.Now()
		deviceMeta.UseCount = 0
	}

	// Prepare anisette data for GSA authentication
	// If we successfully fetched sessionAnisetteData, use it to populate the stored anisette
	// Otherwise, load existing or synthesize from device metadata
	var anisettePersist *AnisetteStored
	if sessionAnisetteData != nil {
		// Use the session Anisette data that will be used throughout the authentication flow
		anisettePersist = &AnisetteStored{
			MachineID:          sessionAnisetteData.MDM,
			OneTimePassword:    sessionAnisetteData.MD,
			LocalUserID:        sessionAnisetteData.MDLU,
			RoutingInfo:        sessionAnisetteData.MDRINFO,
			DeviceUniqueID:     canonicalDeviceID(sessionAnisetteData.DeviceID),
			DeviceSerialNumber: sessionAnisetteData.SRLNO,
			DeviceDescription:  sessionAnisetteData.ClientInfo,
			ClientTime:         sessionAnisetteData.ClientTime,
			Locale:             sessionAnisetteData.Locale,
			TimeZone:           sessionAnisetteData.TimeZone,
			ClientIdentifier:   deviceMeta.CID,
		}
		_ = s.saveAnisetteData(email, anisettePersist)
		log.Info().Str("email", email).Msg("Using session Anisette data for GSA authentication")
	} else if a, err := s.loadAnisetteData(email); err == nil {
		// Fallback to existing stored data
		anisettePersist = a
		log.Info().Str("email", email).Msg("Using stored Anisette data for GSA authentication")
	} else {
		// Last resort: synthesize minimal from device metadata
		anisettePersist = &AnisetteStored{
			MachineID:        deviceMeta.IMDM,
			OneTimePassword:  deviceMeta.IMD,
			DeviceUniqueID:   deviceMeta.UDID,
			ClientIdentifier: deviceMeta.CID,
			ClientTime:       time.Now().UTC().Format("2006-01-02T15:04:05Z"),
			Locale:           "en_US",
			TimeZone:         "UTC",
		}
		_ = s.saveAnisetteData(email, anisettePersist)
		log.Info().Str("email", email).Msg("Using synthesized Anisette data for GSA authentication")
	}

	// Perform GSA login using full anisette overrides (headers + CPD)
	// CRITICAL: Use sessionAnisetteData values if available (matching SideStore's approach)
	imd := deviceMeta.IMD
	imdm := deviceMeta.IMDM
	udid := deviceMeta.UDID

	if sessionAnisetteData != nil {
		imd = sessionAnisetteData.MD
		imdm = sessionAnisetteData.MDM

		// Update UDID to match Anisette data (normalized)
		// This ensures consistency between Login (Step 1/2) and AppTokens request
		newUDID := canonicalDeviceID(sessionAnisetteData.DeviceID)
		if newUDID != "" && newUDID != deviceMeta.UDID {
			log.Info().
				Str("old_udid", deviceMeta.UDID).
				Str("new_udid", newUDID).
				Msg("Updating device UDID to match session Anisette data")
			udid = newUDID

			// Update device metadata object so it gets saved with new values
			deviceMeta.UDID = newUDID
			deviceMeta.IMD = imd
			deviceMeta.IMDM = imdm
		}

		log.Debug().Str("email", email).Msg("Using session Anisette MD/MDM/UDID for GSA CPD")
	} else {
		log.Debug().Str("email", email).Msg("Using device metadata MD/MDM for GSA CPD (fallback)")
	}

	status, token, err := GSALoginFull(email, password, udid, imd, imdm, deviceMeta.CID, anisettePersist)
	if err != nil {
		if isTransientGSAError(err) {
			log.Warn().Err(err).Str("email", email).Msg("GSA login failed with transient network error; trying App Store login directly")
			return s.loginWithIpatool(email, password, appStoreAuthCode, sessionAnisetteData)
		}
		return nil, fmt.Errorf("GSA login failed: %w", err)
	}

	// Apple may return hsc=409 with SPD when additional verification is required.
	// In this case the auth type is decisive and we must stop before requesting app tokens.
	if status.StatusCode == 409 && (status.AuthType == "trustedDeviceSecondaryAuth" || status.AuthType == "secondaryAuth") {
		if sessionAnisetteData != nil && token != nil {
			if spdData, parseErr := ParseSPDToken(token); parseErr == nil {
				if strings.TrimSpace(spdData.ADSID) != "" && strings.TrimSpace(spdData.GsIdmsToken) != "" {
					if err := requestTrustedDeviceCode(&GSAPending2FA{
						DSID:         spdData.ADSID,
						IDMSToken:    spdData.GsIdmsToken,
						AuthType:     status.AuthType,
						AnisetteURL:  anisetteURL,
						AnisetteData: sessionAnisetteData,
						CreatedAt:    time.Now(),
					}); err != nil {
						log.Warn().Err(err).Str("email", email).Msg("Failed to proactively request trusted device code")
					} else {
						log.Info().Str("email", email).Msg("Trusted device code request triggered during login")
					}
				}
			}
		}

		if token != nil {
			if spdData, parseErr := ParseSPDToken(token); parseErr == nil {
				if spdData.GsIdmsToken != "" {
					if err := s.SavePending2FA(email, &GSAPending2FA{
						DSID:         spdData.ADSID,
						IDMSToken:    spdData.GsIdmsToken,
						AuthType:     status.AuthType,
						AnisetteURL:  anisetteURL,
						AnisetteData: sessionAnisetteData,
						CreatedAt:    time.Now(),
					}); err != nil {
						log.Warn().Err(err).Str("email", email).Msg("Failed to store pending GSA 2FA context")
					}
				}
			} else {
				log.Warn().Err(parseErr).Str("email", email).Msg("Failed to parse SPD while storing pending 2FA context")
			}
		}

		// 2FA required
		log.Info().Str("email", email).Str("auth_type", status.AuthType).Msg("GSA authentication requires 2FA")
		return &models.AuthResponse{
			Success:     false,
			Requires2FA: true,
			Message:     "Two-factor authentication required",
		}, nil
	}

	if status.ErrorCode != 0 {
		// Check for environment mismatch error
		if status.ErrorCode == -22421 ||
			(status.ErrorMessage != "" &&
				(containsSubstring(status.ErrorMessage, "environment mismatch") ||
					containsSubstring(status.ErrorMessage, "This action could not be completed"))) {
			// Environment mismatch - clear existing device metadata and GSA credentials
			log.Info().Str("email", email).Msg("GSA authentication failed with environment mismatch, clearing device metadata and credentials")
			s.clearDeviceMetadata(email)
			s.clearGSACredentials(email)

			// Automatically fallback to ipatool
			log.Info().Str("email", email).Msg("Automatically switching to ipatool")

			// Try ipatool authentication directly
			return s.loginWithIpatool(email, password, "", sessionAnisetteData)
		}
		return nil, fmt.Errorf("%s", status.ErrorMessage)
	}

	if token == nil {
		return nil, fmt.Errorf("GSA authentication failed: no token received")
	}

	log.Info().Str("email", email).Msg("GSA authentication successful")

	// Parse SPD token to extract DSID for developer portal
	// The token is already decrypted plist data from GSALoginFull
	spdData, err := ParseSPDToken(token)
	if err != nil {
		previewLen := len(token)
		if previewLen > 100 {
			previewLen = 100
		}
		log.Error().Err(err).Int("token_len", len(token)).Str("token_preview", string(token[:previewLen])).Msg("Failed to parse SPD token - GSA credentials will not be saved!")
		// This is critical - without parsed SPD data, we cannot save GSA credentials for later use
		// User will need to re-login for certificate generation
	} else {
		log.Info().Str("email", email).
			Str("adsid", spdData.ADSID).
			Bool("has_gs_idms_token", spdData.GsIdmsToken != "").
			Bool("has_delegate_token", spdData.DelegateToken != "").
			Bool("has_session_key", len(spdData.SessionKey) > 0).
			Bool("has_c", len(spdData.C) > 0).
			Int("session_key_len", len(spdData.SessionKey)).
			Int("c_len", len(spdData.C)).
			Msg("SPD token parsed successfully - checking available tokens")

		// CRITICAL: Always save GSA credentials synchronously FIRST
		// This ensures credentials are available immediately after LoginWithGSA returns
		// The async callback is only for certificate generation, not credential saving
		authTokenToSave := spdData.GsIdmsToken

		// Try to get app-specific token if possible
		if len(spdData.SessionKey) > 0 && len(spdData.C) > 0 {
			log.Info().Str("email", email).Msg("Attempting to fetch app-specific auth token for Developer Portal")
			appToken, err := s.fetchAppAuthToken(spdData, sessionAnisetteData)
			if err != nil {
				log.Error().Err(err).Str("email", email).Msg("Failed to fetch app-specific auth token, using GsIdmsToken")
			} else {
				log.Info().Str("email", email).Msg("Successfully fetched app-specific auth token")
				authTokenToSave = appToken
			}
		} else {
			log.Warn().
				Str("email", email).
				Bool("has_sk", len(spdData.SessionKey) > 0).
				Bool("has_c", len(spdData.C) > 0).
				Msg("SPD data missing required fields for app token generation, using GsIdmsToken")
		}

		// SYNCHRONOUSLY save GSA credentials - this is critical for handleImportFreeCert
		if authTokenToSave != "" {
			creds := &GSACredentials{
				DSID:         spdData.ADSID,
				AuthToken:    authTokenToSave,
				AnisetteURL:  anisetteURL,
				AnisetteData: sessionAnisetteData,
			}
			if err := s.SaveGSACredentials(email, creds); err != nil {
				log.Error().Err(err).Str("email", email).Msg("Failed to save GSA credentials")
			} else {
				log.Info().
					Str("email", email).
					Bool("has_anisette_data", sessionAnisetteData != nil).
					Str("client_time", func() string {
						if sessionAnisetteData != nil {
							return sessionAnisetteData.ClientTime
						}
						return "nil"
					}()).
					Msg("GSA credentials saved synchronously")
			}
		}

		// Trigger async certificate generation if callback is set
		if s.onGSAAuthenticated != nil && authTokenToSave != "" {
			go func(e, p, dsid, authToken, aniURL string, aniData *AnisetteData) {
				defer func() { recover() }()
				s.onGSAAuthenticated(e, p, dsid, authToken, aniURL, aniData)
			}(email, password, spdData.ADSID, authTokenToSave, anisetteURL, sessionAnisetteData)
		}
	}

	// Save device metadata for future logins
	if err := s.saveDeviceMetadata(email, deviceMeta); err != nil {
		log.Warn().Err(err).Str("email", email).Msg("Failed to save device metadata (non-critical)")
	}

	// Prefer App Store login when available, but do not fail the whole sign-in flow if
	// GSA already succeeded. Free-sign certificate generation only requires the GSA session.
	log.Info().Str("email", email).Msg("GSA successful - proceeding with ipatool App Store login")
	appStoreResp, appStoreErr := s.loginWithIpatool(email, password, appStoreAuthCode, sessionAnisetteData)
	if appStoreErr == nil {
		return appStoreResp, nil
	}

	log.Warn().
		Err(appStoreErr).
		Str("email", email).
		Bool("has_authcode", strings.TrimSpace(appStoreAuthCode) != "").
		Msg("ipatool login failed after successful GSA auth; falling back to GSA-only session")

	fallbackStorefront := "us"
	if spdData != nil {
		if country := getStringOrEmpty(map[string]interface{}{"countryCode": func() interface{} {
			if spdData == nil {
				return ""
			}
			return ""
		}()}, "countryCode"); strings.TrimSpace(country) != "" {
			fallbackStorefront = strings.ToLower(strings.TrimSpace(country))
		}
	}

	account := appstore.Account{
		Name:       strings.TrimSpace(strings.TrimSpace(spdData.FirstName + " " + spdData.LastName)),
		Email:      email,
		Password:   password,
		StoreFront: countryCodeToStoreFront(fallbackStorefront),
	}
	s.saveCurrentAccount(&account)

	accountData, marshalErr := json.Marshal(account)
	if marshalErr != nil {
		return nil, fmt.Errorf("failed to save fallback account after GSA login: %w", marshalErr)
	}

	if err := s.keychain.Set(s.getAccountKey(email), accountData); err != nil {
		log.Warn().
			Err(err).
			Str("email", email).
			Msg("Failed to save fallback account after GSA login; continuing with current session")
	}

	return &models.AuthResponse{
		Success: true,
		Email:   email,
		Message: "Login successful",
	}, nil
}

// Helper function to check if string contains substring
func containsSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// Helper function to safely get string from map
func getStringOrEmpty(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func (s *Service) loginWithIpatool(email, password, authCode string, anisetteData *AnisetteData) (*models.AuthResponse, error) {
	log := logger.Logger

	log.Debug().Str("email", email).Bool("has_password", password != "").Bool("has_authcode", authCode != "").Msg("Calling appStore.Login (ipatool)")

	// Add safety checks
	if s == nil {
		log.Error().Msg("Service is nil")
		return nil, fmt.Errorf("service is nil")
	}

	if s.appStore == nil {
		log.Error().Msg("AppStore client is nil")
		return nil, fmt.Errorf("service not properly initialized: appStore is nil")
	}

	if anisetteData == nil {
		anisetteData = s.loadAppStoreAnisetteData(email)
	}
	if anisetteData != nil {
		log.Info().
			Str("email", email).
			Str("client_time", anisetteData.ClientTime).
			Msg("Using ApplePackage-compatible App Store login request")
	} else {
		log.Warn().Str("email", email).Msg("Proceeding with App Store login without stored anisette context")
	}

	output, err := s.withTemporaryAppStoreHeaders(anisetteData, func() (appstore.LoginOutput, error) {
		return s.appStore.Login(appstore.LoginInput{
			Email:    email,
			Password: password,
			AuthCode: authCode,
		})
	})

	log.Debug().Str("email", email).Bool("has_error", err != nil).Msg("appStore.Login returned")

	if err != nil {
		log.Error().Err(err).Str("email", email).Str("error_type", fmt.Sprintf("%T", err)).Str("error_string", err.Error()).Msg("Login failed, checking error type")

		// Check if 2FA is required
		if errors.Is(err, appstore.ErrAuthCodeRequired) {
			log.Info().Str("email", email).Msg("Two-factor authentication required")
			return &models.AuthResponse{
				Success:     false,
				Requires2FA: true,
				Message:     "Two-factor authentication required",
			}, nil
		}

		// Extract error message from appstore.Error if possible
		var appstoreErr *appstore.Error
		errMsg := err.Error()
		if errors.As(err, &appstoreErr) {
			errMsg = appstoreErr.Error()
			log.Error().Interface("metadata", appstoreErr.Metadata).Str("error_message", errMsg).Msg("AppStore error with metadata")
		}

		// Check for specific error messages and return English errors
		switch errMsg {
		case "account is disabled":
			return nil, fmt.Errorf("account is disabled")
		case "invalid username or password":
			return nil, fmt.Errorf("invalid username or password")
		case "incorrect credentials":
			return nil, fmt.Errorf("invalid username or password")
		case "something went wrong":
			return nil, fmt.Errorf("apple service error")
		case "too many attempts":
			return nil, fmt.Errorf("too many attempts")
		case "request failed: context canceled", "request failed: context deadline exceeded":
			return nil, fmt.Errorf("network timeout")
		case "failed to get mac address":
			return nil, fmt.Errorf("failed to get mac address")
		default:
			// Check if the error message contains specific keywords
			if errMsg == "" {
				return nil, fmt.Errorf("invalid username or password")
			}
			// Return the original error message if it's meaningful
			log.Error().Err(err).Str("email", email).Str("error_message", errMsg).Msg("Login failed with unhandled error")
			return nil, fmt.Errorf("login failed: %s", errMsg)
		}
	}

	// Check if account is valid
	if output.Account.Email == "" {
		log.Error().Str("email", email).Msg("Login output has empty account email")
		return nil, fmt.Errorf("login failed: invalid account from Apple")
	}

	log.Info().Str("email", email).Str("account_name", output.Account.Name).Str("storefront", output.Account.StoreFront).Msg("Login successful, saving account to keychain")
	s.saveCurrentAccount(&output.Account)

	// Save account to keychain
	accountData, err := json.Marshal(output.Account)
	if err != nil {
		log.Error().Err(err).Str("email", email).Msg("Failed to marshal account data")
		return nil, fmt.Errorf("failed to marshal account: %w", err)
	}

	err = s.keychain.Set(s.getAccountKey(email), accountData)
	if err != nil {
		log.Warn().Err(err).Str("email", email).Msg("Failed to save account to keychain; continuing with current session")
	}

	log.Info().Str("email", email).Msg("Account saved successfully")

	return &models.AuthResponse{
		Success: true,
		Email:   email,
		Message: "Login successful",
	}, nil
}

func (s *Service) Verify2FA(email, password, code string) (*models.AuthResponse, error) {
	log := logger.Logger

	log.Info().Str("email", email).Str("code_length", fmt.Sprintf("%d", len(code))).Msg("Verifying 2FA code")

	pending, err := s.GetPending2FA(email)
	if err != nil {
		log.Warn().Err(err).Str("email", email).Msg("No pending GSA 2FA session found; retrying App Store login with verification code")
		return s.loginWithGSAAndAppStoreCode(email, password, s.getAnisetteServerURL(), code)
	}

	if pending.AnisetteData == nil {
		return nil, fmt.Errorf("pending 2FA session is incomplete. Please log in again")
	}

	if time.Since(pending.CreatedAt) > 10*time.Minute {
		s.ClearPending2FA(email)
		return nil, fmt.Errorf("pending 2FA session expired. Please log in again")
	}

	if err := s.verifyGSA2FA(email, code, pending); err != nil {
		var twoFactorErr *TwoFactorError
		if errors.As(err, &twoFactorErr) {
			log.Warn().Err(err).Str("email", email).Str("auth_type", pending.AuthType).Msg("GSA 2FA verification rejected")
			return &models.AuthResponse{
				Success:     false,
				Requires2FA: true,
				Message:     twoFactorErr.Message,
				ErrorCode:   twoFactorErr.ErrorCode,
			}, nil
		}
		log.Error().Err(err).Str("email", email).Str("auth_type", pending.AuthType).Msg("GSA 2FA verification failed")
		return nil, err
	}

	s.ClearPending2FA(email)

	log.Info().Str("email", email).Msg("GSA 2FA verification completed successfully, restarting GSA login")
	return s.loginWithGSAAndAppStoreCode(email, password, pending.AnisetteURL, code)
}

func (s *Service) verifyGSA2FA(email, code string, pending *GSAPending2FA) error {
	if pending == nil || pending.AnisetteData == nil {
		return fmt.Errorf("pending 2FA session is incomplete")
	}

	identityToken := base64.StdEncoding.EncodeToString([]byte(pending.DSID + ":" + pending.IDMSToken))
	headers := GSAValidateHeaders{
		SecurityCode:        code,
		XAppleIClientTime:   pending.AnisetteData.ClientTime,
		XAppleIMd:           pending.AnisetteData.MD,
		XAppleIMdM:          pending.AnisetteData.MDM,
		XAppleIMdLu:         pending.AnisetteData.MDLU,
		XAppleIMdRInfo:      pending.AnisetteData.MDRINFO,
		XAppleITimeZone:     pending.AnisetteData.TimeZone,
		XAppleIdentityToken: identityToken,
		XMMEClientInfo:      pending.AnisetteData.ClientInfo,
		XMMEDeviceID:        pending.AnisetteData.DeviceID,
		AcceptLanguage:      "en-us",
		XAppleLocale:        pending.AnisetteData.Locale,
		UserAgent:           "Xcode",
	}

	if pending.AuthType == "trustedDeviceSecondaryAuth" {
		validateResult, err := GetGSAValidate(headers)
		if err != nil {
			return fmt.Errorf("failed to validate trusted device code: %w", err)
		}
		if validateResult.Body.EC != 0 {
			if validateResult.Body.EC == -21669 {
				return &TwoFactorError{Message: "incorrect verification code", ErrorCode: "invalid_or_expired_code"}
			}
			if strings.TrimSpace(validateResult.Body.EM) != "" {
				return &TwoFactorError{Message: strings.TrimSpace(validateResult.Body.EM)}
			}
			return &TwoFactorError{Message: fmt.Sprintf("failed to validate trusted device code: ec=%d", validateResult.Body.EC)}
		}
		return nil
	}

	return fmt.Errorf("unsupported GSA 2FA auth type: %s", pending.AuthType)
}

func requestTrustedDeviceCode(pending *GSAPending2FA) error {
	if pending == nil || pending.AnisetteData == nil {
		return fmt.Errorf("pending 2FA session is incomplete")
	}

	identityToken := base64.StdEncoding.EncodeToString([]byte(pending.DSID + ":" + pending.IDMSToken))
	headers := buildGSATwoFactorHeaders(GSAValidateHeaders{
		XAppleIClientTime:   pending.AnisetteData.ClientTime,
		XAppleIMd:           pending.AnisetteData.MD,
		XAppleIMdM:          pending.AnisetteData.MDM,
		XAppleIMdLu:         pending.AnisetteData.MDLU,
		XAppleIMdRInfo:      pending.AnisetteData.MDRINFO,
		XAppleITimeZone:     pending.AnisetteData.TimeZone,
		XAppleIdentityToken: identityToken,
		XMMEClientInfo:      pending.AnisetteData.ClientInfo,
		XMMEDeviceID:        pending.AnisetteData.DeviceID,
		AcceptLanguage:      "en-us",
		XAppleLocale:        pending.AnisetteData.Locale,
		UserAgent:           "Xcode",
	})

	request, err := http.NewRequest("GET", "https://gsa.apple.com/auth/verify/trusteddevice", nil)
	if err != nil {
		return fmt.Errorf("failed to create trusted device request: %w", err)
	}
	for key, values := range headers {
		for _, value := range values {
			request.Header.Add(key, value)
		}
	}

	client := &http.Client{
		Timeout: 60 * time.Second,
		Transport: &http.Transport{
			Proxy:           http.ProxyFromEnvironment,
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	}
	resp, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("failed to request trusted device code: %w", err)
	}
	defer resp.Body.Close()

	body, readErr := io.ReadAll(resp.Body)
	if readErr != nil {
		return fmt.Errorf("failed to read trusted device response: %w", readErr)
	}

	var trustedDeviceResp map[string]interface{}
	if len(body) > 0 {
		if err := json.Unmarshal(body, &trustedDeviceResp); err != nil {
			logger.Logger.Debug().Str("body", string(body)).Msg("Trusted device 2FA response is not JSON")
		} else if ecValue, ok := trustedDeviceResp["ec"]; ok {
			errorCode := 0
			switch value := ecValue.(type) {
			case float64:
				errorCode = int(value)
			case int:
				errorCode = value
			}
			if errorCode != 0 {
				errorMessage, _ := trustedDeviceResp["em"].(string)
				return fmt.Errorf("failed to request trusted device code: %s", strings.TrimSpace(errorMessage))
			}
		}
	}

	logger.Logger.Debug().Int("status_code", resp.StatusCode).Msg("Trusted device 2FA code request sent")
	return nil
}

func buildGSATwoFactorHeaders(hdr GSAValidateHeaders) http.Header {
	headers := make(http.Header)
	headers.Set("Accept", "application/x-buddyml")
	headers.Set("Accept-Language", "en-us")
	headers.Set("Content-Type", "application/x-plist")
	headers.Set("User-Agent", "Xcode")
	headers.Set("X-Apple-App-Info", "com.apple.gs.xcode.auth")
	headers.Set("X-Xcode-Version", "11.2 (11B41)")
	headers.Set("X-Apple-Identity-Token", hdr.XAppleIdentityToken)
	headers.Set("X-Apple-I-MD-M", hdr.XAppleIMdM)
	headers.Set("X-Apple-I-MD", hdr.XAppleIMd)
	headers.Set("X-Apple-I-MD-LU", hdr.XAppleIMdLu)
	headers.Set("X-Apple-I-MD-RINFO", hdr.XAppleIMdRInfo)
	headers.Set("X-Mme-Device-Id", hdr.XMMEDeviceID)
	headers.Set("X-MMe-Client-Info", hdr.XMMEClientInfo)
	headers.Set("X-Apple-I-Client-Time", hdr.XAppleIClientTime)
	headers.Set("X-Apple-Locale", hdr.XAppleLocale)
	headers.Set("X-Apple-I-TimeZone", hdr.XAppleITimeZone)
	if hdr.SecurityCode != "" {
		headers.Set("Security-Code", hdr.SecurityCode)
	}
	return headers
}

func (s *Service) CheckAuth(email string) (bool, error) {
	_, err := s.getAccount(email)
	if err != nil {
		return false, nil
	}
	return true, nil
}

func (s *Service) Logout(email string) error {
	log := logger.Logger

	// Remove account from keychain
	err := s.keychain.Remove(s.getAccountKey(email))
	if err != nil {
		return fmt.Errorf("failed to remove account: %w", err)
	}

	// Clear in-memory session account
	s.accountsMu.Lock()
	delete(s.currentAccounts, normalizeEmailKey(email))
	s.accountsMu.Unlock()

	// Also clear device metadata for this account
	if err := s.clearDeviceMetadata(email); err != nil {
		log.Warn().Err(err).Str("email", email).Msg("Failed to clear device metadata during logout (non-critical)")
	}

	// Clear persisted anisette
	if err := s.keychain.Remove(s.getAnisetteKey(email)); err != nil {
		log.Warn().Err(err).Str("email", email).Msg("Failed to clear anisette during logout (non-critical)")
	}

	return nil
}

func (s *Service) GetAccountInfo(email string) (*models.AccountInfo, error) {
	account, err := s.getAccount(email)
	if err != nil {
		return nil, err
	}

	// Extract country code from StoreFront
	countryCode, err := s.extractCountryCode(account.StoreFront)
	if err != nil {
		// If extraction fails, use StoreFront as-is
		countryCode = account.StoreFront
	}

	return &models.AccountInfo{
		Email:      account.Email,
		Name:       account.Name,
		StoreFront: countryCode, // Now returns the extracted country code
	}, nil
}

func (s *Service) GetAccountPassword(email string) (string, error) {
	log := logger.Logger
	account, err := s.loadStoredAccount(email)
	if err != nil {
		log.Error().Err(err).Str("email", email).Msg("Failed to get account for password retrieval")
		return "", err
	}
	hasPassword := account.Password != ""
	log.Info().Str("email", email).Bool("has_password", hasPassword).Msg("Retrieved account password from keychain")
	return account.Password, nil
}

func (s *Service) ListAccounts() ([]string, error) {
	// Prefer persisted keychain accounts so web/desktop can restore after restart.
	emails := make([]string, 0)
	seen := make(map[string]struct{})

	if s.keyring != nil {
		keys, err := s.keyring.Keys()
		if err != nil {
			logger.Logger.Warn().Err(err).Msg("Failed to list keyring keys for accounts; falling back to in-memory accounts")
		} else {
			for _, key := range keys {
				if !strings.HasPrefix(key, "account:") {
					continue
				}
				email := strings.TrimSpace(strings.TrimPrefix(key, "account:"))
				if email == "" {
					continue
				}
				normalized := normalizeEmailKey(email)
				if _, exists := seen[normalized]; exists {
					continue
				}
				// Validate stored payload can be loaded.
				if _, loadErr := s.loadStoredAccount(email); loadErr != nil {
					continue
				}
				seen[normalized] = struct{}{}
				emails = append(emails, email)
			}
		}
	}

	// Merge any in-memory session accounts not yet listed.
	s.accountsMu.RLock()
	for _, account := range s.currentAccounts {
		if account == nil {
			continue
		}
		email := strings.TrimSpace(account.Email)
		if email == "" {
			continue
		}
		normalized := normalizeEmailKey(email)
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		emails = append(emails, email)
	}
	s.accountsMu.RUnlock()

	return emails, nil
}

func (s *Service) SearchApps(keyword, limit, countryCode string) ([]models.AppSearchResult, error) {
	limitInt := int64(10)
	fmt.Sscanf(limit, "%d", &limitInt)

	// Use anonymous account with specified country code
	account := appstore.Account{
		Name:       "anonymous",
		Email:      "",
		Password:   "",
		StoreFront: countryCodeToStoreFront(countryCode),
	}

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
		apps = append(apps, s.convertAppToSearchResult(&app))
	}

	return apps, nil
}

// countryCodeToStoreFront converts country code to storefront ID
func countryCodeToStoreFront(countryCode string) string {
	// Map common country codes to Apple storefront IDs
	// Format: {countryCode}-{languageCode}
	countryMap := map[string]string{
		"us": "143441-1,29",
		"cn": "143465-19,29",
		"jp": "143462-9,29",
		"gb": "143444-2,29",
		"fr": "143442-2,29",
		"de": "143443-2,29",
		"au": "143460-2,29",
		"ca": "143455-6,29",
		"kr": "143466-13,29",
		"it": "143450-2,29",
		"es": "143454-2,29",
		"br": "143503-15,29",
		"in": "143467-2,29",
		"ru": "143469-16,29",
		"mx": "143468-28,29",
		"tw": "143470-18,29",
		"hk": "143463-18,29",
		"sg": "143464-2,29",
	}

	if storefront, ok := countryMap[strings.ToLower(countryCode)]; ok {
		return storefront
	}

	// Default to US if country code not found
	return "143441-1,29"
}

func (s *Service) GetAppDetails(bundleID, email string) (*models.AppDetails, error) {
	account, err := s.getAccount(email)
	if err != nil {
		return nil, fmt.Errorf("failed to get account: %w", err)
	}

	lookupOutput, err := s.appStore.Lookup(appstore.LookupInput{
		Account:  *account,
		BundleID: bundleID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to lookup app: %w", err)
	}

	app := lookupOutput.App
	details := &models.AppDetails{
		AppSearchResult:   s.convertAppToSearchResult(&app),
		Screenshots:       app.ScreenshotUrls,
		ScreenshotsIPad:   app.IpadScreenshotUrls,
		SupportedDevices:  app.SupportedDevices,
		LanguageCodes:     app.LanguageCodesISO2A,
		HasInAppPurchases: contains(app.Features, "iosUniversal"),
	}

	if subtitle, err := s.GetAppSubtitle(bundleID, account.StoreFront); err == nil && subtitle != "" {
		details.Subtitle = subtitle
	}

	return details, nil
}

func (s *Service) GetAppVersionHistory(bundleID, email string) (*models.AppVersionHistory, error) {
	log := logger.Logger
	log.Info().Str("bundle_id", bundleID).Str("email", email).Msg("Getting app version history")

	cacheDuration := time.Hour
	if !s.shouldFetchVersions(bundleID, cacheDuration) {
		log.Info().Str("bundle_id", bundleID).Msg("Using cached version history (fetched within 1 hour)")
		cache, err := s.loadVersionCache(bundleID)
		if err == nil && len(cache.Versions) > 0 {
			versions := make([]models.AppVersion, len(cache.Versions))
			for i, cv := range cache.Versions {
				versions[i] = models.AppVersion{
					VersionID:     cv.VersionID,
					VersionString: cv.VersionString,
					ReleaseDate:   cv.ReleaseDate,
					Success:       true,
				}
			}

			latestVersion := ""
			if len(cache.Versions) > 0 {
				latestVersion = cache.Versions[0].VersionID
			}

			log.Info().Str("bundle_id", bundleID).Int("version_count", len(versions)).Msg("Returning cached version history")
			return &models.AppVersionHistory{
				BundleID:      bundleID,
				AppName:       cache.AppName,
				LatestVersion: latestVersion,
				Versions:      versions,
			}, nil
		}
		log.Warn().Str("bundle_id", bundleID).Msg("Failed to load cache, fetching from App Store")
	}

	log.Info().Str("bundle_id", bundleID).Msg("Fetching fresh version history from App Store")

	account, err := s.getAccount(email)
	if err != nil {
		log.Error().Err(err).Str("bundle_id", bundleID).Str("email", email).Msg("Failed to get account")
		return nil, fmt.Errorf("failed to get account: %w", err)
	}
	log.Debug().Str("bundle_id", bundleID).Msg("Account retrieved successfully")

	lookupOutput, err := s.appStore.Lookup(appstore.LookupInput{
		Account:  *account,
		BundleID: bundleID,
	})
	if err != nil {
		log.Error().Err(err).Str("bundle_id", bundleID).Msg("Failed to lookup app")
		return nil, fmt.Errorf("failed to lookup app: %w", err)
	}
	log.Debug().Str("bundle_id", bundleID).Str("app_name", lookupOutput.App.Name).Msg("App lookup successful")

	app := lookupOutput.App

	versionsOutput, err := s.fetchVersionHistory(&account, email, bundleID, app, nil)
	if err != nil {
		return nil, err
	}

	// Fetch all version metadata in parallel, then return combined result
	var wg sync.WaitGroup
	results := make(chan models.AppVersion, len(versionsOutput.ExternalVersionIdentifiers))

	for _, vID := range versionsOutput.ExternalVersionIdentifiers {
		wg.Add(1)
		go func(versionID string) {
			defer wg.Done()
			md, mdErr := s.appStore.GetVersionMetadata(appstore.GetVersionMetadataInput{
				Account:   *account,
				App:       app,
				VersionID: versionID,
			})
			if mdErr != nil {
				results <- models.AppVersion{
					VersionID:     versionID,
					VersionString: versionID,
					Success:       false,
					Error:         mdErr.Error(),
				}
				return
			}
			results <- models.AppVersion{
				VersionID:     versionID,
				VersionString: md.DisplayVersion,
				ReleaseDate:   md.ReleaseDate.Format("2006-01-02"),
				Success:       true,
			}
		}(vID)
	}

	wg.Wait()
	close(results)

	versions := make([]models.AppVersion, 0, len(versionsOutput.ExternalVersionIdentifiers))
	for v := range results {
		versions = append(versions, v)
	}

	log.Info().Str("bundle_id", bundleID).Int("version_count", len(versions)).Msg("Returning version history")

	cacheItems := make([]versionCacheItem, 0, len(versions))
	for _, v := range versions {
		if v.Success {
			cacheItems = append(cacheItems, versionCacheItem{
				VersionID:     v.VersionID,
				VersionString: v.VersionString,
				ReleaseDate:   v.ReleaseDate,
			})
		}
	}

	cache := &appVersionCache{
		BundleID:     bundleID,
		AppName:      app.Name,
		LastFetchAt:  time.Now(),
		VersionCount: len(cacheItems),
		Versions:     cacheItems,
	}

	if err := s.saveVersionCache(cache); err != nil {
		log.Warn().Err(err).Str("bundle_id", bundleID).Msg("Failed to save version cache (non-critical)")
	} else {
		log.Info().Str("bundle_id", bundleID).Int("cached_count", len(cacheItems)).Msg("Version cache saved successfully")
	}

	return &models.AppVersionHistory{
		BundleID:      bundleID,
		AppName:       app.Name,
		LatestVersion: versionsOutput.LatestExternalVersionID,
		Versions:      versions,
	}, nil
}

// GetAppVersionHistoryWithProgress gets app version history and broadcasts progress via WebSocket
func (s *Service) GetAppVersionHistoryWithProgress(bundleID, email, taskID string, broadcastFunc func(interface{})) (*models.AppVersionHistory, error) {
	log := logger.Logger
	log.Info().Str("bundle_id", bundleID).Str("email", email).Str("task_id", taskID).Msg("Getting app version history with progress")

	// Broadcast started
	broadcastFunc(models.TaskProgress{
		Type:     "task_progress",
		TaskID:   taskID,
		TaskType: "version_history",
		Status:   "started",
		Progress: 0,
		Message:  "Starting version history lookup...",
	})

	cacheDuration := time.Hour
	if !s.shouldFetchVersions(bundleID, cacheDuration) {
		log.Info().Str("bundle_id", bundleID).Msg("Using cached version history (fetched within 1 hour)")
		cache, err := s.loadVersionCache(bundleID)
		if err == nil && len(cache.Versions) > 0 {
			time.Sleep(100 * time.Millisecond)

			broadcastFunc(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   taskID,
				TaskType: "version_history",
				Status:   "progress",
				Progress: 50,
				Message:  "Loading cached version history...",
			})

			versions := make([]models.AppVersion, len(cache.Versions))
			for i, cv := range cache.Versions {
				versions[i] = models.AppVersion{
					VersionID:     cv.VersionID,
					VersionString: cv.VersionString,
					ReleaseDate:   cv.ReleaseDate,
					Success:       true,
				}
			}

			latestVersion := ""
			if len(cache.Versions) > 0 {
				latestVersion = cache.Versions[0].VersionID
			}

			log.Info().Str("bundle_id", bundleID).Int("version_count", len(versions)).Msg("Returning cached version history")

			broadcastFunc(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   taskID,
				TaskType: "version_history",
				Status:   "completed",
				Progress: 100,
				Message:  "Version history loaded from cache",
			})

			return &models.AppVersionHistory{
				BundleID:      bundleID,
				AppName:       cache.AppName,
				LatestVersion: latestVersion,
				Versions:      versions,
			}, nil
		}
		log.Warn().Str("bundle_id", bundleID).Msg("Failed to load cache, fetching from App Store")
	}

	account, err := s.getAccount(email)
	if err != nil {
		log.Error().Err(err).Str("bundle_id", bundleID).Str("email", email).Msg("Failed to get account")
		return nil, fmt.Errorf("failed to get account: %w", err)
	}

	// Progress: 10%
	broadcastFunc(models.TaskProgress{
		Type:     "task_progress",
		TaskID:   taskID,
		TaskType: "version_history",
		Status:   "progress",
		Progress: 10,
		Message:  "Looking up app information...",
	})

	lookupOutput, err := s.appStore.Lookup(appstore.LookupInput{
		Account:  *account,
		BundleID: bundleID,
	})
	if err != nil {
		log.Error().Err(err).Str("bundle_id", bundleID).Msg("Failed to lookup app")
		return nil, fmt.Errorf("failed to lookup app: %w", err)
	}

	app := lookupOutput.App
	log.Debug().Str("bundle_id", bundleID).Str("app_name", lookupOutput.App.Name).Msg("App lookup successful")

	// Progress: 20%
	broadcastFunc(models.TaskProgress{
		Type:     "task_progress",
		TaskID:   taskID,
		TaskType: "version_history",
		Status:   "progress",
		Progress: 20,
		Message:  "Preparing version lookup...",
	})

	versionsOutput, err := s.fetchVersionHistory(&account, email, bundleID, app, &versionHistoryProgressReporter{taskID: taskID, broadcastFunc: broadcastFunc})
	if err != nil {
		return nil, err
	}

	// Progress: 70%
	broadcastFunc(models.TaskProgress{
		Type:     "task_progress",
		TaskID:   taskID,
		TaskType: "version_history",
		Status:   "progress",
		Progress: 70,
		Message:  "Loading version metadata...",
	})

	// Fetch all version metadata in parallel, then return combined result
	var wg sync.WaitGroup
	results := make(chan models.AppVersion, len(versionsOutput.ExternalVersionIdentifiers))

	for _, vID := range versionsOutput.ExternalVersionIdentifiers {
		wg.Add(1)
		go func(versionID string) {
			defer wg.Done()
			md, mdErr := s.appStore.GetVersionMetadata(appstore.GetVersionMetadataInput{
				Account:   *account,
				App:       app,
				VersionID: versionID,
			})
			if mdErr != nil {
				results <- models.AppVersion{
					VersionID:     versionID,
					VersionString: versionID,
					Success:       false,
					Error:         mdErr.Error(),
				}
				return
			}
			results <- models.AppVersion{
				VersionID:     versionID,
				VersionString: md.DisplayVersion,
				ReleaseDate:   md.ReleaseDate.Format("2006-01-02"),
				Success:       true,
			}
		}(vID)
	}

	wg.Wait()
	close(results)

	versions := make([]models.AppVersion, 0, len(versionsOutput.ExternalVersionIdentifiers))
	for v := range results {
		versions = append(versions, v)
	}

	log.Info().Str("bundle_id", bundleID).Int("version_count", len(versions)).Msg("Returning version history")

	// Progress: 90%
	broadcastFunc(models.TaskProgress{
		Type:     "task_progress",
		TaskID:   taskID,
		TaskType: "version_history",
		Status:   "progress",
		Progress: 90,
		Message:  "Finalizing results...",
	})

	cacheItems := make([]versionCacheItem, 0, len(versions))
	for _, v := range versions {
		if v.Success {
			cacheItems = append(cacheItems, versionCacheItem{
				VersionID:     v.VersionID,
				VersionString: v.VersionString,
				ReleaseDate:   v.ReleaseDate,
			})
		}
	}

	cache := &appVersionCache{
		BundleID:     bundleID,
		AppName:      app.Name,
		LastFetchAt:  time.Now(),
		VersionCount: len(cacheItems),
		Versions:     cacheItems,
	}

	if err := s.saveVersionCache(cache); err != nil {
		log.Warn().Err(err).Str("bundle_id", bundleID).Msg("Failed to save version cache (non-critical)")
	} else {
		log.Info().Str("bundle_id", bundleID).Int("cached_count", len(cacheItems)).Msg("Version cache saved successfully")
	}

	return &models.AppVersionHistory{
		BundleID:      bundleID,
		AppName:       app.Name,
		LatestVersion: versionsOutput.LatestExternalVersionID,
		Versions:      versions,
	}, nil
}

func (s *Service) GetVersionDetails(bundleID, email string, versionIDs []string) ([]models.AppVersion, error) {
	account, err := s.getAccount(email)
	if err != nil {
		return nil, fmt.Errorf("failed to get account: %w", err)
	}

	lookupOutput, err := s.appStore.Lookup(appstore.LookupInput{
		Account:  *account,
		BundleID: bundleID,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to lookup app: %w", err)
	}

	app := lookupOutput.App
	versions := make([]models.AppVersion, 0, len(versionIDs))

	for _, versionID := range versionIDs {
		metadata, err := s.appStore.GetVersionMetadata(appstore.GetVersionMetadataInput{
			Account:   *account,
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

func (s *Service) CheckLicense(bundleID, email string) (bool, error) {
	log := logger.Logger
	log.Info().Str("bundle_id", bundleID).Str("email", email).Msg("Checking app license")

	account, err := s.getAccount(email)
	if err != nil {
		log.Error().Err(err).Str("bundle_id", bundleID).Msg("Failed to get account")
		return false, fmt.Errorf("failed to get account: %w", err)
	}

	lookupOutput, err := s.appStore.Lookup(appstore.LookupInput{
		Account:  *account,
		BundleID: bundleID,
	})
	if err != nil {
		log.Error().Err(err).Str("bundle_id", bundleID).Msg("Failed to lookup app")
		return false, fmt.Errorf("failed to lookup app: %w", err)
	}

	app := lookupOutput.App

	err = s.appStore.Purchase(appstore.PurchaseInput{
		Account: *account,
		App:     app,
	})

	if err != nil {
		if errors.Is(err, appstore.ErrPasswordTokenExpired) {
			log.Error().Err(err).Str("bundle_id", bundleID).Msg("Password token expired - attempting refresh and retry")
			// Refresh token and retry once
			newAccount, refreshErr := s.refreshAccountToken(email, account)
			if refreshErr == nil {
				account = newAccount
				err = s.appStore.Purchase(appstore.PurchaseInput{Account: *account, App: app})
			}

			if err != nil {
				log.Error().Err(err).Str("bundle_id", bundleID).Msg("Password token refresh retry failed")
				return false, fmt.Errorf("password token expired")
			}
			log.Info().Str("bundle_id", bundleID).Msg("License acquired successfully after token refresh")
			return true, nil
		}

		errMsg := err.Error()
		if errMsg == "license already exists" {
			log.Info().Str("bundle_id", bundleID).Msg("License already exists")
			return true, nil
		}
		log.Error().Err(err).Str("bundle_id", bundleID).Msg("Failed to check license")
		return false, nil
	}

	log.Info().Str("bundle_id", bundleID).Msg("License acquired successfully")
	return true, nil
}

// RSS Feed Response Structures
type RSSFeedResponse struct {
	Feed struct {
		Results []RSSApp `json:"results"`
	} `json:"feed"`
}

type RSSApp struct {
	ID string `json:"id"`
}

// New Top Charts API Response Structure
type TopChartsResponse struct {
	ResultIds []string `json:"resultIds"`
}

// iTunes Lookup Response Structures
type ITunesLookupResponse struct {
	ResultCount int               `json:"resultCount"`
	Results     []ITunesLookupApp `json:"results"`
}

type ITunesLookupApp struct {
	TrackId                   int64    `json:"trackId"`
	BundleId                  string   `json:"bundleId"`
	TrackName                 string   `json:"trackName"`
	Version                   string   `json:"version"`
	Price                     float64  `json:"price"`
	FormattedPrice            string   `json:"formattedPrice"`
	ArtworkUrl512             string   `json:"artworkUrl512"`
	ArtworkUrl100             string   `json:"artworkUrl100"`
	ArtworkUrl60              string   `json:"artworkUrl60"`
	Description               string   `json:"description"`
	ReleaseNotes              string   `json:"releaseNotes"`
	ArtistName                string   `json:"artistName"`
	ArtistId                  int64    `json:"artistId"`
	Genres                    []string `json:"genres"`
	PrimaryGenreName          string   `json:"primaryGenreName"`
	ContentAdvisoryRating     string   `json:"contentAdvisoryRating"`
	AverageUserRating         float64  `json:"averageUserRating"`
	UserRatingCount           int      `json:"userRatingCount"`
	FileSizeBytes             string   `json:"fileSizeBytes"`
	MinimumOsVersion          string   `json:"minimumOsVersion"`
	ReleaseDate               string   `json:"releaseDate"`
	CurrentVersionReleaseDate string   `json:"currentVersionReleaseDate"`
	ScreenshotUrls            []string `json:"screenshotUrls"`
	IpadScreenshotUrls        []string `json:"ipadScreenshotUrls"`
	SupportedDevices          []string `json:"supportedDevices"`
	LanguageCodesISO2A        []string `json:"languageCodesISO2A"`
}

func (s *Service) GetTopApps(limit int, country string) ([]models.AppSearchResult, error) {
	if country == "" {
		country = "us"
	}
	if limit <= 0 {
		limit = 50
	}

	// 1. Fetch Top Charts using new API
	// https://itunes.apple.com/WebObjects/MZStoreServices.woa/ws/charts?cc=cn&g=36&name=FreeApplications&limit=10
	chartsURL := fmt.Sprintf("https://itunes.apple.com/WebObjects/MZStoreServices.woa/ws/charts?cc=%s&g=36&name=FreeApplications&limit=%d", country, limit)
	resp, err := http.Get(chartsURL)
	if err != nil {
		logger.Logger.Error().Err(err).Str("url", chartsURL).Msg("Failed to fetch top charts")
		return nil, fmt.Errorf("failed to fetch top charts: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		logger.Logger.Warn().Int("status_code", resp.StatusCode).Str("url", chartsURL).Msg("Top charts API returned non-200 status")
		return nil, fmt.Errorf("top charts API returned status: %d", resp.StatusCode)
	}

	var chartsResp TopChartsResponse
	if err := json.NewDecoder(resp.Body).Decode(&chartsResp); err != nil {
		return nil, fmt.Errorf("failed to decode top charts response: %w", err)
	}

	if len(chartsResp.ResultIds) == 0 {
		return []models.AppSearchResult{}, nil
	}

	// 2. Use extracted IDs
	ids := chartsResp.ResultIds

	// 3. Call iTunes Lookup API
	lookupURL := fmt.Sprintf("https://itunes.apple.com/lookup?id=%s&country=%s", strings.Join(ids, ","), country)
	lookupResp, err := appSubtitleHTTPClient.Get(lookupURL)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch iTunes lookup: %w", err)
	}
	defer lookupResp.Body.Close()

	if lookupResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("iTunes lookup returned status: %d", lookupResp.StatusCode)
	}

	var lookupResult ITunesLookupResponse
	if err := json.NewDecoder(lookupResp.Body).Decode(&lookupResult); err != nil {
		return nil, fmt.Errorf("failed to decode iTunes lookup response: %w", err)
	}

	// 4. Map to AppSearchResult
	// Maintain order from charts response
	resultsMap := make(map[string]models.AppSearchResult)
	for _, app := range lookupResult.Results {
		fileSize := int64(0)
		fmt.Sscanf(app.FileSizeBytes, "%d", &fileSize)

		res := models.AppSearchResult{
			ID:                        app.TrackId,
			BundleID:                  app.BundleId,
			Name:                      app.TrackName,
			Version:                   app.Version,
			Price:                     app.Price,
			FormattedPrice:            app.FormattedPrice,
			IconURL:                   app.ArtworkUrl512,
			IconURL60:                 app.ArtworkUrl60,
			IconURL100:                app.ArtworkUrl100,
			IconURL512:                app.ArtworkUrl512,
			Description:               app.Description,
			ReleaseNotes:              app.ReleaseNotes,
			DeveloperName:             app.ArtistName,
			DeveloperID:               app.ArtistId,
			Genres:                    app.Genres,
			PrimaryGenre:              app.PrimaryGenreName,
			ContentRating:             app.ContentAdvisoryRating,
			AverageRating:             app.AverageUserRating,
			RatingCount:               app.UserRatingCount,
			FileSize:                  fileSize,
			FileSizeFormatted:         formatFileSize(fileSize),
			MinimumOSVersion:          app.MinimumOsVersion,
			ReleaseDate:               app.ReleaseDate,
			CurrentVersionReleaseDate: app.CurrentVersionReleaseDate,
		}
		resultsMap[fmt.Sprintf("%d", app.TrackId)] = res
	}

	var results []models.AppSearchResult
	for _, id := range ids {
		if res, ok := resultsMap[id]; ok {
			results = append(results, res)
		}
	}

	return results, nil
}

// Device metadata management methods

func (s *Service) getDeviceMetadataKey(email string) string {
	return fmt.Sprintf("device:%s", normalizeEmailKey(email))
}

func (s *Service) loadDeviceMetadata(email string) (*DeviceMetadata, error) {
	b, err := s.keychain.Get(s.getDeviceMetadataKey(email))
	if err != nil {
		return nil, fmt.Errorf("device metadata not found: %w", err)
	}
	var metadata DeviceMetadata
	if err := json.Unmarshal(b, &metadata); err != nil {
		return nil, fmt.Errorf("failed to unmarshal device metadata: %w", err)
	}
	return &metadata, nil
}

func (s *Service) saveDeviceMetadata(email string, metadata *DeviceMetadata) error {
	b, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("failed to marshal device metadata: %w", err)
	}
	if err := s.keychain.Set(s.getDeviceMetadataKey(email), b); err != nil {
		return fmt.Errorf("failed to save device metadata: %w", err)
	}
	return nil
}

func (s *Service) clearDeviceMetadata(email string) error {
	if err := s.keychain.Remove(s.getDeviceMetadataKey(email)); err != nil {
		return fmt.Errorf("failed to clear device metadata: %w", err)
	}
	return nil
}

func (s *Service) clearGSACredentials(email string) error {
	if err := s.keychain.Remove(s.getGSAKey(email)); err != nil {
		return fmt.Errorf("failed to clear GSA credentials: %w", err)
	}
	return nil
}

// fetchAppAuthToken fetches an app-specific auth token for Developer Portal API calls
// This implements the same flow as Sidestore: sending "apptokens" request to GSA and decrypting the response
func (s *Service) fetchAppAuthToken(spdData *SPDData, anisetteData *AnisetteData) (string, error) {
	log := logger.Logger

	if spdData == nil {
		return "", fmt.Errorf("SPD data is nil")
	}

	if len(spdData.SessionKey) == 0 || len(spdData.C) == 0 {
		return "", fmt.Errorf("SPD data missing session key or challenge")
	}

	if len(spdData.GsIdmsToken) == 0 {
		return "", fmt.Errorf("SPD data missing GsIdmsToken")
	}

	log.Debug().
		Int("sk_len", len(spdData.SessionKey)).
		Int("c_len", len(spdData.C)).
		Str("adsid", spdData.ADSID).
		Msg("Fetching app-specific auth token for com.apple.gs.xcode.auth")

	// Step 1: Generate checksum using session key
	// checksum = HMAC-SHA256(sessionKey, "apptokens" + dsid + appName)
	// This matches Sidestore's GSAContext.makeChecksum implementation
	appName := "com.apple.gs.xcode.auth"
	checksum := generateApptokensChecksum(spdData.SessionKey, spdData.ADSID, appName)

	log.Debug().
		Str("checksum_hex_full", fmt.Sprintf("%x", checksum)).
		Int("checksum_len", len(checksum)).
		Str("input_apptokens", "apptokens").
		Str("input_dsid", spdData.ADSID).
		Str("input_appName", appName).
		Int("sessionKey_len", len(spdData.SessionKey)).
		Str("sessionKey_hex_prefix", fmt.Sprintf("%x", spdData.SessionKey[:min(8, len(spdData.SessionKey))])).
		Msg("Generated checksum for app token request")

	// Step 2: Build apptokens request parameters (matching Sidestore)
	params := map[string]interface{}{
		"app":      []string{appName},
		"c":        spdData.C,
		"checksum": checksum,
		"o":        "apptokens",
		"t":        spdData.GsIdmsToken,
		"u":        spdData.ADSID,
	}

	log.Debug().
		Str("app", appName).
		Int("c_len", len(spdData.C)).
		Str("c_hex_prefix", fmt.Sprintf("%x", spdData.C[:min(16, len(spdData.C))])).
		Int("checksum_len", len(checksum)).
		Str("operation", "apptokens").
		Int("token_len", len(spdData.GsIdmsToken)).
		Str("token_prefix", spdData.GsIdmsToken[:min(20, len(spdData.GsIdmsToken))]+"...").
		Str("dsid", spdData.ADSID).
		Msg("Sending apptokens request with parameters")

	// Step 3: Send apptokens request to GSA
	respData, err := s.sendGSAAppTokensRequest(params, anisetteData)
	if err != nil {
		return "", fmt.Errorf("failed to send apptokens request: %w", err)
	}

	// Debug: Log all response fields
	log.Debug().
		Interface("response_keys", func() []string {
			keys := make([]string, 0, len(respData))
			for k := range respData {
				keys = append(keys, k)
			}
			return keys
		}()).
		Interface("response_types", func() map[string]string {
			types := make(map[string]string)
			for k, v := range respData {
				types[k] = fmt.Sprintf("%T", v)
			}
			return types
		}()).
		Msg("GSA apptokens response structure")

	// Step 4: Extract encrypted token from response
	// Check if 'et' exists and log its type
	etValue, hasET := respData["et"]
	if !hasET {
		log.Error().
			Interface("all_keys", func() []string {
				keys := make([]string, 0, len(respData))
				for k := range respData {
					keys = append(keys, k)
				}
				return keys
			}()).
			Msg("Response does not contain 'et' field - checking for Status/error")

		// Check for error in response
		if status, ok := respData["Status"].(map[string]interface{}); ok {
			log.Error().
				Interface("status_content", status).
				Msg("GSA apptokens request returned Status only (no et field)")

			// Try to extract error code and message
			ec := 0
			em := ""

			if ecVal, ok := status["ec"]; ok {
				switch v := ecVal.(type) {
				case int:
					ec = v
				case int64:
					ec = int(v)
				case uint64:
					ec = int(v)
				}
			}

			if emVal, ok := status["em"]; ok {
				if s, ok := emVal.(string); ok {
					em = s
				}
			}

			log.Error().
				Int("error_code", ec).
				Str("error_message", em).
				Msg("GSA apptokens Status details")

			if ec != 0 {
				if em != "" {
					return "", fmt.Errorf("GSA apptokens error (code %d): %s", ec, em)
				}
				return "", fmt.Errorf("GSA apptokens error code: %d", ec)
			}

			// Even if ec=0, the lack of 'et' is still an error
			return "", fmt.Errorf("GSA apptokens request succeeded (ec=%d) but no 'et' field returned", ec)
		}

		return "", fmt.Errorf("response does not contain 'et' field - available keys: %v", func() []string {
			keys := make([]string, 0, len(respData))
			for k := range respData {
				keys = append(keys, k)
			}
			return keys
		}())
	}

	log.Debug().Str("et_type", fmt.Sprintf("%T", etValue)).Msg("Found 'et' field in response")

	encryptedToken, ok := etValue.([]byte)
	if !ok {
		// Try to convert from Data type or string
		if dataVal, ok := etValue.(plist.UID); ok {
			log.Debug().Interface("et_uid", dataVal).Msg("et is plist.UID type")
			return "", fmt.Errorf("et field is plist.UID, not []byte - needs conversion")
		}
		return "", fmt.Errorf("et field has wrong type: %T (expected []byte)", etValue)
	}

	log.Debug().Int("encrypted_token_len", len(encryptedToken)).Msg("Received encrypted app token")

	// Step 5: Decrypt token using GCM with session key
	// GCM key and nonce are derived from session key
	decryptedToken, err := decryptAppToken(spdData.SessionKey, encryptedToken)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt app token: %w", err)
	}

	log.Debug().Int("decrypted_len", len(decryptedToken)).Msg("Decrypted app token data")

	// Step 6: Parse decrypted token (plist format)
	tokenDict, err := parsePlistData(decryptedToken)
	if err != nil {
		return "", fmt.Errorf("failed to parse decrypted token: %w", err)
	}

	// Step 7: Extract the app-specific token for xcode.auth.
	// AltStore expects the decrypted plist shape to be:
	// { t: { "com.apple.gs.xcode.auth": { token: "..." } } }
	tokensRoot, ok := tokenDict["t"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("token dictionary missing top-level 't' field")
	}

	appTokenEntry, ok := tokensRoot[appName].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("token dictionary missing app entry for %s", appName)
	}

	appToken, ok := appTokenEntry["token"].(string)
	if !ok || strings.TrimSpace(appToken) == "" {
		return "", fmt.Errorf("token dictionary missing token string for %s", appName)
	}

	log.Info().
		Str("token_prefix", func() string {
			if len(appToken) > 30 {
				return appToken[:30] + "..."
			}
			return appToken
		}()).
		Msg("Successfully fetched app-specific auth token")

	return appToken, nil
}

// generateApptokensChecksum creates HMAC-SHA256 checksum for app token request
// Matches Sidestore's GSAContext.makeChecksum: HMAC(sessionKey, "apptokens" + dsid + appName)
func generateApptokensChecksum(sessionKey []byte, dsid, appName string) []byte {
	mac := hmac.New(sha256.New, sessionKey)
	mac.Write([]byte("apptokens"))
	mac.Write([]byte(dsid))
	mac.Write([]byte(appName))
	return mac.Sum(nil)
}

// sendGSAAppTokensRequest sends apptokens request to Apple GSA service
func (s *Service) sendGSAAppTokensRequest(params map[string]interface{}, anisetteData *AnisetteData) (map[string]interface{}, error) {
	log := logger.Logger

	// CRITICAL: Use GSARequestCPD struct to ensure cpd key order matches GSA Step 1/2!
	// Using map[string]interface{} causes keys to be sorted alphabetically,
	// which differs from GSARequestCPD struct field order and causes Apple to reject the request!
	cpd := &GSARequestCPD{
		BootStrap: true,
		ICSCrec:   true,
		PBE:       false,
		PRKGEN:    true,
		SVCT:      "iCloud",
	}

	if anisetteData != nil {
		cpd.Loc = anisetteData.Locale
		cpd.XAppleLocale = anisetteData.Locale
		cpd.IMD = anisetteData.MD
		cpd.IMDM = anisetteData.MDM
		// DeviceID must match the format used in GSA login (lowercase, no dashes)
		cpd.UDID = canonicalDeviceID(anisetteData.DeviceID)
		cpd.IMDLU = anisetteData.MDLU
		// RINFO must be uint64 to match SideStore's NSUInteger (unsigned long long)
		cpd.RInfo = 17106176
		if n, err := strconv.ParseUint(strings.TrimSpace(anisetteData.MDRINFO), 10, 64); err == nil {
			cpd.RInfo = n
		}
		cpd.SerialNumber = anisetteData.SRLNO
		cpd.ClientTime = anisetteData.ClientTime
		cpd.TimeZone = anisetteData.TimeZone
	} else {
		cpd.Loc = "en_US"
		cpd.XAppleLocale = "en_US"
		cpd.TimeZone = "UTC"
		cpd.RInfo = 17106176
	}

	// Build deterministic, struct-based request (avoid map ordering issues)
	appName := "com.apple.gs.xcode.auth"
	apps, _ := params["app"].([]string)
	if len(apps) == 0 {
		apps = []string{appName}
	}
	challenge, _ := params["c"].([]byte)
	checksum, _ := params["checksum"].([]byte)
	token, _ := params["t"].(string)
	user, _ := params["u"].(string)

	req := &GSAApptokensRequest{
		App:       apps,
		C:         challenge,
		Checksum:  checksum,
		CPD:       *cpd,
		Operation: "apptokens",
		Token:     token,
		User:      user,
	}

	// Debug: Log all CPD fields for comparison with GSA login
	mdPreview := cpd.IMD
	if len(mdPreview) > 20 {
		mdPreview = mdPreview[:20] + "..."
	}
	mdmPreview := cpd.IMDM
	if len(mdmPreview) > 20 {
		mdmPreview = mdmPreview[:20] + "..."
	}
	log.Debug().
		Bool("bootstrap", cpd.BootStrap).
		Bool("icscrec", cpd.ICSCrec).
		Bool("pbe", cpd.PBE).
		Bool("prkgen", cpd.PRKGEN).
		Str("svct", cpd.SVCT).
		Str("loc", cpd.Loc).
		Str("X-Apple-Locale", cpd.XAppleLocale).
		Str("X-Apple-I-MD", mdPreview).
		Str("X-Apple-I-MD-M", mdmPreview).
		Str("X-Mme-Device-Id", cpd.UDID).
		Str("X-Apple-I-MD-LU", cpd.IMDLU).
		Uint64("X-Apple-I-MD-RINFO", cpd.RInfo).
		Str("X-Apple-I-SRL-NO", cpd.SerialNumber).
		Str("X-Apple-I-Client-Time", cpd.ClientTime).
		Str("X-Apple-I-TimeZone", cpd.TimeZone).
		Msg("apptokens CPD fields (using GSARequestCPD struct for consistent key order)")

	// Send request using existing GSA network infrastructure
	// Only set X-MMe-Client-Info in HTTP headers - all other Anisette data is in cpd
	// Matches Sidestore's sendAuthenticationRequest (line 387)
	headers := GSAValidateHeaders{}
	if anisetteData != nil {
		headers.XMMEClientInfo = anisetteData.ClientInfo
		log.Debug().
			Str("X-MMe-Client-Info", anisetteData.ClientInfo).
			Msg("Setting X-MMe-Client-Info header for apptokens request")
	} else {
		log.Warn().Msg("anisetteData is nil for apptokens request - X-MMe-Client-Info will be empty!")
	}

	respData, err := PostGSAApptokensRequest(req, headers)
	if err != nil {
		return nil, fmt.Errorf("GSA apptokens request failed: %w", err)
	}

	log.Debug().Msg("GSA apptokens request successful")
	return respData, nil
}

// decryptAppToken decrypts encrypted app token using AES-GCM
func decryptAppToken(sessionKey, encryptedToken []byte) ([]byte, error) {
	// AltStore uses the SPD "sk" value directly as the AES-GCM key for apptokens.
	// The nonce and authentication tag are embedded in Apple's envelope.
	decrypted, err := DecryptGCM(sessionKey, encryptedToken)
	if err != nil {
		return nil, fmt.Errorf("GCM decryption failed: %w", err)
	}

	return decrypted, nil
}

// parsePlistData parses plist-encoded data
func parsePlistData(data []byte) (map[string]interface{}, error) {
	var result map[string]interface{}
	decoder := plist.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(&result); err != nil {
		return nil, fmt.Errorf("plist decode error: %w", err)
	}
	return result, nil
}

// Helper methods

func (s *Service) getAccountKey(email string) string {
	return fmt.Sprintf("account:%s", normalizeEmailKey(email))
}

func (s *Service) saveCurrentAccount(account *appstore.Account) {
	if account == nil || strings.TrimSpace(account.Email) == "" {
		return
	}
	accountCopy := *account
	s.accountsMu.Lock()
	s.currentAccounts[normalizeEmailKey(account.Email)] = &accountCopy
	s.accountsMu.Unlock()
}

func (s *Service) loadCurrentAccount(email string) (*appstore.Account, bool) {
	s.accountsMu.RLock()
	account, ok := s.currentAccounts[normalizeEmailKey(email)]
	s.accountsMu.RUnlock()
	if !ok || account == nil {
		return nil, false
	}
	accountCopy := *account
	accountCopy.StoreFront = normalizeStoreFrontID(accountCopy.StoreFront)
	return &accountCopy, true
}

func (s *Service) loadStoredAccount(email string) (*appstore.Account, error) {
	accountData, err := s.keychain.Get(s.getAccountKey(email))
	if err != nil {
		if account, ok := s.loadCurrentAccount(email); ok {
			logger.Logger.Warn().Err(err).Str("email", email).Msg("Account keyring unavailable; using current in-memory account")
			return account, nil
		}
		return nil, fmt.Errorf("account not found: %w", err)
	}

	var account appstore.Account
	if err := json.Unmarshal(accountData, &account); err != nil {
		return nil, fmt.Errorf("failed to unmarshal account: %w", err)
	}

	account.StoreFront = normalizeStoreFrontID(account.StoreFront)

	return &account, nil
}

func normalizeStoreFrontID(storeFront string) string {
	return strings.TrimSpace(strings.Split(strings.TrimSpace(storeFront), "-")[0])
}

func hasUsableAppStoreSession(account *appstore.Account) bool {
	if account == nil {
		return false
	}

	return len(strings.TrimSpace(account.PasswordToken)) > 0 &&
		len(strings.TrimSpace(account.DirectoryServicesID)) > 0 &&
		len(strings.TrimSpace(account.StoreFront)) > 0
}

func (s *Service) getAccount(email string) (*appstore.Account, error) {
	account, err := s.loadStoredAccount(email)
	if err != nil {
		return nil, err
	}

	s.restoreAppStoreAccountContext(email)

	if !hasUsableAppStoreSession(account) {
		logger.Logger.Warn().
			Str("email", email).
			Bool("has_password_token", len(strings.TrimSpace(account.PasswordToken)) > 0).
			Bool("has_dsid", len(strings.TrimSpace(account.DirectoryServicesID)) > 0).
			Bool("has_storefront", len(strings.TrimSpace(account.StoreFront)) > 0).
			Msg("Stored account is missing App Store session fields; attempting to refresh App Store login")

		refreshedAccount, refreshErr := s.refreshAccountToken(email, account)
		if refreshErr != nil {
			return nil, fmt.Errorf("stored account is missing required App Store session data and refresh failed: %w", refreshErr)
		}

		account = refreshedAccount
	}

	// Return a pointer to the account
	return account, nil
}

func (s *Service) extractCountryCode(storefront string) (string, error) {
	// StoreFront format is usually like "143441-1,29" where 143441 is the ID
	// We need to map this to a country code
	// For simplicity, we'll extract the first part and use a basic mapping

	if storefront == "" {
		return "us", nil
	}

	// Basic mapping of common storefront IDs to country codes
	storefrontMap := map[string]string{
		"143441": "us", // United States
		"143442": "fr", // France
		"143443": "de", // Germany
		"143444": "gb", // United Kingdom
		"143445": "at", // Austria
		"143446": "be", // Belgium
		"143447": "fi", // Finland
		"143448": "gr", // Greece
		"143449": "ie", // Ireland
		"143450": "it", // Italy
		"143451": "lu", // Luxembourg
		"143452": "nl", // Netherlands
		"143453": "pt", // Portugal
		"143454": "es", // Spain
		"143455": "ca", // Canada
		"143456": "se", // Sweden
		"143457": "no", // Norway
		"143458": "dk", // Denmark
		"143460": "ch", // Switzerland
		"143462": "au", // Australia
		"143463": "nz", // New Zealand
		"143465": "cn", // China
		"143466": "jp", // Japan
		"143467": "hk", // Hong Kong
		"143468": "sg", // Singapore
		"143469": "kr", // South Korea
	}

	// Extract the first part before the comma or dash
	parts := strings.FieldsFunc(storefront, func(r rune) bool {
		return r == ',' || r == '-'
	})

	if len(parts) > 0 {
		if code, ok := storefrontMap[parts[0]]; ok {
			return code, nil
		}
	}

	// Default to "us" if not found
	return "us", nil
}

func (s *Service) getVersionCachePath(bundleID string) string {
	cacheDir := filepath.Join(s.configDir, "version_cache")
	os.MkdirAll(cacheDir, 0700)
	safeBundleID := strings.ReplaceAll(bundleID, ".", "_")
	return filepath.Join(cacheDir, safeBundleID+".json")
}

func (s *Service) loadVersionCache(bundleID string) (*appVersionCache, error) {
	cachePath := s.getVersionCachePath(bundleID)
	data, err := os.ReadFile(cachePath)
	if err != nil {
		return nil, err
	}

	var cache appVersionCache
	if err := json.Unmarshal(data, &cache); err != nil {
		return nil, err
	}

	return &cache, nil
}

func (s *Service) saveVersionCache(cache *appVersionCache) error {
	cachePath := s.getVersionCachePath(cache.BundleID)
	data, err := json.MarshalIndent(cache, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(cachePath, data, 0600)
}

func (s *Service) shouldFetchVersions(bundleID string, cacheDuration time.Duration) bool {
	cache, err := s.loadVersionCache(bundleID)
	if err != nil {
		return true
	}

	return time.Since(cache.LastFetchAt) > cacheDuration
}

func (s *Service) GetAppSubtitle(bundleID, countryCode string) (string, error) {
	cacheKey := subtitleCacheKey(bundleID, countryCode)

	s.appSubtitleCacheMu.RLock()
	if subtitle, ok := s.appSubtitleCache[cacheKey]; ok {
		s.appSubtitleCacheMu.RUnlock()
		return subtitle, nil
	}
	s.appSubtitleCacheMu.RUnlock()

	subtitle, err := fetchAppStoreSubtitle(bundleID, countryCode)
	if err != nil {
		return "", err
	}

	s.appSubtitleCacheMu.Lock()
	s.appSubtitleCache[cacheKey] = subtitle
	s.appSubtitleCacheMu.Unlock()

	return subtitle, nil
}

func (s *Service) GetAppSubtitles(bundleIDs []string, countryCode string) map[string]string {
	results := make(map[string]string, len(bundleIDs))
	seen := make(map[string]struct{}, len(bundleIDs))
	queue := make([]string, 0, len(bundleIDs))

	for _, bundleID := range bundleIDs {
		bundleID = strings.TrimSpace(bundleID)
		if bundleID == "" {
			continue
		}
		if _, ok := seen[bundleID]; ok {
			continue
		}
		seen[bundleID] = struct{}{}
		queue = append(queue, bundleID)
	}

	if len(queue) == 0 {
		return results
	}

	workerCount := appSubtitleFetchConcurrency
	if len(queue) < workerCount {
		workerCount = len(queue)
	}

	var resultsMu sync.Mutex
	jobs := make(chan string, len(queue))
	var wg sync.WaitGroup

	for index := 0; index < workerCount; index++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for bundleID := range jobs {
				subtitle, err := s.GetAppSubtitle(bundleID, countryCode)
				if err == nil && subtitle != "" {
					resultsMu.Lock()
					results[bundleID] = subtitle
					resultsMu.Unlock()
				}
			}
		}()
	}

	for _, bundleID := range queue {
		jobs <- bundleID
	}
	close(jobs)
	wg.Wait()

	return results
}

func (s *Service) populateSubtitlesForApps(apps []models.AppSearchResult, countryCode string) {
	for index := range apps {
		subtitle, err := s.GetAppSubtitle(apps[index].BundleID, countryCode)
		if err == nil && subtitle != "" {
			apps[index].Subtitle = subtitle
		}
	}
}

func subtitleCacheKey(bundleID, countryCode string) string {
	bundleID = strings.TrimSpace(bundleID)
	countryCode = strings.ToLower(strings.TrimSpace(countryCode))
	if countryCode == "" {
		countryCode = "us"
	}
	return bundleID + ":" + countryCode
}

func fetchAppStoreSubtitle(bundleID, countryCode string) (string, error) {
	countryCode = strings.ToLower(strings.TrimSpace(countryCode))
	if countryCode == "" {
		countryCode = "us"
	}

	lookupURL := fmt.Sprintf("https://itunes.apple.com/lookup?bundleId=%s&country=%s", url.QueryEscape(bundleID), url.QueryEscape(countryCode))
	lookupResp, err := http.Get(lookupURL)
	if err != nil {
		return "", fmt.Errorf("lookup app id failed: %w", err)
	}
	defer lookupResp.Body.Close()

	if lookupResp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("lookup app id returned status: %d", lookupResp.StatusCode)
	}

	var lookupResult ITunesLookupResponse
	if err := json.NewDecoder(lookupResp.Body).Decode(&lookupResult); err != nil {
		return "", fmt.Errorf("decode app id lookup failed: %w", err)
	}
	if len(lookupResult.Results) == 0 || lookupResult.Results[0].TrackId == 0 {
		return "", fmt.Errorf("app id not found for bundle id %s", bundleID)
	}

	appURL := fmt.Sprintf("https://apps.apple.com/%s/app/id%d", countryCode, lookupResult.Results[0].TrackId)
	req, err := http.NewRequest(http.MethodGet, appURL, nil)
	if err != nil {
		return "", fmt.Errorf("create app store request failed: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")
	req.Header.Set("Accept-Language", "zh-Hans-CN,zh;q=0.9,en;q=0.8")

	resp, err := appSubtitleHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetch app store page failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("app store page returned status: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read app store page failed: %w", err)
	}

	match := regexp.MustCompile(`<p class="subtitle[^"]*">([^<]+)</p>`).FindSubmatch(body)
	if len(match) < 2 {
		return "", fmt.Errorf("subtitle not found")
	}

	return strings.TrimSpace(html.UnescapeString(string(match[1]))), nil
}

func (s *Service) convertAppToSearchResult(app *appstore.App) models.AppSearchResult {
	// Parse file size from string
	fileSize := int64(0)
	if app.FileSizeBytes != "" {
		fmt.Sscanf(app.FileSizeBytes, "%d", &fileSize)
	}

	return models.AppSearchResult{
		ID:                        app.ID,
		BundleID:                  app.BundleID,
		Name:                      app.Name,
		Subtitle:                  "",
		Version:                   app.Version,
		Price:                     app.Price,
		FormattedPrice:            formatPrice(app.Price, "USD"), // Default to USD
		IconURL:                   app.IconURL512,
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
		FileSizeFormatted:         formatFileSize(fileSize),
		MinimumOSVersion:          app.MinimumOsVersion,
		ReleaseDate:               app.ReleaseDate,
		CurrentVersionReleaseDate: app.CurrentVersionReleaseDate,
	}
}

func getPrimaryGenre(genres []string) string {
	if len(genres) > 0 {
		return genres[0]
	}
	return ""
}

func formatPrice(price float64, currency string) string {
	if price == 0 {
		return "Free"
	}
	if currency == "" {
		currency = "USD"
	}
	return fmt.Sprintf("%.2f %s", price, currency)
}

func formatFileSize(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%d B", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(bytes)/float64(div), "KMGTPE"[exp])
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func (s *Service) refreshAccountToken(email string, account *appstore.Account) (*appstore.Account, error) {
	// Get the stored password
	password, err := s.GetAccountPassword(email)
	if err != nil || password == "" {
		return nil, fmt.Errorf("cannot refresh token: no password stored")
	}

	// Re-login to get a fresh token
	anisetteData := s.loadAppStoreAnisetteData(email)

	output, err := s.withTemporaryAppStoreHeaders(anisetteData, func() (appstore.LoginOutput, error) {
		return s.appStore.Login(appstore.LoginInput{
			Email:    email,
			Password: password,
		})
	})
	if err != nil {
		return nil, fmt.Errorf("failed to refresh token: %w", err)
	}

	// Save the refreshed account
	accountData, err := json.Marshal(output.Account)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal refreshed account: %w", err)
	}

	if err := s.keychain.Set(s.getAccountKey(email), accountData); err != nil {
		s.saveCurrentAccount(&output.Account)
		logger.Logger.Warn().Err(err).Str("email", email).Msg("Failed to save refreshed account to keychain; continuing with current session")
		return &output.Account, nil
	}

	s.saveCurrentAccount(&output.Account)

	return &output.Account, nil
}

func resolveOutputDir(outputDir string) (string, error) {
	if outputDir == "" {
		return "", fmt.Errorf("output directory is required")
	}

	if outputDir == "~" || strings.HasPrefix(outputDir, "~/") {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}

		if outputDir == "~" {
			return homeDir, nil
		}

		return filepath.Join(homeDir, outputDir[2:]), nil
	}

	return outputDir, nil
}

// Download downloads an IPA file from the App Store
func (s *Service) Download(ctx context.Context, bundleID, email, outputDir, externalVersionID string, progressChan chan<- models.DownloadProgress) error {
	log := logger.Logger

	log.Info().Str("bundle_id", bundleID).Str("email", email).Str("output_dir", outputDir).Msg("Starting app download")

	resolvedOutputDir, err := resolveOutputDir(outputDir)
	if err != nil {
		return fmt.Errorf("failed to resolve output directory: %w", err)
	}

	if err := os.MkdirAll(resolvedOutputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	outputDir = resolvedOutputDir

	// Check if context is cancelled
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	// Send initial progress
	if progressChan != nil {
		progressChan <- models.DownloadProgress{
			Status:  "progress",
			Message: "Retrieving account information...",
		}
	}

	// Get account
	account, err := s.getAccount(email)
	if err != nil {
		return fmt.Errorf("failed to get account: %w", err)
	}

	// Check if context is cancelled
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	// Send progress
	if progressChan != nil {
		progressChan <- models.DownloadProgress{
			Status:  "progress",
			Message: "Looking up app information...",
		}
	}

	// Lookup app
	lookupOutput, err := s.appStore.Lookup(appstore.LookupInput{
		Account:  *account,
		BundleID: bundleID,
	})
	if err != nil {
		return fmt.Errorf("failed to lookup app: %w", err)
	}

	app := lookupOutput.App

	// Check if context is cancelled
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	// Check if context is cancelled before starting download
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	// Send progress
	if progressChan != nil {
		progressChan <- models.DownloadProgress{
			Status:  "progress",
			Message: "Downloading IPA file...",
		}
	}

	// Prepare output path with duplicate handling
	baseName := fmt.Sprintf("%s.ipa", app.BundleID)
	outputPath := filepath.Join(outputDir, baseName)

	// Check for existing file and add suffix if needed
	if _, err := os.Stat(outputPath); err == nil {
		// File exists, find next available number
		counter := 1
		for {
			newBaseName := fmt.Sprintf("%s(%d).ipa", app.BundleID, counter)
			newPath := filepath.Join(outputDir, newBaseName)
			if _, err := os.Stat(newPath); os.IsNotExist(err) {
				outputPath = newPath
				break
			}
			counter++
			if counter > 1000 {
				// Safety limit
				return fmt.Errorf("too many duplicate files")
			}
		}
		log.Info().Str("original", baseName).Str("new", filepath.Base(outputPath)).Msg("File exists, using new name")
	}

	// Download the IPA with progress callback
	log.Info().Msg("Setting up progress callback")
	var progressCallback func(current, total int64)
	var lastPercent int  // declared at function scope so retry code can reset it
	if progressChan != nil {
		log.Info().Msg("progressChan is NOT nil, creating callback")
		progressCallback = func(current, total int64) {
			if total <= 0 {
				log.Warn().Int64("total", total).Msg("Download progress callback: total is 0")
				return
			}
			percent := int(float64(current) / float64(total) * 100)
			log.Debug().Int64("current", current).Int64("total", total).Int("percent", percent).Int("lastPercent", lastPercent).Msg("Download progress callback invoked")
			if percent != lastPercent {
				lastPercent = percent
				progressChan <- models.DownloadProgress{
					Status:   "progress",
					Message:  "Downloading IPA file...",
					Progress: float64(percent),
				}
			}
		}
	}

	// Download the IPA
	log.Info().Bool("has_callback", progressCallback != nil).Msg("Calling appstore.Download")
	output, err := s.appStore.Download(appstore.DownloadInput{
		Account:           *account,
		App:               app,
		OutputPath:        outputPath,
		Progress:          nil,
		ProgressCallback:  progressCallback,
		ExternalVersionID: externalVersionID,
	})

	// Handle download errors with retry logic
	if err != nil {
		if errors.Is(err, appstore.ErrPasswordTokenExpired) {
			// Reset progress percent tracker so retry progress callbacks fire again
			lastPercent = -1
			log.Warn().Err(err).Str("bundle_id", bundleID).Msg("Password token expired during download - attempting refresh and retry")

			// Send progress update about re-login
			if progressChan != nil {
				progressChan <- models.DownloadProgress{
					Status:  "progress",
					Message: "Refreshing login session...",
				}
			}

			if newAccount, refreshErr := s.refreshAccountToken(email, account); refreshErr == nil {
				account = newAccount
				output, err = s.appStore.Download(appstore.DownloadInput{
					Account:           *account,
					App:               app,
					OutputPath:        outputPath,
					Progress:          nil,
					ProgressCallback:  progressCallback,
					ExternalVersionID: externalVersionID,
				})
			}
		}

		if err != nil && isUnknownAppStoreDownloadError(err) {
			log.Warn().Err(err).Str("bundle_id", bundleID).Msg("Download returned unknown App Store error - attempting token refresh and retry")
			lastPercent = -1

			if progressChan != nil {
				progressChan <- models.DownloadProgress{
					Status:  "progress",
					Message: "Refreshing login session...",
				}
			}

			if newAccount, refreshErr := s.refreshAccountToken(email, account); refreshErr == nil {
				account = newAccount
				output, err = s.appStore.Download(appstore.DownloadInput{
					Account:           *account,
					App:               app,
					OutputPath:        outputPath,
					Progress:          nil,
					ProgressCallback:  progressCallback,
					ExternalVersionID: externalVersionID,
				})
			} else {
				log.Warn().Err(refreshErr).Str("bundle_id", bundleID).Msg("Token refresh after unknown download error failed")
			}
		}

		if errors.Is(err, appstore.ErrLicenseRequired) {
			licenseErr := s.acquireLicenseForDownload(&account, email, bundleID, app, progressChan)
			if licenseErr != nil {
				return licenseErr
			}
			lastPercent = -1

			if progressChan != nil {
				progressChan <- models.DownloadProgress{
					Status:  "progress",
					Message: "Downloading IPA file...",
				}
			}

			output, err = s.appStore.Download(appstore.DownloadInput{
				Account:           *account,
				App:               app,
				OutputPath:        outputPath,
				Progress:          nil,
				ProgressCallback:  progressCallback,
				ExternalVersionID: externalVersionID,
			})

			if err != nil && errors.Is(err, appstore.ErrPasswordTokenExpired) {
				log.Warn().Err(err).Str("bundle_id", bundleID).Msg("Password token expired during licensed download retry - attempting refresh and retry")

				if progressChan != nil {
					progressChan <- models.DownloadProgress{
						Status:  "progress",
						Message: "Refreshing login session...",
					}
				}

				if newAccount, refreshErr := s.refreshAccountToken(email, account); refreshErr == nil {
					account = newAccount
					output, err = s.appStore.Download(appstore.DownloadInput{
						Account:           *account,
						App:               app,
						OutputPath:        outputPath,
						Progress:          nil,
						ProgressCallback:  progressCallback,
						ExternalVersionID: externalVersionID,
					})
				}
			}
		}

		if err != nil && app.Price == 0 && isUnknownAppStoreDownloadError(err) {
			log.Warn().Err(err).Str("bundle_id", bundleID).Msg("Unknown App Store download error for free app - attempting license acquisition fallback")

			lastPercent = -1
			licenseErr := s.acquireLicenseForDownload(&account, email, bundleID, app, progressChan)
			if licenseErr != nil {
				return licenseErr
			}

			if progressChan != nil {
				progressChan <- models.DownloadProgress{
					Status:  "progress",
					Message: "Downloading IPA file...",
				}
			}

			output, err = s.appStore.Download(appstore.DownloadInput{
				Account:           *account,
				App:               app,
				OutputPath:        outputPath,
				Progress:          nil,
				ProgressCallback:  progressCallback,
				ExternalVersionID: externalVersionID,
			})
		}
	}

	if err != nil {
		return fmt.Errorf("failed to download IPA: %w", err)
	}

	log.Info().Str("bundle_id", bundleID).Str("path", output.DestinationPath).Msg("Download completed successfully")

	// Send 100% progress for smooth completion
	if progressChan != nil {
		progressChan <- models.DownloadProgress{
			Status:   "progress",
			Message:  "Downloading IPA file...",
			Progress: 100,
		}
	}

	// Send final progress
	if progressChan != nil {
		progressChan <- models.DownloadProgress{
			Status:   "completed",
			Message:  fmt.Sprintf("Download completed: %s", output.DestinationPath),
			FilePath: output.DestinationPath,
		}
	}

	return nil
}
