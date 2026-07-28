import React, { useState, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { Folder, FileArchive, RefreshCw, Loader2, ExternalLink, Check, Trash2, Upload, ShieldCheck, FileEdit } from "lucide-react";
import { useIpaStore, selectBySource, type IpaMeta } from "../store/ipaStore";
import { DataTable, DataTableColumn } from "../components/DataTable";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { useTranslation } from "react-i18next";
import { useErrorStore } from "../store/errorStore";
import { useToastStore } from "../store/toastStore";
import { useDownloadStore } from "../store/downloadStore";
import { useMount, useUnmount, useMeasure, useDebounce, useTimeoutFn, useClickAway } from "react-use";
import { goServiceClient, TaskProgressEvent } from "../lib/goService";
import InstallingAppsBlock from "../components/InstallingAppsBlock";
import IpaPreviewDialog from "../components/IpaPreviewDialog";
import IpaSignDialog from "../components/IpaSignDialog";
import { useInstallStore } from "../store/installStore";
import ConfirmDialog from "../components/ConfirmDialog";
import Button3D from "../components/Button3D";
import SignatureStatusBadge from "../components/SignatureStatusBadge";
import { useDropZone } from "../hooks/useDropZone";
import { isTauriRuntime } from "../lib/runtime";

export default function AppLibraryPage() {
  const { t } = useTranslation();
  const location = useLocation() as any;
  const navigate = useNavigate();
  const [downloadDir, setDownloadDir] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const nativeMetas = useIpaStore(selectBySource("native"));
  const signedMetas = useIpaStore(selectBySource("signed"));
  const downloadedIpas = [...nativeMetas, ...signedMetas].sort((a, b) => a.name.localeCompare(b.name));
  const upsertMany = useIpaStore(s => s.upsertMany);
  const indexNativeFromBackend = useIpaStore(s => s.indexNativeFromBackend);
  const markDownloaded = useIpaStore(s => s.markDownloaded);
  const { showError } = useErrorStore();
  const { showToast } = useToastStore();
  const { downloads, updateDownload, removeDownload } = useDownloadStore();

  // Control downloads section visibility with animation
  useEffect(() => {
    if (downloads.length > 0) {
      setShowDownloads(true);
    } else {
      // Delay hiding to allow fade-out animation
      const timer = setTimeout(() => {
        setShowDownloads(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [downloads.length]);

  // Auto-remove cancelled tasks after a short delay with fade-out animation
  useEffect(() => {
    const cancelledTasks = downloads.filter(d => d.status === 'cancelled');
    if (cancelledTasks.length > 0) {
      const timers = cancelledTasks.map(task => {
        // Start fade-out immediately
        setTimeout(() => {
          setFadingOutTasks(prev => new Set(prev).add(task.id));
        }, 100);
        
        // Remove after animation completes
        return setTimeout(() => {
          removeDownload(task.id);
          setFadingOutTasks(prev => {
            const next = new Set(prev);
            next.delete(task.id);
            return next;
          });
        }, 800); // Total time: 100ms delay + 700ms fade-out
      });
      return () => timers.forEach(timer => clearTimeout(timer));
    }
  }, [downloads, removeDownload]);
  const { startInstall } = useInstallStore();
  const [ipaPreviewPath, setIpaPreviewPath] = useState<string | null>(null);
  const [ipaPreviewSize, setIpaPreviewSize] = useState<number>(0);
  const [ipaSignPath, setIpaSignPath] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshCompleted, setRefreshCompleted] = useState(false);
  const [selectedIpaIds, setSelectedIpaIds] = useState<Set<string>>(new Set());
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [contextMenuPath, setContextMenuPath] = useState<string | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const fileWatcherUnlistenRef = useRef<UnlistenFn | null>(null);
  const [pathContainerRef, { width: pathContainerWidth }] = useMeasure<HTMLDivElement>();
  const [debouncedWidth, setDebouncedWidth] = useState(0);
  const hasInitializedWidth = useRef(false);
  const [disableTableAnimation, setDisableTableAnimation] = useState(false);
  const previousDownloadDirRef = useRef<string>(downloadDir);
  const [fadingOutTasks, setFadingOutTasks] = useState<Set<string>>(new Set());
  const [showDownloads, setShowDownloads] = useState(false);
  const clearableDownloads = downloads.filter(
    (download) => download.status === "completed" || download.status === "failed"
  );
  
  const [, , resetRefreshCompleted] = useTimeoutFn(() => {
    setRefreshCompleted(false);
  }, 1000);

  useEffect(() => {
    if (pathContainerWidth > 0 && !hasInitializedWidth.current) {
      setDebouncedWidth(pathContainerWidth);
      hasInitializedWidth.current = true;
    }
  }, [pathContainerWidth]);
  
  useDebounce(
    () => {
      if (pathContainerWidth > 0 && hasInitializedWidth.current) {
        setDebouncedWidth(pathContainerWidth);
      }
    },
    150,
    [pathContainerWidth]
  );

  useMount(() => {
    loadDownloadDirectory();
    refreshDownloadedIpas();
    setupFileWatcher();
    setupDownloadTaskListener();
    if (location?.state?.openPreviewPath) {
      setIpaPreviewPath(location.state.openPreviewPath);
      history.replaceState({}, document.title);
    }
  });

  useUnmount(() => {
    if (fileWatcherUnlistenRef.current) {
      fileWatcherUnlistenRef.current();
    }
  });

  const importIpaFiles = async (paths: string[]) => {
    if (!isTauriRuntime()) {
      showToast("Import is available in the desktop app.", "error");
      return;
    }

    const ipaFiles = paths.filter(path => {
      const lower = path.toLowerCase();
      return lower.endsWith(".ipa") || lower.endsWith(".tipa");
    });

    if (ipaFiles.length === 0) {
      showToast(t("devices.dropIpaOnly"), "error");
      return;
    }

    try {
      setIsImporting(true);
      await invoke("import_ipa_files", { paths: ipaFiles });
      await refreshDownloadedIpas(true);
      showToast(t("library.importSuccess", { count: ipaFiles.length }), "success");
    } catch (error: any) {
      showError(t("library.importFailed"), error.toString());
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportClick = async () => {
    if (!isTauriRuntime()) {
      showToast("Import is available in the desktop app.", "error");
      return;
    }

    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "IPA Files",
            extensions: ["ipa", "tipa"],
          },
        ],
      });

      if (!selected) {
        return;
      }

      const paths = Array.isArray(selected) ? selected : [selected];
      await importIpaFiles(paths);
    } catch (error: any) {
      showError(t("library.importFailed"), error.toString());
    }
  };

  const { ref: dropZoneRef, isDragging } = useDropZone({
    onDrop: importIpaFiles,
    enabled: true,
  });

  const setupFileWatcher = async () => {
    if (!isTauriRuntime()) {
      return;
    }

    try {
      fileWatcherUnlistenRef.current = await listen("download-directory-changed", () => {
        refreshDownloadedIpas(true);
      });
    } catch (error) {
      console.error("Failed to setup file watcher:", error);
    }
  };

  const setupDownloadTaskListener = () => {
    const handleDownloadProgress = (event: TaskProgressEvent) => {
      if (event.task_type === "download") {
        const existingDownload = downloads.find(d => d.id === event.task_id);
        
        if (!existingDownload && event.status === "started") {
          // addDownload({
          //   id: event.task_id,
          //   bundleId: event.data?.bundle_id || "",
          //   appName: event.data?.app_name || event.data?.bundle_id || "",
          //   fileName: "",
          //   filePath: event.data?.file_path,
          // });
        }
        
        if (existingDownload) {
          const mappedStatus = event.status === "completed"
            ? "completed"
            : event.status === "error"
              ? "failed"
              : event.status === "cancelled"
                ? "cancelled"
                : existingDownload.status;

          updateDownload(event.task_id, {
            progress: event.progress,
            status: mappedStatus,
            error: event.status === "error" ? event.message : undefined,
            endTime: mappedStatus === "completed" || mappedStatus === "failed" || mappedStatus === "cancelled"
              ? Date.now()
              : existingDownload.endTime,
          });
        }

        // Handle completed downloads (even if not in downloadStore)
        if (event.status === "completed") {
          const filePath = event.data?.file_path;
          if (filePath) {
            markDownloaded(filePath, {
              bundleId: event.data?.bundle_id,
              appName: event.data?.app_name,
              version: (event.data as any)?.version,
            }).catch(() => {});
            
            // Only refresh the single downloaded file's metadata - DO NOT call refreshDownloadedIpas
            setTimeout(async () => {
              try {
                const fileStats = isTauriRuntime()
                  ? await invoke<{ size: number }>('get_file_stats', { path: filePath })
                  : null;
                const fileSize = fileStats?.size || 0;
                
                const ipaInfo = await goServiceClient.parseIPA(filePath);
                upsertMany([{
                  path: filePath,
                  name: filePath.split(/[\\/]/).pop()!,
                  size: fileSize,
                  source: 'native',
                  appName: ipaInfo.name,
                  bundleId: ipaInfo.bundle_id,
                  version: ipaInfo.version,
                  iconBase64: ipaInfo.icon_base64,
                  minimumOsVersion: ipaInfo.minimum_os_version,
                  certificateStatus: ipaInfo.certificate_status,
                  signerName: ipaInfo.signer_name,
                  signerIdentity: ipaInfo.signer_identity,
                  organization: ipaInfo.organization,
                  teamId: ipaInfo.team_id,
                  purchaserEmail: ipaInfo.purchaser_email,
                  isEncrypted: ipaInfo.is_encrypted,
                  download_date: new Date().toISOString(),
                } as any]);
              } catch (error) {
                console.error('Failed to parse downloaded IPA:', error);
              }
            }, 500);
          }
        }
      }

      if ((event.task_type === "sign" || event.task_type === "export") && event.status === "completed") {
        const signedPath = event.data?.file_path;
        if (typeof signedPath === "string" && signedPath) {
          if (event.task_type === "sign") {
            showToast(t("library.signSuccess"), "success");
          }
          refreshDownloadedIpas(true).catch(() => {});
        }
      }

      if (event.task_type === "sign" && event.status === "error") {
        showError(t("library.signFailed"), event.message || "Sign failed");
      }
    };

    goServiceClient.connectWebSocket(handleDownloadProgress as any);
  };

  const loadDownloadDirectory = async () => {
    if (!isTauriRuntime()) {
      setDownloadDir("~/Downloads/iPAGet");
      return;
    }

    try {
      const dir = await invoke<string>("get_download_directory");
      setDownloadDir(dir);
    } catch (error: any) {
      showError(t('library.loadFilesFailed'), error.toString());
    }
  };

  const refreshDownloadedIpas = async (force = false) => {
    if (isRefreshing && !force) return;
    
    try {
      setIsRefreshing(true);
      // Index from backend (paths, sizes); adds/updates store with source=downloaded
      await indexNativeFromBackend();
      
      // Get the latest data from store after indexing
      const state = useIpaStore.getState();
      const latestMetas = [
        ...state.pathsBySource.native,
        ...state.pathsBySource.signed,
      ]
        .map(p => state.byPath[p])
        .filter(Boolean);
      
      // Enrich metadata via Go service for icon/name/etc. (in parallel)
      const { goServiceClient } = await import("../lib/goService");
      const parsePromises = latestMetas.map(async (m) => {
        // Skip if already enriched unless forcing
        if (m.appName && m.iconBase64 && !force) return;
        try {
          const ipaInfo = await goServiceClient.parseIPA(m.path);
          upsertMany([{
            ...m,
            size: Number(ipaInfo.file_size || m.size || 0),
            appName: ipaInfo.name,
            bundleId: ipaInfo.bundle_id,
            version: ipaInfo.version,
            iconBase64: ipaInfo.icon_base64,
            minimumOsVersion: ipaInfo.minimum_os_version,
            certificateStatus: ipaInfo.certificate_status,
            signerName: ipaInfo.signer_name,
            signerIdentity: ipaInfo.signer_identity,
            organization: ipaInfo.organization,
            teamId: ipaInfo.team_id,
            purchaserEmail: ipaInfo.purchaser_email,
            isEncrypted: ipaInfo.is_encrypted,
          }]);
        } catch (error) {
          upsertMany([{
            ...m,
            appName: m.appName || m.name.replace('.ipa', ''),
            bundleId: m.bundleId || 'Unknown',
            version: m.version || 'Unknown',
          }]);
        }
      });
      await Promise.allSettled(parsePromises);
    } catch (error: any) {
      showError(t('library.loadFilesFailed'), error.toString());
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    if (refreshCompleted) {
      resetRefreshCompleted();
    }
    
    setIsRefreshing(true);
    setRefreshCompleted(false);
    try {
      await refreshDownloadedIpas(true);
      setRefreshCompleted(true);
      resetRefreshCompleted();
    } catch (error) {
      console.error("Failed to refresh downloads:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const truncateDirectoryPath = (path: string, containerWidth: number): string => {
    if (containerWidth === 0) return path;
    
    const avgCharWidth = 7;
    const maxLength = Math.floor(containerWidth / avgCharWidth);
    
    if (maxLength <= 0) return path;
    if (path.length <= maxLength) return path;

    const separator = path.includes('\\') ? '\\' : '/';
    const parts = path.split(separator);
    
    if (parts.length <= 1) {
      if (path.length > maxLength) {
        return '...' + path.slice(-(maxLength - 3));
      }
      return path;
    }

    const firstPart = parts[0];
    
    for (let keepCount = parts.length - 1; keepCount >= 1; keepCount--) {
      const tailParts = parts.slice(-keepCount);
      const result = `${firstPart}${separator}...${separator}${tailParts.join(separator)}`;
      
      if (result.length <= maxLength) {
        return result;
      }
    }
    
    const lastPart = parts[parts.length - 1];
    let result = `...${separator}${lastPart}`;
    if (result.length <= maxLength) {
      return result;
    }
    
    if (lastPart.length > maxLength - 3) {
      return '...' + lastPart.slice(-(maxLength - 3));
    }
    
    return result;
  };

  const handleChangeDirectory = async () => {
    if (!isTauriRuntime()) {
      showToast("Changing the download folder is available in the desktop app.", "error");
      return;
    }

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: downloadDir,
      });

      if (selected && typeof selected === "string") {
        if (fileWatcherUnlistenRef.current) {
          fileWatcherUnlistenRef.current();
        }
        
        await invoke("set_download_directory", { path: selected });
        setDownloadDir(selected);
        previousDownloadDirRef.current = selected;
        
        setDisableTableAnimation(true);
        
        await setupFileWatcher();
        
        refreshDownloadedIpas();
        
        setTimeout(() => {
          setDisableTableAnimation(false);
        }, 50);
      }
    } catch (error: any) {
      showError(t('common.changeDirectoryFailed'), error.toString());
    }
  };

  const handleOpenFolder = async () => {
    if (!isTauriRuntime()) {
      showToast("Opening the download folder is available in the desktop app.", "error");
      return;
    }

    try {
      // Ensure directory exists before opening
      await invoke("set_download_directory", { path: downloadDir });
      await openShell(downloadDir);
    } catch (error: any) {
      showError(t('common.openFolderFailed'), error.toString());
    }
  };

  const handleDeleteClick = async (ipa: { path: string }) => {
    if (!isTauriRuntime()) {
      showToast("Deleting files is available in the desktop app.", "error");
      return;
    }

    try {
      await invoke("delete_ipa", { path: ipa.path });
      
      await refreshDownloadedIpas();
      
      // Clear selection if the deleted file was the only one selected
      setSelectedIpaIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(ipa.path);
        // Clear all if nothing remains valid
        const state = useIpaStore.getState();
        const validPaths = new Set(state.pathsBySource.native);
        for (const path of newSet) {
          if (!validPaths.has(path)) {
            newSet.delete(path);
          }
        }
        return newSet;
      });
      
      showToast(t('downloads.deleteSuccess'), 'success');
    } catch (error: any) {
      showError(t('common.deleteFailed'), error.toString());
    }
  };

  const handleBatchDelete = async () => {
    if (!isTauriRuntime()) {
      showToast("Deleting files is available in the desktop app.", "error");
      setShowBatchDeleteConfirm(false);
      return;
    }

    try {
      const pathsToDelete = Array.from(selectedIpaIds);
      for (const path of pathsToDelete) {
        await invoke("delete_ipa", { path });
      }
      await refreshDownloadedIpas();
      // Clear all selections after batch delete
      setSelectedIpaIds(new Set());
      showToast(t('downloads.deleteSuccess'), 'success');
    } catch (error: any) {
      showError(t('downloads.deleteFailed'), error.toString());
    } finally {
      setShowBatchDeleteConfirm(false);
    }
  };

  const handleBatchInstall = () => {
    if (selectedIpaIds.size === 0) return;
    const firstPath = Array.from(selectedIpaIds)[0];
    setIpaPreviewPath(firstPath);
  };

  const handleContextMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setContextMenuPath(path);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => {
    setContextMenuPath(null);
    setContextMenuPosition(null);
  };

  const handleContextMenuInstall = () => {
    if (contextMenuPath) {
      setIpaPreviewPath(contextMenuPath);
      const meta = useIpaStore.getState().byPath[contextMenuPath];
      setIpaPreviewSize(Number(meta?.size || 0));
    }
    closeContextMenu();
  };

  const handleContextMenuDelete = async () => {
    if (!isTauriRuntime()) {
      showToast("Deleting files is available in the desktop app.", "error");
      closeContextMenu();
      return;
    }

    if (contextMenuPath) {
      try {
        await invoke("delete_ipa", { path: contextMenuPath });
        await refreshDownloadedIpas();
        showToast(t('downloads.deleteSuccess'), 'success');
      } catch (error: any) {
        showError(t('downloads.deleteFailed'), error.toString());
      }
    }
    closeContextMenu();
  };

  const handleContextMenuSign = () => {
    if (contextMenuPath) {
      setIpaSignPath(contextMenuPath);
    }
    closeContextMenu();
  };

  const handleContextMenuShowInFolder = async () => {
    if (!isTauriRuntime()) {
      showToast("Showing files is available in the desktop app.", "error");
      closeContextMenu();
      return;
    }

    if (!contextMenuPath) {
      return;
    }

    try {
      await invoke("show_in_folder", { path: contextMenuPath });
    } catch (error: any) {
      showError(t("common.error"), error.toString());
    } finally {
      closeContextMenu();
    }
  };

  useClickAway(contextMenuRef, () => {
    if (contextMenuPosition) {
      closeContextMenu();
    }
  });

  const handleInstallClick = (ipa: { path: string; fileSize?: number; size?: number }) => {
    setIpaPreviewPath(ipa.path);
    setIpaPreviewSize(Number(ipa.fileSize || ipa.size || 0));
  };

  const handleEditClick = (ipa: { path: string }) => {
    navigate("/editor", { state: { ipaPath: ipa.path } });
  };

  const handleConfirmInstall = async (filePath: string, deviceUdid: string, certificateId?: string | null) => {
    try {
      const fileName = filePath.split(/[/\\]/).pop() || filePath;
      showToast(t("devices.installingFile", { name: fileName }), "info");
      await startInstall(deviceUdid, filePath, undefined, undefined, undefined, certificateId);
    } catch (error: any) {
      showError(t("devices.installIpaFailed"), error.toString());
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  type IpaRow = {
    path: string;
    fileName: string;
    fileSize: number;
    bundleId: string;
    version: string;
    appName: string;
    iconBase64?: string;
    minimumOsVersion?: string;
    certificateStatus?: string;
    signerName?: string;
    signerIdentity?: string;
    organization?: string;
    teamId?: string;
    purchaserEmail?: string;
    isEncrypted?: boolean;
  };

  const toRows = (metas: IpaMeta[]): IpaRow[] =>
    metas.map(m => ({
      path: m.path,
      fileName: m.name,
      fileSize: m.size,
      bundleId: m.bundleId || 'Unknown',
      version: m.version || 'Unknown',
      appName: m.appName || m.name.replace('.ipa', ''),
      iconBase64: m.iconBase64,
      minimumOsVersion: m.minimumOsVersion,
      certificateStatus: m.certificateStatus,
      signerName: m.signerName,
      signerIdentity: m.signerIdentity,
      organization: m.organization,
      teamId: m.teamId,
      purchaserEmail: m.purchaserEmail,
      isEncrypted: m.isEncrypted,
    }));

  const columns: DataTableColumn<IpaRow>[] = [
    {
      key: 'fileName',
      header: t('library.fileName'),
      width: 'minmax(80px, 1fr)',
      align: 'left',
      minWidth: 140,
      scalePriority: true,
      render: (ipa) => {
        return (
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 shadow-sm">
              {ipa.iconBase64 ? (
                <img
                  src={`data:image/png;base64,${ipa.iconBase64}`}
                  alt={ipa.appName || ipa.fileName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary-400 to-primary-600">
                  <FileArchive className="text-white" size={20} />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate leading-tight text-gray-900">
                {ipa.appName}
              </p>
              <p className="text-xs truncate mt-0.5 text-gray-500">
                {ipa.fileName}
              </p>
            </div>
          </div>
          
        );
      },
    },
    {
      key: 'version',
      header: t('common.version'),
      width: 'minmax(80px, 120px)',
      align: 'center',
      minWidth: 100,
      render: (ipa) => (
        <span className="text-sm text-gray-600">
          {ipa.version || '-'}
        </span>
      ),
    },
    {
      key: 'fileSize',
      header: t('common.fileSize'),
      width: 'minmax(70px, 100px)',
      align: 'center',
      minWidth: 110,
      render: (ipa) => (
        <span className="text-sm text-gray-600">
          {formatFileSize(ipa.fileSize)}
        </span>
      ),
    },
    {
      key: 'signatureStatus',
      header: t('library.signatureStatus'),
      width: 'minmax(140px, 180px)',
      align: 'center',
      minWidth: 140,
      render: (ipa) => (
        <div className="flex justify-center">
          <SignatureStatusBadge info={ipa} />
        </div>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      width: 'minmax(250px, max-content)',
      align: 'center',
      minWidth: 250,
      render: (ipa) => {
        return (
          <div className="flex justify-center space-x-2">
            <Button3D
              variant="secondary"
              size="md"
              onClick={() => handleEditClick(ipa)}
            >
              {t('library.actions.edit')}
            </Button3D>
            <Button3D
              variant="secondary"
              size="md"
              onClick={() => handleInstallClick(ipa)}
            >
              {t('library.actions.install')}
            </Button3D>
            <Button3D
              variant="danger"
              size="md"
              onClick={() => handleDeleteClick(ipa)}
            >
              {t('library.actions.delete')}
            </Button3D>
          </div>
        );
      },
    },
  ];

  const handleSelectIpa = (path: string, ctrlKey: boolean = false) => {
    if (ctrlKey) {
      // Ctrl pressed: toggle selection (multi-select)
      const newSelected = new Set(selectedIpaIds);
      if (newSelected.has(path)) {
        newSelected.delete(path);
      } else {
        newSelected.add(path);
      }
      setSelectedIpaIds(newSelected);
    } else {
      // No Ctrl: single selection (replace all)
      if (selectedIpaIds.has(path) && selectedIpaIds.size === 1) {
        // Clicking already selected item: deselect
        setSelectedIpaIds(new Set());
      } else {
        // Select only this item
        setSelectedIpaIds(new Set([path]));
      }
    }
  };

  const handleSelectAll = () => {
    if (selectedIpaIds.size === downloadedIpas.length) {
      setSelectedIpaIds(new Set());
    } else {
      setSelectedIpaIds(new Set(downloadedIpas.map(ipa => ipa.path)));
    }
  };

  const handleRowClick = (e: React.MouseEvent, path: string) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input[type="checkbox"]')) {
      return;
    }
    handleSelectIpa(path, e.ctrlKey || e.metaKey);
  };

  

  return (
    <div className="h-full overflow-auto scrollbar-thin p-8">
      <div ref={dropZoneRef} className="max-w-7xl mx-auto relative">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">{t('library.title')}</h2>
            <p className="text-gray-500">{t('library.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg p-6 border border-gray-200 mb-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3 flex-1 min-w-0">
            <Folder className="text-primary-600 flex-shrink-0" size={24} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-700">{t('library.currentDirectory')}</p>
              <div ref={pathContainerRef} className="text-sm text-gray-500 mt-1 whitespace-nowrap overflow-hidden" title={downloadDir}>
                {truncateDirectoryPath(downloadDir, debouncedWidth)}
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-2 flex-shrink-0">
            <button
              onClick={handleOpenFolder}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center space-x-2 whitespace-nowrap"
            >
              <ExternalLink size={16} />
              <span>{t('library.openDir')}</span>
            </button>
            <button
              onClick={handleChangeDirectory}
              className="px-4 py-2 bg-primary-100 text-primary-700 rounded-lg hover:bg-primary-200 transition-colors whitespace-nowrap"
            >
              {t('library.changeDir')}
            </button>
          </div>
        </div>
      </div>

      {showDownloads && (
        <div 
          className={`mb-3 flex items-center justify-between transition-all duration-300 ease-in-out ${
            downloads.length === 0 ? 'opacity-0 max-h-0 overflow-hidden' : 'opacity-100 max-h-20'
          }`}
        >
          <div className="flex items-center space-x-3">
            <h3 className="text-xl font-bold text-gray-900">
              {t('library.downloading')}
            </h3>
            <span className="text-sm text-gray-500">
              {t('common.files', { count: downloads.length })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => clearableDownloads.forEach((download) => removeDownload(download.id))}
              disabled={clearableDownloads.length === 0}
              className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors disabled:opacity-50 disabled:text-gray-400 disabled:hover:bg-transparent"
              title="清空已完成和失败项"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      )}

      {showDownloads && (
        <div 
          className={`bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden mb-6 transition-all duration-500 ease-in-out ${
            downloads.length === 0 ? 'opacity-0 max-h-0 border-0 mb-0' : 'opacity-100'
          }`}
        >
          {downloads.filter(d => d.status === "downloading").map((download) => (
            <div key={download.id} className="relative px-4 py-3 transition-colors">
              <div
                className="absolute inset-y-0 left-0 bg-primary-50"
                style={{ width: `${Math.max(0, Math.min(100, download.progress || 0))}%` }}
              />
              <div className="relative flex items-center justify-between gap-4">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 shadow-sm">
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary-400 to-primary-600">
                      <Loader2 className="animate-spin text-white" size={20} />
                    </div>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 text-base truncate">
                    {download.appName}
                  </h4>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button3D
                    variant="secondary"
                    size="md"
                    onClick={async () => {
                      updateDownload(download.id, { status: 'cancelled', endTime: Date.now() });
                      try {
                        await goServiceClient.cancelTask(download.id);
                      } catch (err) {
                        console.error('Failed to cancel task:', err);
                      }
                    }}
                  >
                    {t('common.cancel')}
                  </Button3D>
                </div>
              </div>
            </div>
          ))}
          {downloads.filter(d => d.status === "cancelled").map((download) => (
            <div 
              key={download.id} 
              className={`relative px-4 py-3 bg-gray-100 border-t border-gray-200 transition-all duration-700 ease-in-out overflow-hidden ${
                fadingOutTasks.has(download.id) 
                  ? 'opacity-0 max-h-0 py-0 border-t-0' 
                  : 'opacity-60 max-h-24 py-3'
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-300 flex-shrink-0 shadow-sm flex items-center justify-center">
                    <span className="text-gray-600 text-lg">✕</span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-700 text-base truncate">
                    {download.appName}
                  </h4>
                  <p className="text-sm text-gray-500">{t('download.cancelled') || '已取消'}</p>
                </div>
              </div>
            </div>
          ))}
          {downloads.filter(d => d.status !== "downloading" && d.status !== "cancelled").map((download) => (
            <div
              key={download.id}
              className={`px-4 py-3 transition-colors ${
                download.status === "failed" ? "bg-red-50" : "bg-green-50"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-shrink-0">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white ${
                    download.status === "failed" 
                      ? "bg-gradient-to-br from-red-400 to-red-600"
                      : "bg-gradient-to-br from-green-400 to-green-600"
                  }`}>
                    <FileArchive size={20} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 text-base truncate">
                    {download.appName}
                  </h4>
                  <p className={`text-sm mt-0.5 ${
                    download.status === "failed" ? "text-red-600" : "text-green-600"
                  }`}>
                    {download.status === "failed" 
                      ? t('library.failed') 
                      : t('library.completed')}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {download.status === "completed" && (
                    <Button3D
                      variant="secondary"
                      size="md"
                      onClick={() => setIpaPreviewPath(download.filePath || "")}
                      disabled={!download.filePath}
                    >
                      {t('library.actions.install')}
                    </Button3D>
                  )}
                  <Button3D
                    variant="secondary"
                    size="md"
                    onClick={() => removeDownload(download.id)}
                  >
                    {t('common.confirm')}
                  </Button3D>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between" style={{ minHeight: '40px' }}>
        <div className="flex items-center space-x-3">
          <h3 className="text-xl font-bold text-gray-900">
            {t('library.downloaded')}
          </h3>
          <span className="text-sm text-gray-500">
            {t('common.files', { count: downloadedIpas.length })}
          </span>
          {selectedIpaIds.size > 0 && (
            <>
              <span className="text-sm text-gray-400">•</span>
              <span className="text-sm text-primary-600 font-medium">
                {t('downloads.selected')} {t('common.files', { count: selectedIpaIds.size })}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedIpaIds.size > 1 && (
            <>
              <button
                onClick={handleBatchInstall}
                className="px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors font-medium"
              >
                {t('downloads.batchInstall')}
              </button>
              <button
                onClick={() => setShowBatchDeleteConfirm(true)}
                className="px-4 py-2 bg-pink-50 text-red-600 hover:bg-pink-100 rounded-lg transition-colors font-medium"
              >
                {t('downloads.batchDelete')}
              </button>
            </>
          )}
          <button
            onClick={handleImportClick}
            disabled={isImporting}
            className="px-4 py-2 bg-primary-50 text-primary-700 hover:bg-primary-100 rounded-lg transition-colors font-medium flex items-center gap-2 disabled:opacity-50"
            title={t('common.import')}
          >
            {isImporting ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
            <span>{isImporting ? t('common.importing') : t('common.import')}</span>
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors disabled:opacity-50"
            title={t('library.refresh')}
          >
            <div className="relative w-5 h-5">
              <RefreshCw
                className={`absolute inset-0 transition-all duration-300 ${
                  isRefreshing ? 'animate-spin opacity-100' : refreshCompleted ? 'opacity-0 scale-0' : 'opacity-100 scale-100'
                }`}
                size={18}
              />
              <Check
                className={`absolute inset-0 transition-all duration-300 ${
                  refreshCompleted ? 'opacity-100 scale-100 text-green-600' : 'opacity-0 scale-0'
                }`}
                size={18}
              />
            </div>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">

        {downloadedIpas.length === 0 && downloads.length === 0 ? (
          <div className="p-8 text-center">
            <FileArchive className="mx-auto text-gray-300 mb-3" size={48} />
            <p className="text-gray-500">{t('library.noFiles')}</p>
            <p className="text-gray-400 text-sm mt-1.5">{t('library.importSome')}</p>
          </div>
        ) : (
          <DataTable<IpaRow>
            data={toRows([...nativeMetas]
              .sort((a, b) => {
                // Sort by modification/download date desc; fallback to name
                const ad = (a as any).download_date as string | undefined;
                const bd = (b as any).download_date as string | undefined;
                if (ad && bd) return new Date(bd).getTime() - new Date(ad).getTime();
                if (ad) return -1;
                if (bd) return 1;
                return b.name.localeCompare(a.name);
              })
            )}
            columns={columns}
            keyExtractor={(ipa) => ipa.path}
            selectedIds={selectedIpaIds}
            onSelect={handleSelectIpa}
            onSelectAll={handleSelectAll}
            onRowClick={(ipa, e) => handleRowClick(e, ipa.path)}
            onContextMenu={(ipa, e) => handleContextMenu(e, ipa.path)}
            selectable={true}
            rowHeight="large"
            emptyState={null}
            removeAnimationDuration={300}
            disableAnimation={disableTableAnimation}
          />
        )}
      </div>
      
      <InstallingAppsBlock title={t("library.installingApps")} />

      {/* IPA Preview Dialog */}
      <IpaPreviewDialog
        filePath={ipaPreviewPath}
        knownFileSize={ipaPreviewSize}
        onClose={() => {
          setIpaPreviewPath(null);
          setIpaPreviewSize(0);
        }}
        onInstall={handleConfirmInstall}
      />

      <IpaSignDialog
        filePath={ipaSignPath}
        onClose={() => setIpaSignPath(null)}
        onSigned={() => undefined}
      />

      {/* Batch Delete Confirm Dialog */}
      <ConfirmDialog
        isOpen={showBatchDeleteConfirm}
        title={t('downloads.batchDelete')}
        message={t('downloads.batchDeleteConfirm', { count: selectedIpaIds.size })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        onConfirm={handleBatchDelete}
        onCancel={() => setShowBatchDeleteConfirm(false)}
        type="danger"
      />

      {/* Context Menu */}
      {contextMenuPosition && contextMenuPath && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-1 min-w-[180px]"
          style={{
            left: `${contextMenuPosition.x}px`,
            top: `${contextMenuPosition.y}px`,
          }}
        >
          <button
            onClick={handleContextMenuInstall}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 transition-colors flex items-center space-x-2"
          >
            <Upload size={14} />
            <span>
              {t('library.actions.install')}
              {selectedIpaIds.has(contextMenuPath) && selectedIpaIds.size > 1 && ` (${t('common.file', { count: selectedIpaIds.size })})`}
            </span>
          </button>
          <button
            onClick={handleContextMenuSign}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 transition-colors flex items-center space-x-2"
          >
            <ShieldCheck size={14} />
            <span>{t('library.actions.sign')}</span>
          </button>
          <button
            onClick={() => {
              handleEditClick({ path: contextMenuPath });
              closeContextMenu();
            }}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 transition-colors flex items-center space-x-2"
          >
            <FileEdit size={14} />
            <span>{t('library.actions.edit')}</span>
          </button>
          <button
            onClick={handleContextMenuShowInFolder}
            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 transition-colors flex items-center space-x-2"
          >
            <ExternalLink size={14} />
            <span>{t('library.actions.showInFolder')}</span>
          </button>
          <div className="border-t border-gray-200"></div>
          <button
            onClick={handleContextMenuDelete}
            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center space-x-2"
          >
            <Trash2 size={14} />
            <span>
              {t('library.actions.delete')}
              {selectedIpaIds.has(contextMenuPath) && selectedIpaIds.size > 1 && ` (${t('common.file', { count: selectedIpaIds.size })})`}
            </span>
          </button>
        </div>
      )}

      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 pointer-events-none">
          <div className="bg-white rounded-xl p-8 shadow-2xl text-center">
            <Upload className="mx-auto text-primary-600 mb-4" size={80} />
            <h3 className="text-2xl font-bold text-gray-900 mb-2">
              {t('library.dropHere')}
            </h3>
            <p className="text-gray-500">{t('library.dropIpaFiles')}</p>
          </div>
        </div>
      )}
      </div>

      
    </div>
  );
}

