package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/rand"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"ipaget-service/internal/app"
	"ipaget-service/internal/certifi"
	"ipaget-service/internal/device"
	"ipaget-service/internal/ipa"
	"ipaget-service/internal/logger"
	"ipaget-service/internal/models"
	"ipaget-service/internal/sign"
	"ipaget-service/internal/store"
	wsHub "ipaget-service/internal/websocket"

	"github.com/danielpaulus/go-ios/ios"
	"github.com/danielpaulus/go-ios/ios/afc"
	// crashreport is intentionally not used here. We implement the minimal
	// crashreportmover + crashreportcopymobile logic to ensure connections
	// are properly closed per request.
)

var (
	deviceService *device.Service
	appService    *app.Service
	storeService  *store.Service
	ipaService    *ipa.Service
	certService   *certifi.Service
	hub           *wsHub.Hub
	upgrader      = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
	instanceID        string
	cancelTasksMutex  sync.RWMutex
	cancelTasks       = make(map[string]chan struct{})
	cancelledTasksSet = make(map[string]bool)
)

func main() {
	// Parse command line flags
	verbose := flag.Bool("v", false, "enable verbose/debug logging")
	port := flag.String("port", "", "service port (default: 8765)")
	host := flag.String("host", "", "service host (default: 127.0.0.1)")
	configDir := flag.String("config", "", "config directory")
	flag.Parse()

	// Check debug mode from environment or command line flag
	debug := os.Getenv("DEBUG") == "true" || *verbose
	logger.Init(debug, false)

	if debug {
		logger.Info().Msg("Debug mode enabled")
	}

	// Port: command line > environment > default
	servicePort := *port
	if servicePort == "" {
		servicePort = os.Getenv("PORT")
	}
	if servicePort == "" {
		servicePort = "8765"
	}

	// Host: command line > environment > default
	serviceHost := *host
	if serviceHost == "" {
		serviceHost = os.Getenv("HOST")
	}
	if serviceHost == "" {
		serviceHost = "0.0.0.0"
	}

	// Config directory: command line > environment > default
	serviceConfigDir := *configDir
	if serviceConfigDir == "" {
		serviceConfigDir = os.Getenv("CONFIG_DIR")
	}
	if serviceConfigDir == "" {
		serviceConfigDir = getDefaultConfigDir()
	}
	os.MkdirAll(serviceConfigDir, 0755)
	configureOutboundProxy(serviceConfigDir)

	deviceService = device.NewService(serviceConfigDir)
	appService = app.NewService()
	// Define a callback to ensure/refresh free-sign certificate after GSA success
	// This callback receives the GSA session credentials (DSID/AuthToken) from successful authentication
	onGSAAuthenticated := func(email, password, dsid, authToken, anisetteURL string, anisetteData *store.AnisetteData) {
		log := logger.Logger
		log.Info().Str("email", email).Msg("Ensuring free-sign certificate after GSA success")

		// Save GSA credentials for later use
		if storeService != nil {
			creds := &store.GSACredentials{
				DSID:         dsid,
				AuthToken:    authToken,
				AnisetteURL:  anisetteURL,
				AnisetteData: anisetteData,
			}
			if err := storeService.SaveGSACredentials(email, creds); err != nil {
				log.Warn().Err(err).Str("email", email).Msg("Failed to save GSA credentials (non-critical)")
			} else {
				log.Info().
					Str("email", email).
					Bool("has_anisette_data", anisetteData != nil).
					Msg("GSA credentials saved successfully")
			}
		}

		if certService == nil {
			log.Warn().Str("email", email).Msg("Certificate service not initialized; skipping free-sign ensure")
			return
		}
		// Check existing free-sign cert
		if existing, err := certService.GetFreeSignCertForAppleID(email); err == nil && existing != nil {
			if existing.IsExpired || existing.DaysUntilExpiry <= 1 {
				log.Info().Str("email", email).Msg("Free-sign certificate expired/expiring; attempting refresh")
				if _, err := certService.ImportFreeSign(certifi.ImportFreeSignRequest{
					Name:         fmt.Sprintf("Free Sign (%s)", email),
					AppleID:      email,
					Password:     password,
					DSID:         dsid,
					AuthToken:    authToken,
					AnisetteURL:  anisetteURL,
					AnisetteData: anisetteData,
					IsDefault:    existing.IsDefault,
				}); err != nil {
					log.Warn().Err(err).Str("email", email).Msg("Failed to refresh free-sign certificate (non-critical)")
				}
			} else {
				log.Info().Str("email", email).Int("days_left", existing.DaysUntilExpiry).Msg("Free-sign certificate is valid; no action")
			}
			return
		}
		// None exists: attempt to create one
		log.Info().Str("email", email).Msg("No free-sign certificate found; attempting creation")
		if _, err := certService.ImportFreeSign(certifi.ImportFreeSignRequest{
			Name:         fmt.Sprintf("Free Sign (%s)", email),
			AppleID:      email,
			Password:     password,
			DSID:         dsid,
			AuthToken:    authToken,
			AnisetteURL:  anisetteURL,
			AnisetteData: anisetteData,
			IsDefault:    true,
		}); err != nil {
			log.Warn().Err(err).Str("email", email).Msg("Failed to create free-sign certificate (non-critical)")
		}
	}

	storeService = store.NewService(serviceConfigDir, onGSAAuthenticated)
	ipaService = ipa.NewService()
	hub = wsHub.NewHub()

	// Generate a 4-digit random instance ID at startup
	rand.Seed(time.Now().UnixNano())
	instanceID = fmt.Sprintf("%04d", rand.Intn(10000))

	// Initialize certificate service
	var err error
	certService, err = certifi.NewService(serviceConfigDir)
	if err != nil {
		logger.Fatal().Err(err).Msg("Failed to initialize certificate service")
	}

	go hub.Run()
	go startDeviceListener()

	if !debug {
		gin.SetMode(gin.ReleaseMode)
	}

	logger.SetupGin()
	r := gin.New()
	r.Use(logger.GinRecovery())
	r.Use(logger.GinLogger())

	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
	}))

	r.GET("/health", handleHealth)

	// Device management
	r.GET("/devices", handleListDevices)
	r.GET("/devices/connected", handleListConnectedDevices)
	r.GET("/device/:udid/apps", handleListApps)
	r.GET("/device/:udid/storage", handleGetStorageInfo)
	r.GET("/device/:udid/device-info", handleGetFullDeviceInfo)
	r.GET("/device/:udid/crashlogs", handleListCrashLogs)
	r.GET("/device/:udid/crashlog", handleGetCrashLogContent)
	r.POST("/device/:udid/icons", handleGetIcons)
	r.POST("/device/:udid/install", handleInstallApp)
	r.POST("/device/:udid/launch/:bundleId", handleLaunchApp)
	r.POST("/device/:udid/kill/:bundleId", handleKillApp)
	r.DELETE("/device/:udid/app/:bundleId", handleUninstallApp)
	r.POST("/device/:udid/restart", handleRestartDevice)
	r.POST("/device/:udid/shutdown", handleShutdownDevice)
	r.GET("/device/:udid/pair-status", handleCheckPairingStatus)
	r.POST("/device/:udid/pair", handlePairDevice)

	// Debug endpoints
	r.GET("/device/:udid/lockdown-debug", handleLockdownDebug)
	r.GET("/debug/ping", handleDebugPing)
	r.POST("/debug/test-task", handleTestTask)
	r.POST("/debug/simulate-device", handleSimulateDevice)
	r.POST("/debug/clear-simulated", handleClearSimulatedDevices)
	r.DELETE("/debug/simulated/:udid", handleRemoveSimulatedDevice)
	r.GET("/debug/sim-profiles", handleListSimProfiles)
	r.POST("/debug/save-sim-profile", handleSaveSimProfile)
	r.DELETE("/debug/sim-profiles/:id", handleDeleteSimProfile)
	r.GET("/debug/generate-random-device", handleGenerateRandomDevice)
	r.POST("/debug/load-device-profile", handleLoadDeviceProfile)

	// Global WebSocket endpoint for all real-time messages
	r.GET("/ws", handleWebSocket)
	r.GET("/ws/logs", handleLogsWebSocket)

	// ipatool / App Store
	r.POST("/auth/login", handleLogin)
	r.POST("/auth/verify2fa", handleVerify2FA)
	r.POST("/auth/logout", handleLogout)
	r.GET("/auth/check", handleCheckAuth)
	r.GET("/auth/info", handleGetAccountInfo)
	r.GET("/auth/accounts", handleListAccounts)
	r.GET("/auth/country", handleGetCountryCode)
	r.GET("/apps/check-license", handleCheckLicense)
	r.GET("/apps/top", handleGetTopApps)
	r.GET("/apps/search", handleSearchApps)
	r.GET("/apps/subtitles", handleGetAppSubtitles)
	r.GET("/apps/details", handleGetAppDetails)
	r.GET("/apps/versions", handleGetAppVersions)
	r.POST("/apps/version-details", handleGetVersionDetails)
	r.POST("/apps/download", handleDownloadApp)
	r.POST("/tasks/:taskId/cancel", handleCancelTask)

	// IPA file parsing
	r.POST("/ipa/parse", handleParseIPA)
	r.POST("/ipa/details", handleGetIPADetails)
	r.GET("/ipa/files", handleListIPAFiles)
	r.POST("/ipa/extract-file", handleExtractFile)
	r.POST("/ipa/extract-files", handleExtractFiles)
	r.POST("/ipa/sign", handleSignIPA)

	// Certificate management
	r.POST("/certs/import-p12", handleImportP12Cert)
	r.POST("/certs/import-free", handleImportFreeCert)
	r.GET("/certs", handleListCerts)
	r.GET("/certs/:id", handleGetCert)
	r.GET("/certs/:id/export", handleExportCert)
	r.GET("/certs/apple-id/:email", handleGetCertForAppleID)
	r.DELETE("/certs/:id", handleDeleteCert)
	r.POST("/certs/:id/set-default", handleSetDefaultCert)

	address := serviceHost + ":" + servicePort
	logger.Info().
		Str("address", address).
		Str("config_dir", serviceConfigDir).
		Msg("Starting iPAGet service")

	// Explicitly listen on TCP4 to ensure IPv4 binding (required for Docker port forwarding)
	listener, err := net.Listen("tcp4", address)
	if err != nil {
		logger.Fatal().Err(err).Str("address", address).Msg("Failed to listen on address")
	}
	defer listener.Close()

	if err := r.RunListener(listener); err != nil {
		logger.Fatal().Err(err).Msg("Failed to start server")
	}
}

func getDefaultConfigDir() string {
	homeDir, _ := os.UserHomeDir()

	switch runtime.GOOS {
	case "windows":
		// Windows: %APPDATA%\iPAGet
		appData := os.Getenv("APPDATA")
		if appData != "" {
			return filepath.Join(appData, "iPAGet")
		}
		return filepath.Join(homeDir, "AppData", "Roaming", "iPAGet")
	case "darwin":
		// macOS: ~/Library/Application Support/iPAGet
		return filepath.Join(homeDir, "Library", "Application Support", "iPAGet")
	default:
		// Linux: ~/.config/iPAGet
		configHome := os.Getenv("XDG_CONFIG_HOME")
		if configHome != "" {
			return filepath.Join(configHome, "iPAGet")
		}
		return filepath.Join(homeDir, ".config", "iPAGet")
	}
}

func configureOutboundProxy(configDir string) {
	configPath := filepath.Join(configDir, "config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return
	}

	var config struct {
		Settings struct {
			ProxyURL string `json:"proxy_url"`
		} `json:"settings"`
	}

	if err := json.Unmarshal(data, &config); err != nil {
		logger.Warn().Err(err).Str("config_path", configPath).Msg("Failed to parse config.json for proxy settings")
		return
	}

	proxyURL := strings.TrimSpace(config.Settings.ProxyURL)
	if proxyURL == "" {
		return
	}

	parsedURL, err := url.Parse(proxyURL)
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		logger.Warn().Str("config_path", configPath).Msg("Ignoring invalid outbound proxy URL in config")
		return
	}

	os.Setenv("HTTP_PROXY", proxyURL)
	os.Setenv("HTTPS_PROXY", proxyURL)
	os.Setenv("http_proxy", proxyURL)
	os.Setenv("https_proxy", proxyURL)

	logger.Info().
		Str("proxy", fmt.Sprintf("%s://%s", parsedURL.Scheme, parsedURL.Host)).
		Msg("Using outbound proxy from config")
}

func startDeviceListener() {
	logger.Info().Msg("Starting device event listener")
	eventChan := deviceService.Subscribe()
	defer deviceService.Unsubscribe(eventChan)

	go deviceService.StartListener()

	for event := range eventChan {
		logger.Info().
			Str("type", event.Type).
			Str("serial", event.SerialNumber).
			Int("device_id", event.DeviceID).
			Msg("Device event received, broadcasting to WebSocket clients")
		hub.Broadcast(event)
	}
}

func handleHealth(c *gin.Context) {
	ready := deviceService != nil &&
		appService != nil &&
		storeService != nil &&
		ipaService != nil &&
		certService != nil &&
		hub != nil

	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"ready":   ready,
		"message": "iPAGet service is running",
	})
}

// Debug: simple HTTP ping
func handleDebugPing(c *gin.Context) {
	logger.Info().Msg("Debug ping")
	c.JSON(http.StatusOK, models.SuccessResponse{Message: "pong", Data: map[string]interface{}{"time": time.Now().UnixMilli()}})
}

// Debug: test task system with simulated progress
func handleTestTask(c *gin.Context) {
	taskID := fmt.Sprintf("test-%d", time.Now().UnixMilli())

	logger.Info().Str("task_id", taskID).Msg("Starting test task")

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "Test task started",
		Data:    map[string]interface{}{"task_id": taskID},
	})

	go func() {
		hub.Broadcast(models.TaskProgress{
			Type:     "task_progress",
			TaskID:   taskID,
			TaskType: "test",
			Status:   "started",
			Progress: 0,
			Message:  "Test task started",
		})

		time.Sleep(500 * time.Millisecond)

		steps := []struct {
			progress float64
			message  string
			delay    time.Duration
		}{
			{20, "Initializing test components...", 800 * time.Millisecond},
			{40, "Processing test data...", 1000 * time.Millisecond},
			{60, "Running validation checks...", 900 * time.Millisecond},
			{80, "Finalizing results...", 700 * time.Millisecond},
			{100, "Test completed successfully", 500 * time.Millisecond},
		}

		for _, step := range steps {
			hub.Broadcast(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   taskID,
				TaskType: "test",
				Status:   "progress",
				Progress: step.progress,
				Message:  step.message,
			})

			time.Sleep(step.delay)
		}

		hub.Broadcast(models.TaskProgress{
			Type:     "task_progress",
			TaskID:   taskID,
			TaskType: "test",
			Status:   "completed",
			Progress: 100,
			Message:  "Test task completed successfully",
		})

		logger.Info().Str("task_id", taskID).Msg("Test task completed")
	}()
}

// Debug: create a simulated device with key fields, other fields empty
func handleSimulateDevice(c *gin.Context) {
	var req struct {
		Info models.DeviceInfo `json:"info"`
		Apps []models.AppInfo  `json:"apps"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid request"})
		return
	}

	deviceInfo := req.Info
	if deviceInfo.UDID == "" {
		deviceInfo.UDID = deviceService.GenerateRandomDeviceInfo().UDID
	}
	if deviceInfo.SerialNumber == "" {
		deviceInfo.SerialNumber = deviceInfo.UDID
	}
	if deviceInfo.ActivationState == "" {
		deviceInfo.ActivationState = "Simulated"
	}
	if deviceInfo.ProductType == "" {
		deviceInfo.ProductType = deviceInfo.Model
	}
	if deviceInfo.RawData == nil {
		deviceInfo.RawData = map[string]interface{}{"simulated": true}
	}

	deviceService.AddSimulatedDevice(deviceInfo, req.Apps)

	// Broadcast attach event for simulated device (behave like real device)
	hub.Broadcast(models.DeviceEvent{Type: "device_attached", DeviceID: 0, SerialNumber: deviceInfo.UDID, Properties: map[string]interface{}{"simulated": true}})

	c.JSON(http.StatusOK, models.SuccessResponse{Message: "simulated device created", Data: deviceInfo})
}

// Debug: clear all simulated devices
func handleClearSimulatedDevices(c *gin.Context) {
	udids := deviceService.ClearSimulatedDevices()

	// Broadcast device_detached for each simulated device
	for _, udid := range udids {
		hub.Broadcast(models.DeviceEvent{
			Type:         "device_detached",
			DeviceID:     0,
			SerialNumber: udid,
			Properties:   map[string]interface{}{"simulated": true},
		})
		logger.Info().Str("udid", udid).Msg("Simulated device detached")
	}

	c.JSON(http.StatusOK, models.SuccessResponse{Message: "simulated devices cleared", Data: map[string]int{"count": len(udids)}})
}

// Debug: remove a single simulated device
func handleRemoveSimulatedDevice(c *gin.Context) {
	udid := c.Param("udid")
	if udid == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "udid is required"})
		return
	}

	removed := deviceService.RemoveSimulatedDevice(udid)
	if !removed {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "simulated device not found"})
		return
	}

	// Broadcast device_detached event
	hub.Broadcast(models.DeviceEvent{
		Type:         "device_detached",
		DeviceID:     0,
		SerialNumber: udid,
		Properties:   map[string]interface{}{"simulated": true},
	})
	logger.Info().Str("udid", udid).Msg("Simulated device removed")

	c.JSON(http.StatusOK, models.SuccessResponse{Message: "simulated device removed"})
}

// Debug: list, save, delete simulated profiles
func handleListSimProfiles(c *gin.Context) {
	profiles, err := deviceService.ListSimulatedProfiles()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse{Message: "success", Data: profiles})
}

func handleSaveSimProfile(c *gin.Context) {
	var p models.SimulatedDeviceProfile
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid request"})
		return
	}
	if p.ID == "" {
		p.ID = fmt.Sprintf("SIM-PROFILE-%d", time.Now().UnixNano())
	}
	if err := deviceService.SaveSimulatedProfile(p); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse{Message: "saved", Data: p})
}

func handleDeleteSimProfile(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "id is required"})
		return
	}
	if err := deviceService.DeleteSimulatedProfile(id); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse{Message: "deleted"})
}

func handleGenerateRandomDevice(c *gin.Context) {
	deviceInfo := deviceService.GenerateRandomDeviceInfo()
	apps := deviceService.GenerateRandomApps()

	// Clean up unnecessary fields before sending
	deviceInfo.RawData = nil

	profile := models.SimulatedDeviceProfile{
		ID:   fmt.Sprintf("RAND-%d", time.Now().UnixNano()),
		Info: deviceInfo,
		Apps: apps,
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "random device generated",
		Data:    profile,
	})
}

func handleLoadDeviceProfile(c *gin.Context) {
	var req struct {
		UDID string `json:"udid" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "udid is required"})
		return
	}

	// Get all devices
	devices, err := deviceService.ListDevices()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: fmt.Sprintf("Failed to list devices: %v", err)})
		return
	}

	// Find the device
	var deviceInfo models.DeviceInfo
	found := false
	for _, d := range devices {
		if d.UDID == req.UDID {
			deviceInfo = d
			found = true
			break
		}
	}

	if !found {
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: "device not found"})
		return
	}

	// Clean up unnecessary fields
	deviceInfo.RawData = nil
	deviceInfo.StorageInfo = nil

	// Check if it's a simulated device
	var apps []models.AppInfo
	if sim, ok := deviceService.Simulated[req.UDID]; ok {
		logger.Info().Str("udid", req.UDID).Msg("Loading profile for simulated device")
		apps = sim.Apps
	} else {
		// Get device entry to list apps
		device, err := deviceService.GetDeviceByUDID(req.UDID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: fmt.Sprintf("Failed to get device: %v", err)})
			return
		}

		// Get apps for this device
		apps, err = appService.ListApps(*device, req.UDID)
		if err != nil {
			logger.Warn().Err(err).Str("udid", req.UDID).Msg("Failed to get device apps, returning empty list")
			apps = []models.AppInfo{}
		}
	}

	// Clean up app data
	cleanApps := make([]models.AppInfo, len(apps))
	for i, app := range apps {
		cleanApps[i] = app
		cleanApps[i].RawData = nil
	}

	profile := models.SimulatedDeviceProfile{
		ID:   fmt.Sprintf("PROF-%s", req.UDID),
		Info: deviceInfo,
		Apps: cleanApps,
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "device profile loaded",
		Data:    profile,
	})
}

func handleListDevices(c *gin.Context) {
	logger.Debug().Msg("API: Listing devices")
	devices, err := deviceService.ListDevices()
	if err != nil {
		logger.Error().Err(err).Msg("Failed to list devices")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	logger.Info().Int("count", len(devices)).Msg("Successfully retrieved devices")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    devices,
	})
}

func handleListConnectedDevices(c *gin.Context) {
	logger.Debug().Msg("API: Listing all connected device UDIDs")
	udids := deviceService.ListAllConnectedDeviceUDIDs()

	logger.Info().Int("count", len(udids)).Msg("Successfully retrieved connected device UDIDs")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    udids,
	})
}

func handleListApps(c *gin.Context) {
	udid := c.Param("udid")
	logger.Debug().Str("udid", udid).Msg("API: Listing apps for device")
	// If UDID is a simulated one, return its app list directly
	if sim, ok := deviceService.Simulated[udid]; ok {
		logger.Info().Str("udid", udid).Msg("Returning simulated device apps")
		c.JSON(http.StatusOK, models.SuccessResponse{Message: "success", Data: sim.Apps})
		return
	}

	device, err := deviceService.GetDeviceByUDID(udid)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Device not found")
		c.JSON(http.StatusNotFound, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	apps, err := appService.ListApps(*device, "")
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Failed to list apps")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	logger.Info().Int("count", len(apps)).Str("udid", udid).Msg("Successfully retrieved apps")

	// Start async size calculation for all apps
	bundleIDs := make([]string, len(apps))
	for i, app := range apps {
		bundleIDs[i] = app.BundleID
	}
	appService.CalculateAppSizesAsync(*device, udid, bundleIDs, hub.Broadcast)

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    apps,
	})
}

func handleGetIcons(c *gin.Context) {
	udid := c.Param("udid")

	var req struct {
		BundleIDs []string `json:"bundle_ids" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "bundle_ids array is required",
		})
		return
	}

	logger.Debug().Str("udid", udid).Int("bundle_count", len(req.BundleIDs)).Msg("API: Getting app icons")

	// Check if it's a simulated device
	if sim, ok := deviceService.Simulated[udid]; ok {
		logger.Info().Str("udid", udid).Msg("Getting icons for simulated device")
		icons := make(map[string]string)
		for _, bundleID := range req.BundleIDs {
			for _, app := range sim.Apps {
				if app.BundleID == bundleID {
					icons[bundleID] = ""
					break
				}
			}
		}
		c.JSON(http.StatusOK, models.SuccessResponse{
			Message: "success",
			Data:    icons,
		})
		return
	}

	device, err := deviceService.GetDeviceByUDID(udid)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Device not found")
		c.JSON(http.StatusNotFound, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	icons, err := appService.GetAppIcons(*device, req.BundleIDs)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Failed to get app icons")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	logger.Debug().Int("icon_count", len(icons)).Int("requested", len(req.BundleIDs)).Str("udid", udid).Msg("Successfully retrieved app icons")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    icons,
	})
}

func handleInstallApp(c *gin.Context) {
	udid := c.Param("udid")

	var req struct {
		IpaPath       string `json:"ipa_path" binding:"required"`
		BundleID      string `json:"bundle_id"`
		Version       string `json:"version"`
		CertificateID string `json:"certificate_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "ipa_path is required",
		})
		return
	}

	device, err := deviceService.GetDeviceByUDID(udid)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	bundleIDForTask := strings.TrimSpace(req.BundleID)
	if bundleIDForTask == "" {
		bundleIDForTask = "app"
	}

	// Generate unique task ID
	taskID := fmt.Sprintf("install_%s_%s_%d", udid[:8], bundleIDForTask, time.Now().UnixNano())

	// Install in a goroutine to allow immediate response
	go func() {
		installPath := req.IpaPath
		effectiveBundleID := req.BundleID
		cleanup := func() {}
		defer cleanup()

		if strings.TrimSpace(req.CertificateID) != "" {
			hub.Broadcast(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   taskID,
				TaskType: "install",
				Status:   "started",
				Progress: 0,
				Message:  "Preparing signing materials...",
				Data: map[string]interface{}{
					"udid":           udid,
					"bundle_id":      req.BundleID,
					"file_path":      req.IpaPath,
					"certificate_id": req.CertificateID,
				},
			})

			var signErr error
			installPath, effectiveBundleID, cleanup, signErr = prepareSignedIPAForInstall(*device, req.IpaPath, req.BundleID, req.CertificateID, taskID)
			if signErr != nil {
				hub.Broadcast(models.TaskProgress{
					Type:     "task_progress",
					TaskID:   taskID,
					TaskType: "install",
					Status:   "error",
					Progress: 0,
					Message:  signErr.Error(),
					Data: map[string]interface{}{
						"udid":           udid,
						"bundle_id":      req.BundleID,
						"file_path":      req.IpaPath,
						"certificate_id": req.CertificateID,
					},
				})
				logger.Error().Err(signErr).Str("udid", udid).Str("ipa_path", req.IpaPath).Str("task_id", taskID).Str("certificate_id", req.CertificateID).Msg("Failed to prepare signed IPA")
				return
			}
		}

		err := appService.InstallApp(*device, installPath, taskID, effectiveBundleID, hub.Broadcast)
		if err != nil {
			logger.Error().Err(err).Str("udid", udid).Str("ipa_path", installPath).Str("task_id", taskID).Msg("Failed to install app")
		}
	}()

	logger.Info().Str("udid", udid).Str("ipa_path", req.IpaPath).Str("task_id", taskID).Msg("App install started")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "App install started",
		Data: map[string]interface{}{
			"task_id": taskID,
		},
	})
}

func handleSignIPA(c *gin.Context) {
	var req struct {
		IpaPath       string                 `json:"ipa_path" binding:"required"`
		CertificateID string                 `json:"certificate_id"`
		DeviceUDID    string                 `json:"device_udid"`
		OutputDir     string                 `json:"output_dir"`
		BundleID      string                 `json:"bundle_id"`
		SignMode      string                 `json:"sign_mode"`
		EditorOptions *models.SigningOptions `json:"editor_options"`
		IconPath      string                 `json:"icon_path"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "ipa_path is required"})
		return
	}

	signMode := strings.ToLower(strings.TrimSpace(req.SignMode))
	if signMode == "" {
		signMode = "certificate"
	}
	if signMode != "certificate" && signMode != "adhoc" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "sign_mode must be certificate or adhoc"})
		return
	}
	if signMode == "certificate" && strings.TrimSpace(req.CertificateID) == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "certificate_id is required for certificate signing"})
		return
	}

	outputDir := strings.TrimSpace(req.OutputDir)
	if outputDir == "" {
		outputDir = filepath.Dir(req.IpaPath)
	}

	bundleIDForTask := strings.TrimSpace(req.BundleID)
	if bundleIDForTask == "" {
		bundleIDForTask = "app"
	}

	taskPrefix := "sign"
	if signMode == "adhoc" {
		taskPrefix = "export"
	}
	taskID := fmt.Sprintf("%s_%s_%d", taskPrefix, bundleIDForTask, time.Now().UnixNano())
	taskType := "sign"
	if signMode == "adhoc" {
		taskType = "export"
	}

	go func() {
		var signedIPAPath string
		var effectiveBundleID string
		var signErr error

		if signMode == "adhoc" {
			signedIPAPath, effectiveBundleID, signErr = exportAdhocIPA(
				req.IpaPath,
				outputDir,
				strings.TrimSpace(req.BundleID),
				taskID,
				req.EditorOptions,
				strings.TrimSpace(req.IconPath),
			)
		} else {
			signedIPAPath, effectiveBundleID, signErr = signStoredIPA(
				req.IpaPath,
				req.CertificateID,
				strings.TrimSpace(req.DeviceUDID),
				outputDir,
				strings.TrimSpace(req.BundleID),
				taskID,
				req.EditorOptions,
				strings.TrimSpace(req.IconPath),
			)
		}

		if signErr != nil {
			hub.Broadcast(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   taskID,
				TaskType: taskType,
				Status:   "error",
				Progress: 0,
				Message:  signErr.Error(),
				Data: map[string]interface{}{
					"file_path":      req.IpaPath,
					"certificate_id": req.CertificateID,
					"device_udid":    strings.TrimSpace(req.DeviceUDID),
					"sign_mode":      signMode,
				},
			})
			logger.Error().Err(signErr).Str("ipa_path", req.IpaPath).Str("task_id", taskID).Str("sign_mode", signMode).Str("certificate_id", req.CertificateID).Msg("Failed to process IPA")
			return
		}

		parsedIPA, parseErr := ipaService.ParseIPA(signedIPAPath)
		if parseErr != nil {
			logger.Warn().Err(parseErr).Str("signed_path", signedIPAPath).Msg("Failed to parse signed IPA metadata")
		}

		fileName := filepath.Base(signedIPAPath)
		appName := strings.TrimSuffix(fileName, filepath.Ext(fileName))
		version := ""
		if parseErr == nil {
			if strings.TrimSpace(parsedIPA.Name) != "" {
				appName = parsedIPA.Name
			}
			version = parsedIPA.Version
			if strings.TrimSpace(parsedIPA.BundleID) != "" {
				effectiveBundleID = parsedIPA.BundleID
			}
		}

		completedMessage := fmt.Sprintf("Signed IPA saved to %s", signedIPAPath)
		if signMode == "adhoc" {
			completedMessage = fmt.Sprintf("Edited IPA exported to %s", signedIPAPath)
		}

		hub.Broadcast(models.TaskProgress{
			Type:     "task_progress",
			TaskID:   taskID,
			TaskType: taskType,
			Status:   "completed",
			Progress: 100,
			Message:  completedMessage,
			Data: map[string]interface{}{
				"file_path":      signedIPAPath,
				"bundle_id":      effectiveBundleID,
				"app_name":       appName,
				"version":        version,
				"certificate_id": req.CertificateID,
				"device_udid":    strings.TrimSpace(req.DeviceUDID),
				"sign_mode":      signMode,
			},
		})
	}()

	logger.Info().Str("ipa_path", req.IpaPath).Str("task_id", taskID).Str("sign_mode", signMode).Str("certificate_id", req.CertificateID).Msg("IPA processing started")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "IPA processing started",
		Data: map[string]interface{}{
			"task_id": taskID,
		},
	})
}

func prepareSignedIPAForInstall(device ios.DeviceEntry, ipaPath string, bundleID string, certificateID string, taskID string) (string, string, func(), error) {
	effectiveBundleID := strings.TrimSpace(bundleID)
	if effectiveBundleID == "" {
		parsedIPA, err := ipaService.ParseIPA(ipaPath)
		if err != nil {
			return "", "", func() {}, fmt.Errorf("failed to parse IPA bundle ID: %w", err)
		}
		effectiveBundleID = strings.TrimSpace(parsedIPA.BundleID)
	}
	if effectiveBundleID == "" {
		return "", "", func() {}, fmt.Errorf("bundle ID is required for re-signing")
	}

	cert, err := certService.GetCertificate(certificateID)
	if err != nil {
		return "", "", func() {}, err
	}
	if cert.Type == "free_sign" {
		effectiveBundleID = certifi.DeriveFreeSignBundleID(effectiveBundleID, cert.TeamID)
	}

	var creds *store.GSACredentials
	if cert.Type == "free_sign" {
		appleID, _ := cert.RawData["apple_id"].(string)
		if strings.TrimSpace(appleID) == "" {
			return "", "", func() {}, fmt.Errorf("free-sign certificate is missing Apple ID metadata")
		}
		creds, err = storeService.GetGSACredentials(appleID)
		if err != nil {
			return "", "", func() {}, fmt.Errorf("failed to load GSA credentials for %s: %w", appleID, err)
		}
	}

	deviceName := fmt.Sprintf("ipaget-%s", device.Properties.SerialNumber)
	assets, err := certService.PrepareSigningAssets(certificateID, effectiveBundleID, deviceName, device.Properties.SerialNumber, creds)
	if err != nil {
		return "", "", func() {}, err
	}

	signedIPAPath, cleanup, err := signIPAWithAssets(
		ipaPath,
		assets,
		filepath.Join(os.TempDir(), "ipaget-install-sign-*", "signed.ipa"),
		true,
		taskID,
		"install",
		map[string]interface{}{
			"udid":           device.Properties.SerialNumber,
			"bundle_id":      effectiveBundleID,
			"file_path":      ipaPath,
			"certificate_id": certificateID,
		},
		nil,
		"",
	)
	if err != nil {
		return "", "", func() {}, err
	}

	return signedIPAPath, effectiveBundleID, cleanup, nil
}

func exportAdhocIPA(ipaPath string, outputDir string, bundleID string, taskID string, editorOpts *models.SigningOptions, iconPath string) (string, string, error) {
	effectiveBundleID := strings.TrimSpace(bundleID)
	if effectiveBundleID == "" {
		parsedIPA, err := ipaService.ParseIPA(ipaPath)
		if err != nil {
			return "", "", fmt.Errorf("failed to parse IPA bundle ID: %w", err)
		}
		effectiveBundleID = strings.TrimSpace(parsedIPA.BundleID)
	}
	if effectiveBundleID == "" {
		return "", "", fmt.Errorf("bundle ID is required for export")
	}

	hub.Broadcast(models.TaskProgress{
		Type:     "task_progress",
		TaskID:   taskID,
		TaskType: "export",
		Status:   "started",
		Progress: 0,
		Message:  "Preparing edited IPA...",
		Data: map[string]interface{}{
			"file_path": ipaPath,
			"bundle_id": effectiveBundleID,
			"sign_mode": "adhoc",
		},
	})

	outputPath, err := buildEditedOutputPath(outputDir, ipaPath)
	if err != nil {
		return "", "", err
	}

	if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
		return "", "", fmt.Errorf("failed to create output directory: %w", err)
	}

	hub.Broadcast(models.TaskProgress{
		Type:     "task_progress",
		TaskID:   taskID,
		TaskType: "export",
		Status:   "progress",
		Progress: 20,
		Message:  "Applying edits and Ad-Hoc signing...",
		Data: map[string]interface{}{
			"file_path": ipaPath,
			"bundle_id": effectiveBundleID,
			"sign_mode": "adhoc",
		},
	})

	opts := sign.SignerOptions{
		InputPath:  ipaPath,
		OutputPath: outputPath,
		Force:      true,
	}
	if editorOpts != nil {
		applyEditorToSigner(&opts, editorOpts)
	}
	if strings.TrimSpace(iconPath) != "" {
		opts.IconFile = strings.TrimSpace(iconPath)
	}

	if err := sign.SignIPA(opts); err != nil {
		return "", "", fmt.Errorf("failed to export edited IPA: %w", err)
	}

	return outputPath, effectiveBundleID, nil
}

func buildEditedOutputPath(outputDir string, ipaPath string) (string, error) {
	baseName := strings.TrimSuffix(filepath.Base(ipaPath), filepath.Ext(ipaPath))
	// Avoid stacking suffixes when re-exporting an already edited file.
	baseName = strings.TrimSuffix(baseName, "-edited")
	baseName = strings.TrimSuffix(baseName, "_signed")
	outputPath := filepath.Join(outputDir, baseName+"-edited.ipa")

	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		return outputPath, nil
	}

	for counter := 1; counter <= 1000; counter++ {
		candidate := filepath.Join(outputDir, fmt.Sprintf("%s-edited(%d).ipa", baseName, counter))
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("too many duplicate edited files")
}

func signStoredIPA(ipaPath string, certificateID string, deviceUDID string, outputDir string, bundleID string, taskID string, editorOpts *models.SigningOptions, iconPath string) (string, string, error) {
	effectiveBundleID := strings.TrimSpace(bundleID)
	if effectiveBundleID == "" {
		parsedIPA, err := ipaService.ParseIPA(ipaPath)
		if err != nil {
			return "", "", fmt.Errorf("failed to parse IPA bundle ID: %w", err)
		}
		effectiveBundleID = strings.TrimSpace(parsedIPA.BundleID)
	}
	if effectiveBundleID == "" {
		return "", "", fmt.Errorf("bundle ID is required for signing")
	}

	cert, err := certService.GetCertificate(certificateID)
	if err != nil {
		return "", "", err
	}

	var deviceName string
	var udid string
	var creds *store.GSACredentials
	var appleID string
	if cert.Type == "free_sign" {
		udid = strings.TrimSpace(deviceUDID)
		if udid == "" {
			return "", "", fmt.Errorf("device UDID is required for free signing")
		}

		device, err := deviceService.GetDeviceByUDID(udid)
		if err != nil {
			return "", "", err
		}
		deviceName = fmt.Sprintf("ipaget-%s", device.Properties.SerialNumber)
		udid = device.Properties.SerialNumber

		appleID, _ = cert.RawData["apple_id"].(string)
		appleID = strings.ToLower(strings.TrimSpace(appleID))
		if strings.TrimSpace(appleID) == "" {
			return "", "", fmt.Errorf("free-sign certificate is missing Apple ID metadata")
		}
		creds, err = storeService.GetGSACredentials(appleID)
		if err != nil {
			return "", "", fmt.Errorf("failed to load GSA credentials for %s: %w", appleID, err)
		}
	}

	if cert.Type == "free_sign" {
		effectiveBundleID = certifi.DeriveFreeSignBundleID(effectiveBundleID, cert.TeamID)
	}

	hub.Broadcast(models.TaskProgress{
		Type:     "task_progress",
		TaskID:   taskID,
		TaskType: "sign",
		Status:   "started",
		Progress: 0,
		Message:  "Preparing signing materials...",
		Data: map[string]interface{}{
			"file_path":      ipaPath,
			"bundle_id":      effectiveBundleID,
			"certificate_id": certificateID,
			"device_udid":    udid,
		},
	})

	assets, err := certService.PrepareSigningAssets(certificateID, effectiveBundleID, deviceName, udid, creds)
	if err != nil && cert.Type == "free_sign" {
		var sessionExpiredErr *certifi.SessionExpiredError
		isSessionExpired := errors.As(err, &sessionExpiredErr) ||
			strings.Contains(err.Error(), "session expired") ||
			strings.Contains(err.Error(), "1100") ||
			strings.Contains(err.Error(), "Your session has expired")

		if isSessionExpired {
			storedPassword, pwdErr := storeService.GetAccountPassword(appleID)
			if pwdErr != nil || strings.TrimSpace(storedPassword) == "" {
				return "", "", fmt.Errorf("session expired. Please log in again")
			}

			authResp, loginErr := storeService.LoginWithGSA(appleID, storedPassword, creds.AnisetteURL)
			if loginErr != nil || authResp == nil || !authResp.Success {
				return "", "", fmt.Errorf("session expired and failed to refresh credentials")
			}

			freshCreds, refreshErr := storeService.GetGSACredentials(appleID)
			if refreshErr != nil {
				return "", "", fmt.Errorf("session refreshed but failed to load credentials: %w", refreshErr)
			}

			creds = freshCreds
			assets, err = certService.PrepareSigningAssets(certificateID, effectiveBundleID, deviceName, udid, creds)
		}
	}
	if err != nil {
		return "", "", err
	}

	outputPath, err := buildSignedOutputPath(outputDir, ipaPath)
	if err != nil {
		return "", "", err
	}

	signedIPAPath, cleanup, err := signIPAWithAssets(
		ipaPath,
		assets,
		outputPath,
		false,
		taskID,
		"sign",
		map[string]interface{}{
			"file_path":      ipaPath,
			"bundle_id":      effectiveBundleID,
			"certificate_id": certificateID,
			"device_udid":    udid,
		},
		editorOpts,
		iconPath,
	)
	if err != nil {
		return "", "", err
	}
	cleanup()

	return signedIPAPath, effectiveBundleID, nil
}

func signIPAWithAssets(
	ipaPath string,
	assets *certifi.SigningAssets,
	outputPath string,
	tempOutput bool,
	taskID string,
	taskType string,
	taskData map[string]interface{},
	editorOpts *models.SigningOptions,
	iconPath string,
) (string, func(), error) {
	hub.Broadcast(models.TaskProgress{
		Type:     "task_progress",
		TaskID:   taskID,
		TaskType: taskType,
		Status:   "progress",
		Progress: 15,
		Message:  "Signing IPA...",
		Data:     taskData,
	})

	var tempDir string
	var err error
	cleanup := func() {}
	if tempOutput {
		tempDir, err = os.MkdirTemp("", "ipaget-install-sign-*")
		if err != nil {
			return "", func() {}, fmt.Errorf("failed to create temp sign directory: %w", err)
		}
		cleanup = func() {
			_ = os.RemoveAll(tempDir)
		}
		outputPath = filepath.Join(tempDir, "signed.ipa")
	} else {
		if err := os.MkdirAll(filepath.Dir(outputPath), 0755); err != nil {
			return "", func() {}, fmt.Errorf("failed to create output directory: %w", err)
		}
	}

	workDir := tempDir
	if workDir == "" {
		workDir, err = os.MkdirTemp("", "ipaget-sign-assets-*")
		if err != nil {
			return "", cleanup, fmt.Errorf("failed to create temp assets directory: %w", err)
		}
		prevCleanup := cleanup
		cleanup = func() {
			prevCleanup()
			_ = os.RemoveAll(workDir)
		}
	}

	p12Path := filepath.Join(workDir, "cert.p12")
	if err := os.WriteFile(p12Path, assets.P12Data, 0600); err != nil {
		cleanup()
		return "", func() {}, fmt.Errorf("failed to write temp P12: %w", err)
	}
	provisionPath := filepath.Join(workDir, "profile.mobileprovision")
	if err := os.WriteFile(provisionPath, assets.ProvisionData, 0644); err != nil {
		cleanup()
		return "", func() {}, fmt.Errorf("failed to write temp provisioning profile: %w", err)
	}

	_, err = sign.ParseProvisioningProfileFromData(assets.ProvisionData)
	if err != nil {
		cleanup()
		return "", func() {}, fmt.Errorf("failed to parse generated provisioning profile: %w", err)
	}

	// Build a full SignerOptions, applying editor overrides when present.
	opts := sign.SignerOptions{
		InputPath:     ipaPath,
		OutputPath:    outputPath,
		P12File:       p12Path,
		P12Password:   assets.P12Password,
		ProvisionFile: provisionPath,
		Force:         true,
	}
	if editorOpts != nil {
		applyEditorToSigner(&opts, editorOpts)
	}
	if strings.TrimSpace(iconPath) != "" {
		opts.IconFile = strings.TrimSpace(iconPath)
	}

	// Provisioning profile is passed via the parsed *ProvisioningProfile to SignIPAWithP12;
	// here we feed it through a temp file path so SignIPA can read it.
	// (SignIPA reads ProvisionFile when P12File is set.)
	if err := sign.SignIPA(opts); err != nil {
		cleanup()
		return "", func() {}, fmt.Errorf("failed to sign IPA: %w", err)
	}

	return outputPath, cleanup, nil
}

// applyEditorToSigner copies the editor-generated SigningOptions onto the SignerOptions
// struct that SignIPA actually consumes.
func applyEditorToSigner(opts *sign.SignerOptions, e *models.SigningOptions) {
	// Identity
	if e.AppName != nil {
		opts.NewBundleName = *e.AppName
	}
	if e.AppVersion != nil {
		opts.NewBundleVersion = *e.AppVersion
	}
	if e.AppIdentifier != nil {
		opts.NewBundleID = *e.AppIdentifier
	}
	if e.AppBuildVersion != nil {
		opts.NewBuildVersion = *e.AppBuildVersion
	}
	if e.MinimumOSVersion != nil {
		opts.MinimumOSVersion = *e.MinimumOSVersion
	}
	if e.Appearance != nil {
		opts.Appearance = *e.Appearance
	}

	// Injection
	if len(e.InjectionFiles) > 0 {
		opts.DylibFiles = append([]string{}, e.InjectionFiles...)
	}

	// Common capabilities
	opts.FileSharing = e.FileSharing
	opts.ITunesFileSharing = e.ITunesFileSharing
	opts.RemoveURLScheme = e.RemoveURLScheme
	opts.RemoveProvisioning = e.RemoveProvisioning
	opts.StatusBarHidden = e.StatusBarHidden
	opts.ViewControllerBasedStatusBar = e.ViewControllerBasedStatusBar
	opts.PrerenderedIcon = e.PrerenderedIcon
	opts.RequiresPersistentWiFi = e.RequiresPersistentWiFi
	opts.ExitsOnSuspend = e.ExitsOnSuspend
	opts.AllowsArbitraryLoads = e.AllowsArbitraryLoads
	opts.NoEncryptionDecl = e.NoEncryptionDecl

	// Orientations
	opts.OrientationPortrait = e.OrientationPortrait
	opts.OrientationLandscapeLeft = e.OrientationLandscapeLeft
	opts.OrientationLandscapeRight = e.OrientationLandscapeRight
	opts.OrientationPortraitUpsideDown = e.OrientationPortraitUpsideDown

	// Background modes
	opts.BgAudio = e.BgAudio
	opts.BgLocation = e.BgLocation
	opts.BgFetch = e.BgFetch
	opts.BgVoip = e.BgVoip

	// Advanced
	opts.RequiredDeviceCapabilities = e.RequiredDeviceCapabilities
	opts.RemoveSupportedDevices = e.RemoveSupportedDevices
	opts.BundleLocalizations = e.BundleLocalizations
	opts.DevelopmentRegion = e.DevelopmentRegion
	opts.ApplicationCategoryType = e.ApplicationCategoryType
	opts.SupportsMultipleScenes = e.SupportsMultipleScenes
	opts.CustomURLScheme = e.CustomURLScheme
	opts.RemoveDocumentTypes = e.RemoveDocumentTypes
	opts.RemoveExportedTypeDeclarations = e.RemoveExportedTypeDeclarations
	opts.RemoveApplicationQueriesSchemes = e.RemoveApplicationQueriesSchemes
	if e.PrivacyOverrides != nil {
		opts.PrivacyOverrides = e.PrivacyOverrides
	}
	opts.RemoveLaunchScreen = e.RemoveLaunchScreen
	opts.RemoveWatchApp = e.RemoveWatchApp
	opts.RemovePlugIns = e.RemovePlugIns
}

func buildSignedOutputPath(outputDir string, ipaPath string) (string, error) {
	baseName := strings.TrimSuffix(filepath.Base(ipaPath), filepath.Ext(ipaPath)) + "_signed.ipa"
	outputPath := filepath.Join(outputDir, baseName)

	if _, err := os.Stat(outputPath); os.IsNotExist(err) {
		return outputPath, nil
	}

	for counter := 1; counter <= 1000; counter++ {
		candidate := filepath.Join(outputDir, fmt.Sprintf("%s_signed(%d).ipa", strings.TrimSuffix(filepath.Base(ipaPath), filepath.Ext(ipaPath)), counter))
		if _, err := os.Stat(candidate); os.IsNotExist(err) {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("too many duplicate signed files")
}

func handleLaunchApp(c *gin.Context) {
	udid := c.Param("udid")
	bundleId := c.Param("bundleId")

	// Check if it's a simulated device
	if _, ok := deviceService.Simulated[udid]; ok {
		logger.Warn().Str("udid", udid).Msg("Cannot launch apps on simulated device")
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "Cannot launch apps on simulated device",
		})
		return
	}

	device, err := deviceService.GetDeviceByUDID(udid)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	err = appService.LaunchApp(*device, bundleId)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "App launched successfully",
	})
}

func handleKillApp(c *gin.Context) {
	udid := c.Param("udid")
	bundleId := c.Param("bundleId")

	// Check if it's a simulated device
	if _, ok := deviceService.Simulated[udid]; ok {
		logger.Warn().Str("udid", udid).Msg("Cannot kill apps on simulated device")
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "Cannot kill apps on simulated device",
		})
		return
	}

	device, err := deviceService.GetDeviceByUDID(udid)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	err = appService.KillApp(*device, bundleId)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "App killed successfully",
	})
}

func handleUninstallApp(c *gin.Context) {
	udid := c.Param("udid")
	bundleId := c.Param("bundleId")

	logger.Info().Str("udid", udid).Str("bundle_id", bundleId).Msg("API: Uninstalling app")

	// Check if it's a simulated device
	if _, ok := deviceService.Simulated[udid]; ok {
		logger.Warn().Str("udid", udid).Msg("Cannot uninstall apps from simulated device")
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "Cannot uninstall apps from simulated device",
		})
		return
	}

	device, err := deviceService.GetDeviceByUDID(udid)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Device not found")
		c.JSON(http.StatusNotFound, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	// Generate unique task ID
	taskID := fmt.Sprintf("uninstall_%s_%s_%d", udid[:8], bundleId, time.Now().UnixNano())

	// Uninstall in a goroutine to allow immediate response
	go func() {
		err := appService.UninstallApp(*device, bundleId, taskID, hub.Broadcast)
		if err != nil {
			logger.Error().Err(err).Str("udid", udid).Str("bundle_id", bundleId).Str("task_id", taskID).Msg("Failed to uninstall app")
		}
	}()

	logger.Info().Str("udid", udid).Str("bundle_id", bundleId).Str("task_id", taskID).Msg("App uninstall started")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "App uninstall started",
		Data: map[string]interface{}{
			"task_id": taskID,
		},
	})
}

func handleRestartDevice(c *gin.Context) {
	udid := c.Param("udid")

	logger.Info().Str("udid", udid).Msg("API: Restarting device")

	err := deviceService.RestartDevice(udid)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Failed to restart device")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	logger.Info().Str("udid", udid).Msg("Device restart initiated successfully")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "Device restart initiated",
	})
}

func handleShutdownDevice(c *gin.Context) {
	udid := c.Param("udid")

	logger.Info().Str("udid", udid).Msg("API: Shutting down device")

	err := deviceService.ShutdownDevice(udid)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Failed to shutdown device")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	logger.Info().Str("udid", udid).Msg("Device shutdown initiated successfully")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "Device shutdown initiated",
	})
}

func handleLockdownDebug(c *gin.Context) {
	udid := c.Param("udid")

	logger.Info().Str("udid", udid).Msg("API: Getting lockdown debug info")

	values, err := deviceService.GetLockdownValues(udid)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Failed to get lockdown values")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	logger.Info().Str("udid", udid).Msg("Lockdown debug info retrieved successfully")
	c.JSON(http.StatusOK, values)
}

type crashLogEntry struct {
	Path         string `json:"path"`
	Name         string `json:"name"`
	IsDir        bool   `json:"is_dir"`
	Size         int64  `json:"size"`
	ModifiedUnix int64  `json:"modified_unix"`
}

func handleListCrashLogs(c *gin.Context) {
	udid := c.Param("udid")
	logger.Info().Str("udid", udid).Msg("API: Listing crash logs")

	device, err := deviceService.GetDeviceByUDID(udid)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Device not found")
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: err.Error()})
		return
	}

	pattern := c.DefaultQuery("pattern", "*")
	files, err := listCrashLogPaths(*device, ".", pattern)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Failed to list crash logs")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: err.Error()})
		return
	}

	entries := make([]crashLogEntry, 0, len(files))
	for _, f := range files {
		if f == "." || f == ".." {
			continue
		}
		entries = append(entries, crashLogEntry{
			Path:         f,
			Name:         filepath.Base(f),
			IsDir:        false,
			Size:         0,
			ModifiedUnix: 0,
		})
	}

	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].Name < entries[j].Name
	})

	c.JSON(http.StatusOK, models.SuccessResponse{Message: "success", Data: entries})
}

func handleGetCrashLogContent(c *gin.Context) {
	udid := c.Param("udid")
	pathParam := c.Query("path")
	if strings.TrimSpace(pathParam) == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "path is required"})
		return
	}
	if strings.Contains(pathParam, "..") || strings.HasPrefix(pathParam, "/") || strings.HasPrefix(pathParam, "\\") {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{Error: "invalid path"})
		return
	}

	logger.Info().Str("udid", udid).Str("path", pathParam).Msg("API: Reading crash log")

	device, err := deviceService.GetDeviceByUDID(udid)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Device not found")
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: err.Error()})
		return
	}

	maxBytes := 1024 * 1024
	if mb := c.Query("max_bytes"); strings.TrimSpace(mb) != "" {
		if v, err := strconv.Atoi(mb); err == nil && v > 0 {
			maxBytes = v
		}
	}

	content, truncated, err := readCrashLogFile(*device, pathParam, maxBytes)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Str("path", pathParam).Msg("Failed to read crash log")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{Message: "success", Data: map[string]interface{}{
		"path":      pathParam,
		"content":   content,
		"truncated": truncated,
	}})
}

func handleGetFullDeviceInfo(c *gin.Context) {
	udid := c.Param("udid")
	logger.Info().Str("udid", udid).Msg("API: Collecting full device info")

	device, err := deviceService.GetDeviceByUDID(udid)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Device not found")
		c.JSON(http.StatusNotFound, models.ErrorResponse{Error: err.Error()})
		return
	}

	info, err := collectFullDeviceInfo(*device)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Failed to collect full device info")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{Message: "success", Data: info})
}

func collectFullDeviceInfo(device ios.DeviceEntry) (map[string]interface{}, error) {
	result := make(map[string]interface{})

	// Part 1: lockdown full values
	lockdownValues, err := ios.GetValuesPlist(device)
	if err != nil {
		return nil, err
	}
	result["lockdown:all"] = lockdownValues

	// Part 2: domain-specific values (aligned with scripts/export-device-info.ps1)
	domains := []string{
		"com.apple.disk_usage",
		"com.apple.disk_usage.factory",
		"com.apple.mobile.battery",
		"com.apple.iqagent",
		"com.apple.purplebuddy",
		"com.apple.PurpleBuddy",
		"com.apple.mobile.chaperone",
		"com.apple.mobile.third_party_termination",
		"com.apple.mobile.lockdownd",
		"com.apple.mobile.lockdown_cache",
		"com.apple.xcode.developerdomain",
		"com.apple.international",
		"com.apple.mobile.data_sync",
		"com.apple.mobile.tethered_sync",
		"com.apple.mobile_application_usage",
		"com.apple.mobile.backup",
		"com.apple.mobile.nikita",
		"com.apple.mobile.restriction",
		"com.apple.mobile.user_preferences",
		"com.apple.mobile.sync_data_class",
		"com.apple.mobile.software_behavior",
		"com.apple.mobile.iTunes.SQLMusicLibraryPostProcessCommands",
		"com.apple.mobile.iTunes.accessories",
		"com.apple.mobile.internal",
		"com.apple.mobile.wireless_lockdown",
		"com.apple.fairplay",
		"com.apple.iTunes",
		"com.apple.mobile.iTunes.store",
		"com.apple.mobile.iTunes",
		"com.apple.fmip",
		"com.apple.Accessibility",
	}

	lockdownConn, err := ios.ConnectLockdownWithSession(device)
	if err != nil {
		return nil, err
	}
	defer lockdownConn.Close()

	for _, domain := range domains {
		val, err := lockdownConn.GetValueForDomain("", domain)
		if err == nil && val != nil {
			result["lockdown:domain:"+domain] = val
		}
	}

	// Part 3: IORegistry entries (aligned with scripts/export-device-info.ps1)
	entries := []string{
		"AppleAPFSContainer",
		"AppleStockholmControl",
		"AppleSPUAppDriver",
		"AppleSPUProfileDriver",
		"AppleSPU",
		"AppleSPUHIDDevice",
		"AppleSPUFirmwareService",
		"Audio",
		"AppleAOPAudioController",
		"AppleAOPVoiceTriggerController",
		"Interfaces",
		"IOPP",
		"IOHIDInterface",
		"AppleARMPE",
		"AVD",
		"AppleAVD",
		"AppleAVE2Driver",
		"IODARTMapper",
		"RTBuddyService",
		"IOAccessoryTRM",
		"IOAccessoryUSBConnectShim",
		"USB2",
		"USB3",
		"AppleJPEGDriver",
		"AGXArmFirmwareMapper",
		"AppleT8015TempSensor",
		"AppleMobsiTmpSADC",
		"AppleDialogSPMIPMU",
		"AppleDialogSPMIPMURTC",
		"AppleCLPC",
		"AppleMesaSEPDriver",
		"AppleBiometricServices",
		"AppleSEPXARTService",
		"AppleSMC",
		"AppleARMPMUPowerSensor",
		"AppleARMPMUTempSensor",
		"AppleSmartBattery",
		"AppleSmartBatteryManager",
		"AppleSMCPMU",
		"AppleDiagnosticDataAccessReadOnly",
		"AppleMesaShim",
		"AppleMultitouchDevice",
		"IOSerialBSDClient",
		"AppleSerialShim",
		"IONetworkStack",
		"AppleBCMWLANBusInterfacePCIe",
		"AppleBCMWLANCore",
		"AppleOLYHAL",
		"AppleARMBacklight",
		"AppleM68Buttons",
		"AppleARMCPU",
		"AppleMobileApNonce",
		"AppleImage4",
		"product",
		"sacm",
		"AppleARMSlowAdaptiveClockingManager",
		"IOResources",
	}

	for _, entry := range entries {
		val, err := queryIORegistryEntry(device, entry, "")
		if err == nil && val != nil {
			result["ioregentry:"+entry] = val
		}
	}

	return result, nil
}

func queryIORegistryEntry(device ios.DeviceEntry, entryName string, entryClass string) (map[string]interface{}, error) {
	deviceConn, err := ios.ConnectToService(device, "com.apple.mobile.diagnostics_relay")
	if err != nil {
		return nil, err
	}
	defer deviceConn.Close()

	plistCodec := ios.NewPlistCodec()
	reqMap := map[string]string{"Request": "IORegistry"}
	if strings.TrimSpace(entryName) != "" {
		reqMap["EntryName"] = entryName
	}
	if strings.TrimSpace(entryClass) != "" {
		reqMap["EntryClass"] = entryClass
	}

	encoded, err := plistCodec.Encode(reqMap)
	if err != nil {
		return nil, err
	}
	if err := deviceConn.Send(encoded); err != nil {
		return nil, err
	}

	respBytes, err := plistCodec.Decode(deviceConn.Reader())
	if err != nil {
		return nil, err
	}
	parsed, err := ios.ParsePlist(respBytes)
	if err != nil {
		return nil, err
	}
	if diag, ok := parsed["Diagnostics"].(map[string]interface{}); ok {
		return diag, nil
	}
	return parsed, nil
}

func readCrashLogFile(device ios.DeviceEntry, devicePath string, maxBytes int) (string, bool, error) {
	if err := ensureCrashReportsMoved(device); err != nil {
		return "", false, err
	}

	deviceConn, err := ios.ConnectToService(device, "com.apple.crashreportcopymobile")
	if err != nil {
		return "", false, err
	}
	defer deviceConn.Close()

	afcConn := afc.NewFromConn(deviceConn)
	stat, err := afcConn.Stat(devicePath)
	if err != nil {
		return "", false, err
	}
	if stat.IsDir() {
		return "", false, fmt.Errorf("path is a directory")
	}

	tmpDir, err := os.MkdirTemp("", "ipaget-crashlog-*")
	if err != nil {
		return "", false, err
	}
	defer os.RemoveAll(tmpDir)

	tmpFile := filepath.Join(tmpDir, filepath.Base(devicePath))
	if err := afcConn.PullSingleFile(devicePath, tmpFile); err != nil {
		return "", false, err
	}

	f, err := os.Open(tmpFile)
	if err != nil {
		return "", false, err
	}
	defer f.Close()

	if maxBytes <= 0 {
		maxBytes = 1024 * 1024
	}
	buf, err := io.ReadAll(io.LimitReader(f, int64(maxBytes+1)))
	if err != nil {
		return "", false, err
	}
	truncated := len(buf) > maxBytes
	if truncated {
		buf = buf[:maxBytes]
	}
	return string(buf), truncated, nil
}

func ensureCrashReportsMoved(device ios.DeviceEntry) error {
	conn, err := ios.ConnectToService(device, "com.apple.crashreportmover")
	if err != nil {
		return err
	}
	defer conn.Close()

	p := make([]byte, 4)
	if _, err := io.ReadFull(conn.Reader(), p); err != nil {
		return err
	}
	if string(p) != "ping" {
		return fmt.Errorf("did not receive ping from crashreport mover: %x", p)
	}
	return nil
}

func listCrashLogPaths(device ios.DeviceEntry, cwd string, pattern string) ([]string, error) {
	if strings.TrimSpace(pattern) == "" {
		pattern = "*"
	}
	if strings.TrimSpace(cwd) == "" {
		cwd = "."
	}
	if err := ensureCrashReportsMoved(device); err != nil {
		return nil, err
	}

	conn, err := ios.ConnectToService(device, "com.apple.crashreportcopymobile")
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	afcConn := afc.NewFromConn(conn)
	return afcConn.ListFiles(cwd, pattern)
}

func handleWebSocket(c *gin.Context) {
	logger.Debug().Str("remote_addr", c.Request.RemoteAddr).Msg("New WebSocket connection request")

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		logger.Error().Err(err).Msg("Failed to upgrade WebSocket connection")
		return
	}

	logger.Info().Str("instance_id", instanceID).Msg("WebSocket connection established")

	client := wsHub.NewClient(hub, conn)
	hub.Register(client)

	// Send hello message with instance ID immediately on connect
	hello := map[string]interface{}{
		"type":        "hello",
		"instance_id": instanceID,
		"time":        time.Now().UnixMilli(),
	}
	if data, err := json.Marshal(hello); err == nil {
		_ = conn.WriteMessage(websocket.TextMessage, data)
	}

	go client.WritePump()
	go func() {
		defer func() {
			hub.Unregister(client)
		}()
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			// Simple ping/pong echo for debug
			if string(msg) == "{\"type\":\"ping\"}" {
				conn.WriteMessage(websocket.TextMessage, []byte("{\"type\":\"pong\"}"))
			}
		}
	}()
}

func handleLogsWebSocket(c *gin.Context) {
	logger.Debug().Msg("New log stream connection request")
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		logger.Error().Err(err).Msg("Failed to upgrade log stream connection")
		return
	}
	defer conn.Close()

	// On connect, send history as a batch
	history := logger.LogBuffer.GetHistory()
	logger.Debug().Int("count", len(history)).Msg("Sending log history to new client")

	// Pack all history logs into a JSON array and send at once
	if len(history) > 0 {
		// Build a JSON array: [log1, log2, log3, ...]
		batchMsg := []byte("[")
		for i, line := range history {
			if i > 0 {
				batchMsg = append(batchMsg, ',')
			}
			batchMsg = append(batchMsg, line...)
		}
		batchMsg = append(batchMsg, ']')

		if err := conn.WriteMessage(websocket.TextMessage, batchMsg); err != nil {
			logger.Warn().Err(err).Msg("Failed to write log history batch to client")
			return
		}
	}

	// Subscribe to new logs
	logChan := logger.LogBuffer.Subscribe()
	defer logger.LogBuffer.Unsubscribe(logChan)

	// Goroutine to read messages from client (and detect close)
	go func() {
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				// This will trigger the defer above to unsubscribe
				return
			}
		}
	}()

	// Forward new logs to the client
	for line := range logChan {
		if err := conn.WriteMessage(websocket.TextMessage, line); err != nil {
			logger.Warn().Err(err).Msg("Failed to write log line to client, closing connection")
			return
		}
	}
}

func handleLogin(c *gin.Context) {
	var req struct {
		Email       string `json:"email" binding:"required"`
		Password    string `json:"password" binding:"required"`
		AnisetteURL string `json:"anisette_url"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "email and password are required",
		})
		return
	}

	logger.Info().
		Str("email", req.Email).
		Str("anisette_url_from_frontend", req.AnisetteURL).
		Msg("Received login request")

	// Add safety check
	if storeService == nil {
		logger.Error().Msg("storeService is nil")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: "service not initialized",
		})
		return
	}

	// Pass optional anisette override
	result, err := storeService.LoginWithGSA(req.Email, req.Password, req.AnisetteURL)
	if err != nil {
		logger.Error().
			Err(err).
			Str("email", req.Email).
			Msg("Login handler error")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, result)
}

func handleVerify2FA(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required"`
		Password string `json:"password" binding:"required"`
		Code     string `json:"code" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "email, password, and code are required",
		})
		return
	}

	// Add safety check
	if storeService == nil {
		logger.Error().Msg("storeService is nil")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: "service not initialized",
		})
		return
	}

	result, err := storeService.Verify2FA(req.Email, req.Password, req.Code)
	if err != nil {
		logger.Error().
			Err(err).
			Str("email", req.Email).
			Msg("Verify2FA handler error")
		if result != nil {
			c.JSON(http.StatusOK, result)
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, result)
}

func handleLogout(c *gin.Context) {
	email := c.Query("email")
	if email == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "email is required",
		})
		return
	}

	err := storeService.Logout(email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "Logged out successfully",
	})
}

func handleCheckAuth(c *gin.Context) {
	email := c.Query("email")
	if email == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "email is required",
		})
		return
	}

	isAuth, err := storeService.CheckAuth(email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    map[string]bool{"authenticated": isAuth},
	})
}

func handleGetAccountInfo(c *gin.Context) {
	email := c.Query("email")
	if email == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "email is required",
		})
		return
	}

	info, err := storeService.GetAccountInfo(email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    info,
	})
}

func handleListAccounts(c *gin.Context) {
	accounts, err := storeService.ListAccounts()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    map[string]interface{}{"accounts": accounts},
	})
}

func handleGetCountryCode(c *gin.Context) {
	email := c.Query("email")
	if email == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "email is required",
		})
		return
	}

	countryCode, err := storeService.GetCountryCode(email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    map[string]string{"country_code": countryCode},
	})
}

func handleCheckLicense(c *gin.Context) {
	bundleID := c.Query("bundle_id")
	email := c.Query("email")
	if bundleID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "bundle_id is required",
		})
		return
	}
	if email == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "email is required",
		})
		return
	}

	hasLicense, err := storeService.CheckLicense(bundleID, email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    map[string]bool{"has_license": hasLicense},
	})
}

func handleGetTopApps(c *gin.Context) {
	limitStr := c.DefaultQuery("limit", "50")
	country := c.Query("country")

	limit := 50
	fmt.Sscanf(limitStr, "%d", &limit)

	apps, err := storeService.GetTopApps(limit, country)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    map[string]interface{}{"apps": apps},
	})
}

func handleSearchApps(c *gin.Context) {
	keyword := c.Query("keyword")
	if keyword == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "keyword is required",
		})
		return
	}

	limit := c.DefaultQuery("limit", "10")
	country := c.DefaultQuery("country", "us")

	apps, err := storeService.SearchApps(keyword, limit, country)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    map[string]interface{}{"apps": apps},
	})
}

func handleGetAppDetails(c *gin.Context) {
	bundleID := c.Query("bundle_id")
	if bundleID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "bundle_id is required",
		})
		return
	}

	email := c.Query("email")
	if email == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "email is required",
		})
		return
	}

	details, err := storeService.GetAppDetails(bundleID, email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    details,
	})
}

func handleGetAppSubtitles(c *gin.Context) {
	bundleIDs := c.QueryArray("bundle_id")
	if len(bundleIDs) == 0 {
		if raw := strings.TrimSpace(c.Query("bundle_ids")); raw != "" {
			bundleIDs = strings.Split(raw, ",")
		}
	}

	if len(bundleIDs) == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "bundle_id is required",
		})
		return
	}

	country := c.DefaultQuery("country", "us")
	subtitles := storeService.GetAppSubtitles(bundleIDs, country)

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    map[string]interface{}{"subtitles": subtitles},
	})
}

func handleGetAppVersions(c *gin.Context) {
	bundleID := c.Query("bundle_id")
	if bundleID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "bundle_id is required",
		})
		return
	}

	email := c.Query("email")
	if email == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "email is required",
		})
		return
	}

	// Create a task ID for tracking progress
	taskID := fmt.Sprintf("version-history-%s-%d", bundleID, time.Now().UnixMilli())

	// Return task ID immediately
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "version history task started",
		Data:    map[string]interface{}{"task_id": taskID},
	})

	// Process in background with progress updates
	go func() {
		// Pass hub.Broadcast (method value) as the broadcast function
		history, err := storeService.GetAppVersionHistoryWithProgress(bundleID, email, taskID, hub.Broadcast)
		if err != nil {
			hub.Broadcast(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   taskID,
				TaskType: "version_history",
				Status:   "error",
				Progress: 0,
				Message:  err.Error(),
			})
			return
		}

		hub.Broadcast(models.TaskProgress{
			Type:     "task_progress",
			TaskID:   taskID,
			TaskType: "version_history",
			Status:   "completed",
			Progress: 100,
			Message:  "Version history loaded successfully",
			Data: map[string]interface{}{
				"history": history,
			},
		})
	}()
}

func handleGetVersionDetails(c *gin.Context) {
	var req struct {
		BundleID   string   `json:"bundle_id" binding:"required"`
		Email      string   `json:"email" binding:"required"`
		VersionIDs []string `json:"version_ids" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "bundle_id, email, and version_ids are required",
		})
		return
	}

	versions, err := storeService.GetVersionDetails(req.BundleID, req.Email, req.VersionIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    map[string]interface{}{"versions": versions},
	})
}

func handleDownloadApp(c *gin.Context) {
	var req struct {
		BundleID          string `json:"bundle_id" binding:"required"`
		Email             string `json:"email" binding:"required"`
		OutputDir         string `json:"output_dir" binding:"required"`
		AppName           string `json:"app_name"`
		IconURL           string `json:"icon_url"`
		ExternalVersionID string `json:"external_version_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "bundle_id, email, and output_dir are required",
		})
		return
	}

	taskID := fmt.Sprintf("download_%s_%d", req.BundleID, time.Now().UnixNano())
	appName := req.AppName
	if appName == "" {
		appName = req.BundleID
	}

	logger.Info().
		Str("task_id", taskID).
		Str("bundle_id", req.BundleID).
		Str("app_name", appName).
		Msg("Starting app download")

	// Create cancel channel and context for this task
	ctx, cancel := context.WithCancel(context.Background())
	cancelChan := make(chan struct{})
	cancelTasksMutex.Lock()
	cancelTasks[taskID] = cancelChan
	cancelTasksMutex.Unlock()

	// Send initial task progress
	hub.Broadcast(models.TaskProgress{
		Type:     "task_progress",
		TaskID:   taskID,
		TaskType: "download",
		Status:   "started",
		Progress: 0,
		Message:  fmt.Sprintf("Starting download of %s", appName),
		Data: map[string]interface{}{
			"bundle_id":           req.BundleID,
			"app_name":            appName,
			"icon_url":            req.IconURL,
			"external_version_id": req.ExternalVersionID,
		},
	})

	// Start download in background
	go func() {
		defer func() {
			cancel()
			cancelTasksMutex.Lock()
			delete(cancelTasks, taskID)
			cancelTasksMutex.Unlock()
		}()
		progressChan := make(chan models.DownloadProgress, 10)

		go func() {
			// Monotonic guard: never send a lower progress value than previously sent.
			// This prevents the progress bar from going backwards when retries
			// (token refresh, license acquisition) emit fixed stage values.
			var lastSentProgress float64
			for {
				select {
				case <-cancelChan:
					logger.Info().Str("task_id", taskID).Msg("Download task cancelled, stopping progress updates")
					return
				case progress, ok := <-progressChan:
					if !ok {
						return
					}

					var progressValue float64

					// Map stages to progress values
					switch progress.Message {
					case "Retrieving account information...":
						progressValue = 5
					case "Looking up app information...":
						progressValue = 10
					case "Checking app license...":
						progressValue = 15
					case "Refreshing login session...":
						progressValue = 20
					case "Downloading IPA file...":
						if progress.Progress > 0 {
							// Real download progress: map 0-100 to 25-100
							progressValue = 25 + (progress.Progress * 0.75)
						} else {
							progressValue = 25
						}
					default:
						if progress.Status == "completed" {
							progressValue = 100
						} else if progress.Progress > 0 {
							// Real download progress: map 0-100 to 25-100
							progressValue = 25 + (progress.Progress * 0.75)
						} else {
							progressValue = 25
						}
					}

					data := map[string]interface{}{
						"bundle_id":           req.BundleID,
						"app_name":            appName,
						"icon_url":            req.IconURL,
						"external_version_id": req.ExternalVersionID,
					}

					if progress.FilePath != "" {
						data["file_path"] = progress.FilePath
					}

					if progressValue > lastSentProgress {
						lastSentProgress = progressValue
					} else if progress.Status != "completed" && progress.Status != "error" {
						progressValue = lastSentProgress
					}

					hub.Broadcast(models.TaskProgress{
						Type:     "task_progress",
						TaskID:   taskID,
						TaskType: "download",
						Status:   progress.Status,
						Progress: progressValue,
						Message:  progress.Message,
						Data:     data,
					})
				}
			}
		}()

		err := storeService.Download(ctx, req.BundleID, req.Email, req.OutputDir, req.ExternalVersionID, progressChan)
		close(progressChan)

		// Check if task was cancelled
		cancelTasksMutex.Lock()
		isCancelled := cancelledTasksSet[taskID]
		if isCancelled {
			delete(cancelledTasksSet, taskID)
		}
		cancelTasksMutex.Unlock()

		// If task was cancelled, don't send completion/error messages as cancelled message was already sent
		if isCancelled {
			logger.Info().Str("task_id", taskID).Msg("Task was cancelled, skipping completion/error broadcast")
			return
		}

		if err != nil {
			logger.Error().Err(err).Str("bundle_id", req.BundleID).Msg("Download failed")

			// Check if error is related to token expiration
			isTokenError := strings.Contains(err.Error(), "password token") ||
				strings.Contains(err.Error(), "token expired") ||
				strings.Contains(err.Error(), "failed to refresh token")

			errorData := map[string]interface{}{
				"bundle_id":           req.BundleID,
				"app_name":            appName,
				"error":               err.Error(),
				"icon_url":            req.IconURL,
				"external_version_id": req.ExternalVersionID,
			}

			if isTokenError {
				errorData["account_expired"] = true
				errorData["email"] = req.Email
			}

			hub.Broadcast(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   taskID,
				TaskType: "download",
				Status:   "error",
				Progress: 0,
				Message:  fmt.Sprintf("Download failed: %v", err),
				Data:     errorData,
			})
		} else {
			logger.Info().Str("bundle_id", req.BundleID).Msg("Download completed")
			hub.Broadcast(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   taskID,
				TaskType: "download",
				Status:   "completed",
				Progress: 100,
				Message:  fmt.Sprintf("Download completed: %s", appName),
				Data: map[string]interface{}{
					"bundle_id":           req.BundleID,
					"app_name":            appName,
					"icon_url":            req.IconURL,
					"external_version_id": req.ExternalVersionID,
				},
			})
		}
	}()

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "Download started",
		Data: map[string]interface{}{
			"task_id": taskID,
		},
	})
}

func handleCancelTask(c *gin.Context) {
	taskID := c.Param("taskId")
	if taskID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "task_id is required",
		})
		return
	}

	logger.Info().Str("task_id", taskID).Msg("Cancelling task")

	cancelTasksMutex.Lock()
	cancelChan, exists := cancelTasks[taskID]
	if exists {
		close(cancelChan)
		delete(cancelTasks, taskID)
		cancelledTasksSet[taskID] = true
	}
	cancelTasksMutex.Unlock()

	if !exists {
		c.JSON(http.StatusNotFound, models.ErrorResponse{
			Error: "Task not found or already completed",
		})
		return
	}

	hub.Broadcast(models.TaskProgress{
		Type:     "task_progress",
		TaskID:   taskID,
		TaskType: "download",
		Status:   "cancelled",
		Progress: 0,
		Message:  "Task cancelled by user",
	})

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "Task cancelled successfully",
		Data: map[string]interface{}{
			"task_id": taskID,
		},
	})
}

func handleCheckPairingStatus(c *gin.Context) {
	udid := c.Param("udid")

	isPaired, waitingForTrust, err := deviceService.CheckPairingStatus(udid)
	if err != nil {
		errMsg := err.Error()

		// Device is locked (PasswordProtected) - return 423 Locked
		if strings.Contains(errMsg, "PasswordProtected") {
			logger.Debug().Err(err).Str("udid", udid).Msg("Device is locked")
			c.JSON(http.StatusLocked, gin.H{
				"error":        "Device is locked",
				"locked":       true,
				"is_paired":    false,
				"needs_unlock": true,
			})
			return
		}

		logger.Error().Err(err).Str("udid", udid).Msg("Failed to check pairing status")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: fmt.Sprintf("Failed to check pairing status: %v", err),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"is_paired":         isPaired,
		"waiting_for_trust": waitingForTrust,
		"needs_pairing":     !isPaired && !waitingForTrust,
	})
}

func handlePairDevice(c *gin.Context) {
	udid := c.Param("udid")

	logger.Info().Str("udid", udid).Msg("API: Pair device request")

	err := deviceService.PairDevice(udid)
	if err != nil {
		errMsg := err.Error()

		// Waiting for user to trust
		if errMsg == "waiting_for_trust" {
			c.JSON(http.StatusAccepted, gin.H{
				"message":           "Waiting for user to trust this computer on device",
				"waiting_for_trust": true,
			})
			return
		}

		// Device is locked (PasswordProtected) - return 423 Locked
		if strings.Contains(errMsg, "PasswordProtected") {
			logger.Debug().Err(err).Str("udid", udid).Msg("Device is locked, cannot pair")
			c.JSON(http.StatusLocked, gin.H{
				"error":        "Device is locked",
				"locked":       true,
				"needs_unlock": true,
			})
			return
		}

		logger.Error().Err(err).Str("udid", udid).Msg("Failed to pair device")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: fmt.Sprintf("Failed to pair device: %v", err),
		})
		return
	}

	logger.Info().Str("udid", udid).Msg("Device paired successfully")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "Device paired successfully",
	})
}

func handleParseIPA(c *gin.Context) {
	var req struct {
		FilePath string `json:"file_path" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "file_path is required",
		})
		return
	}

	logger.Debug().Str("file_path", req.FilePath).Msg("Parsing IPA file")

	ipaInfo, err := ipaService.ParseIPA(req.FilePath)
	if err != nil {
		logger.Error().Err(err).Str("file_path", req.FilePath).Msg("Failed to parse IPA file")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: fmt.Sprintf("Failed to parse IPA file: %v", err),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "IPA file parsed successfully",
		Data:    ipaInfo,
	})
}

func handleListIPAFiles(c *gin.Context) {
	directory := strings.TrimSpace(c.Query("directory"))
	if directory == "" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: err.Error()})
			return
		}
		directory = filepath.Join(homeDir, "Downloads", "iPAGet")
	}

	entries, err := os.ReadDir(directory)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusOK, models.SuccessResponse{Message: "success", Data: []map[string]interface{}{}})
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{Error: err.Error()})
		return
	}

	ipas := make([]map[string]interface{}, 0)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		name := entry.Name()
		ext := strings.ToLower(filepath.Ext(name))
		if ext != ".ipa" && ext != ".tipa" {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		ipas = append(ipas, map[string]interface{}{
			"name":          name,
			"path":          filepath.Join(directory, name),
			"size":          info.Size(),
			"bundle_id":     "",
			"version":       "",
			"download_date": info.ModTime().Format(time.RFC3339),
			"source":        "native",
		})
	}

	c.JSON(http.StatusOK, models.SuccessResponse{Message: "success", Data: ipas})
}

func handleGetStorageInfo(c *gin.Context) {
	udid := c.Param("udid")

	logger.Debug().Str("udid", udid).Msg("API: Getting storage info")

	storageInfo, err := deviceService.GetStorageInfo(udid)
	if err != nil {
		logger.Error().Err(err).Str("udid", udid).Msg("Failed to get storage info")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	logger.Info().
		Str("udid", udid).
		Str("total", storageInfo.FormattedTotal).
		Str("used", storageInfo.FormattedUsed).
		Float64("used_percentage", storageInfo.UsedPercentage).
		Msg("Storage info retrieved successfully")

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    storageInfo,
	})
}

func handleGetIPADetails(c *gin.Context) {
	var req struct {
		FilePath string `json:"file_path" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "file_path is required",
		})
		return
	}

	logger.Debug().Str("file_path", req.FilePath).Msg("Getting IPA details")

	details, err := ipaService.GetIPADetails(req.FilePath, nil)
	if err != nil {
		logger.Error().Err(err).Str("file_path", req.FilePath).Msg("Failed to get IPA details")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: fmt.Sprintf("Failed to get IPA details: %v", err),
		})
		return
	}

	logger.Info().
		Str("file_path", req.FilePath).
		Int("files_count", len(details.Files)).
		Bool("has_entitlements", details.EntitlementsXML != "").
		Msg("IPA details retrieved successfully")

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "IPA details retrieved successfully",
		Data:    details,
	})
}

func handleExtractFile(c *gin.Context) {
	var req struct {
		IPAPath  string `json:"ipa_path" binding:"required"`
		FilePath string `json:"file_path" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "ipa_path and file_path are required",
		})
		return
	}

	logger.Debug().
		Str("ipa_path", req.IPAPath).
		Str("file_path", req.FilePath).
		Msg("Extracting file from IPA")

	content, err := ipaService.ExtractFile(req.IPAPath, req.FilePath)
	if err != nil {
		logger.Error().Err(err).
			Str("ipa_path", req.IPAPath).
			Str("file_path", req.FilePath).
			Msg("Failed to extract file")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: fmt.Sprintf("Failed to extract file: %v", err),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "File extracted successfully",
		Data: map[string]interface{}{
			"content": content,
		},
	})
}

func handleExtractFiles(c *gin.Context) {
	var req struct {
		IPAPath   string   `json:"ipa_path" binding:"required"`
		FilePaths []string `json:"file_paths" binding:"required"`
		OutputDir string   `json:"output_dir" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "ipa_path, file_paths and output_dir are required",
		})
		return
	}

	logger.Debug().
		Str("ipa_path", req.IPAPath).
		Int("file_count", len(req.FilePaths)).
		Str("output_dir", req.OutputDir).
		Msg("Extracting files from IPA")

	extractedFiles, err := ipaService.ExtractFiles(req.IPAPath, req.FilePaths, req.OutputDir)
	if err != nil {
		logger.Error().Err(err).
			Str("ipa_path", req.IPAPath).
			Msg("Failed to extract files")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: fmt.Sprintf("Failed to extract files: %v", err),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: fmt.Sprintf("Extracted %d files successfully", len(extractedFiles)),
		Data: map[string]interface{}{
			"files": extractedFiles,
		},
	})
}

// Certificate management handlers

func handleImportP12Cert(c *gin.Context) {
	var req struct {
		Name          string `json:"name" binding:"required"`
		P12Data       string `json:"p12_data" binding:"required"`
		ProvisionData string `json:"provision_data" binding:"required"`
		Password      string `json:"password" binding:"required"`
		IsDefault     bool   `json:"is_default"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "name, p12_data, provision_data, and password are required",
		})
		return
	}

	logger.Info().Str("name", req.Name).Msg("Importing P12 certificate")

	certificate, err := certService.ImportP12(certifi.ImportP12Request{
		Name:          req.Name,
		P12Data:       req.P12Data,
		ProvisionData: req.ProvisionData,
		Password:      req.Password,
		IsDefault:     req.IsDefault,
	})

	if err != nil {
		logger.Error().Err(err).Str("name", req.Name).Msg("Failed to import P12 certificate")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: fmt.Sprintf("Failed to import certificate: %v", err),
		})
		return
	}

	logger.Info().Str("id", certificate.ID).Str("name", certificate.Name).Msg("P12 certificate imported successfully")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "Certificate imported successfully",
		Data:    certificate,
	})
}

func handleImportFreeCert(c *gin.Context) {
	var req struct {
		Name        string `json:"name" binding:"required"`
		AppleID     string `json:"apple_id" binding:"required"`
		Password    string `json:"password"` // Optional if using existing account
		IsDefault   bool   `json:"is_default"`
		AnisetteURL string `json:"anisette_url"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "name and apple_id are required",
		})
		return
	}

	req.AppleID = strings.ToLower(strings.TrimSpace(req.AppleID))

	logger.Info().
		Str("name", req.Name).
		Str("apple_id", req.AppleID).
		Str("anisette_url_from_frontend", req.AnisetteURL).
		Msg("Importing free signing certificate")

	var dsid, authToken, anisetteURL string
	var gsaCreds *store.GSACredentials

	// Try to get GSA credentials from store
	gsaCreds, err := storeService.GetGSACredentials(req.AppleID)
	if err != nil {
		// GSA credentials not found, try to get them by re-authenticating with stored password
		logger.Warn().Err(err).Str("apple_id", req.AppleID).Msg("GSA credentials not found, attempting to re-authenticate")

		// Try to get stored password for the account
		storedPassword, pwdErr := storeService.GetAccountPassword(req.AppleID)
		if pwdErr != nil {
			logger.Error().Err(pwdErr).Str("apple_id", req.AppleID).Msg("Failed to get account password")
			c.JSON(http.StatusBadRequest, models.ErrorResponse{
				Error: fmt.Sprintf("Account not logged in or missing credentials. Please log in first: %v", err),
			})
			return
		}

		if storedPassword == "" {
			logger.Error().Str("apple_id", req.AppleID).Msg("No password stored for account")
			c.JSON(http.StatusBadRequest, models.ErrorResponse{
				Error: "Account has no stored password. Please log out and log in again to save credentials",
			})
			return
		}

		// Perform GSA login with stored password, using anisette_url from frontend if provided
		logger.Info().
			Str("apple_id", req.AppleID).
			Str("anisette_url_override", req.AnisetteURL).
			Msg("Re-authenticating with stored password to get GSA credentials")
		authResp, loginErr := storeService.LoginWithGSA(req.AppleID, storedPassword, req.AnisetteURL)
		if loginErr != nil {
			logger.Error().Err(loginErr).Str("apple_id", req.AppleID).Msg("GSA re-authentication failed")
			c.JSON(http.StatusBadRequest, models.ErrorResponse{
				Error: fmt.Sprintf("Failed to authenticate with Apple: %v", loginErr),
			})
			return
		}

		if !authResp.Success {
			logger.Error().Str("apple_id", req.AppleID).Msg("GSA re-authentication was not successful")
			c.JSON(http.StatusBadRequest, models.ErrorResponse{
				Error: "Failed to authenticate with Apple. Please log out and log in again",
			})
			return
		}

		// Get the newly saved GSA credentials
		gsaCreds, err = storeService.GetGSACredentials(req.AppleID)
		if err != nil {
			logger.Error().Err(err).Str("apple_id", req.AppleID).Msg("Failed to get GSA credentials after re-authentication")
			c.JSON(http.StatusInternalServerError, models.ErrorResponse{
				Error: fmt.Sprintf("Re-authentication succeeded but failed to retrieve credentials: %v", err),
			})
			return
		}

		logger.Info().Str("apple_id", req.AppleID).Msg("GSA re-authentication successful, using fresh credentials")
	} else {
		logger.Info().Str("apple_id", req.AppleID).Msg("Using existing GSA credentials for certificate generation")

		// CRITICAL: AnisetteData must exist and match the AuthToken
		// If AnisetteData is nil, we must re-authenticate to get fresh, consistent credentials
		if gsaCreds.AnisetteData == nil {
			logger.Warn().Str("apple_id", req.AppleID).Msg("GSA credentials missing AnisetteData - must re-authenticate for consistency")

			// Try to get stored password for re-authentication
			storedPassword, pwdErr := storeService.GetAccountPassword(req.AppleID)
			if pwdErr != nil || storedPassword == "" {
				logger.Error().Err(pwdErr).Str("apple_id", req.AppleID).Msg("Cannot re-authenticate: no stored password")
				c.JSON(http.StatusBadRequest, models.ErrorResponse{
					Error: "Credentials incomplete. Please log out and log in again to refresh your session",
				})
				return
			}

			logger.Info().Str("apple_id", req.AppleID).Msg("Re-authenticating to get fresh credentials with AnisetteData")
			authResp, loginErr := storeService.LoginWithGSA(req.AppleID, storedPassword, req.AnisetteURL)
			if loginErr != nil || !authResp.Success {
				logger.Error().Err(loginErr).Str("apple_id", req.AppleID).Msg("Re-authentication failed")
				c.JSON(http.StatusBadRequest, models.ErrorResponse{
					Error: "Failed to refresh credentials. Please log out and log in again",
				})
				return
			}

			// Get the newly saved GSA credentials
			gsaCreds, err = storeService.GetGSACredentials(req.AppleID)
			if err != nil || gsaCreds.AnisetteData == nil {
				logger.Error().Err(err).Str("apple_id", req.AppleID).Msg("Failed to get complete GSA credentials after re-authentication")
				c.JSON(http.StatusInternalServerError, models.ErrorResponse{
					Error: "Re-authentication succeeded but credentials are still incomplete. Please try again",
				})
				return
			}
			logger.Info().Str("apple_id", req.AppleID).Msg("Re-authentication successful, using fresh credentials")
		} else {
			// Debug: Log Anisette data details
			logger.Debug().
				Str("apple_id", req.AppleID).
				Str("client_time", gsaCreds.AnisetteData.ClientTime).
				Str("device_id", gsaCreds.AnisetteData.DeviceID).
				Str("md_prefix", func() string {
					if len(gsaCreds.AnisetteData.MD) > 20 {
						return gsaCreds.AnisetteData.MD[:20] + "..."
					}
					return gsaCreds.AnisetteData.MD
				}()).
				Str("mdm_prefix", func() string {
					if len(gsaCreds.AnisetteData.MDM) > 20 {
						return gsaCreds.AnisetteData.MDM[:20] + "..."
					}
					return gsaCreds.AnisetteData.MDM
				}()).
				Msg("Using cached Anisette data from GSA credentials")
		}
	}

	dsid = gsaCreds.DSID
	authToken = gsaCreds.AuthToken
	anisetteURL = gsaCreds.AnisetteURL

	// Override anisette URL if provided from frontend
	if strings.TrimSpace(req.AnisetteURL) != "" {
		anisetteURL = strings.TrimSpace(req.AnisetteURL)
	}

	dsidPreview := dsid
	if len(dsid) > 20 {
		dsidPreview = dsid[:20] + "..."
	}
	tokenPreview := authToken
	if len(authToken) > 20 {
		tokenPreview = authToken[:20] + "..."
	}

	logger.Info().
		Str("apple_id", req.AppleID).
		Str("dsid_preview", dsidPreview).
		Str("token_preview", tokenPreview).
		Str("anisette_url", anisetteURL).
		Msg("Using GSA credentials for certificate generation")

	certificate, err := certService.ImportFreeSign(certifi.ImportFreeSignRequest{
		Name:         req.Name,
		AppleID:      req.AppleID,
		Password:     "",
		DSID:         dsid,
		AuthToken:    authToken,
		AnisetteURL:  anisetteURL,
		AnisetteData: gsaCreds.AnisetteData,
		IsDefault:    req.IsDefault,
	})

	if err != nil {
		// Check if this is a session expired error (resultCode 1100)
		var sessionExpiredErr *certifi.SessionExpiredError
		isSessionExpired := errors.As(err, &sessionExpiredErr) ||
			strings.Contains(err.Error(), "session expired") ||
			strings.Contains(err.Error(), "1100") ||
			strings.Contains(err.Error(), "Your session has expired")

		logger.Debug().
			Err(err).
			Bool("is_session_expired", isSessionExpired).
			Str("error_type", fmt.Sprintf("%T", err)).
			Msg("Certificate import error occurred")

		if isSessionExpired {
			logger.Warn().Err(err).Str("apple_id", req.AppleID).Msg("Session expired during certificate import, attempting to re-authenticate")

			// Try to get stored password for the account
			storedPassword, pwdErr := storeService.GetAccountPassword(req.AppleID)
			if pwdErr != nil {
				logger.Error().Err(pwdErr).Str("apple_id", req.AppleID).Msg("Failed to get account password for re-authentication")
				c.JSON(http.StatusBadRequest, models.ErrorResponse{
					Error: "Session expired. Please log out and log in again to refresh credentials",
				})
				return
			}

			if storedPassword == "" {
				logger.Error().Str("apple_id", req.AppleID).Msg("No password stored for account")
				c.JSON(http.StatusBadRequest, models.ErrorResponse{
					Error: "Session expired. Please log out and log in again to save credentials",
				})
				return
			}

			logger.Info().
				Str("apple_id", req.AppleID).
				Str("anisette_url_override", req.AnisetteURL).
				Msg("Password retrieved, starting GSA re-authentication after session expiry")
			authResp, loginErr := storeService.LoginWithGSA(req.AppleID, storedPassword, req.AnisetteURL)
			if loginErr != nil {
				logger.Error().Err(loginErr).Str("apple_id", req.AppleID).Msg("GSA re-authentication failed")
				var gsaErr *store.GSAError
				if errors.As(loginErr, &gsaErr) {
					c.JSON(http.StatusBadRequest, models.ErrorResponse{
						Error: "Session expired. Please log out and log in again, and complete the two-factor authentication flow.",
					})
					return
				}
				c.JSON(http.StatusBadRequest, models.ErrorResponse{
					Error: fmt.Sprintf("Session expired and re-authentication failed: %v", loginErr),
				})
				return
			}

			if !authResp.Success {
				logger.Error().Str("apple_id", req.AppleID).Msg("GSA re-authentication was not successful")
				c.JSON(http.StatusBadRequest, models.ErrorResponse{
					Error: "Session expired and re-authentication failed. Please log out and log in again",
				})
				return
			}

			// Get the newly saved GSA credentials
			gsaCreds, err = storeService.GetGSACredentials(req.AppleID)
			if err != nil {
				logger.Error().Err(err).Str("apple_id", req.AppleID).Msg("Failed to get GSA credentials after re-authentication")
				c.JSON(http.StatusInternalServerError, models.ErrorResponse{
					Error: fmt.Sprintf("Re-authentication succeeded but failed to retrieve credentials: %v", err),
				})
				return
			}

			// CRITICAL: AnisetteData must be present after re-authentication
			// Do NOT fetch new Anisette data separately - it must match the AuthToken
			if gsaCreds.AnisetteData == nil {
				logger.Error().Str("apple_id", req.AppleID).Msg("Re-authentication did not produce complete credentials (missing AnisetteData)")
				c.JSON(http.StatusInternalServerError, models.ErrorResponse{
					Error: "Re-authentication succeeded but credentials are incomplete. Please try logging out and logging in again",
				})
				return
			}

			logger.Debug().
				Str("apple_id", req.AppleID).
				Str("anisette_url", gsaCreds.AnisetteURL).
				Str("client_time", gsaCreds.AnisetteData.ClientTime).
				Str("token_preview", func() string {
					if len(gsaCreds.AuthToken) > 30 {
						return gsaCreds.AuthToken[:30] + "..."
					}
					return gsaCreds.AuthToken
				}()).
				Msg("Retrieved complete GSA credentials after re-authentication")

			newDSIDPreview := gsaCreds.DSID
			if len(gsaCreds.DSID) > 20 {
				newDSIDPreview = gsaCreds.DSID[:20] + "..."
			}
			newTokenPreview := gsaCreds.AuthToken
			if len(gsaCreds.AuthToken) > 30 {
				newTokenPreview = gsaCreds.AuthToken[:30] + "..."
			}

			logger.Info().
				Str("apple_id", req.AppleID).
				Str("old_dsid_preview", func() string {
					if len(dsid) > 20 {
						return dsid[:20] + "..."
					}
					return dsid
				}()).
				Str("new_dsid_preview", newDSIDPreview).
				Str("old_token_preview", func() string {
					if len(authToken) > 30 {
						return authToken[:30] + "..."
					}
					return authToken
				}()).
				Str("new_token_preview", newTokenPreview).
				Bool("dsid_changed", dsid != gsaCreds.DSID).
				Bool("token_changed", authToken != gsaCreds.AuthToken).
				Msg("Comparing old and new credentials")

			logger.Info().
				Str("apple_id", req.AppleID).
				Str("dsid_preview", newDSIDPreview).
				Msg("New GSA credentials retrieved successfully, retrying certificate import")

			logger.Info().Str("apple_id", req.AppleID).Msg("Session refreshed successfully, retrying certificate import")

			// Retry certificate import with fresh credentials
			logger.Info().Str("apple_id", req.AppleID).Str("name", req.Name).Msg("Retrying certificate import with refreshed credentials")

			retryDSIDPreview := gsaCreds.DSID
			if len(gsaCreds.DSID) > 20 {
				retryDSIDPreview = gsaCreds.DSID[:20] + "..."
			}
			retryTokenPreview := gsaCreds.AuthToken
			if len(gsaCreds.AuthToken) > 30 {
				retryTokenPreview = gsaCreds.AuthToken[:30] + "..."
			}

			logger.Debug().
				Str("apple_id", req.AppleID).
				Str("dsid_preview", retryDSIDPreview).
				Str("token_preview", retryTokenPreview).
				Str("anisette_url", gsaCreds.AnisetteURL).
				Bool("has_anisette_data", gsaCreds.AnisetteData != nil).
				Msg("Using credentials for retry")

			certificate, err = certService.ImportFreeSign(certifi.ImportFreeSignRequest{
				Name:         req.Name,
				AppleID:      req.AppleID,
				Password:     "",
				DSID:         gsaCreds.DSID,
				AuthToken:    gsaCreds.AuthToken,
				AnisetteURL:  gsaCreds.AnisetteURL,
				AnisetteData: gsaCreds.AnisetteData,
				IsDefault:    req.IsDefault,
			})

			if err != nil {
				logger.Error().Err(err).Str("name", req.Name).Msg("Failed to import free signing certificate after session refresh")
				c.JSON(http.StatusInternalServerError, models.ErrorResponse{
					Error: fmt.Sprintf("Failed to import certificate: %v", err),
				})
				return
			}
		} else {
			logger.Error().Err(err).Str("name", req.Name).Msg("Failed to import free signing certificate")
			c.JSON(http.StatusInternalServerError, models.ErrorResponse{
				Error: fmt.Sprintf("Failed to import certificate: %v", err),
			})
			return
		}
	}

	logger.Info().Str("id", certificate.ID).Str("name", certificate.Name).Msg("Free signing certificate imported successfully")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "Certificate imported successfully",
		Data:    certificate,
	})
}

func handleListCerts(c *gin.Context) {
	logger.Debug().Msg("API: Listing certificates")

	certificates := certService.ListCertificates()

	logger.Info().Int("count", len(certificates)).Msg("Successfully retrieved certificates")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    certificates,
	})
}

func handleGetCert(c *gin.Context) {
	id := c.Param("id")

	logger.Debug().Str("id", id).Msg("API: Getting certificate")

	certificate, err := certService.GetCertificate(id)
	if err != nil {
		logger.Error().Err(err).Str("id", id).Msg("Certificate not found")
		c.JSON(http.StatusNotFound, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	logger.Info().Str("id", id).Str("name", certificate.Name).Msg("Certificate retrieved successfully")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    certificate,
	})
}

func handleExportCert(c *gin.Context) {
	id := c.Param("id")

	logger.Info().Str("id", id).Msg("API: Exporting certificate")

	exportedFile, err := certService.ExportCertificate(id)
	if err != nil {
		logger.Error().Err(err).Str("id", id).Msg("Failed to export certificate")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", exportedFile.FileName))
	c.Data(http.StatusOK, exportedFile.ContentType, exportedFile.Data)
}

func handleDeleteCert(c *gin.Context) {
	id := c.Param("id")

	logger.Info().Str("id", id).Msg("API: Deleting certificate")

	err := certService.DeleteCertificate(id)
	if err != nil {
		logger.Error().Err(err).Str("id", id).Msg("Failed to delete certificate")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	logger.Info().Str("id", id).Msg("Certificate deleted successfully")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "Certificate deleted successfully",
	})
}

func handleSetDefaultCert(c *gin.Context) {
	id := c.Param("id")

	logger.Info().Str("id", id).Msg("API: Setting default certificate")

	err := certService.SetDefaultCertificate(id)
	if err != nil {
		logger.Error().Err(err).Str("id", id).Msg("Failed to set default certificate")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	logger.Info().Str("id", id).Msg("Default certificate set successfully")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "Default certificate set successfully",
	})
}

func handleGetCertForAppleID(c *gin.Context) {
	email := strings.ToLower(strings.TrimSpace(c.Param("email")))

	logger.Debug().Str("email", email).Msg("API: Getting certificate for Apple ID")

	certificate, err := certService.GetFreeSignCertForAppleID(email)
	if err != nil {
		logger.Error().Err(err).Str("email", email).Msg("Failed to get certificate for Apple ID")
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	if certificate == nil {
		// No certificate found, return null
		c.JSON(http.StatusOK, models.SuccessResponse{
			Message: "success",
			Data:    nil,
		})
		return
	}

	logger.Debug().Str("email", email).Str("id", certificate.ID).Msg("Certificate for Apple ID retrieved successfully")
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    certificate,
	})
}
