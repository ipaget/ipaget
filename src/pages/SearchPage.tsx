import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, Loader2, Package, Download, Info, Star, Globe } from "lucide-react";
import { useAppStore, AppInfo, VersionInfo } from "../store/appStore";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { useErrorStore } from "../store/errorStore";
import { useAuthStore } from "../store/authStore";
import DownloadToast from "../components/DownloadToast";
import { useMount, useUnmount } from "react-use";
import { goServiceClient, AppSearchResult, AppVersionHistory } from "../lib/goService";

interface DownloadState {
  bundleId: string;
  appName: string;
  progress: number;
  status: "downloading" | "completed" | "error";
  message?: string;
}

export default function SearchPage() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [downloadingApps, setDownloadingApps] = useState<Set<string>>(new Set());
  const [activeDownload, setActiveDownload] = useState<DownloadState | null>(null);
  const [countryCode, setCountryCode] = useState<string>("");
  const [appStoreResults, setAppStoreResults] = useState<AppSearchResult[]>([]);
  const [selectedStoreApp, setSelectedStoreApp] = useState<AppSearchResult | null>(null);
  const [versionHistory, setVersionHistory] = useState<AppVersionHistory | null>(null);

  const {
    searchResults,
    selectedApp,
    appVersions,
    setSearchResults,
    setSelectedApp,
    setAppVersions,
  } = useAppStore();

  const { showError } = useErrorStore();
  const { accountInfo, isAuthenticated, setShowLoginDialog } = useAuthStore();
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Load country code when authenticated
  useEffect(() => {
    if (isAuthenticated && accountInfo?.email) {
      loadCountryCode();
    }
  }, [isAuthenticated, accountInfo]);

  const loadCountryCode = async () => {
    if (!accountInfo?.email) return;
    try {
      const code = await goServiceClient.getCountryCode(accountInfo.email);
      setCountryCode(code);
    } catch (error: any) {
      console.error("Failed to load country code:", error);
    }
  };

  // Use useMount/useUnmount for event listener lifecycle
  useMount(async () => {
    unlistenRef.current = await listen("download-progress", (event: any) => {
      const data = event.payload;
      
      if (data.status === "downloading") {
        setActiveDownload({
          bundleId: data.bundle_id,
          appName: data.app_name || data.bundle_id,
          progress: data.progress || 0,
          status: "downloading",
        });
      } else if (data.status === "completed") {
        setActiveDownload({
          bundleId: data.bundle_id,
          appName: data.app_name || data.bundle_id,
          progress: 100,
          status: "completed",
        });
        setDownloadingApps((prev) => {
          const newSet = new Set(prev);
          newSet.delete(data.bundle_id);
          return newSet;
        });
      } else if (data.status === "error") {
        setActiveDownload({
          bundleId: data.bundle_id,
          appName: data.app_name || data.bundle_id,
          progress: 0,
          status: "error",
          message: data.message,
        });
        setDownloadingApps((prev) => {
          const newSet = new Set(prev);
          newSet.delete(data.bundle_id);
          return newSet;
        });
      }
    });
  });

  useUnmount(() => {
    if (unlistenRef.current) {
      unlistenRef.current();
    }
  });

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    if (!isAuthenticated || !accountInfo?.email) {
      setShowLoginDialog(true);
      return;
    }

    setIsSearching(true);
    try {
      const results = await goServiceClient.searchApps(searchQuery, accountInfo.email, 20);
      setAppStoreResults(results);
    } catch (error: any) {
      showError(t('search.searchFailed'), error.toString());
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectApp = async (app: AppSearchResult) => {
    if (!accountInfo?.email) return;
    
    setSelectedStoreApp(app);
    setShowVersions(true);
    setIsLoadingVersions(true);

    try {
      const versions = await goServiceClient.getAppVersionHistory(app.bundle_id, accountInfo.email);
      setVersionHistory(versions);
    } catch (error: any) {
      showError(t('search.versionsFailed'), error.toString());
      setVersionHistory(null);
    } finally {
      setIsLoadingVersions(false);
    }
  };

  const handleDownload = async (bundleId: string, version?: string, appName?: string) => {
    setDownloadingApps((prev) => new Set(prev).add(bundleId));
    setActiveDownload({
      bundleId,
      appName: appName || bundleId,
      progress: 0,
      status: "downloading",
    });

    try {
      await invoke("download_ipa", {
        bundleId,
        version: version || null,
      });
    } catch (error: any) {
      showError(t('downloads.failed'), error.toString());
      setDownloadingApps((prev) => {
        const newSet = new Set(prev);
        newSet.delete(bundleId);
        return newSet;
      });
      setActiveDownload({
        bundleId,
        appName: appName || bundleId,
        progress: 0,
        status: "error",
        message: String(error),
      });
    }
  };

  const handleCancelDownload = () => {
    // TODO: Implement cancel download logic in backend
    setActiveDownload(null);
  };

  return (
    <div className="flex h-full">
      <div className={`${showVersions && selectedStoreApp ? "w-2/3" : "w-full"} transition-all p-6 overflow-auto`}>
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-3xl font-bold text-gray-900 mb-2">{t('search.title')}</h2>
              <p className="text-gray-500">{t('search.subtitle')}</p>
            </div>
            {countryCode && (
              <div className="flex items-center space-x-2 px-4 py-2 bg-blue-50 rounded-lg">
                <Globe size={16} className="text-blue-600" />
                <span className="text-sm font-medium text-blue-700">{t('common.region')}: {countryCode}</span>
              </div>
            )}
          </div>

          <form onSubmit={handleSearch} className="mb-6">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('search.placeholder')}
                className="w-full pl-12 pr-4 py-4 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all text-lg shadow-sm"
              />
            </div>
          </form>
        </div>

        {isSearching ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-primary-600" size={40} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {appStoreResults.map((app) => (
              <div
                key={app.bundle_id}
                className="bg-white rounded-lg p-5 border border-gray-200 hover:shadow-lg transition-all cursor-pointer group"
                onClick={() => handleSelectApp(app)}
              >
                <div className="flex items-start space-x-4">
                  {app.icon_url ? (
                    <img
                      src={app.icon_url}
                      alt={app.name}
                      className="w-20 h-20 rounded-xl shadow-md flex-shrink-0"
                    />
                  ) : (
                    <div className="w-20 h-20 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center text-white font-bold text-2xl shadow-md flex-shrink-0">
                      {app.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg text-gray-900 group-hover:text-primary-600 transition-colors truncate">
                      {app.name}
                    </h3>
                    <p className="text-sm text-gray-500 truncate">{app.bundle_id}</p>
                    <div className="flex items-center flex-wrap gap-3 mt-2 text-xs text-gray-600">
                      <span className="flex items-center">
                        <Package size={14} className="mr-1" />
                        v{app.version}
                      </span>
                      {app.average_rating && app.average_rating > 0 && (
                        <span className="flex items-center text-yellow-600">
                          <Star size={14} className="mr-1 fill-current" />
                          {app.average_rating.toFixed(1)} ({app.rating_count?.toLocaleString()})
                        </span>
                      )}
                      {app.file_size_formatted && (
                        <span>{app.file_size_formatted}</span>
                      )}
                      {app.price === 0 ? (
                        <span className="text-green-600 font-medium">{t('common.free')}</span>
                      ) : (
                        <span className="text-blue-600 font-medium">{app.formatted_price}</span>
                      )}
                    </div>
                    {app.description && (
                      <p className="text-sm text-gray-600 mt-2 line-clamp-2">{app.description}</p>
                    )}
                  </div>

                  <div className="flex items-center space-x-2 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDownload(app.bundle_id, undefined, app.name);
                      }}
                      disabled={downloadingApps.has(app.bundle_id)}
                      className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2 shadow-sm"
                    >
                      {downloadingApps.has(app.bundle_id) ? (
                        <>
                          <Loader2 className="animate-spin" size={16} />
                          <span>{t('search.downloading')}</span>
                        </>
                      ) : (
                        <>
                          <Download size={16} />
                          <span>{t('search.download')}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {appStoreResults.length === 0 && !isSearching && searchQuery && (
              <div className="text-center py-20">
                <Package className="mx-auto text-gray-300 mb-4" size={60} />
                <p className="text-gray-500 text-lg">{t('search.noResults')}</p>
                <p className="text-gray-400 text-sm mt-2">{t('search.tryDifferentKeywords')}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {showVersions && selectedStoreApp && (
        <div className="w-1/3 bg-white border-l border-gray-200 p-6 overflow-auto">
          <div className="flex items-start justify-between mb-6">
            <div className="flex-1">
              {selectedStoreApp.icon_url && (
                <img 
                  src={selectedStoreApp.icon_url} 
                  alt={selectedStoreApp.name} 
                  className="w-20 h-20 rounded-xl shadow-lg mb-4" 
                />
              )}
              <h3 className="text-xl font-bold text-gray-900">{selectedStoreApp.name}</h3>
              <p className="text-sm text-gray-500">{selectedStoreApp.bundle_id}</p>
              <p className="text-sm text-gray-600 mt-2">{selectedStoreApp.developer_name}</p>
            </div>
            <button
              onClick={() => setShowVersions(false)}
              className="text-gray-400 hover:text-gray-600 text-xl"
            >
              ✕
            </button>
          </div>

          <div className="space-y-6">
            {selectedStoreApp.description && (
              <div>
                <h4 className="font-semibold text-gray-700 mb-2">{t('common.description')}</h4>
                <p className="text-sm text-gray-600 leading-relaxed">{selectedStoreApp.description}</p>
              </div>
            )}

            {selectedStoreApp.release_notes && (
              <div>
                <h4 className="font-semibold text-gray-700 mb-2">{t('common.releaseNotes')}</h4>
                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">{selectedStoreApp.release_notes}</p>
              </div>
            )}

            <div>
              <h4 className="font-semibold text-gray-700 mb-3">{t('search.versions')}</h4>
              {isLoadingVersions ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="animate-spin text-primary-600" size={24} />
                </div>
              ) : versionHistory ? (
                <div className="space-y-2">
                  <div className="text-sm text-gray-600 mb-3">
                    <div>{t('common.latestVersion')}: {versionHistory.latest_version}</div>
                    <div>{t('common.totalVersions')}: {versionHistory.version_identifiers.length}</div>
                  </div>
                  <div className="max-h-96 overflow-auto space-y-2">
                    {versionHistory.version_identifiers.slice(0, 10).map((versionId, index) => (
                      <div
                        key={versionId}
                        className="p-3 bg-gray-50 rounded-lg border border-gray-200 hover:border-primary-300 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-700">ID: {versionId}</span>
                          {index === 0 && (
                            <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">{t('common.latest')}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-center text-gray-500 py-8">{t('search.noVersions')}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeDownload && (
        <DownloadToast
          appName={activeDownload.appName}
          progress={activeDownload.progress}
          status={activeDownload.status}
          message={activeDownload.message}
          onCancel={activeDownload.status === "downloading" ? handleCancelDownload : undefined}
          onClose={() => setActiveDownload(null)}
        />
      )}
    </div>
  );
}

