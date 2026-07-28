import { useState, useEffect, useRef, Fragment, useCallback, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Smartphone,
  RefreshCw,
  Upload,
  Loader2,
  Package,
  UploadCloud,
  Check,
  ShieldCheck,
  User,
  Users,
  HelpCircle,
  Settings,
  Search,
  X,
  Copy,
  ChevronDown,
  Info as InfoIcon,
} from "lucide-react";
import { Menu, Transition } from "@headlessui/react";
import { useTranslation } from "react-i18next";
import { useTimeoutFn, useClickAway, useCopyToClipboard, useInterval } from "react-use";
import { useErrorStore } from "../store/errorStore";
import { useToastStore } from "../store/toastStore";
import { useDeviceStore } from "../store/deviceStore";
import { useTask } from "../hooks/useTask";
import ConfirmDialog from "../components/ConfirmDialog";
import { DataTable, DataTableColumn } from "../components/DataTable";
import {
  goServiceClient,
  DeviceInfo,
} from "../lib/goService";
import type { AppInfo } from "../store/deviceStore";
import { getDeviceColorName } from "../lib/deviceColorMap";
import { getDeviceModelName } from "../lib/deviceModelMap";
import AppDetailsDialog from "../components/AppDetailsDialog";
import DeviceDetailsDialog from "../components/DeviceDetailsDialog";
import IpaPreviewDialog from "../components/IpaPreviewDialog";
import InstallingAppsBlock from "../components/InstallingAppsBlock";
import { useDropZone } from "../hooks/useDropZone";
import { useInstallStore } from "../store/installStore";
import PageLoading from "../components/PageLoading";
import Button3D from "../components/Button3D";

export default function DevicesPage() {
  const { t } = useTranslation();
  const { showError } = useErrorStore();
  const { showToast } = useToastStore();
  
  // Global device state from store
  const {
    connectedDevices,
    selectedDevice,
    isRefreshing,
    refreshCompleted,
    refreshTrigger,
    setConnectedDevices,
    setSelectedDevice,
    setIsRefreshing,
    setRefreshCompleted,
    setDeviceAppsCache,
    getDeviceAppsCache,
    clearDeviceAppsCache,
  } = useDeviceStore();

  // App-specific state (keep in component for UI only)
  const [deviceApps, setDeviceApps] = useState<AppInfo[]>([]);
  const [appIcons, setAppIcons] = useState<Record<string, string>>({});
  const [isLoadingApps, setIsLoadingApps] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [showSystemApps, setShowSystemApps] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAppIds, setSelectedAppIds] = useState<Set<string>>(new Set());

  type AppSortField = 'name' | 'auth_type' | 'version' | 'app_size';
  const [sortField, setSortField] = useState<AppSortField>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedAppForDetails, setSelectedAppForDetails] = useState<AppInfo | null>(null);
  const [contextMenuApp, setContextMenuApp] = useState<AppInfo | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [showDeviceDetails, setShowDeviceDetails] = useState(false);
  const [showUninstallConfirm, setShowUninstallConfirm] = useState(false);
  const [showBatchUninstallConfirm, setShowBatchUninstallConfirm] = useState(false);
  const [appToUninstall, setAppToUninstall] = useState<{ bundleId: string; appName: string } | null>(null);
  const [ipaPreviewPath, setIpaPreviewPath] = useState<string | null>(null);
  const [deviceLockError, setDeviceLockError] = useState<'locked' | 'timeout' | null>(null);
  const [deviceImageError, setDeviceImageError] = useState<Record<string, boolean>>({});
  const [copiedDeviceName, setCopiedDeviceName] = useState(false);
  const [copiedDeviceInfo, setCopiedDeviceInfo] = useState(false);
  const [hoveringDeviceName, setHoveringDeviceName] = useState(false);
  const [hoveringDeviceInfo, setHoveringDeviceInfo] = useState(false);
  const deviceNameTimerRef = useRef<number | null>(null);
  const deviceInfoTimerRef = useRef<number | null>(null);
  const [disableTableAnimation, setDisableTableAnimation] = useState(false);
  const previousDeviceUdidRef = useRef<string | undefined>(selectedDevice?.udid);
  
  // Copy to clipboard with react-use
  const [, copyToClipboard] = useCopyToClipboard();
  
  // Ref to track the latest appIcons without triggering effects
  const appIconsRef = useRef(appIcons);
  useEffect(() => {
    appIconsRef.current = appIcons;
  }, [appIcons]);
  
  // Task management using useTask hook
  const { tasks: uninstallTasks } = useTask("uninstall", (data) => data?.udid === selectedDevice?.udid);
  
  // Listen for completed uninstall tasks and remove apps from the list
  useEffect(() => {
    if (!selectedDevice) return;
    
    const completedTasks = uninstallTasks.filter(task => 
      task.status === "completed" && 
      task.data?.udid === selectedDevice.udid
    );
    
    if (completedTasks.length > 0) {
      const bundleIdsToRemove = new Set(completedTasks.map(task => task.data?.bundle_id).filter(Boolean));
      
      setDeviceApps(prevApps => {
        const newApps = prevApps.filter(app => !bundleIdsToRemove.has(app.bundle_id));
        
        // Use setTimeout to defer the cache update to avoid nested state updates
        setTimeout(() => {
          setDeviceAppsCache(selectedDevice.udid, newApps, appIconsRef.current);
        }, 0);
        
        return newApps;
      });
      
      // Clear selection for removed apps - check if selected apps still exist
      setSelectedAppIds(prevSelected => {
        const newSelected = new Set(prevSelected);
        bundleIdsToRemove.forEach(id => newSelected.delete(id));
        // If all selected apps were removed, clear selection
        if (newSelected.size === 0 && prevSelected.size > 0) {
          return new Set();
        }
        return newSelected;
      });
      
      showToast(t("devices.uninstallSuccess"), "success");
    }
  }, [uninstallTasks, selectedDevice, t, showToast, setDeviceAppsCache]);
  
  // Refs for lock polling
  const lockPollingEnabledRef = useRef(false);
  const lockPollingUdidRef = useRef<string | null>(null);
  const lockTimeoutIdRef = useRef<number | null>(null);
  
  // Auto-reset refresh completed state after 1s
  const [, , resetRefreshCompleted] = useTimeoutFn(() => {
    setRefreshCompleted(false);
  }, 1000);
  
  // Ref for search input
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleFileDrop = (paths: string[]) => {
    if (!selectedDevice) {
      showToast(t("devices.selectDeviceFirst"), "error");
      return;
    }

    const ipaFiles = paths.filter(path => 
      path.toLowerCase().endsWith('.ipa') || 
      path.toLowerCase().endsWith('.tipa')
    );

    if (ipaFiles.length === 0) {
      showToast(t("devices.dropIpaOnly"), "error");
      return;
    }

    setIpaPreviewPath(ipaFiles[0]);
  };

  const { ref: dropZoneRef, isDragging } = useDropZone({
    onDrop: handleFileDrop,
    enabled: !!selectedDevice,
  });

  const clearLockTimers = () => {
    lockPollingEnabledRef.current = false;
    lockPollingUdidRef.current = null;
    if (lockTimeoutIdRef.current) {
      clearTimeout(lockTimeoutIdRef.current);
      lockTimeoutIdRef.current = null;
    }
  };

  const startLockPolling = (udid: string) => {
    clearLockTimers();
    lockPollingEnabledRef.current = true;
    lockPollingUdidRef.current = udid;
    
    // Set 120 second timeout
    lockTimeoutIdRef.current = window.setTimeout(() => {
      clearLockTimers();
      setDeviceLockError('timeout');
    }, 120000);
  };

  const loadDeviceApps = useCallback(async (udid: string, forceRefresh: boolean = false) => {
    console.log('loadDeviceApps called:', { udid, forceRefresh });
    
    if (forceRefresh) {
      console.log('Clearing cache for device:', udid);
      clearDeviceAppsCache(udid);
    }
    
    setIsLoadingApps(true);
    setDeviceLockError(null);
    clearLockTimers();
    
    try {
      console.log('Fetching apps list from backend...');
      const apps = await goServiceClient.listApps(udid);
      console.log('Received apps from backend:', apps.length);
      setDeviceApps(apps);
      setIsLoadingApps(false);
      
      // Load icons asynchronously after displaying the app list
      if (apps.length > 0) {
        const bundleIds = apps.map(app => app.bundle_id);
        console.log('Fetching icons for', bundleIds.length, 'apps...');
        goServiceClient.getAppIcons(udid, bundleIds).then(icons => {
          setAppIcons(icons);
          setDeviceAppsCache(udid, apps, icons);
        }).catch(err => {
          console.error('Failed to load icons:', err);
          setDeviceAppsCache(udid, apps, {});
        });
      } else {
        setDeviceAppsCache(udid, apps, {});
      }
    } catch (error: any) {
      console.error("Failed to load device apps:", error);
      setIsLoadingApps(false);
      
      if (error.message && error.message.includes("PasswordProtected")) {
        setDeviceLockError('locked');
        startLockPolling(udid);
      }
    }
  }, [clearDeviceAppsCache, setDeviceAppsCache]);

  const refreshDevices = useCallback(async (refreshApps: boolean = false) => {
    if (refreshCompleted) {
      resetRefreshCompleted();
    }
    
    setIsRefreshing(true);
    setRefreshCompleted(false);
    try {
      const devices = await goServiceClient.listDevices();
      setConnectedDevices(devices);

      if (selectedDevice) {
        const stillConnected = devices.find(
          (d) => d.udid === selectedDevice.udid
        );
        if (!stillConnected) {
          setDeviceApps([]);
          setAppIcons({});
        } else if (refreshApps) {
          await loadDeviceApps(selectedDevice.udid, true);
        }
      }
      
      setRefreshCompleted(true);
      resetRefreshCompleted();
    } catch (error: any) {
      console.error("Failed to refresh devices:", error);
    } finally {
      setIsRefreshing(false);
    }
    // Store functions are stable, selectedDevice and loadDeviceApps are the key dependencies
  }, [selectedDevice, loadDeviceApps]);

  useEffect(() => {
    refreshDevices();
    
    const preventDefaults = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !e.shiftKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    
    window.addEventListener('dragover', preventDefaults);
    window.addEventListener('drop', preventDefaults);
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('dragover', preventDefaults);
      window.removeEventListener('drop', preventDefaults);
      window.removeEventListener('keydown', handleKeyDown);
      if (deviceNameTimerRef.current) {
        clearTimeout(deviceNameTimerRef.current);
      }
      if (deviceInfoTimerRef.current) {
        clearTimeout(deviceInfoTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (refreshTrigger > 0) {
      console.log("Refresh triggered from store, refreshing devices...");
      refreshDevices();
    }
  }, [refreshTrigger, refreshDevices]);

  const tryLoadAppsQuietly = async (udid: string): Promise<boolean> => {
    try {
      const apps = await goServiceClient.listApps(udid);
      setDeviceApps(apps);
      
      let icons = {};
      if (apps.length > 0) {
        const bundleIds = apps.map(app => app.bundle_id);
        icons = await goServiceClient.getAppIcons(udid, bundleIds);
        setAppIcons(icons);
      }
      
      setDeviceAppsCache(udid, apps, icons);
      
      return true;
    } catch (error) {
      return false;
    }
  };

  // Lock polling interval using useInterval
  useInterval(
    async () => {
      if (lockPollingUdidRef.current) {
        const success = await tryLoadAppsQuietly(lockPollingUdidRef.current);
        if (success) {
          clearLockTimers();
          setDeviceLockError(null);
        }
      }
    },
    lockPollingEnabledRef.current ? 2000 : null
  );


  // Auto-load apps when selectedDevice changes (including auto-selected first device)
  useEffect(() => {
    if (selectedDevice) {
      const udidChanged = previousDeviceUdidRef.current !== selectedDevice.udid;
      
      if (udidChanged) {
        setDisableTableAnimation(true);
        previousDeviceUdidRef.current = selectedDevice.udid;
        
        setTimeout(() => {
          setDisableTableAnimation(false);
        }, 50);
      }
      
      // Check if we have cached apps first
      const cached = getDeviceAppsCache(selectedDevice.udid);
      if (cached && cached.apps.length > 0) {
        setDeviceApps(cached.apps);
        setAppIcons(cached.icons);
      } else if (!isLoadingApps) {
        // Load apps for the newly selected device
        loadDeviceApps(selectedDevice.udid, false);
      }
    } else {
      // No device selected, clear apps
      setDeviceApps([]);
      setAppIcons({});
      previousDeviceUdidRef.current = undefined;
    }
    
    return () => {
      clearLockTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice?.udid]); // Only trigger when device UDID changes

  // Listen for app size calculation tasks from global task store
  const { tasks: allAppSizeTasks } = useTask("app_size_calculation");
  
  const appSizeTasks = useMemo(() => {
    return allAppSizeTasks.filter(task => task.data?.udid === selectedDevice?.udid);
  }, [allAppSizeTasks, selectedDevice?.udid]);

  // Debug log for all tasks
  useEffect(() => {
    if (allAppSizeTasks.length > 0) {
      console.log("All app size tasks:", allAppSizeTasks.length);
      console.log("Filtered app size tasks:", appSizeTasks.length);
    }
  }, [allAppSizeTasks.length, appSizeTasks.length]);
  
  useEffect(() => {
    if (!selectedDevice) return;
    
    // Update device apps when app size calculation completes
    const completedTasks = appSizeTasks.filter(task => task.status === "completed");
    
    if (completedTasks.length > 0) {
      console.log("App size tasks updated:", completedTasks.length, "completed tasks");
      console.log("First completed task data:", completedTasks[0]?.data);
      setDeviceApps(prevApps => {
        console.log("Current device apps count:", prevApps.length);
        let hasChanges = false;
        const newApps = prevApps.map(app => {
          const sizeTask = completedTasks.find(task => task.data?.bundle_id === app.bundle_id);
          if (sizeTask?.data) {
             // Log for debugging
             console.log(`Updating size for ${app.bundle_id}: app=${sizeTask.data.app_size}, data=${sizeTask.data.data_size}`);
             
             if (app.app_size !== sizeTask.data.app_size || app.data_size !== sizeTask.data.data_size) {
                hasChanges = true;
                return {
                  ...app,
                  app_size: sizeTask.data.app_size,
                  data_size: sizeTask.data.data_size,
                };
             }
          }
          return app;
        });
        
        // Only update cache if there were actual changes
        if (hasChanges) {
          console.log("Device apps updated with new sizes");
          // Use setTimeout to defer the cache update to avoid nested state updates
          setTimeout(() => {
            setDeviceAppsCache(selectedDevice.udid, newApps, appIconsRef.current);
          }, 0);
        }
        
        return newApps;
      });
    }
  }, [appSizeTasks, selectedDevice, setDeviceAppsCache]);

  const handleSelectIpaFile = async () => {
    if (!selectedDevice) return;

    try {
      const file = await open({
        multiple: false,
        filters: [
          {
            name: "IPA Files",
            extensions: ["ipa", "tipa"],
          },
        ],
      });

      if (file) {
        setIpaPreviewPath(file);
      }
    } catch (error: any) {
      showError(t("devices.installIpaFailed"), error.toString());
    }
  };

  const handleConfirmInstall = async (filePath: string, deviceUdid: string, certificateId?: string | null) => {
    try {
      setIsInstalling(true);
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      showToast(t("devices.installingFile", { name: fileName }), "info");
      await useInstallStore.getState().startInstall(deviceUdid, filePath, undefined, undefined, undefined, certificateId);
    } catch (error: any) {
      showError(t("devices.installIpaFailed"), error.toString());
    } finally {
      setIsInstalling(false);
    }
  };

  const isAppSortField = useCallback((key: string): key is AppSortField => {
    return key === 'name' || key === 'auth_type' || key === 'version' || key === 'app_size';
  }, []);

  const handleSort = useCallback((key: string) => {
    if (!isAppSortField(key)) return;

    if (sortField === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
      return;
    }

    setSortField(key);
    setSortDirection('asc');
  }, [isAppSortField, sortDirection, sortField]);

  const filteredAndSortedApps = useMemo(() => {
    let filtered = deviceApps.filter(app => {
      if (!showSystemApps && app.auth_type === 'system') return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (app.name || '').toLowerCase().includes(query) || 
               app.bundle_id.toLowerCase().includes(query);
      }
      return true;
    });

    const deviceOrderIndex = new Map<string, number>();
    for (let i = 0; i < deviceApps.length; i++) {
      deviceOrderIndex.set(deviceApps[i].bundle_id, i);
    }

    const tieBreakByOriginalOrder = (a: AppInfo, b: AppInfo) => {
      const ai = deviceOrderIndex.get(a.bundle_id) ?? 0;
      const bi = deviceOrderIndex.get(b.bundle_id) ?? 0;
      return ai - bi;
    };

    return filtered.sort((a, b) => {
      let comparison = 0;
      if (sortField === 'name') {
        comparison = (a.name || a.bundle_id).localeCompare(b.name || b.bundle_id);
      } else if (sortField === 'auth_type') {
        comparison = a.auth_type.localeCompare(b.auth_type);
      } else if (sortField === 'version') {
        comparison = a.version.localeCompare(b.version);
      } else if (sortField === 'app_size') {
        const aHasSize = (a.app_size ?? 0) > 0 || (a.data_size ?? 0) > 0;
        const bHasSize = (b.app_size ?? 0) > 0 || (b.data_size ?? 0) > 0;

        if (aHasSize !== bHasSize) {
          return aHasSize ? -1 : 1;
        }

        if (!aHasSize && !bHasSize) {
          return tieBreakByOriginalOrder(a, b);
        }

        const aTotal = (a.app_size ?? 0) + (a.data_size ?? 0);
        const bTotal = (b.app_size ?? 0) + (b.data_size ?? 0);
        const base = aTotal - bTotal;
        const sizedComparison = sortDirection === 'asc' ? base : -base;
        return sizedComparison === 0 ? tieBreakByOriginalOrder(a, b) : sizedComparison;
      }

      if (comparison === 0) {
        comparison = tieBreakByOriginalOrder(a, b);
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [deviceApps, showSystemApps, searchQuery, sortField, sortDirection]);

  const handleSelectApp = useCallback((bundleId: string, ctrlKey: boolean = false) => {
    if (ctrlKey) {
      // Ctrl pressed: toggle selection (multi-select)
      const newSelected = new Set(selectedAppIds);
      if (newSelected.has(bundleId)) {
        newSelected.delete(bundleId);
      } else {
        newSelected.add(bundleId);
      }
      setSelectedAppIds(newSelected);
    } else {
      // No Ctrl: single selection (replace all)
      if (selectedAppIds.has(bundleId) && selectedAppIds.size === 1) {
        // Clicking already selected item: deselect
        setSelectedAppIds(new Set());
      } else {
        // Select only this item
        setSelectedAppIds(new Set([bundleId]));
      }
    }
  }, [selectedAppIds]);

  const handleSelectAll = useCallback(() => {
    if (selectedAppIds.size === filteredAndSortedApps.length) {
      setSelectedAppIds(new Set());
    } else {
      setSelectedAppIds(new Set(filteredAndSortedApps.map(app => app.bundle_id)));
    }
  }, [filteredAndSortedApps, selectedAppIds.size]);

  const handleUninstallApp = useCallback((bundleId: string, appName: string) => {
    setAppToUninstall({ bundleId, appName });
    setShowUninstallConfirm(true);
  }, []);

  const confirmUninstallApp = async () => {
    if (!selectedDevice || !appToUninstall) return;

    try {
      showToast(t("devices.uninstalling"), "info");
      await useInstallStore.getState().startUninstall(selectedDevice.udid, appToUninstall.bundleId, appToUninstall.appName);
      
      // Remove from selection if it was selected
      setSelectedAppIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(appToUninstall.bundleId);
        return newSet;
      });
    } catch (error: any) {
      showError(t("devices.uninstallFailed"), error.toString());
    }
  };

  const handleBatchUninstall = () => {
    setShowBatchUninstallConfirm(true);
  };

  const confirmBatchUninstall = async () => {
    if (!selectedDevice) return;

    try {
      const appsToUninstall = filteredAndSortedApps.filter(app => selectedAppIds.has(app.bundle_id));
      for (const app of appsToUninstall) {
        await useInstallStore.getState().startUninstall(selectedDevice.udid, app.bundle_id, app.name || app.bundle_id);
      }
      setSelectedAppIds(new Set());
      showToast(t("devices.uninstallSuccess"), "info");
    } catch (error: any) {
      showError(t("devices.uninstallFailed"), error.toString());
    } finally {
      setShowBatchUninstallConfirm(false);
    }
  };

  const handleSelectDevice = async (device: DeviceInfo) => {
    setSelectedDevice(device);
    setCopiedDeviceName(false);
    setCopiedDeviceInfo(false);
    setHoveringDeviceName(false);
    setHoveringDeviceInfo(false);
    if (deviceNameTimerRef.current) {
      clearTimeout(deviceNameTimerRef.current);
      deviceNameTimerRef.current = null;
    }
    if (deviceInfoTimerRef.current) {
      clearTimeout(deviceInfoTimerRef.current);
      deviceInfoTimerRef.current = null;
    }
    
    const cache = getDeviceAppsCache(device.udid);
    if (cache) {
      setDeviceApps(cache.apps);
      setAppIcons(cache.icons);
    } else {
      setDeviceApps([]);
      setAppIcons({});
      await loadDeviceApps(device.udid);
    }
  };

  const getAuthTypeBadge = useCallback((authType: string) => {
    switch (authType) {
      case "apple_store":
        return (
          <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">
            <ShieldCheck size={10} />
            <span>{t("devices.authType.appleStore")}</span>
          </span>
        );
      case "shared":
        return (
          <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">
            <Users size={10} />
            <span>{t("devices.authType.shared")}</span>
          </span>
        );
      case "development":
        return (
          <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-medium">
            <User size={10} />
            <span>{t("devices.authType.development")}</span>
          </span>
        );
      case "system":
        return (
          <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-[10px] font-medium">
            <Package size={10} />
            <span>{t("devices.authType.system")}</span>
          </span>
        );
      case "jailbreak":
        return (
          <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-medium">
            <ShieldCheck size={10} className="opacity-50" />
            <span>{t("devices.authType.jailbreak")}</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px] font-medium">
            <HelpCircle size={10} />
            <span>{t("devices.authType.unknown")}</span>
          </span>
        );
    }
  }, [t]);

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      showToast(t("common.copied"), "success");
    }).catch(() => {
      showToast(t("common.copyFailed"), "error");
    });
  };

  const handleRowClick = (e: React.MouseEvent, bundleId: string) => {
    // Don't toggle if clicking on buttons or interactive elements
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input[type="checkbox"]')) {
      return;
    }
    handleSelectApp(bundleId, e.ctrlKey || e.metaKey);
  };

  const handleContextMenu = (e: React.MouseEvent, app: AppInfo) => {
    e.preventDefault();
    setContextMenuApp(app);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => {
    setContextMenuApp(null);
    setContextMenuPosition(null);
  };

  const handleContextMenuUninstall = () => {
    if (contextMenuApp) {
      if (selectedAppIds.has(contextMenuApp.bundle_id) && selectedAppIds.size > 1) {
        handleBatchUninstall();
      } else {
        handleUninstallApp(contextMenuApp.bundle_id, contextMenuApp.name);
      }
    }
    closeContextMenu();
  };

  const handleContextMenuCopyBundleId = () => {
    if (contextMenuApp) {
      handleCopyToClipboard(contextMenuApp.bundle_id);
    }
    closeContextMenu();
  };

  const formatSize = useCallback((bytes?: number): string => {
    if (!bytes) return '-';
    const kb = bytes / 1024;
    const mb = kb / 1024;
    const gb = mb / 1024;
    
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    if (mb >= 1) return `${mb.toFixed(2)} MB`;
    if (kb >= 1) return `${kb.toFixed(2)} KB`;
    return `${bytes} B`;
  }, []);

  const columns: DataTableColumn<AppInfo>[] = useMemo(() => [
    {
      key: 'name',
      header: t("devices.appName"),
      width: 'minmax(120px, 1fr)',
      align: 'left',
      sortable: true,
      minWidth: 120,
      scalePriority: true,
      render: (app) => (
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 shadow-sm">
            {app.icon_data || appIcons[app.bundle_id] ? (
              <img
                src={`data:image/png;base64,${
                  app.icon_data || appIcons[app.bundle_id]
                }`}
                alt={app.name || app.bundle_id}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary-400 to-primary-600">
                <Package className="text-white" size={16} />
              </div>
            )}
          </div>
          <p className="text-sm font-medium text-gray-900 truncate leading-tight min-w-0">
            {app.name || app.bundle_id}
          </p>
        </div>
      ),
    },
    {
      key: 'auth_type',
      header: t("devices.authType.title"),
      width: 'minmax(110px, 130px)',
      align: 'center',
      sortable: true,
      minWidth: 110,
      render: (app) => {
        const runningTask = uninstallTasks.find(
          task => task.data?.bundle_id === app.bundle_id && 
                  (task.status === "started" || task.status === "progress")
        );
        
        if (runningTask) {
          return (
            <div className="flex items-center space-x-1 px-2 py-0.5">
              <Loader2 className="animate-spin text-orange-600" size={14} />
              <span className="text-xs text-orange-600">{t("devices.uninstalling")}</span>
            </div>
          );
        }
        
        return getAuthTypeBadge(app.auth_type);
      },
    },
    {
      key: 'version',
      header: t("common.version"),
      width: 'minmax(80px, 100px)',
      align: 'center',
      sortable: true,
      minWidth: 80,
      render: (app) => (
        <span className="text-xs text-gray-600">
          {app.version}
        </span>
      ),
    },
    {
      key: 'app_size',
      header: t("devices.appSize"),
      width: 'minmax(80px, 100px)',
      align: 'center',
      sortable: true,
      minWidth: 80,
      render: (app) => {
        const totalSize = (app.app_size || 0) + (app.data_size || 0);
        const hasData = app.app_size !== undefined && app.app_size > 0;
        
        return (
          <div 
            className="flex flex-col items-center justify-center group relative cursor-default"
            title={hasData ? `${t("devices.appSizeFull")}: ${formatSize(app.app_size)}\n${t("devices.dataSize")}: ${formatSize(app.data_size || 0)}` : undefined}
          >
            {hasData ? (
              <>
                <span className="text-xs text-gray-700 font-medium">
                  {formatSize(totalSize)}
                </span>
                {app.data_size && app.data_size > 0 && (
                  <div className="absolute hidden group-hover:block z-50 bottom-full mb-2 px-2 py-1 bg-gray-900 text-white text-[10px] rounded whitespace-nowrap">
                    <div>{t("devices.appSizeFull")}: {formatSize(app.app_size)}</div>
                    <div>{t("devices.dataSize")}: {formatSize(app.data_size)}</div>
                  </div>
                )}
              </>
            ) : (
              <span className="text-xs text-gray-400 italic">
                {t("common.calculating")}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: t("common.actions"),
      width: 'minmax(160px, max-content)',
      align: 'center',
      minWidth: 160,
      render: (app) => (
        <div className="flex justify-center space-x-2">
          <Button3D
            variant="secondary"
            size="sm"
            onClick={() => setSelectedAppForDetails(app)}
          >
            {t("devices.details")}
          </Button3D>
          <Button3D
            variant="danger"
            size="sm"
            onClick={() => handleUninstallApp(app.bundle_id, app.name || app.bundle_id)}
          >
            {t("devices.uninstall")}
          </Button3D>
        </div>
      ),
    },
  ], [appIcons, formatSize, getAuthTypeBadge, handleUninstallApp, t, uninstallTasks]);

  const getDeviceImageUrl = (device: DeviceInfo): string | null => {
    if (!device.product_type || !device.color) {
      return null;
    }
    return `https://statici.icloud.com/fmipmobile/deviceImages-9.0/iPhone/${device.product_type}-1-${device.color}-0/online-infobox__3x.png`;
  };

  const handleDeviceImageError = (udid: string) => {
    setDeviceImageError(prev => ({ ...prev, [udid]: true }));
  };

  const getDisplayStorageBytes = (device: DeviceInfo): number | null => {
    const storageInfo = device.storage_info;
    if (!storageInfo) return null;
    return storageInfo.total_data_capacity || storageInfo.total_disk_capacity || null;
  };

  const getStorageCapacity = (device: DeviceInfo): string | null => {
    const totalBytes = getDisplayStorageBytes(device);
    if (!totalBytes) return null;
    const totalGB = totalBytes / (1000 * 1000 * 1000);
    const tiers = [32, 64, 128, 256, 512, 1024, 2048];
    for (const tier of tiers) {
      if (totalGB <= tier) {
        return tier >= 1024 ? `${tier / 1024}T` : `${tier}G`;
      }
    }
    return tiers[tiers.length - 1] >= 1024 ? `${tiers[tiers.length - 1] / 1024}T` : `${tiers[tiers.length - 1]}G`;
  };

  const handleCopyDeviceName = () => {
    if (!selectedDevice) return;
    
    copyToClipboard(selectedDevice.name);
    
    if (deviceNameTimerRef.current) {
      clearTimeout(deviceNameTimerRef.current);
    }
    
    setCopiedDeviceName(true);
    deviceNameTimerRef.current = window.setTimeout(() => {
      setCopiedDeviceName(false);
    }, 1000);
  };

  const handleCopyDeviceInfo = () => {
    if (!selectedDevice) return;
    
    const deviceInfo = [
      (() => {
        const modelName = getDeviceModelName(selectedDevice.product_type);
        const colorName = getDeviceColorName(selectedDevice.product_type, selectedDevice.color, selectedDevice.enclosure_color);
        return colorName ? `${modelName} ${colorName}` : modelName;
      })(),
      getStorageCapacity(selectedDevice),
      `iOS ${selectedDevice.version}`
    ].filter(Boolean).join(' | ');
    
    copyToClipboard(deviceInfo);
    
    if (deviceInfoTimerRef.current) {
      clearTimeout(deviceInfoTimerRef.current);
    }
    
    setCopiedDeviceInfo(true);
    deviceInfoTimerRef.current = window.setTimeout(() => {
      setCopiedDeviceInfo(false);
    }, 1000);
  };

  // Close context menu when clicking outside using useClickAway
  const contextMenuRef = useRef<HTMLDivElement>(null);
  useClickAway(contextMenuRef, () => {
    if (contextMenuPosition) {
      closeContextMenu();
    }
  });

  return (
    <>
    <div className="h-full overflow-auto scrollbar-thin p-8">
      <div ref={dropZoneRef} className="max-w-7xl mx-auto relative">
      {connectedDevices.length === 0 ? (
        <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
          <div className="text-center">
            <Smartphone className="mx-auto text-gray-300 mb-4" size={80} />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {t("devices.noDevices")}
            </h2>
            <p className="text-gray-500 mb-6">
              {t("devices.connectPrompt")}
            </p>
            <button
              onClick={() => refreshDevices(true)}
              disabled={isRefreshing}
              className="inline-flex items-center space-x-2 px-4 py-2 text-gray-700 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-all disabled:opacity-50"
            >
              <div className="relative w-5 h-5">
                <RefreshCw
                  className={`absolute inset-0 transition-all duration-300 ${
                    isRefreshing ? "animate-spin opacity-100" : refreshCompleted ? "opacity-0 scale-0" : "opacity-100 scale-100"
                  }`}
                  size={20}
                />
                <Check
                  className={`absolute inset-0 transition-all duration-300 ${
                    refreshCompleted ? "opacity-100 scale-100 text-green-600" : "opacity-0 scale-0"
                  }`}
                  size={20}
                />
              </div>
              <span>{refreshCompleted ? t("devices.refreshed") : t("devices.refresh")}</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 mb-2">
                  {t("devices.title")}
                </h2>
                <p className="text-gray-500">{t("devices.subtitle")}</p>
              </div>
              <button
              onClick={() => refreshDevices(true)}
              disabled={isRefreshing}
              className="inline-flex items-center space-x-2 px-4 py-2 text-gray-700 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-all disabled:opacity-50"
            >
              <div className="relative w-5 h-5">
                <RefreshCw
                  className={`absolute inset-0 transition-all duration-300 ${
                    isRefreshing ? "animate-spin opacity-100" : refreshCompleted ? "opacity-0 scale-0" : "opacity-100 scale-100"
                  }`}
                  size={20}
                />
                <Check
                  className={`absolute inset-0 transition-all duration-300 ${
                    refreshCompleted ? "opacity-100 scale-100 text-green-600" : "opacity-0 scale-0"
                  }`}
                  size={20}
                />
              </div>
                <span>{refreshCompleted ? t("devices.refreshed") : t("devices.refresh")}</span>
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 mb-8 shadow-sm">
            <div className="p-6">
              {selectedDevice && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4 flex-1">
                    <div className="w-16 h-16 flex items-center justify-center relative overflow-hidden">
                      {(() => {
                        const imageUrl = getDeviceImageUrl(selectedDevice);
                        const hasError = deviceImageError[selectedDevice.udid];
                        
                        if (imageUrl && !hasError) {
                          return (
                            <img
                              src={imageUrl}
                              alt={selectedDevice.name}
                              className="w-full h-full object-contain scale-150"
                              onError={() => handleDeviceImageError(selectedDevice.udid)}
                            />
                          );
                        }
                        
                        return (
                          <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center">
                            <Smartphone className="text-primary-600" size={24} />
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center mb-1">
                        <h3 
                          onClick={handleCopyDeviceName}
                          onMouseEnter={() => setHoveringDeviceName(true)}
                          onMouseLeave={() => setHoveringDeviceName(false)}
                          className={`font-semibold text-lg cursor-pointer transition-colors ${
                            hoveringDeviceName || copiedDeviceName ? 'text-primary-600' : 'text-gray-900'
                          }`}
                        >
                          {selectedDevice.name}
                        </h3>
                        <div className="relative ml-1.5 h-5 flex items-center min-w-[80px]">
                          <div className={`absolute left-0 flex items-center gap-1 text-green-600 text-sm whitespace-nowrap transition-all duration-300 ${
                            copiedDeviceName ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
                          }`}>
                            <Check size={14} />
                            <span>{t("common.copied")}</span>
                          </div>
                          <div className={`absolute left-0 transition-all duration-300 ${
                            !copiedDeviceName && hoveringDeviceName ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
                          }`}>
                            <Copy 
                              size={14} 
                              className="text-primary-600 cursor-pointer" 
                              onClick={handleCopyDeviceName}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center">
                        <p 
                          onClick={handleCopyDeviceInfo}
                          onMouseEnter={() => setHoveringDeviceInfo(true)}
                          onMouseLeave={() => setHoveringDeviceInfo(false)}
                          className={`text-sm flex items-center space-x-2 cursor-pointer transition-colors ${
                            hoveringDeviceInfo || copiedDeviceInfo ? 'text-primary-600' : 'text-gray-500'
                          }`}
                        >
                          <span>
                            {getDeviceModelName(selectedDevice.product_type)}
                            {(() => {
                              const colorName = getDeviceColorName(selectedDevice.product_type, selectedDevice.color, selectedDevice.enclosure_color);
                              return colorName ? ` ${colorName}` : '';
                            })()}
                          </span>
                          {(() => {
                            const storageCapacity = getStorageCapacity(selectedDevice);
                            return storageCapacity ? (
                              <>
                                <span className={hoveringDeviceInfo || copiedDeviceInfo ? 'text-primary-400' : 'text-gray-400'}>|</span>
                                <span>{storageCapacity}</span>
                              </>
                            ) : null;
                          })()}
                          <span className={hoveringDeviceInfo || copiedDeviceInfo ? 'text-primary-400' : 'text-gray-400'}>|</span>
                          <span>iOS {selectedDevice.version}</span>
                        </p>
                        <div className="relative ml-1.5 h-5 flex items-center min-w-[80px]">
                          <div className={`absolute left-0 flex items-center gap-1 text-green-600 text-sm whitespace-nowrap transition-all duration-300 ${
                            copiedDeviceInfo ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
                          }`}>
                            <Check size={14} />
                            <span>{t("common.copied")}</span>
                          </div>
                          <div className={`absolute left-0 transition-all duration-300 ${
                            !copiedDeviceInfo && hoveringDeviceInfo ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
                          }`}>
                            <Copy 
                              size={14} 
                              className="text-primary-600 cursor-pointer" 
                              onClick={handleCopyDeviceInfo}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button3D
                      variant="secondary"
                      size="md"
                      onClick={() => setShowDeviceDetails(true)}
                    >
                      <InfoIcon size={18} />
                      <span>{t("devices.details")}</span>
                    </Button3D>
                    {connectedDevices.length > 1 && (
                      <Menu as="div" className="relative">
                        <Menu.Button className="px-3 py-2 text-gray-600 hover:text-primary-600 hover:bg-gray-50 rounded-lg transition-colors flex items-center space-x-1">
                          <ChevronDown size={18} />
                        </Menu.Button>
                        <Transition
                          as={Fragment}
                          enter="transition ease-out duration-100"
                          enterFrom="transform opacity-0 scale-95"
                          enterTo="transform opacity-100 scale-100"
                          leave="transition ease-in duration-75"
                          leaveFrom="transform opacity-100 scale-100"
                          leaveTo="transform opacity-0 scale-95"
                        >
                          <Menu.Items className="absolute right-0 mt-2 w-96 origin-top-right bg-white rounded-xl shadow-xl border border-gray-200 focus:outline-none z-20 overflow-hidden max-h-[480px] overflow-y-auto">
                            <div className="p-2 space-y-1">
                              {connectedDevices.map((device) => (
                                <Menu.Item key={device.udid}>
                                  {({ active }) => (
                                    <button
                                      onClick={() => handleSelectDevice(device)}
                                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                                        selectedDevice?.udid === device.udid 
                                          ? 'bg-primary-50 ring-2 ring-primary-500 ring-inset' 
                                          : active ? 'bg-gray-50' : ''
                                      }`}
                                    >
                                      <div className="flex items-center space-x-4">
                                        <div className="w-16 h-16 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                          {(() => {
                                            const imageUrl = getDeviceImageUrl(device);
                                            const hasError = deviceImageError[device.udid];
                                            
                                            if (imageUrl && !hasError) {
                                              return (
                                                <img
                                                  src={imageUrl}
                                                  alt={device.name}
                                                  className="w-full h-full object-contain scale-150"
                                                  onError={() => handleDeviceImageError(device.udid)}
                                                />
                                              );
                                            }
                                            
                                            return (
                                              <div className="w-12 h-12 bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl flex items-center justify-center">
                                                <Smartphone
                                                  className={selectedDevice?.udid === device.udid ? "text-primary-600" : "text-gray-400"}
                                                  size={28}
                                                />
                                              </div>
                                            );
                                          })()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className={`text-base font-semibold truncate mb-1 ${
                                            selectedDevice?.udid === device.udid ? "text-primary-700" : "text-gray-900"
                                          }`}>
                                            {device.name}
                                          </p>
                                          <p className="text-sm text-gray-600 truncate mb-1">
                                            {getDeviceModelName(device.product_type)}
                                          </p>
                                          <div className="flex items-center space-x-2 text-xs text-gray-500">
                                            {(() => {
                                              const colorName = getDeviceColorName(device.product_type, device.color, device.enclosure_color);
                                              return colorName ? (
                                                <>
                                                  <span className="px-1.5 py-0.5 bg-gray-100 rounded">
                                                    {colorName}
                                                  </span>
                                                  <span className="text-gray-300">•</span>
                                                </>
                                              ) : null;
                                            })()}
                                            {(() => {
                                              const storageCapacity = getStorageCapacity(device);
                                              return storageCapacity ? (
                                                <>
                                                  <span className="px-1.5 py-0.5 bg-gray-100 rounded">
                                                    {storageCapacity}
                                                  </span>
                                                  <span className="text-gray-300">•</span>
                                                </>
                                              ) : null;
                                            })()}
                                            <span className="px-1.5 py-0.5 bg-gray-100 rounded">
                                              iOS {device.version}
                                            </span>
                                          </div>
                                        </div>
                                        {selectedDevice?.udid === device.udid && (
                                          <Check size={20} className="text-primary-600 flex-shrink-0" />
                                        )}
                                      </div>
                                    </button>
                                  )}
                                </Menu.Item>
                              ))}
                            </div>
                          </Menu.Items>
                        </Transition>
                      </Menu>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {selectedDevice && (
            <>
              <div className="mb-6 flex items-center justify-between gap-4">
                <div className="flex items-center space-x-3 flex-shrink-0">
                  <h3 className="text-xl font-bold text-gray-900">
                    {deviceApps.filter(app => showSystemApps || app.auth_type !== 'system').length} {t('common.apps')}
                  </h3>
                  {selectedAppIds.size > 0 && (
                    <>
                      <span className="text-sm text-gray-400">•</span>
                      <span className="text-sm text-primary-600 font-medium">
                        {selectedAppIds.size} {t('common.selected')}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center space-x-3 flex-shrink min-w-0">
                  <div className="relative min-w-0 flex-shrink">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 flex-shrink-0" size={16} />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t("devices.searchApps")}
                      className="pl-9 pr-8 py-2 w-full min-w-[160px] max-w-[256px] text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                  <Menu as="div" className="relative flex-shrink-0">
                    <Menu.Button
                      className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                      title={t("devices.displaySettings")}
                    >
                      <Settings size={20} />
                    </Menu.Button>
                    <Transition
                      as={Fragment}
                      enter="transition ease-out duration-100"
                      enterFrom="transform opacity-0 scale-95"
                      enterTo="transform opacity-100 scale-100"
                      leave="transition ease-in duration-75"
                      leaveFrom="transform opacity-100 scale-100"
                      leaveTo="transform opacity-0 scale-95"
                    >
                      <Menu.Items className="absolute right-0 mt-2 w-56 origin-top-right bg-white rounded-lg shadow-lg border border-gray-200 focus:outline-none z-20">
                        <div className="p-2">
                          <Menu.Item>
                            {({ active }) => (
                              <label
                                className={`flex items-center space-x-2 px-3 py-2 text-sm rounded-md cursor-pointer transition-colors ${
                                  active ? 'bg-gray-100' : ''
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={showSystemApps}
                                  onChange={(e) => setShowSystemApps(e.target.checked)}
                                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 cursor-pointer"
                                />
                                <span className="text-gray-700">{t("devices.showSystemApps")}</span>
                              </label>
                            )}
                          </Menu.Item>
                        </div>
                      </Menu.Items>
                    </Transition>
                  </Menu>
                  <Button3D
                    variant="primary"
                    size="md"
                    onClick={handleSelectIpaFile}
                    disabled={isInstalling}
                    loading={isInstalling}
                  >
                    {!isInstalling && <Upload size={16} />}
                    <span>{isInstalling ? t("devices.installing") : t("devices.installIpa")}</span>
                  </Button3D>
                </div>
              </div>

              {isDragging && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 pointer-events-none">
                  <div className="bg-white rounded-xl p-12 shadow-2xl text-center">
                    <UploadCloud className="mx-auto text-primary-600 mb-4" size={80} />
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">
                      {t("devices.dropHere")}
                    </h3>
                    <p className="text-gray-500">{t("devices.dropIpaFiles")}</p>
                  </div>
                </div>
              )}

              {isLoadingApps ? (
                <PageLoading message={t("devices.loadingApps")} />
              ) : deviceLockError ? (
                <div className="bg-white rounded-lg border border-gray-200 p-12 text-center shadow-sm">
                  <Package className="mx-auto text-orange-400 mb-4" size={60} />
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">
                    {deviceLockError === 'locked' 
                      ? t("devices.deviceLocked") 
                      : t("devices.unlockTimeout")}
                  </h3>
                  <p className="text-gray-500 mb-3">
                    {deviceLockError === 'locked'
                      ? t("devices.pleaseUnlockDevice")
                      : t("devices.pleaseReconnectDevice")}
                  </p>
                  {deviceLockError === 'locked' && (
                    <div className="flex items-center justify-center space-x-2 text-sm text-gray-400">
                      <Loader2 className="animate-spin" size={16} />
                      <span>{t("devices.autoDetecting")}</span>
                    </div>
                  )}
                </div>
              ) : deviceApps.length === 0 ? (
                <div className="bg-white rounded-lg border border-gray-200 p-12 text-center shadow-sm">
                  <Package className="mx-auto text-gray-300 mb-4" size={60} />
                  <p className="text-gray-500">{t("devices.noApps")}</p>
                </div>
              ) : (
                <div
                  className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
                >
                  <DataTable
                    key={selectedDevice?.udid}
                    data={filteredAndSortedApps}
                    columns={columns}
                    keyExtractor={(app) => app.bundle_id}
                    selectedIds={selectedAppIds}
                    onSelect={handleSelectApp}
                    onSelectAll={handleSelectAll}
                    onSort={handleSort}
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onRowClick={(app, e) => handleRowClick(e, app.bundle_id)}
                    onContextMenu={(app, e) => handleContextMenu(e, app)}
                    selectable={true}
                    rowHeight="normal"
                    disableAnimation={disableTableAnimation}
                    resizable={true}
                  />
                </div>
              )}
              
              {/* Installing Apps Block */}
              {selectedDevice && <InstallingAppsBlock udid={selectedDevice.udid} />}
            </>
          )}
        </>
      )}

      {/* App Details Dialog */}
      <AppDetailsDialog
        app={selectedAppForDetails}
        appIcon={selectedAppForDetails ? appIcons[selectedAppForDetails.bundle_id] : undefined}
        onClose={() => setSelectedAppForDetails(null)}
      />

      {/* Device Details Dialog */}
      <DeviceDetailsDialog
        device={showDeviceDetails ? selectedDevice : null}
        onClose={() => setShowDeviceDetails(false)}
      />

      {/* Context Menu */}
      {contextMenuPosition && contextMenuApp && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[180px]"
          style={{
            left: `${contextMenuPosition.x}px`,
            top: `${contextMenuPosition.y}px`,
          }}
        >
          <button
            onClick={handleContextMenuCopyBundleId}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 transition-colors flex items-center space-x-2"
          >
            <Copy size={14} />
            <span>{t("devices.copyBundleId")}</span>
          </button>
          <div className="border-t border-gray-200"></div>
          <button
            onClick={handleContextMenuUninstall}
            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center space-x-2"
          >
            <X size={14} />
            <span>
              {t("devices.uninstall")}
              {selectedAppIds.has(contextMenuApp.bundle_id) && selectedAppIds.size > 1 && ` (${t('common.app', { count: selectedAppIds.size })})`}
            </span>
          </button>
        </div>
      )}
      </div>
    </div>

    {/* Confirm Dialog */}
    <ConfirmDialog
      isOpen={showUninstallConfirm}
      title={t("devices.uninstall")}
      message={
        appToUninstall
          ? `${t("devices.uninstallConfirm")}\n\n${appToUninstall.appName} (${appToUninstall.bundleId})`
          : t("devices.uninstallConfirm")
      }
      confirmText={t("devices.uninstall")}
      cancelText={t("common.cancel")}
      onConfirm={confirmUninstallApp}
      onCancel={() => {
        setShowUninstallConfirm(false);
        setAppToUninstall(null);
      }}
      type="danger"
    />

    {/* Batch Uninstall Confirm Dialog */}
    <ConfirmDialog
      isOpen={showBatchUninstallConfirm}
      title={t("devices.batchUninstall")}
      message={t("devices.batchUninstallConfirm", { count: selectedAppIds.size })}
      confirmText={t("devices.uninstall")}
      cancelText={t("common.cancel")}
      onConfirm={confirmBatchUninstall}
      onCancel={() => setShowBatchUninstallConfirm(false)}
      type="danger"
    />

    {/* IPA Preview Dialog */}
    <IpaPreviewDialog
      filePath={ipaPreviewPath}
      onClose={() => setIpaPreviewPath(null)}
      onInstall={handleConfirmInstall}
    />
    </>
  );
}

