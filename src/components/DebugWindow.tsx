import { X, Terminal, Bug, Send, Activity, Save, PlusCircle, Trash2, Edit, PlayCircle, StopCircle, Loader, Database, FolderOpen } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useDebugStore, LogEntry } from "../store/debugStore";
import { useDeviceStore } from "../store/deviceStore";
import { useTaskStore } from "../store/taskStore";
import { goServiceClient, SimulatedDeviceProfile, DeviceInfo } from "../lib/goService";
import Ansi from "ansi-to-react";
import { useTaskSubscription } from "../hooks/useTask";
import LogJsonViewer from "./LogJsonViewer";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauriRuntime } from "../lib/runtime";

interface DebugWindowProps {
  onClose: () => void;
  standalone?: boolean;
}

interface DeviceStoreSnapshot {
  connectedDeviceList?: DeviceInfo[];
  selectedDeviceUdid?: string | null;
}

interface StoreDataPayload {
  device?: DeviceStoreSnapshot & Record<string, any>;
  [key: string]: any;
}

const levelMapping: { [key: string]: LogEntry["level"] } = {
  "debug": "debug",
  "info": "info",
  "warn": "warn",
  "error": "error",
  "fatal": "error",
};

export default function DebugWindow({ onClose, standalone = false }: DebugWindowProps) {
  const [activeTab, setActiveTab] = useState<"backend-logs" | "frontend-logs" | "debug-tools" | "simulate" | "store">("backend-logs");
  const { frontendLogs, clearFrontendLogs } = useDebugStore();
  const { selectedDevice, connectedDevices } = useDeviceStore();
  const isDebugWindow = window.location.pathname === "/debug";
  
  const [backendLogs, setBackendLogs] = useState<LogEntry[]>([]);
  const maxLogs = 1000;
  
  const [wsTestUrl, setWsTestUrl] = useState("");
  const [wsTestResponse, setWsTestResponse] = useState("");
  const [httpTestUrl, setHttpTestUrl] = useState("");
  const [httpTestResponse, setHttpTestResponse] = useState("");


  const [testTaskId, setTestTaskId] = useState<string | undefined>();
  const [isTestTaskRunning, setIsTestTaskRunning] = useState(false);
  const [isMainWsConnected, setIsMainWsConnected] = useState(false);
  const [isLogWsConnected, setIsLogWsConnected] = useState(false);
  const [backendInstanceId, setBackendInstanceId] = useState<string | null>(null);
  const testTask = useTaskSubscription(testTaskId, {
    onProgress: (task) => {
      console.log("Task progress update:", task);
    },
    onComplete: (task) => {
      console.log("Task completed:", task);
      setIsTestTaskRunning(false);
      setTimeout(() => {
        setTestTaskId(undefined);
      }, 3000);
    },
    onError: (task) => {
      console.log("Task error:", task);
      setIsTestTaskRunning(false);
    },
  });

  // State for advanced simulation
  const [profiles, setProfiles] = useState<SimulatedDeviceProfile[]>([]);
  const [editingProfile, setEditingProfile] = useState<SimulatedDeviceProfile | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editorDeviceJson, setEditorDeviceJson] = useState<string>("");
  const [simulatedUdids, setSimulatedUdids] = useState<Set<string>>(new Set());
  const [availableDevices, setAvailableDevices] = useState<DeviceInfo[]>([]);
  const [isLoadingCurrentDevice, setIsLoadingCurrentDevice] = useState(false);
  const [currentDeviceLoadError, setCurrentDeviceLoadError] = useState("");

  const backendLogsEndRef = useRef<HTMLDivElement>(null);
  const frontendLogsEndRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<number | null>(null);
  
  const [storeData, setStoreData] = useState<any>(null);
  const [storeLastUpdate, setStoreLastUpdate] = useState<Date | null>(null);
  const [loadedLogData, setLoadedLogData] = useState<Map<string, any>>(new Map());

  const applyDeviceSnapshot = useCallback((deviceSnapshot?: DeviceStoreSnapshot) => {
    if (!deviceSnapshot?.connectedDeviceList) {
      return;
    }

    const devices = deviceSnapshot.connectedDeviceList;
    setAvailableDevices(devices);

    const selectedDeviceFromSnapshot = devices.find(
      (device) => device.udid === deviceSnapshot.selectedDeviceUdid
    ) ?? devices[0] ?? null;

    useDeviceStore.setState({
      connectedDevices: devices,
      selectedDevice: selectedDeviceFromSnapshot,
    });
  }, []);

  const generateSimulatedUdid = () => {
    const chars = "0123456789ABCDEF";
    let suffix = "";
    for (let i = 0; i < 16; i += 1) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    return `00008110-${suffix}`;
  };

  // Containers for conditional auto-scroll
  const backendLogsContainerRef = useRef<HTMLDivElement>(null);
  const frontendLogsContainerRef = useRef<HTMLDivElement>(null);

  const isAtBottom = (el: HTMLDivElement | null, threshold = 24) => {
    if (!el) return true;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
  };

  // Close when main window requests all debugs to close
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        unlisten = await listen("close-all-debug", async () => {
          await getCurrentWebviewWindow().close();
        });
      } catch {}
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const clearBackendLogs = useCallback(() => {
    setBackendLogs([]);
  }, []);

  const backendLogCounterRef = useRef(0);
  const addBackendLog = useCallback((level: string, message: string, data?: any) => {
    setBackendLogs((prev) => [
      ...prev.slice(-maxLogs + 1),
      {
        id: `backend-${Date.now()}-${++backendLogCounterRef.current}`,
        timestamp: new Date(),
        level: levelMapping[level] || "info",
        source: "backend" as const,
        message,
        data,
      },
    ]);
  }, [maxLogs]);

  // Listen for frontend logs and store data from main window (only in debug window)
  useEffect(() => {
    if (!isDebugWindow || !standalone || !isTauriRuntime()) return;

    let unlistenLog: (() => void) | null = null;
    let unlistenHistory: (() => void) | null = null;
    let unlistenStoreData: (() => void) | null = null;
    let unlistenLogDataDetail: (() => void) | null = null;

    const setupEventListeners = async () => {
      try {
        // Listen for new frontend logs
        unlistenLog = await listen<any>("frontend-log", (event) => {
          const log = event.payload;
          const logEntry: LogEntry = {
            id: log.id,
            timestamp: new Date(log.timestamp),
            level: log.level,
            source: log.source,
            message: log.message,
            data: log.data,
          };
          
          // Add to store with deduplication
          const MAX_LOGS = 1000;
          useDebugStore.setState((state) => {
            // Check if log already exists
            const exists = state.frontendLogs.some(existingLog => existingLog.id === logEntry.id);
            if (exists) {
              return state;
            }
            
            return {
              frontendLogs: [
                ...state.frontendLogs.slice(-MAX_LOGS + 1),
                logEntry,
              ],
            };
          });
        });

        // Listen for log history response
        unlistenHistory = await listen<any[]>("log-history", (event) => {
          const logs = event.payload.map(log => ({
            ...log,
            timestamp: new Date(log.timestamp),
          }));
          
          // Deduplicate logs by ID
          const uniqueLogs: LogEntry[] = [];
          const seenIds = new Set<string>();
          
          for (const log of logs) {
            if (!seenIds.has(log.id)) {
              seenIds.add(log.id);
              uniqueLogs.push(log);
            }
          }
          
          useDebugStore.setState({ frontendLogs: uniqueLogs });
        });

        // Listen for store data
        unlistenStoreData = await listen<StoreDataPayload>("store-data", (event) => {
          setStoreData(event.payload);
          setStoreLastUpdate(new Date());
          applyDeviceSnapshot(event.payload.device);
        });

        // Listen for log data detail response
        unlistenLogDataDetail = await listen<any>("log-data-detail", (event) => {
          const { dataId, data } = event.payload;
          if (data !== null) {
            setLoadedLogData(prev => new Map(prev).set(dataId, data));
          }
        });

        // Request log history from main window
        await emit("request-log-history");
        await emit("request-store-data");
      } catch (error) {
        console.error("Failed to setup event listeners:", error);
      }
    };

    setupEventListeners();

    return () => {
      unlistenLog?.();
      unlistenHistory?.();
      unlistenStoreData?.();
      unlistenLogDataDetail?.();
    };
  }, [applyDeviceSnapshot, isDebugWindow, standalone]);

  // Connect to the backend log stream and main WebSocket for task updates
  useEffect(() => {
    let logWs: WebSocket | null = null;
    let mainWs: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let isUnmounted = false;

    const connect = async () => {
      if (isUnmounted) return;

      try {
        const url = await goServiceClient.getWebSocketUrl();
        
        // Connect to log stream
        const logUrl = url.replace('/ws', '/ws/logs');
        logWs = new WebSocket(logUrl);
        clearBackendLogs();

        logWs.onopen = () => {
          console.log("Backend log stream connected");
          setIsLogWsConnected(true);
        };

        logWs.onmessage = (event) => {
          try {
            const logData = JSON.parse(event.data);
            if (Array.isArray(logData)) {
              logData.forEach(log => {
                addBackendLog(log.level, log.message, log);
              });
            } else {
              addBackendLog(logData.level, logData.message, logData);
            }
          } catch (e) {
            addBackendLog("error", "Failed to parse backend log", event.data);
          }
        };

        logWs.onclose = () => {
          console.log("Backend log stream disconnected");
          setIsLogWsConnected(false);
          
          // Auto reconnect after 2 seconds
          if (!isUnmounted) {
            reconnectTimer = window.setTimeout(() => {
              console.log("Attempting to reconnect to backend log stream...");
              connect();
            }, 2000);
          }
        };

        logWs.onerror = (err) => {
          console.error("Backend log stream error:", err);
          setIsLogWsConnected(false);
          addBackendLog("error", "Log stream connection error");
        };

        // Connect to main WebSocket for task updates
        mainWs = new WebSocket(url);

        mainWs.onopen = () => {
          console.log("Main WebSocket connected for task updates");
          setIsMainWsConnected(true);
        };

        mainWs.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            // Only listen to specific message types for debug window
            const allowedTypes = ["task_progress", "hello"];
            
            if (allowedTypes.includes(data.type)) {
              console.log(`[Debug WS] Received ${data.type}:`, data);
              
              switch (data.type) {
                case "task_progress":
                  useTaskStore.getState().updateTask(data);
                  break;
                case "hello":
                  if (typeof data.instance_id === 'string') {
                    setBackendInstanceId(data.instance_id);
                  }
                  break;
              }
            } else {
              // Ignore other message types (device_attached, device_detached, etc.)
              console.log(`[Debug WS] Ignoring message type: ${data.type}`);
            }
          } catch (e) {
            console.error("Failed to parse WebSocket message:", e);
          }
        };

        mainWs.onclose = () => {
          console.log("Main WebSocket disconnected");
          setIsMainWsConnected(false);
          
          // Auto reconnect after 2 seconds
          if (!isUnmounted) {
            reconnectTimer = window.setTimeout(() => {
              console.log("Attempting to reconnect to main WebSocket...");
              connect();
            }, 2000);
          }
        };

        mainWs.onerror = (err) => {
          console.error("Main WebSocket error:", err);
          setIsMainWsConnected(false);
        };

      } catch (error) {
        console.error("Could not get WebSocket URL:", error);
        
        // Retry connection after 2 seconds on error
        if (!isUnmounted) {
          reconnectTimer = window.setTimeout(() => {
            console.log("Retrying WebSocket connection...");
            connect();
          }, 2000);
        }
      }
    };

    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
      }
      logWs?.close();
      mainWs?.close();
      setIsMainWsConnected(false);
      setIsLogWsConnected(false);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Initial scroll to bottom when component mounts or tab changes
  useEffect(() => {
    if (activeTab === 'backend-logs') {
      setTimeout(() => {
        backendLogsEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
      }, 50);
    } else if (activeTab === 'frontend-logs') {
      setTimeout(() => {
        frontendLogsEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
      }, 50);
    }
  }, [activeTab]);

  // Auto-scroll only if user is at bottom
  useEffect(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = window.setTimeout(() => {
      const container = backendLogsContainerRef.current;
      if (isAtBottom(container)) {
        backendLogsEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
      }
    }, 50);
  }, [backendLogs]);

  useEffect(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = window.setTimeout(() => {
      const container = frontendLogsContainerRef.current;
      if (isAtBottom(container)) {
        frontendLogsEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
      }
    }, 50);
  }, [frontendLogs]);

  const formatTime = (date: Date) => {
    // Safari/older TS libs may not support fractionalSecondDigits; keep it simple
    return date.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" } as any);
  };

  const getLevelColor = (level: LogEntry["level"]) => {
    switch (level) {
      case "debug":
        return "text-gray-500";
      case "info":
        return "text-blue-600";
      case "warn":
        return "text-yellow-600";
      case "error":
        return "text-red-600";
      default:
        return "text-gray-700";
    }
  };

  const handleWsTest = async () => {
    setWsTestResponse("Step 1: connecting...");
    try {
      const wsUrl = await goServiceClient.getWebSocketUrl();
      setWsTestUrl(wsUrl);
      const testWs = new WebSocket(wsUrl);
      
      const append = (line: string) => {
        setWsTestResponse((prev) => (prev ? `${prev}\n${line}` : line));
      };

      testWs.onopen = () => {
        append(`Step 1 ✓ connected to ${wsUrl}`);
        const payload = { type: "ping", timestamp: Date.now() };
        const text = JSON.stringify(payload);
        testWs.send(text);
        append(`Step 2 ✓ sent: ${text}`);
      };

      testWs.onmessage = (event: MessageEvent) => {
        append(`Step 3 ✓ received: ${event.data}`);
      };

      testWs.onerror = (error: any) => {
        append(`Step ✗ error: ${String(error)}`);
      };

      testWs.onclose = (ev: CloseEvent) => {
        append(
          `Step 4 ✓ closed (code=${ev.code}${ev.reason ? `, reason=${ev.reason}` : ""})`
        );
      };

      // Close after a fixed delay without judging success
      setTimeout(() => {
        if (testWs.readyState === WebSocket.OPEN) {
          append("Step 4 → closing after timeout");
          testWs.close(1000, "debug timer");
        }
      }, 3000);
    } catch (error: any) {
      setWsTestResponse(`✗ Error: ${error.message}`);
    }
  };

  const handleHttpTest = async () => {
    setHttpTestResponse("Testing HTTP connection...");
    try {
      await goServiceClient.init();
      const url = goServiceClient["baseUrl"] + "/debug/ping";
      setHttpTestUrl(url);
      
      const response = await fetch(url);
      const data = await response.json();
      
      setHttpTestResponse(
        `✓ HTTP ${response.status} ${response.statusText}\n` +
        `URL: ${url}\n` +
        `Response: ${JSON.stringify(data, null, 2)}`
      );
    } catch (error: any) {
      setHttpTestResponse(`✗ Error: ${error.message}`);
    }
  };

  const handleStartTestTask = async () => {
    try {
      setIsTestTaskRunning(true);
      const taskId = await goServiceClient.testTask();
      console.log("Test task started with ID:", taskId);
      setTestTaskId(taskId);
    } catch (error: any) {
      setIsTestTaskRunning(false);
      alert(`Failed to start test task: ${error.message}`);
    }
  };

  const loadSimProfiles = useCallback(async () => {
    try {
      const loadedProfiles = await goServiceClient.listSimProfiles();
      setProfiles(loadedProfiles);
    } catch (e: any) {
      console.error("Failed to load sim profiles", e);
    }
  }, []);

  const refreshAvailableDevices = useCallback(async () => {
    const devices = await goServiceClient.listDevices();
    setAvailableDevices(devices);
    return devices;
  }, []);

  useEffect(() => {
    if(activeTab === 'simulate') {
      loadSimProfiles();
      if (isDebugWindow && standalone && isTauriRuntime()) {
        emit('request-store-data').catch((e) => {
          console.error('Failed to request store data:', e);
        });
      }
      refreshAvailableDevices().catch((e: any) => {
        console.error('Failed to load current devices', e);
        setAvailableDevices([]);
      });
    } else if (activeTab === 'store') {
      if (isDebugWindow && standalone && isTauriRuntime()) {
        emit('request-store-data').catch((e) => {
          console.error('Failed to request store data:', e);
        });
      }
    }
  }, [activeTab, isDebugWindow, standalone, loadSimProfiles, refreshAvailableDevices]);

  const handleOpenAddDialog = () => {
    setEditingProfile(null);
    const emptyProfile: SimulatedDeviceProfile = {
      id: `PROF-${Date.now()}`,
      info: {} as DeviceInfo,
      apps: [],
    };
    setEditorDeviceJson(JSON.stringify(emptyProfile, null, 2));
    setShowEditor(true);
  };

  const handleOpenEditDialog = (profile: SimulatedDeviceProfile) => {
    setEditingProfile(profile);
    
    // Clean up data
    const cleanProfile = { ...profile };
    if (cleanProfile.info.raw_data) {
      delete cleanProfile.info.raw_data;
    }
    if (cleanProfile.info.storage_info) {
      delete cleanProfile.info.storage_info;
    }
    
    if (cleanProfile.apps) {
      cleanProfile.apps = cleanProfile.apps.map(app => {
        const cleanApp = { ...app };
        delete cleanApp.raw_data;
        return cleanApp;
      });
    }
    
    setEditorDeviceJson(JSON.stringify(cleanProfile, null, 2));
    setShowEditor(true);
  };

  const handleLoadCurrentDevice = async () => {
    setIsLoadingCurrentDevice(true);
    setCurrentDeviceLoadError("");

    let device = selectedDevice || connectedDevices[0];

    if (!device) {
      try {
        const latestDevices = await refreshAvailableDevices();
        device = latestDevices[0];
      } catch (e: any) {
        setCurrentDeviceLoadError(e.message || String(e));
        setIsLoadingCurrentDevice(false);
        return;
      }
    }
    
    if (!device) {
      const message = connectedDevices.length === 0 && availableDevices.length === 0
        ? "No device connected. Please connect a device first and ensure it appears in the Devices page."
        : "No device selected. Please go to the Devices page and select a device first.";
      setCurrentDeviceLoadError(message);
      setIsLoadingCurrentDevice(false);
      return;
    }
    
    try {
      // Backend will load device info and apps
      const profile = await goServiceClient.loadDeviceProfile(device.udid);
      console.log("Loaded device profile from backend:", profile);
      
      setEditorDeviceJson(JSON.stringify(profile, null, 2));
      setCurrentDeviceLoadError("");
    } catch (e: any) {
      setCurrentDeviceLoadError(e.message || String(e));
    } finally {
      setIsLoadingCurrentDevice(false);
    }
  };

  const handleGenerateRandom = async () => {
    try {
      const randomProfile = await goServiceClient.generateRandomDevice();
      setEditorDeviceJson(JSON.stringify(randomProfile, null, 2));
    } catch (e: any) {
      alert(`Failed to generate random device: ${e.message}`);
    }
  };

  const handleRandomizeUDID = () => {
    try {
      const profile: SimulatedDeviceProfile = JSON.parse(editorDeviceJson);
      const newUDID = generateSimulatedUdid();
      profile.info.udid = newUDID;
      if (profile.info.serial_number === profile.info.udid || !profile.info.serial_number) {
        profile.info.serial_number = newUDID;
      }
      setEditorDeviceJson(JSON.stringify(profile, null, 2));
    } catch (e: any) {
      alert(`Failed to randomize UDID: ${e.message}`);
    }
  };

  const handleSaveProfile = async () => {
    try {
      const profile: SimulatedDeviceProfile = JSON.parse(editorDeviceJson);
      
      // Clean up data before saving
      if (profile.info.raw_data) {
        delete profile.info.raw_data;
      }
      if (profile.info.storage_info) {
        delete profile.info.storage_info;
      }
      
      if (profile.apps) {
        profile.apps = profile.apps.map(app => {
          const cleanApp = { ...app };
          delete cleanApp.raw_data;
          return cleanApp;
        });
      }
      
      // Ensure ID exists
      if (!profile.id) {
        profile.id = editingProfile?.id || `PROF-${Date.now()}`;
      }
      
      // Check if this profile is currently simulated
      const wasSimulated = simulatedUdids.has(profile.info.udid);
      
      // Stop simulation if running
      if (wasSimulated) {
        await handleStopSingleSimulation(profile.info.udid);
      }
      
      await goServiceClient.saveSimProfile(profile);
      await loadSimProfiles();
      setShowEditor(false);
      
      // Restart simulation if it was running
      if (wasSimulated) {
        await handleSimulateProfile(profile);
      }
    } catch (e: any) {
      console.error("Failed to save profile:", e);
    }
  };

  const handleDeleteProfile = async (id: string) => {
    try {
      // Find the profile to get its UDID
      const profile = profiles.find((p: SimulatedDeviceProfile) => p.id === id);
      
      // Stop simulation if running
      if (profile && simulatedUdids.has(profile.info.udid)) {
        await handleStopSingleSimulation(profile.info.udid);
      }
      
      await goServiceClient.deleteSimProfile(id);
      await loadSimProfiles();
    } catch (e: any) {
      console.error("Failed to delete profile:", e);
    }
  };

  const handleSimulateProfile = async (profile: SimulatedDeviceProfile) => {
    try {
      await goServiceClient.simulateDevice(profile.info, profile.apps);
      setSimulatedUdids(prev => new Set(prev).add(profile.info.udid));
    } catch (e: any) {
      console.error("Failed to simulate device:", e);
    }
  };

  const handleStopSingleSimulation = async (udid: string) => {
    try {
      await goServiceClient.removeSimulatedDevice(udid);
      setSimulatedUdids(prev => {
        const newSet = new Set(prev);
        newSet.delete(udid);
        return newSet;
      });
    } catch (e: any) {
      console.error("Failed to stop simulation:", e);
    }
  };

  const handleStopAllSimulations = async () => {
    try {
      await goServiceClient.clearAllSimulatedDevices();
      setSimulatedUdids(new Set());
    } catch (e: any) {
      console.error("Failed to stop all simulations:", e);
    }
  };

  const renderStoreCard = (title: string, data: Record<string, any> | undefined) => {
    if (!data) {
      return (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <h4 className="font-semibold text-gray-900">{title}</h4>
          </div>
          <div className="text-sm text-gray-500 text-center py-4">
            Data not available
          </div>
        </div>
      );
    }

    const formatValue = (value: any): string => {
      if (value === null || value === undefined) {
        return "N/A";
      }
      if (value === "[deleted]" || value === "[removed]" || value === "[not-exists]") {
        return "(not existing)";
      }
      if (typeof value === "boolean") {
        return value ? "true" : "false";
      }
      if (typeof value === "object") {
        if (Array.isArray(value)) {
          return `Array(${value.length})`;
        }
        if (value instanceof Map) {
          return `Map(${value.size})`;
        }
        if (value instanceof Set) {
          return `Set(${value.size})`;
        }
        try {
          const keys = Object.keys(value);
          return `Object(${keys.length})`;
        } catch {
          return "(not existing)";
        }
      }
      return String(value);
    };

    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <h4 className="font-semibold text-gray-900">{title}</h4>
        </div>
        <div className="space-y-2">
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="flex justify-between items-start text-sm">
              <span className="text-gray-600 font-medium">{key}:</span>
              <span className="text-gray-900 text-right ml-2 truncate max-w-[60%]">
                {formatValue(value)}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  

  const requestLogDataDetail = async (dataId: string) => {
    if (loadedLogData.has(dataId)) {
      return;
    }

    if (!isTauriRuntime()) {
      return;
    }
    
    await emit("request-log-data-detail", dataId);
  };

  const renderFrontendLogs = (logs: LogEntry[], endRef: React.RefObject<HTMLDivElement>) => (
    <div ref={frontendLogsContainerRef} className="flex-1 overflow-y-auto font-mono text-xs bg-gray-900 text-gray-100 p-4 select-text">
      {logs.length === 0 ? (
        <div className="text-gray-500 text-center py-8">No logs yet</div>
      ) : (
        <div className="table w-full border-collapse">
          {logs.map((log) => {
            const isErrorLog = log.level === 'error';
            const isWarnLog = log.level === 'warn';
            const rowHl = isErrorLog ? ' bg-red-950/30' : (isWarnLog ? ' bg-yellow-900/20' : '');
            const extractError = () => {
              const d: any = (log as any).data;
              if (!d) return null;
              if (d.error && typeof d.error === 'object') return d.error;
              if (typeof d.name === 'string' && typeof d.message === 'string') return d; // error-like at root
              return null;
            };
            const err = extractError();
            const buildHeader = () => {
              const parts: string[] = [];
              const rawMsg = typeof log.message === 'string' ? log.message : '';
              const msg = rawMsg.replace(/[：:]\s*$/, '').trim(); // strip trailing colon
              const errName = err && typeof err.name === 'string' ? err.name.trim() : '';
              const errMsg = err && typeof err.message === 'string' ? err.message.trim() : '';
              const lowerMsg = msg.toLowerCase();
              if (msg) parts.push(msg);
              if (errName && !lowerMsg.includes(errName.toLowerCase())) parts.push(errName);
              if (errMsg && !lowerMsg.includes(errMsg.toLowerCase())) parts.push(errMsg);
              return parts.join(': ');
            };
            const errorHeader = err ? buildHeader() : (typeof log.message === 'string' ? log.message : '');
            const buildStackLines = () => {
              if (!err) return [] as string[];
              const raw = Array.isArray(err.stack) ? (err.stack as string[]) : String(err.stack || '').split('\n');
              const lines = raw.map(l => String(l));
              if (!lines.length) return lines;
              const first = lines[0].trim();
              // Common formats: 'Error: message' or just message
              const errName = err && typeof err.name === 'string' ? err.name.trim() : '';
              const errMsg = err && typeof err.message === 'string' ? err.message.trim() : '';
              const repeatsHeader = (first.startsWith('Error:') || (errName && first.startsWith(errName+':')) || (errMsg && first === errMsg) || (errorHeader && first === errorHeader));
              return repeatsHeader ? lines.slice(1) : lines;
            };
            const stackLines: string[] = buildStackLines();
            
            return (
              <div key={log.id} className="table-row">
                <span className={"table-cell text-gray-500 pr-3 align-top whitespace-nowrap" + rowHl}>{formatTime(log.timestamp)}</span>
                <span className={"table-cell font-semibold uppercase pr-3 align-top text-right whitespace-nowrap" + rowHl + " " + getLevelColor(log.level)} style={{width: '60px'}}>
                  [{log.level}]
                </span>
                <span className={"table-cell align-top whitespace-pre-wrap" + rowHl} style={{wordBreak: 'break-word'}}>
                  {!isErrorLog || !err ? (
                    <>
                      <span className="mr-2 inline-block align-top">
                        <Ansi>{log.message}</Ansi>
                      </span>
                      {log.data && (
                        <span className="inline-block align-top">
                          <LogJsonViewer 
                            data={log.data}
                            requestData={requestLogDataDetail}
                            loadedDataCache={loadedLogData}
                          />
                        </span>
                      )}
                    </>
                  ) : (
                    <div>
                      <div className="text-red-300 font-semibold">
                        {errorHeader}
                      </div>
                      {stackLines.map((line, idx) => (
                        <div key={`${log.id}-stack-${idx}`} className="text-red-400">
                          {line.startsWith('at ') ? `    ${line}` : `    ${line}`}
                        </div>
                      ))}
                    </div>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );

  const renderBackendLogs = (logs: LogEntry[], endRef: React.RefObject<HTMLDivElement>) => (
    <div ref={backendLogsContainerRef} className="flex-1 overflow-y-auto font-mono text-xs bg-gray-900 text-gray-100 p-4 select-text">
      {logs.length === 0 ? (
        <div className="text-gray-500 text-center py-8">No logs yet</div>
      ) : (
        <div className="table w-full border-collapse">
          {logs.map((log) => {
            const isErrorLog = log.level === 'error';
            const isWarnLog = log.level === 'warn';
            const rowHl = isErrorLog ? ' bg-red-950/30' : (isWarnLog ? ' bg-yellow-900/20' : '');
            return (
              <div key={log.id} className="table-row">
                <span className={"table-cell text-gray-500 pr-3 align-top whitespace-nowrap" + rowHl}>{formatTime(log.timestamp)}</span>
                <span className={"table-cell font-semibold uppercase pr-3 align-top text-right whitespace-nowrap" + rowHl + " " + getLevelColor(log.level)} style={{width: '60px'}}>
                  [{log.level}]
                </span>
                <span className={"table-cell align-top whitespace-pre-wrap" + rowHl} style={{wordBreak: 'break-word'}}>
                  <span style={{display: 'inline-block'}}>
                    <Ansi>{log.message}</Ansi>
                  </span>
                  {log.data &&
                  typeof log.data === 'object' &&
                  log.data !== null &&
                  !Array.isArray(log.data)
                    ? Object.entries(log.data)
                        .filter(([key]) => !['level', 'time', 'message'].includes(key))
                        .map(([key, value], index) => (
                          <span key={`${log.id}-${key}-${index}`} className="ml-4 inline-block">
                            <span className="text-blue-400">{key}=</span>
                            <span className="text-gray-300 break-all">{JSON.stringify(value)}</span>
                          </span>
                        ))
                    : null}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );

  const Panel = (
      <div className={standalone ? "h-full w-full flex flex-col" : "bg-white rounded-lg shadow-2xl w[90vw] h-[80vh] flex flex-col"}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200" data-tauri-drag-region>
          <div className="flex items-center gap-2" data-tauri-drag-region>
            <Bug className="text-primary-600" size={24} />
            <h2 className="text-xl font-bold text-gray-900">Debug Panel</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-48 border-r border-gray-200 bg-gray-50 flex flex-col">
            <button
              onClick={() => setActiveTab("backend-logs")}
              className={`flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                activeTab === "backend-logs"
                  ? "bg-primary-500 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Terminal size={18} />
              <span className="font-medium">Backend Logs</span>
            </button>
            <button
              onClick={() => setActiveTab("frontend-logs")}
              className={`flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                activeTab === "frontend-logs"
                  ? "bg-primary-500 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Terminal size={18} />
              <span className="font-medium">Frontend Logs</span>
            </button>
            <button
              onClick={() => setActiveTab("debug-tools")}
              className={`flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                activeTab === "debug-tools"
                  ? "bg-primary-500 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Activity size={18} />
              <span className="font-medium">Debug Tools</span>
            </button>
            <button
              onClick={() => setActiveTab("simulate")}
              className={`flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                activeTab === "simulate"
                  ? "bg-primary-500 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <PlayCircle size={18} />
              <span className="font-medium">Simulate</span>
            </button>
            <button
              onClick={() => setActiveTab("store")}
              className={`flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                activeTab === "store"
                  ? "bg-primary-500 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <Database size={18} />
              <span className="font-medium">Store</span>
            </button>
          </div>

          <div className="flex-1 flex flex-col min-w-0">
            {activeTab === "backend-logs" && (
              <>
                <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border-b border-gray-200">
                  <span className="text-sm font-medium text-gray-700">
                    Backend Logs ({backendLogs.length})
                    <span className={`ml-3 text-xs ${isLogWsConnected ? 'text-green-600' : 'text-gray-400'}`}>
                      {isLogWsConnected ? '● Connected' : '○ Disconnected'}
                    </span>
                    {backendInstanceId && (
                      <span className="ml-2 text-xs text-gray-500">ID: {backendInstanceId}</span>
                    )}
                  </span>
                  <button
                    onClick={clearBackendLogs}
                    className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                  >
                    Clear
                  </button>
                </div>
                {renderBackendLogs(backendLogs, backendLogsEndRef)}
              </>
            )}

            {activeTab === "frontend-logs" && (
              <>
                <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border-b border-gray-200">
                  <span className="text-sm font-medium text-gray-700">
                    Frontend Logs ({frontendLogs.length})
                  </span>
                  <button
                    onClick={clearFrontendLogs}
                    className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                  >
                    Clear
                  </button>
                </div>
                {renderFrontendLogs(frontendLogs, frontendLogsEndRef)}
              </>
            )}

            {activeTab === "debug-tools" && (
              <div className="flex-1 overflow-auto p-6 space-y-6">
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <FolderOpen size={18} />
                    Configuration
                  </h3>
                  <p className="text-sm text-gray-600 mb-3">
                    Open application configuration directory
                  </p>
                  <button
                    onClick={async () => {
                      if (!isTauriRuntime()) {
                        alert("Opening the config directory is available in the desktop app.");
                        return;
                      }

                      try {
                        await invoke("open_config_directory");
                      } catch (error: any) {
                        alert(`Failed to open config directory: ${error}`);
                      }
                    }}
                    className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center gap-2"
                  >
                    <FolderOpen size={16} />
                    Open Config Directory
                  </button>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <Activity size={18} />
                      Task System Test
                    </h3>
                    <span className={`text-xs ${isMainWsConnected ? 'text-green-600' : 'text-gray-400'}`}>
                      {isMainWsConnected ? '● Connected' : '○ Disconnected'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">
                    Test the task progress system with a simulated task
                  </p>
                  <button
                    onClick={handleStartTestTask}
                    disabled={isTestTaskRunning || !isMainWsConnected}
                    className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isTestTaskRunning ? (
                      <>
                        <Loader className="animate-spin" size={16} />
                        Running...
                      </>
                    ) : (
                      <>
                        <PlayCircle size={16} />
                        Start Test Task
                      </>
                    )}
                  </button>
                  {testTask && (
                    <div className="mt-4 space-y-2">
                      <div className={`p-3 rounded-lg border-2 transition-all duration-300 ${
                        testTask.status === "completed" 
                          ? "bg-green-50 border-green-500" 
                          : testTask.status === "error"
                          ? "bg-red-50 border-red-500"
                          : "bg-blue-50 border-blue-500"
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold text-gray-900">
                            Task Status: {testTask.status}
                          </span>
                          <span className={`text-sm font-bold ${
                            testTask.status === "completed" ? "text-green-600" : "text-blue-600"
                          }`}>
                            {Math.round(testTask.progress)}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3 mb-2 overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-300 ${
                              testTask.status === "completed" 
                                ? "bg-green-500" 
                                : testTask.status === "error"
                                ? "bg-red-500"
                                : "bg-blue-500"
                            }`}
                            style={{ width: `${testTask.progress}%` }}
                          />
                        </div>
                        <p className="text-sm text-gray-700">{testTask.message}</p>
                        {testTask.status === "completed" && (
                          <div className="mt-2 text-green-600 text-sm font-medium flex items-center gap-1">
                            ✓ Task completed successfully
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <Send size={18} />
                      WebSocket Test
                    </h3>
                    <span className={`text-xs ${isMainWsConnected ? 'text-green-600' : 'text-gray-400'}`}>
                      {isMainWsConnected ? '● Connected' : '○ Disconnected'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-3">
                    Test WebSocket connection to backend
                  </p>
                  <button
                    onClick={handleWsTest}
                    disabled={!isMainWsConnected}
                    className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <PlayCircle size={16} />
                    Start WebSocket Test
                  </button>
                  {wsTestUrl && (
                    <div className="mt-3 text-xs text-gray-600">
                      URL: {wsTestUrl}
                    </div>
                  )}
                  {wsTestResponse && (
                    <pre className="mt-3 p-3 bg-gray-900 text-gray-100 rounded text-xs overflow-auto max-h-48">
                      {wsTestResponse}
                    </pre>
                  )}
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <Send size={18} />
                    HTTP Request Test
                  </h3>
                  <p className="text-sm text-gray-600 mb-3">
                    Test HTTP connection to backend
                  </p>
                  <button
                    onClick={handleHttpTest}
                    className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center gap-2"
                  >
                    <PlayCircle size={16} />
                    Start HTTP Test
                  </button>
                  {httpTestUrl && (
                    <div className="mt-3 text-xs text-gray-600">
                      URL: {httpTestUrl}
                    </div>
                  )}
                  {httpTestResponse && (
                    <pre className="mt-3 p-3 bg-gray-900 text-gray-100 rounded text-xs overflow-auto max-h-48">
                      {httpTestResponse}
                    </pre>
                  )}
                </div>
              </div>
            )}

            {activeTab === "simulate" && (
              <div className="flex-1 overflow-auto p-6">
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <Activity size={18} />
                      Device Simulation Manager
                    </h3>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleStopAllSimulations}
                        className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors flex items-center gap-2"
                      >
                        <StopCircle size={16} />
                        Stop All {simulatedUdids.size > 0 ? `(${simulatedUdids.size})` : ''}
                      </button>
                      <button
                        onClick={handleOpenAddDialog}
                        className="px-3 py-1.5 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center gap-2"
                      >
                        <PlusCircle size={16} />
                        Add Profile
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {profiles.length === 0 ? (
                      <div className="text-center py-8 text-gray-500">
                        No profiles saved. Click "Add Profile" to create one.
                      </div>
                    ) : (
                      profiles.map((profile) => {
                        const isSimulated = simulatedUdids.has(profile.info.udid);
                        const displayName = `${profile.info.name} - ${profile.info.model} - iOS ${profile.info.version}${profile.info.color ? ` - ${profile.info.color}` : ''}`;
                        
                        return (
                          <div
                            key={profile.id}
                            className={`flex items-center justify-between p-3 border rounded-lg ${
                              isSimulated ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-300'
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900 truncate">
                                {displayName}
                              </div>
                              {isSimulated && (
                                <div className="text-xs text-green-600 mt-1">● Simulated</div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 ml-4">
                              {!isSimulated ? (
                                <button
                                  onClick={() => handleSimulateProfile(profile)}
                                  className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 transition-colors flex items-center gap-1"
                                  title="Simulate"
                                >
                                  <PlayCircle size={14} />
                                  Simulate
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleStopSingleSimulation(profile.info.udid)}
                                  className="px-2 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 transition-colors flex items-center gap-1"
                                  title="Stop Simulation"
                                >
                                  <StopCircle size={14} />
                                  Stop
                                </button>
                              )}
                              <button
                                onClick={() => handleOpenEditDialog(profile)}
                                className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors flex items-center gap-1"
                                title="Edit"
                              >
                                <Edit size={14} />
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteProfile(profile.id)}
                                className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors flex items-center gap-1"
                                title="Delete"
                              >
                                <Trash2 size={14} />
                                Delete
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {showEditor && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40">
                      <div className="bg-white rounded-lg shadow-2xl w-[90vw] max-w-4xl max-h-[90vh] flex flex-col">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                          <h3 className="text-xl font-bold text-gray-900">
                            {editingProfile ? 'Edit Profile' : 'Add Profile'}
                          </h3>
                          <button
                            onClick={() => setShowEditor(false)}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                          >
                            <X size={20} />
                          </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                          <div className="mb-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
                            <div>Connected Devices: {availableDevices.length}</div>
                            {selectedDevice && <div>Selected: {selectedDevice.name} ({selectedDevice.model})</div>}
                            {!selectedDevice && availableDevices.length > 0 && (
                              <div className="text-orange-600">⚠ No device selected (will use first backend device)</div>
                            )}
                            {availableDevices.length === 0 && (
                              <div className="text-red-600">⚠ No devices connected</div>
                            )}
                            {currentDeviceLoadError && (
                              <div className="text-red-600 mt-2">⚠ {currentDeviceLoadError}</div>
                            )}
                          </div>
                          
                          <div className="flex gap-2 mb-4 flex-wrap">
                            <button
                              onClick={handleLoadCurrentDevice}
                              disabled={isLoadingCurrentDevice}
                              className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Save size={14} />
                              {isLoadingCurrentDevice ? 'Loading...' : 'Load Current Device'}
                            </button>
                            <button
                              onClick={handleGenerateRandom}
                              className="px-3 py-1.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors flex items-center gap-2"
                            >
                              <PlusCircle size={14} />
                              Generate Random
                            </button>
                            <button
                              onClick={handleRandomizeUDID}
                              className="px-3 py-1.5 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors flex items-center gap-2"
                            >
                              <Activity size={14} />
                              Randomize UDID
                            </button>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Profile (JSON)
                            </label>
                            <textarea
                              value={editorDeviceJson}
                              onChange={(e) => setEditorDeviceJson(e.target.value)}
                              className="w-full h-96 px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                              spellCheck={false}
                              placeholder='{"info": {...}, "apps": [...]}'
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-200">
                          <button
                            onClick={() => setShowEditor(false)}
                            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSaveProfile}
                            className="px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors"
                          >
                            Save Profile
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "store" && (
              <div className="flex-1 overflow-auto p-6">
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <Database size={18} />
                      Store Monitor
                    </h3>
                    <button
                      onClick={() => {
                        if (!isTauriRuntime()) {
                          return;
                        }

                        emit('request-store-data').catch((e) => {
                          console.error('Failed to request store data:', e);
                        });
                      }}
                      className="px-3 py-1.5 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition-colors flex items-center gap-2"
                    >
                      <Activity size={16} />
                      Refresh
                    </button>
                  </div>

                  {storeLastUpdate && (
                    <div className="text-xs text-gray-500 mb-4">
                      Last update: {storeLastUpdate.toLocaleTimeString()}
                    </div>
                  )}

                  {!storeData ? (
                    <div className="text-center py-8 text-gray-500">
                      No store data yet. Click "Refresh" to load data from main window.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {renderStoreCard("🔐 Account", storeData.account)}
                      {renderStoreCard("📱 Device", storeData.device)}
                      {renderStoreCard("⚙️ Task", storeData.task)}
                      {renderStoreCard("🌐 Connection", storeData.connection)}
                      {renderStoreCard("⬇️ Download", storeData.download)}
                      {renderStoreCard("❌ Error", storeData.error)}
                      {renderStoreCard("💬 Toast", storeData.toast)}
                      {renderStoreCard("🐛 Debug", storeData.debug)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
  );

  if (standalone) {
    return <div className="h-screen w-screen bg-white">{Panel}</div>;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      {Panel}
    </div>
  );
}

