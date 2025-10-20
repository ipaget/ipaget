import { useRef, useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "./store/authStore";
import { invoke } from "@tauri-apps/api/core";
import { goServiceClient, WebSocketEvent } from "./lib/goService";
import { useDeviceStore } from "./store/deviceStore";
import { useAppStore } from "./store/appStore";
import { useConnectionStore } from "./store/connectionStore";
import { useTaskStore } from "./store/taskStore";
import { useLatest, useInterval, useMount, useUnmount } from "react-use";

import TitleBar from "./components/TitleBar";
import MainLayout from "./components/MainLayout";
import SearchPage from "./pages/SearchPage";
import DownloadsPage from "./pages/DownloadsPage";
import DevicesPage from "./pages/DevicesPage";
import IpaInstallerPage from "./pages/IpaInstallerPage";
import LoginDialog from "./components/LoginDialog";
import ErrorDialog from "./components/ErrorDialog";
import Toast from "./components/Toast";
import TrustDeviceDialog from "./components/TrustDeviceDialog";
import { useErrorStore } from "./store/errorStore";
import { useTranslation } from "react-i18next";

interface AccountInfo {
  email: string;
  country: string;
  is_authenticated: boolean;
}

function AppContent() {
  const { setAccountInfo, setAuthenticated } = useAuthStore();
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
  const { updateAppSize } = useAppStore();
  const { setStatus, setReconnectAttempts } = useConnectionStore();
  const { updateTask } = useTaskStore();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [isDevMode, setIsDevMode] = useState(false);
  const [isInstallerMode, setIsInstallerMode] = useState(false);
  
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

  useMount(async () => {
    // Check if running in dev mode
    try {
      const devMode = await invoke<boolean>("is_dev_mode");
      setIsDevMode(devMode);
    } catch (error) {
      console.error("Failed to check dev mode:", error);
    }
    
    checkAuthStatus();
    initializeGlobalWebSocket();
  });

  useUnmount(() => {
    trustPollingEnabledRef.current = false;
    if (pairTimeoutRef.current) {
      clearTimeout(pairTimeoutRef.current);
    }
  });

  const checkAuthStatus = async () => {
    try {
      const accountInfo = await invoke<AccountInfo>("get_account_info");
      if (accountInfo.is_authenticated && accountInfo.email) {
        setAccountInfo(accountInfo.email, accountInfo.country);
      } else {
        setAuthenticated(false);
      }
    } catch (error) {
      console.error("Failed to check auth status:", error);
      setAuthenticated(false);
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
      // Get all connected device UDIDs (including unpaired ones)
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
    const handleWebSocketEvent = (event: WebSocketEvent) => {
      console.log("WebSocket event received:", event);
      
      switch (event.type) {
        case "task_progress":
          updateTask(event);
          break;
          
        case "app_size_update":
          updateAppSize({
            udid: event.udid,
            bundle_id: event.bundle_id,
            app_size: event.app_size,
            data_size: event.data_size,
          });
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

  // Installer mode renders standalone
  if (isInstallerMode) {
    return (
      <Routes>
        <Route path="/installer" element={<IpaInstallerPage />} />
      </Routes>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white">
      <TitleBar />
      <MainLayout>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/downloads" element={<DownloadsPage />} />
          <Route path="/devices" element={<DevicesPage />} />
        </Routes>
      </MainLayout>
      <LoginDialog />
      <ErrorDialog />
      <Toast />
      
      {/* Global Trust Device Dialog */}
      <TrustDeviceDialog
        isOpen={showTrustDialog}
        status={trustStatus}
        onClose={() => {
          // Only close dialog, keep polling in background
          setShowTrustDialog(false);
        }}
      />
    </div>
  );
}

function App() {
  return (
    <Router future={{ v7_startTransition: true }}>
      <AppContent />
    </Router>
  );
}

export default App;

