import React, { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { Folder, FileArchive, Trash2, Smartphone, RefreshCw, Loader2, ExternalLink, Check } from "lucide-react";
import { useAppStore, IpaFileInfo } from "../store/appStore";
import { DataTable, DataTableColumn } from "../components/DataTable";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { useTranslation } from "react-i18next";
import { useErrorStore } from "../store/errorStore";
import { useToastStore } from "../store/toastStore";
import { useDeviceStore } from "../store/deviceStore";
import { useDownloadStore } from "../store/downloadStore";
import { useMount, useUnmount, useMeasure, useDebounce, useTimeoutFn } from "react-use";
import { goServiceClient, DeviceInfo, TaskProgressEvent } from "../lib/goService";

export default function DownloadsPage() {
  const { t } = useTranslation();
  const [downloadDir, setDownloadDir] = useState("");
  const { downloadedIpas, setDownloadedIpas } = useAppStore();
  const { showError } = useErrorStore();
  const { showToast } = useToastStore();
  const { connectedDevices } = useDeviceStore();
  const { downloads, addDownload, updateDownload } = useDownloadStore();
  const [showDeviceSelect, setShowDeviceSelect] = useState(false);
  const [ipaToInstall, setIpaToInstall] = useState<IpaFileInfo | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshCompleted, setRefreshCompleted] = useState(false);
  const [selectedIpaIds, setSelectedIpaIds] = useState<Set<string>>(new Set());
  const fileWatcherUnlistenRef = useRef<UnlistenFn | null>(null);
  const [pathContainerRef, { width: pathContainerWidth }] = useMeasure<HTMLDivElement>();
  const [debouncedWidth, setDebouncedWidth] = useState(0);
  const hasInitializedWidth = useRef(false);
  
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
    loadDownloadedIpas();
    setupFileWatcher();
    setupDownloadTaskListener();
  });

  useUnmount(() => {
    if (fileWatcherUnlistenRef.current) {
      fileWatcherUnlistenRef.current();
    }
  });

  const setupFileWatcher = async () => {
    try {
      fileWatcherUnlistenRef.current = await listen("download-directory-changed", () => {
        loadDownloadedIpas();
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
          addDownload({
            bundleId: event.bundle_id || "",
            appName: event.data?.app_name || event.bundle_id || "",
            fileName: "",
            filePath: undefined,
          });
        }
        
        if (existingDownload) {
          updateDownload(event.task_id, {
            progress: event.progress,
            status: event.status === "completed" ? "completed" 
                  : event.status === "error" ? "failed"
                  : "downloading",
            error: event.status === "error" ? event.message : undefined,
            endTime: event.status === "completed" || event.status === "error" 
                    ? Date.now() : undefined,
          });

          if (event.status === "completed") {
            // Refresh file list when download completes
            setTimeout(() => loadDownloadedIpas(), 1000);
          }
        }
      }
    };

    goServiceClient.connectWebSocket(handleDownloadProgress as any);
  };

  const loadDownloadDirectory = async () => {
    try {
      const dir = await invoke<string>("get_download_directory");
      setDownloadDir(dir);
    } catch (error: any) {
      showError(t('downloads.loadDirectoryFailed'), error.toString());
    }
  };

  const loadDownloadedIpas = async (force = false) => {
    if (isRefreshing && !force) return;
    
    try {
      setIsRefreshing(true);
      
      const ipas = await invoke<IpaFileInfo[]>("get_downloaded_ipas");
      
      const currentFingerprint = ipas.map(ipa => `${ipa.name}:${ipa.size}`).sort().join('|');
      const existingFingerprint = downloadedIpas.map(ipa => `${ipa.name}:${ipa.size}`).sort().join('|');
      
      if (currentFingerprint === existingFingerprint && !force) {
        return;
      }
      
      // Parse each IPA file using Go service
      const { goServiceClient } = await import("../lib/goService");
      
      // Create a cache of existing parsed data
      const existingCache = new Map(
        downloadedIpas.map(ipa => [ipa.path, ipa])
      );
      
      const enrichedIpas = await Promise.all(
        ipas.map(async (ipa) => {
          const cached = existingCache.get(ipa.path);
          if (cached && cached.app_name && cached.icon_base64 && !force) {
            return cached;
          }
          
          // Parse new file
          try {
            const ipaInfo = await goServiceClient.parseIPA(ipa.path);
            return {
              ...ipa,
              app_name: ipaInfo.name,
              bundle_id: ipaInfo.bundle_id,
              version: ipaInfo.version,
              icon_base64: ipaInfo.icon_base64,
              minimum_os_version: ipaInfo.minimum_os_version,
            };
          } catch (error) {
            // If parsing fails, use file name as fallback
            return {
              ...ipa,
              app_name: ipa.name.replace('.ipa', ''),
              bundle_id: 'Unknown',
              version: 'Unknown',
            };
          }
        })
      );
      
      setDownloadedIpas(enrichedIpas);
    } catch (error: any) {
      showError(t('downloads.loadFilesFailed'), error.toString());
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
      await loadDownloadedIpas(true);
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
        
        await setupFileWatcher();
        
        loadDownloadedIpas();
      }
    } catch (error: any) {
      showError(t('downloads.changeDirectoryFailed'), error.toString());
    }
  };

  const handleOpenFolder = async () => {
    try {
      // Ensure directory exists before opening
      await invoke("set_download_directory", { path: downloadDir });
      await openShell(downloadDir);
    } catch (error: any) {
      showError(t('downloads.openFolderFailed'), error.toString());
    }
  };

  const handleDeleteClick = async (ipa: IpaFileInfo) => {
    try {
      await invoke("delete_ipa", { path: ipa.path });
    } catch (error: any) {
      showError(t('downloads.deleteFailed'), error.toString());
    }
  };

  const handleInstallClick = (ipa: IpaFileInfo) => {
    if (connectedDevices.length === 0) {
      showError(t('downloads.noDevices'), t('downloads.connectDevice'));
      return;
    }
    setIpaToInstall(ipa);
    setShowDeviceSelect(true);
  };

  const handleInstallToDevice = async (device: DeviceInfo) => {
    if (!ipaToInstall) return;

    try {
      const fileName = ipaToInstall.app_name || ipaToInstall.name;
      showToast(t("devices.installingFile", { name: fileName }), "info");
      
      const response = await goServiceClient.installApp(
        device.udid,
        ipaToInstall.path,
        ipaToInstall.bundle_id !== 'Unknown' ? ipaToInstall.bundle_id : undefined,
        ipaToInstall.version !== 'Unknown' ? ipaToInstall.version : undefined
      );
      
      console.log("Install task started:", response);
      setShowDeviceSelect(false);
      setIpaToInstall(null);
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

  const columns: DataTableColumn<IpaFileInfo>[] = [
    {
      key: 'fileName',
      header: t('downloads.fileName'),
      width: 'minmax(80px, 1fr)',
      align: 'left',
      render: (ipa) => {
        return (
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 shadow-sm">
              {ipa.icon_base64 ? (
                <img
                  src={`data:image/png;base64,${ipa.icon_base64}`}
                  alt={ipa.app_name || ipa.name}
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
                {ipa.app_name || ipa.name.replace('.ipa', '')}
              </p>
              <p className="text-xs truncate mt-0.5 text-gray-500">
                {ipa.name}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      key: 'minimumIosVersion',
      header: t('downloads.minimumIosVersion'),
      width: 'minmax(80px, 120px)',
      align: 'center',
      render: (ipa) => (
        <span className="text-sm text-gray-600">
          {ipa.minimum_os_version || '-'}
        </span>
      ),
    },
    {
      key: 'fileSize',
      header: t('common.fileSize'),
      width: 'minmax(70px, 100px)',
      align: 'center',
      render: (ipa) => (
        <span className="text-sm text-gray-600">
          {formatFileSize(ipa.size)}
        </span>
      ),
    },
    {
      key: 'signatureStatus',
      header: t('downloads.signatureStatus'),
      width: 'minmax(70px, 100px)',
      align: 'center',
      render: () => (
        <span className="text-sm text-gray-400">-</span>
      ),
    },
    {
      key: 'actions',
      header: t('common.actions'),
      width: 'minmax(90px, 120px)',
      align: 'right',
      render: (ipa) => {
        return (
          <div className="flex justify-end space-x-2">
            <button
              onClick={() => handleInstallClick(ipa)}
              className="px-4 py-1.5 text-sm font-medium rounded transition-colors whitespace-nowrap text-primary-600 bg-white border border-primary-600 hover:bg-primary-50"
            >
              {t('downloads.install')}
            </button>
            <button
              onClick={() => handleDeleteClick(ipa)}
              className="px-4 py-1.5 text-sm font-medium rounded transition-colors whitespace-nowrap text-red-600 bg-white border border-red-600 hover:bg-red-50"
            >
              {t('downloads.delete')}
            </button>
          </div>
        );
      },
    },
  ];

  const handleSelectIpa = (path: string) => {
    const newSelected = new Set(selectedIpaIds);
    if (newSelected.has(path)) {
      newSelected.delete(path);
    } else {
      newSelected.add(path);
    }
    setSelectedIpaIds(newSelected);
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
    handleSelectIpa(path);
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">{t('downloads.title')}</h2>
        <p className="text-gray-500">{t('downloads.subtitle')}</p>
      </div>

      <div className="bg-white rounded-lg p-6 border border-gray-200 mb-6 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3 flex-1 min-w-0">
            <Folder className="text-primary-600 flex-shrink-0" size={24} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-700">{t('downloads.currentDirectory')}</p>
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
              <span>{t('downloads.openDirectory')}</span>
            </button>
            <button
              onClick={handleChangeDirectory}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors whitespace-nowrap"
            >
              {t('downloads.setDirectory')}
            </button>
          </div>
        </div>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h3 className="text-xl font-bold text-gray-900">
            {t('downloads.title')}
          </h3>
          <span className="text-sm text-gray-500">
            {downloadedIpas.length} {t('common.files', { count: downloadedIpas.length })}
          </span>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-2 text-primary-600 hover:bg-primary-50 rounded-lg transition-colors disabled:opacity-50"
          title={t('downloads.refresh')}
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

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">

        {downloads.length === 0 && downloadedIpas.length === 0 ? (
          <div className="p-12 text-center">
            <FileArchive className="mx-auto text-gray-300 mb-4" size={60} />
            <p className="text-gray-500">{t('downloads.noFiles')}</p>
            <p className="text-gray-400 text-sm mt-2">{t('downloads.downloadSome')}</p>
          </div>
        ) : (
          <div>
            {/* Active Downloads */}
            {downloads.filter(d => d.status === "downloading").map((download) => (
              <div
                key={download.id}
                className="p-4 bg-blue-50 transition-colors"
              >
                <div className="flex items-center justify-between gap-4">
                  {/* App Icon */}
                  <div className="flex-shrink-0">
                    <div className="w-14 h-14 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center text-white">
                      <Loader2 className="animate-spin" size={28} />
                    </div>
                  </div>

                  {/* App Info */}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900 text-base">
                      {download.appName}
                    </h4>
                    <p className="text-sm text-blue-600 mt-0.5">
                      {t('downloads.downloading')}...
                    </p>
                  </div>

                  {/* Action Buttons - disabled during download */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      disabled
                      className="px-4 py-2 text-gray-400 bg-white border border-gray-300 rounded-lg cursor-not-allowed text-sm font-medium flex items-center gap-2"
                    >
                      <Smartphone size={16} />
                      <span>{t('downloads.install')}</span>
                    </button>
                    <button
                      className="px-4 py-2 text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium flex items-center gap-2"
                    >
                      <Trash2 size={16} />
                      <span>{t('common.cancel')}</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Completed/Failed Downloads (recent first) */}
            {downloads.filter(d => d.status !== "downloading").slice(0, 3).map((download) => (
              <div
                key={download.id}
                className={`p-4 transition-colors ${
                  download.status === "failed" ? "bg-red-50" : "bg-green-50"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-shrink-0">
                    <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-white ${
                      download.status === "failed" 
                        ? "bg-gradient-to-br from-red-400 to-red-600"
                        : "bg-gradient-to-br from-green-400 to-green-600"
                    }`}>
                      <FileArchive size={28} />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-gray-900 text-base">
                      {download.appName}
                    </h4>
                    <p className={`text-sm mt-0.5 ${
                      download.status === "failed" ? "text-red-600" : "text-green-600"
                    }`}>
                      {download.status === "failed" 
                        ? t('downloads.failed') 
                        : t('downloads.completed')}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            <DataTable<IpaFileInfo>
              data={downloadedIpas}
              columns={columns}
              keyExtractor={(ipa) => ipa.path}
              selectedIds={selectedIpaIds}
              onSelect={handleSelectIpa}
              onSelectAll={handleSelectAll}
              onRowClick={(ipa, e) => handleRowClick(e, ipa.path)}
              selectable={true}
              rowHeight="large"
              emptyState={null}
              removeAnimationDuration={300}
            />
          </div>
        )}
      </div>

      {/* Device Selection Dialog */}
      {showDeviceSelect && ipaToInstall && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {t('downloads.selectDevice')}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {t('downloads.selectDeviceForInstall', { name: ipaToInstall.app_name || ipaToInstall.name })}
            </p>
            <div className="space-y-2 max-h-96 overflow-y-auto mb-4">
              {connectedDevices.map((device) => (
                <button
                  key={device.udid}
                  onClick={() => handleInstallToDevice(device)}
                  className="w-full p-3 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="font-medium text-gray-900">{device.name}</div>
                  <div className="text-sm text-gray-500">{device.model} - iOS {device.version}</div>
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setShowDeviceSelect(false);
                setIpaToInstall(null);
              }}
              className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

