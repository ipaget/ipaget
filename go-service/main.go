package main

import (
	"flag"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"ipaget-service/internal/app"
	"ipaget-service/internal/device"
	"ipaget-service/internal/ipa"
	"ipaget-service/internal/logger"
	"ipaget-service/internal/models"
	"ipaget-service/internal/store"
	wsHub "ipaget-service/internal/websocket"
)

var (
	deviceService *device.Service
	appService    *app.Service
	storeService  *store.Service
	ipaService    *ipa.Service
	hub           *wsHub.Hub
	upgrader      = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
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
		serviceHost = "127.0.0.1"
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

	deviceService = device.NewService()
	appService = app.NewService()
	storeService = store.NewService(serviceConfigDir)
	ipaService = ipa.NewService()
	hub = wsHub.NewHub()

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

	// Global WebSocket endpoint for all real-time messages
	r.GET("/ws", handleWebSocket)

	// ipatool / App Store
	r.POST("/auth/login", handleLogin)
	r.POST("/auth/verify2fa", handleVerify2FA)
	r.POST("/auth/logout", handleLogout)
	r.GET("/auth/check", handleCheckAuth)
	r.GET("/auth/info", handleGetAccountInfo)
	r.GET("/auth/accounts", handleListAccounts)
	r.GET("/auth/country", handleGetCountryCode)
	r.GET("/apps/search", handleSearchApps)
	r.GET("/apps/details", handleGetAppDetails)
	r.GET("/apps/versions", handleGetAppVersions)
	r.POST("/apps/version-details", handleGetVersionDetails)
	r.POST("/apps/download", handleDownloadApp)

	// IPA file parsing
	r.POST("/ipa/parse", handleParseIPA)
	r.POST("/ipa/details", handleGetIPADetails)

	address := serviceHost + ":" + servicePort
	logger.Info().
		Str("address", address).
		Str("config_dir", serviceConfigDir).
		Msg("Starting iPAGet service")
	if err := r.Run(address); err != nil {
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
	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "iPAGet service is running",
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
		IpaPath  string `json:"ipa_path" binding:"required"`
		BundleID string `json:"bundle_id"`
		Version  string `json:"version"`
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

	// Generate unique task ID
	taskID := fmt.Sprintf("install_%s_%s_%d", udid[:8], req.BundleID, time.Now().UnixNano())

	// Install in a goroutine to allow immediate response
	go func() {
		err := appService.InstallApp(*device, req.IpaPath, taskID, req.BundleID, hub.Broadcast)
		if err != nil {
			logger.Error().Err(err).Str("udid", udid).Str("ipa_path", req.IpaPath).Str("task_id", taskID).Msg("Failed to install app")
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

func handleLaunchApp(c *gin.Context) {
	udid := c.Param("udid")
	bundleId := c.Param("bundleId")

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

func handleWebSocket(c *gin.Context) {
	logger.Debug().Str("remote_addr", c.Request.RemoteAddr).Msg("New WebSocket connection request")

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		logger.Error().Err(err).Msg("Failed to upgrade WebSocket connection")
		return
	}

	logger.Info().Msg("WebSocket connection established")

	client := wsHub.NewClient(hub, conn)
	hub.Register(client)

	go client.WritePump()
	go client.ReadPump()
}

func handleLogin(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required"`
		Password string `json:"password" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "email and password are required",
		})
		return
	}

	result, err := storeService.Login(req.Email, req.Password)
	if err != nil {
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

	result, err := storeService.Verify2FA(req.Email, req.Password, req.Code)
	if err != nil {
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

func handleSearchApps(c *gin.Context) {
	keyword := c.Query("keyword")
	if keyword == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "keyword is required",
		})
		return
	}

	limit := c.DefaultQuery("limit", "10")
	email := c.Query("email")
	if email == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse{
			Error: "email is required",
		})
		return
	}

	apps, err := storeService.SearchApps(keyword, limit, email)
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

	history, err := storeService.GetAppVersionHistory(bundleID, email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse{
			Error: err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "success",
		Data:    history,
	})
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
		BundleID  string `json:"bundle_id" binding:"required"`
		Email     string `json:"email" binding:"required"`
		OutputDir string `json:"output_dir" binding:"required"`
		AppName   string `json:"app_name"`
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

	// Send initial task progress
	hub.Broadcast(models.TaskProgress{
		Type:     "task_progress",
		TaskID:   taskID,
		TaskType: "download",
		Status:   "started",
		Progress: 0,
		Message:  fmt.Sprintf("Starting download of %s", appName),
		BundleID: req.BundleID,
		Data: map[string]interface{}{
			"app_name": appName,
		},
	})

	// Start download in background
	go func() {
		progressChan := make(chan models.DownloadProgress, 10)

		go func() {
			progressValue := 10.0
			for progress := range progressChan {
				if progress.Status == "progress" {
					progressValue += 10
					if progressValue > 90 {
						progressValue = 90
					}
				}

				hub.Broadcast(models.TaskProgress{
					Type:     "task_progress",
					TaskID:   taskID,
					TaskType: "download",
					Status:   progress.Status,
					Progress: progressValue,
					Message:  progress.Message,
					BundleID: req.BundleID,
					Data: map[string]interface{}{
						"app_name": appName,
					},
				})
			}
		}()

		err := storeService.Download(req.BundleID, req.Email, req.OutputDir, progressChan)
		close(progressChan)

		if err != nil {
			logger.Error().Err(err).Str("bundle_id", req.BundleID).Msg("Download failed")
			hub.Broadcast(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   taskID,
				TaskType: "download",
				Status:   "error",
				Progress: 0,
				Message:  fmt.Sprintf("Download failed: %v", err),
				BundleID: req.BundleID,
				Data: map[string]interface{}{
					"app_name": appName,
					"error":    err.Error(),
				},
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
				BundleID: req.BundleID,
				Data: map[string]interface{}{
					"app_name": appName,
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

	taskID := fmt.Sprintf("ipa_details_%d", time.Now().UnixNano())

	logger.Info().
		Str("task_id", taskID).
		Str("file_path", req.FilePath).
		Msg("Starting IPA details extraction")

	go func() {
		hub.Broadcast(models.TaskProgress{
			Type:     "task_progress",
			TaskID:   taskID,
			TaskType: "ipa_details",
			Status:   "started",
			Progress: 0,
			Message:  "Starting IPA details extraction...",
			FilePath: req.FilePath,
		})

		details, err := ipaService.GetIPADetails(req.FilePath, func(progress float64, message string) {
			hub.Broadcast(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   taskID,
				TaskType: "ipa_details",
				Status:   "progress",
				Progress: progress,
				Message:  message,
				FilePath: req.FilePath,
			})
		})

		if err != nil {
			logger.Error().Err(err).Str("file_path", req.FilePath).Str("task_id", taskID).Msg("Failed to get IPA details")
			hub.Broadcast(models.TaskProgress{
				Type:     "task_progress",
				TaskID:   taskID,
				TaskType: "ipa_details",
				Status:   "error",
				Progress: 0,
				Message:  fmt.Sprintf("Failed to get IPA details: %v", err),
				FilePath: req.FilePath,
			})
			return
		}

		hub.Broadcast(models.TaskProgress{
			Type:     "task_progress",
			TaskID:   taskID,
			TaskType: "ipa_details",
			Status:   "completed",
			Progress: 100,
			Message:  "IPA details extracted successfully",
			FilePath: req.FilePath,
			Data: map[string]interface{}{
				"entitlements_xml": details.EntitlementsXML,
				"files":            details.Files,
				"resources":        details.Resources,
			},
		})

		logger.Info().Str("file_path", req.FilePath).Str("task_id", taskID).Msg("IPA details extracted successfully")
	}()

	c.JSON(http.StatusOK, models.SuccessResponse{
		Message: "IPA details extraction started",
		Data: map[string]interface{}{
			"task_id": taskID,
		},
	})
}
