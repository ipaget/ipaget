import { useRef, useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation, useOutlet } from "react-router-dom";
import { useAccountStore, handleTokenExpired } from "./store/accountStore";
import { useSettingsStore } from "./store/settingsStore";
import { invoke } from "@tauri-apps/api/core";
import { goServiceClient, WebSocketEvent } from "./lib/goService";
import { useDeviceStore } from "./store/deviceStore";
import { useConnectionStore } from "./store/connectionStore";
import { useTaskStore } from "./store/taskStore";
import { useDebugStore, getLogDataFromCache, setFrontendLogBridgeEnabled } from "./store/debugStore";
import { useDownloadStore } from "./store/downloadStore";
import { useErrorStore as useErrorStoreForData } from "./store/errorStore";
import { useToastStore } from "./store/toastStore";
import { useLatest, useInterval, useMount, useUnmount } from "react-use";
import { listen, emit } from "@tauri-apps/api/event";
import { updateLoaderStatus, hideLoader } from "./main";
import { useTranslation } from "react-i18next";
import { isTauriRuntime } from "./lib/runtime";

import TitleBar from "./components/TitleBar";
import MainLayout from "./components/MainLayout";
import SearchPage from "./pages/SearchPage";
import SettingsPage from "./pages/SettingsPage";
import SigningPage from "./pages/SigningPage";
import IpaInstallerPage from "./pages/IpaInstallerPage";
import AppLibraryPage from "./pages/AppLibraryPage";
import DebugPage from "./pages/DebugPage";
import DevicesPage from "./pages/DevicesPage";
import EditorPage from "./pages/EditorPage";
import LoginDialog from "./components/LoginDialog";
import ErrorDialog from "./components/ErrorDialog";
import Toast from "./components/Toast";
import TrustDeviceDialog from "./components/TrustDeviceDialog";
import { useErrorStore } from "./store/errorStore";
import ActiveDownloadsPopup from "./components/ActiveDownloadsPopup";

function KeepAliveLayout() {
  const location = useLocation();
  const outlet = useOutlet();
  const [cache, setCache] = useState<Record<string, JSX.Element>>({});

  useEffect(() => {
    const path = location.pathname;
    if (outlet) {
      setCache(prev => {
        if (prev[path]) return prev;
        return { ...prev, [path]: outlet as JSX.Element };
      });
    }
  }, [location.pathname, outlet]);

  return (
    <div className="h-full relative overflow-hidden">
      {Object.entries(cache).map(([path, element]) => (
        <div 
          key={path} 
          style={{ 
            display: path === location.pathname ? 'block' : 'none', 
            height: '100%',
            overflow: 'hidden'
          }}
        >
          {element}
        </div>
      ))}
      {/* Render current outlet if not in cache yet */}
      {!cache[location.pathname] && outlet && (
        <div style={{ height: '100%', overflow: 'hidden' }}>
          {outlet}
        </div>
      )}
    </div>
  );
}

function AppContent() {
  const { addOrUpdateAccount, setSelectedAccount } = useAccountStore();
  const { loadSettings, settings, isLoaded: isSettingsLoaded } = useSettingsStore();
  const { 
    triggerRefresh,
    setShowTrustDialog,
    setTrustStatus,
    setPairingDeviceUdid,
    showTrustDialog,
    trustStatus,
    pairingDeviceUdid,
    setConnectedDevices,
  } = useDeviceStore();
  const { showError } = useErrorStore();
  const { setStatus, setReconnectAttempts } = useConnectionStore();
  const { updateTask } = useTaskStore();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [isDevMode, setIsDevMode] = useState(false);
  const [isInstallerMode, setIsInstallerMode] = useState(false);
  const debugWindowOpenRef = useRef(false);
  const storeSyncUnsubscribersRef = useRef<(() => void)[] | null>(null);
  const storeSyncTimerRef = useRef<number | null>(null);
  
  // Check if in installer mode
  useEffect(() => {
    setIsInstallerMode(location.pathname === "/installer");
  }, [location.pathname]);
  
  // Polling state refs
  const trustPollingEnabledRef = useRef(false);
  const trustPollingUdidRef = useRef<string | null>(null);
  const pairTimeoutRef = useRef<number | null>(null);
  const hasShownWsError = useRef(false);
  
  // Use useLatest to access latest values in callbacks (avoid closure issues)
  const latestPairingDeviceUdid = useLatest(pairingDeviceUdid);
  const latestShowTrustDialog = useLatest(showTrustDialog);
  const latestTrustStatus = useLatest(trustStatus);

  const buildDeviceDebugSnapshot = () => {
    const deviceStore = useDeviceStore.getState();
    const connectedDeviceList = deviceStore.connectedDevices.map((device) => ({
      udid: device.udid,
      name: device.name,
      model: device.model,
      version: device.version,
      color: device.color,
      product_type: device.product_type,
      product_name: device.product_name,
      is_paired: device.is_paired,
      battery_level: device.battery_level,
    }));

    return {
      connectedDeviceList,
      selectedDeviceUdid: deviceStore.selectedDevice?.udid ?? null,
    };
  };

  useMount(async () => {
    // Debug window is independent, skip global initialization
    if (location.pathname === "/debug") {
      return;
    }
    
    try {
      // Step 1: Load settings and check dev mode in parallel (non-blocking)
      updateLoaderStatus(t("loader.loadingSettings"));
      const [_, devMode] = await Promise.all([
        loadSettings().catch(err => {
          console.error("Failed to load settings:", err);
          return undefined;
        }),
        isTauriRuntime()
          ? invoke<boolean>("is_dev_mode").catch(err => {
              console.error("Failed to check dev mode:", err);
              return false;
            })
          : Promise.resolve(true)
      ]);
      setIsDevMode(devMode);
      
      // Step 2: Wait for Go service to be ready
      updateLoaderStatus(t("loader.startingBackend"));
      try {
        // Warm up service and prefetch lightweight data in parallel
        await Promise.all([
          goServiceClient.waitForServiceReady(),
          // Prefetch certificates in background; do not block loader
          (async () => {
            try {
              const { loadCertificates } = (await import("./store/certificateStore")).useCertificateStore.getState();
              loadCertificates();
            } catch (e) {
              // ignore prefetch error
            }
          })(),
        ]);
      } catch (error) {
        console.error("Go service failed to start:", error);
        // Parse the error message to extract attempt count
        const errorStr = String(error);
        const match = errorStr.match(/after (\d+) attempts/);
        const attempts = match ? match[1] : "30";
        const errorMessage = t("service.startFailedMessage", { attempts });
        showError(t("service.startFailed"), errorMessage);
        hideLoader();
        return;
      }
      
      // Step 3: Hide loader immediately to show UI faster
      hideLoader();
      
      // Step 4: Initialize WebSocket connection in background
      initializeGlobalWebSocket();
      
      // Step 5: Check authentication status in background (non-blocking)
      checkAuthStatus().catch(err => {
        console.error("Failed to check auth status:", err);
      });
      
    } catch (error) {
      console.error("Failed to initialize app:", error);
      hideLoader();
    }

    // If a new Tauri window wants to route to /debug (open_debug_window), handle event
    try {
      const unlistenDebug = await listen("open-debug", () => {
        navigate("/debug");
      });
      const unlistenDebugOpened = await listen("debug-window-opened", () => {
        debugWindowOpenRef.current = true;
        setFrontendLogBridgeEnabled(true);
        startStoreSync();
        emitStoreData().catch(() => {});
      });
      const unlistenDebugClosed = await listen("debug-window-closed", () => {
        debugWindowOpenRef.current = false;
        setFrontendLogBridgeEnabled(false);
        stopStoreSync();
      });
      
      // Listen for log history request from debug window
      const unlistenLogHistory = await listen("request-log-history", () => {
        const logs = useDebugStore.getState().frontendLogs;
        emit("log-history", logs.map(log => ({
          ...log,
          timestamp: log.timestamp.toISOString(),
        }))).catch(() => {});
      });
      
      // Listen for store data request from debug window
      const unlistenStoreData = await listen("request-store-data", () => {
        const accountStore = useAccountStore.getState();
        const deviceStore = useDeviceStore.getState();
        const taskStore = useTaskStore.getState();
        const connectionStore = useConnectionStore.getState();
        const downloadStore = useDownloadStore.getState();
        const errorStore = useErrorStoreForData.getState();
        const toastStore = useToastStore.getState();
        const debugStore = useDebugStore.getState();

        const allTasks = Array.from(taskStore.tasks.values());
        const deviceSnapshot = buildDeviceDebugSnapshot();

        const storeData = {
          account: {
            isAuthenticated: accountStore.isAuthenticated,
            selectedAccountEmail: accountStore.selectedAccount?.email ?? "[not-exists]",
            selectedAccountCountry: accountStore.selectedAccount?.country ?? "[not-exists]",
            totalAccounts: accountStore.accounts.length,
          },
          device: {
            connectedDevices: deviceStore.connectedDevices.length,
            selectedDevice: deviceStore.selectedDevice?.name ?? "none",
            isRefreshing: deviceStore.isRefreshing,
            showTrustDialog: deviceStore.showTrustDialog,
            trustStatus: deviceStore.trustStatus ?? "[not-exists]",
            deviceAppsCache: deviceStore.deviceAppsCache.size,
            connectedDeviceList: deviceSnapshot.connectedDeviceList,
            selectedDeviceUdid: deviceSnapshot.selectedDeviceUdid,
          },
          task: {
            allTasks: allTasks.length,
            runningTasks: allTasks.filter(t => t.status === "started" || t.status === "progress").length,
            completedTasks: allTasks.filter(t => t.status === "completed").length,
            errorTasks: allTasks.filter(t => t.status === "error").length,
          },
          connection: {
            status: connectionStore.status ?? "[not-exists]",
            reconnectAttempts: connectionStore.reconnectAttempts,
          },
          download: {
            downloads: downloadStore.downloads.length,
            activeDownloads: downloadStore.downloads.filter(d => d.status === "downloading").length,
            completedDownloads: downloadStore.downloads.filter(d => d.status === "completed").length,
            failedDownloads: downloadStore.downloads.filter(d => d.status === "failed").length,
          },
          error: {
            hasError: errorStore.message !== null,
            title: errorStore.title ?? "[not-exists]",
            showRestartButton: errorStore.showRestartButton,
          },
          toast: {
            hasMessage: toastStore.message !== null,
            message: toastStore.message ?? "[not-exists]",
            type: toastStore.type ?? "[not-exists]",
          },
          debug: {
            frontendLogs: debugStore.frontendLogs.length,
            maxLogs: debugStore.maxLogs,
          },
        };

        emit("store-data", storeData).catch(() => {});
      });
      
      // Listen for log data detail request from debug window
      const unlistenLogDataDetail = await listen<string>("request-log-data-detail", (event) => {
        const dataId = event.payload;
        const data = getLogDataFromCache(dataId);
        
        emit("log-data-detail", {
          dataId,
          data: data !== undefined ? data : null,
        }).catch(() => {});
      });
      
      return () => {
        unlistenDebug();
        unlistenDebugOpened();
        unlistenDebugClosed();
        unlistenLogHistory();
        unlistenStoreData();
        unlistenLogDataDetail();
      };
    } catch (e) {
      // ignore if not in tauri
    }
  });

  useEffect(() => {
    if (isSettingsLoaded && settings.language) {
      i18n.changeLanguage(settings.language);
    }
  }, [isSettingsLoaded, settings.language, i18n]);

  useUnmount(() => {
    trustPollingEnabledRef.current = false;
    if (pairTimeoutRef.current) {
      clearTimeout(pairTimeoutRef.current);
    }
    if (storeSyncTimerRef.current !== null) {
      clearTimeout(storeSyncTimerRef.current);
      storeSyncTimerRef.current = null;
    }
    setFrontendLogBridgeEnabled(false);
  });

  const checkAuthStatus = async () => {
    try {
      // Load account list first (desktop: Tauri config; web: backend keychain via API)
      await useAccountStore.getState().loadAccounts();

      const { accounts, selectedAccount } = useAccountStore.getState();
      if (!accounts.length) {
        setSelectedAccount(null);
        return;
      }

      // Prefer previously selected account, then first saved account
      const candidate =
        accounts.find((account) => account.email === selectedAccount?.email) ||
        accounts[0];

      const isAuthenticated = await goServiceClient.checkAuth(candidate.email);
      if (!isAuthenticated) {
        setSelectedAccount(null);
        return;
      }

      const accountInfo = await goServiceClient.getAccountInfo(candidate.email);
      addOrUpdateAccount({
        email: accountInfo.email,
        country: accountInfo.storefront,
      });

      // Desktop: keep Tauri local account list in sync
      if (isTauriRuntime()) {
        await invoke("save_account", {
          email: accountInfo.email,
          country: accountInfo.storefront,
        }).catch(console.error);
      }
    } catch (error) {
      console.error("Failed to check auth status:", error);
      setSelectedAccount(null);
    }
  };

  const checkAndPairDevice = async (udid: string) => {
    try {
      // Refresh device list to check if device is paired
      const devices = await goServiceClient.listDevices();
      setConnectedDevices(devices);
      
      const deviceFound = devices.some(d => d.udid === udid);
      
      if (deviceFound) {
        console.log("Device already paired:", udid);
        // Device is already paired, navigate to devices page
        navigate("/devices");
        triggerRefresh();
        return;
      }
      
      // Device not in list means it's not paired, initiate pairing
      console.log("Device not paired, initiating pairing:", udid);
      await handlePairing(udid);
    } catch (error) {
      console.error("Failed to check device pairing status:", error);
    }
  };

  const checkForUnpairedDevices = async () => {
    try {
      // First, load paired devices into store
      const pairedDevices = await goServiceClient.listDevices();
      console.log("Loading paired devices into store:", pairedDevices.length);
      setConnectedDevices(pairedDevices);
      
      // Then get all connected device UDIDs (including unpaired ones)
      const connectedUdids = await goServiceClient.listConnectedDeviceUDIDs();
      console.log("Connected device UDIDs:", connectedUdids);

      if (connectedUdids.length === 0) {
        console.log("No devices connected");
        return;
      }

      // Check pairing status for each device
      for (const udid of connectedUdids) {
        try {
          const status = await goServiceClient.checkPairingStatus(udid);
          console.log(`Device ${udid} pairing status:`, status);

          // If device needs pairing, initiate pairing process
          if (status.needs_pairing || status.waiting_for_trust) {
            console.log(`Device ${udid} needs pairing, initiating pairing process...`);
            await handlePairing(udid);
            // Only handle one device at a time
            break;
          }
        } catch (error: any) {
          console.error(`Failed to check pairing status for device ${udid}:`, error);
          // If device is locked or needs pairing, try to pair it
          if (error.message && (error.message.includes("locked") || error.message.includes("PasswordProtected"))) {
            console.log(`Device ${udid} is locked, initiating pairing process...`);
            await handlePairing(udid);
            break;
          }
        }
      }
    } catch (error) {
      console.error("Failed to check for unpaired devices:", error);
    }
  };

  const handlePairing = async (udid: string) => {
    setPairingDeviceUdid(udid);
    setShowTrustDialog(true);
    setTrustStatus("pairing");

    // Start 120 second timeout
    if (pairTimeoutRef.current) {
      clearTimeout(pairTimeoutRef.current);
    }
    pairTimeoutRef.current = window.setTimeout(() => {
      setTrustStatus("timeout");
    }, 120000); // 120 seconds

    try {
      const result = await goServiceClient.pairDevice(udid);
      
      if (result.waiting_for_trust) {
        setTrustStatus("waiting_trust");
        startTrustPolling(udid);
      } else if (result.success) {
        clearPairingTimers();
        setTrustStatus("success");
        setTimeout(async () => {
          setShowTrustDialog(false);
          setPairingDeviceUdid(null);
          navigate("/devices");
          triggerRefresh();
        }, 2000);
      }
    } catch (error: any) {
      const errorMsg = error.message || error.toString();
      
      // Check if device is locked
      if (errorMsg.includes("PasswordProtected") || 
          errorMsg.includes("Device is locked") || 
          errorMsg.toLowerCase().includes("locked")) {
        setTrustStatus("device_locked");
        startTrustPolling(udid);
      } else if (errorMsg.includes("device not found")) {
        // Suppress "device not found" error popup, as it likely means device was disconnected
        console.warn("Pairing failed: Device not found (likely disconnected):", udid);
        clearPairingTimers();
        setShowTrustDialog(false);
        setPairingDeviceUdid(null);
      } else {
        console.error("Failed to pair device:", error);
        showError(t("devices.trust.pairFailed"), errorMsg);
        clearPairingTimers();
        setShowTrustDialog(false);
        setPairingDeviceUdid(null);
      }
    }
  };

  const clearPairingTimers = () => {
    trustPollingEnabledRef.current = false;
    trustPollingUdidRef.current = null;
    if (pairTimeoutRef.current) {
      clearTimeout(pairTimeoutRef.current);
      pairTimeoutRef.current = null;
    }
  };

  const startTrustPolling = (udid: string) => {
    trustPollingEnabledRef.current = true;
    trustPollingUdidRef.current = udid;
  };

  // Trust polling interval using useInterval
  useInterval(
    async () => {
      if (!trustPollingUdidRef.current) return;

      try {
        const status = await goServiceClient.checkPairingStatus(trustPollingUdidRef.current);
        
        if (status.is_paired) {
          clearPairingTimers();
          
          setTrustStatus("success");
          setTimeout(async () => {
            setShowTrustDialog(false);
            setPairingDeviceUdid(null);
            navigate("/devices");
            triggerRefresh();
          }, 2000);
        } else if (status.waiting_for_trust && latestTrustStatus.current === "device_locked") {
          setTrustStatus("waiting_trust");
        }
      } catch (error) {
        console.error("Failed to check pairing status:", error);
      }
    },
    trustPollingEnabledRef.current ? 2000 : null
  );

  const initializeGlobalWebSocket = () => {
    // Minimal throttling - only prevent duplicate updates within 50ms
    const progressUpdateThrottle = new Map<string, { lastUpdate: number; lastProgress: number }>();
    const MIN_UPDATE_INTERVAL = 50; // ms - prevent duplicate rapid-fire updates
    
    const handleWebSocketEvent = (event: WebSocketEvent) => {
      console.log("WebSocket event received:", event);
      
      switch (event.type) {
        case "task_progress":
          // Minimal throttling - show all meaningful progress updates
          const now = Date.now();
          const throttleKey = event.task_id;
          const lastUpdate = progressUpdateThrottle.get(throttleKey);
          
          // Always update for status changes (including cancelled)
          const isStatusChange = 
            event.status === "completed" || 
            event.status === "error" ||
            event.status === "started" ||
            event.status === "cancelled";
          
          // Update if: no previous update, status changed, or enough time passed
          const shouldUpdate = !lastUpdate || 
            isStatusChange ||
            (now - lastUpdate.lastUpdate >= MIN_UPDATE_INTERVAL);
          
          if (shouldUpdate) {
            updateTask(event);
            progressUpdateThrottle.set(throttleKey, {
              lastUpdate: now,
              lastProgress: event.progress
            });
          }

          // Detect token expiration errors coming via task progress (e.g. download purchasing stage)
          if (event.status === "error") {
            const msg = String(event.message || "").toLowerCase();
            const dataErr = typeof (event.data as any)?.error === 'string' ? String((event.data as any).error).toLowerCase() : "";
            const tokenExpired = /(?:password\s+)?token.*expired/.test(msg) || /(?:password\s+)?token.*expired/.test(dataErr);
            if (tokenExpired) {
              handleTokenExpired();
            }
          }
          break;
          
        case "device_attached":
          console.log("Device attached:", event.serial_number);
          setTimeout(() => {
            checkAndPairDevice(event.serial_number);
          }, 1000);
          triggerRefresh();
          break;
          
        case "device_detached":
          console.log("Device detached event:", {
            serial_number: event.serial_number,
            pairingDeviceUdid: latestPairingDeviceUdid.current,
            showTrustDialog: latestShowTrustDialog.current,
            match: latestPairingDeviceUdid.current === event.serial_number
          });
          
          if (latestShowTrustDialog.current && latestPairingDeviceUdid.current === event.serial_number) {
            console.log("Closing trust dialog - device being paired was detached");
            setShowTrustDialog(false);
            clearPairingTimers();
            setPairingDeviceUdid(null);
          }
          triggerRefresh();
          break;
      }
    };

    // Set status callback for connection state
    goServiceClient.setStatusCallback(async (status, reconnectAttempts) => {
      console.log("Connection status:", status, "reconnect attempts:", reconnectAttempts);
      setStatus(status);
      setReconnectAttempts(reconnectAttempts);
      
      // Show error dialog only after 5 failed attempts
      if (reconnectAttempts >= 5 && status === "error") {
        if (!hasShownWsError.current) {
          hasShownWsError.current = true;
          const message = isDevMode 
            ? t("service.connectionFailedDev")
            : t("service.connectionFailedProd");
          showError(t("service.connectionFailed"), message, true); // Show restart button
        }
      }
      
      // Check for devices that need pairing when WebSocket connects
      if (status === "connected") {
        console.log("WebSocket connected, checking for unpaired devices...");
        checkForUnpairedDevices();
      }
    });

    // Set error callback for goServiceClient (now only for non-connection errors)
    goServiceClient.setErrorCallback((error: Error, isWsError: boolean, reconnectAttempts: number) => {
      console.error("Go service error:", error, "isWsError:", isWsError, "attempts:", reconnectAttempts);
      // We're now handling WS errors via statusCallback, so this is for other errors only
    });

    goServiceClient.connectWebSocket(handleWebSocketEvent);
  };

  const buildStoreData = () => {
    const accountStore = useAccountStore.getState();
    const deviceStore = useDeviceStore.getState();
    const taskStore = useTaskStore.getState();
    const connectionStore = useConnectionStore.getState();
    const downloadStore = useDownloadStore.getState();
    const errorStore = useErrorStoreForData.getState();
    const toastStore = useToastStore.getState();
    const debugStore = useDebugStore.getState();

    const allTasks = Array.from(taskStore.tasks.values());
    const deviceSnapshot = buildDeviceDebugSnapshot();

    return {
      account: {
        isAuthenticated: accountStore.isAuthenticated,
        selectedAccountEmail: accountStore.selectedAccount?.email ?? "[not-exists]",
        selectedAccountCountry: accountStore.selectedAccount?.country ?? "[not-exists]",
        totalAccounts: accountStore.accounts.length,
      },
      device: {
        connectedDevices: deviceStore.connectedDevices.length,
        selectedDevice: deviceStore.selectedDevice?.name ?? "none",
        isRefreshing: deviceStore.isRefreshing,
        showTrustDialog: deviceStore.showTrustDialog,
        trustStatus: deviceStore.trustStatus ?? "[not-exists]",
        deviceAppsCache: deviceStore.deviceAppsCache.size,
        connectedDeviceList: deviceSnapshot.connectedDeviceList,
        selectedDeviceUdid: deviceSnapshot.selectedDeviceUdid,
      },
      task: {
        allTasks: allTasks.length,
        runningTasks: allTasks.filter(t => t.status === "started" || t.status === "progress").length,
        completedTasks: allTasks.filter(t => t.status === "completed").length,
        errorTasks: allTasks.filter(t => t.status === "error").length,
      },
      connection: {
        status: connectionStore.status ?? "[not-exists]",
        reconnectAttempts: connectionStore.reconnectAttempts,
      },
      download: {
        downloads: downloadStore.downloads.length,
        activeDownloads: downloadStore.downloads.filter(d => d.status === "downloading").length,
        completedDownloads: downloadStore.downloads.filter(d => d.status === "completed").length,
        failedDownloads: downloadStore.downloads.filter(d => d.status === "failed").length,
      },
      error: {
        hasError: errorStore.message !== null,
        title: errorStore.title ?? "[not-exists]",
        showRestartButton: errorStore.showRestartButton,
      },
      toast: {
        hasMessage: toastStore.message !== null,
        message: toastStore.message ?? "[not-exists]",
        type: toastStore.type ?? "[not-exists]",
      },
      debug: {
        frontendLogs: debugStore.frontendLogs.length,
        maxLogs: debugStore.maxLogs,
      },
    } as const;
  };

  const emitStoreData = async () => {
    try {
      const snapshot = buildStoreData();
      await emit("store-data", snapshot);
    } catch (error) {
      // Silently ignore emit errors to prevent console spam and potential loops
    }
  };

  const scheduleStoreSync = () => {
    if (!debugWindowOpenRef.current || storeSyncTimerRef.current !== null) {
      return;
    }

    storeSyncTimerRef.current = window.setTimeout(() => {
      storeSyncTimerRef.current = null;
      emitStoreData().catch(() => {
        // Silently ignore emit errors
      });
    }, 150);
  };

  const startStoreSync = () => {
    if (storeSyncUnsubscribersRef.current) return;
    const unsubs: (() => void)[] = [];
    const subscribeStore = (store: any) => {
      const unsub = store.subscribe(() => {
        scheduleStoreSync();
      });
      unsubs.push(unsub);
    };

    subscribeStore(useAccountStore);
    subscribeStore(useDeviceStore);
    subscribeStore(useTaskStore);
    subscribeStore(useConnectionStore);
    subscribeStore(useDownloadStore);
    subscribeStore(useErrorStoreForData);
    subscribeStore(useToastStore);
    subscribeStore(useDebugStore);

    storeSyncUnsubscribersRef.current = unsubs;
  };

  const stopStoreSync = () => {
    if (!storeSyncUnsubscribersRef.current) return;
    for (const unsub of storeSyncUnsubscribersRef.current) {
      try { unsub(); } catch {}
    }
    storeSyncUnsubscribersRef.current = null;
    if (storeSyncTimerRef.current !== null) {
      clearTimeout(storeSyncTimerRef.current);
      storeSyncTimerRef.current = null;
    }
  };

  // Installer mode renders standalone
  if (isInstallerMode) {
    return (
      <Routes>
        <Route path="/installer" element={<IpaInstallerPage />} />
      </Routes>
    );
  }

  // Debug mode renders standalone (independent window)
  if (location.pathname === "/debug") {
    return (
      <Routes>
        <Route path="/debug" element={<DebugPage />} />
      </Routes>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white">
      <Routes>
        <Route path="/*" element={
          <>
            <TitleBar />
            <MainLayout>
              <Routes>
                <Route element={<KeepAliveLayout />}>
                  <Route path="/" element={<SearchPage />} />
                  <Route path="/devices" element={<DevicesPage />} />
                  <Route path="/library" element={<AppLibraryPage />} />
                  <Route path="/certificates" element={<SigningPage />} />
                  <Route path="/signing" element={<SigningPage />} />
                  <Route path="/editor" element={<EditorPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                </Route>
              </Routes>
            </MainLayout>
          </>
        } />
      </Routes>
      <LoginDialog />
      <ErrorDialog />
      <Toast />
      <TrustDeviceDialog
        isOpen={showTrustDialog}
        status={trustStatus}
        onClose={() => setShowTrustDialog(false)}
      />
      {location.pathname === '/' && <ActiveDownloadsPopup />}
    </div>
  );
}

function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppContent />
    </Router>
  );
}

export default App;

