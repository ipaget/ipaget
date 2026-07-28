import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, Loader2, Package, Download, Star, Globe, ArrowLeft, ChevronDown, ChevronUp, History, ShoppingCart, BarChart2, RefreshCw, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useErrorStore } from "../store/errorStore";
import { useAccountStore, handleTokenExpired } from "../store/accountStore";
import VersionHistoryDialog from "../components/VersionHistoryDialog";
import CopyButton from "../components/CopyButton";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useDebounce } from "react-use";
import { goServiceClient, AppSearchResult, TokenExpiredError } from "../lib/goService";
import { useDownloadStore } from "../store/downloadStore";
import PageLoading from "../components/PageLoading";
import Button3D from "../components/Button3D";
import { isTauriRuntime } from "../lib/runtime";

const SEARCH_RESULTS_LIMIT = 200;
const DISPLAY_PAGE_SIZE = 20;
const SUBTITLE_VIEWPORT_BATCH_SIZE = 16;
const SUBTITLE_VIEWPORT_PREFETCH_SIZE = 6;
const SUBTITLE_REQUEST_BATCH_SIZE = 2;

export default function SearchPage() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [appStoreResults, setAppStoreResults] = useState<AppSearchResult[]>([]);
  const [displayPage, setDisplayPage] = useState<number>(1);
  const [selectedStoreApp, setSelectedStoreApp] = useState<AppSearchResult | null>(null);
  const [showAppDetails, setShowAppDetails] = useState<boolean>(false);
  const [licenseStatus, setLicenseStatus] = useState<Record<string, { has_license: boolean; is_checking: boolean }>>({});
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [selectedCountryCode, setSelectedCountryCode] = useState<string | null>(null);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const countryDropdownRef = useRef<HTMLDivElement>(null);
  const [displayedResults, setDisplayedResults] = useState<AppSearchResult[]>([]); // Results for display
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [suggestions, setSuggestions] = useState<AppSearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [inputRect, setInputRect] = useState<DOMRect | null>(null);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isReleaseNotesExpanded, setIsReleaseNotesExpanded] = useState(false);
  const [showVersionDialog, setShowVersionDialog] = useState(false);
  const [versionDialogApp, setVersionDialogApp] = useState<AppSearchResult | null>(null);
  
  const [iconCopied, setIconCopied] = useState(false);

  const [topApps, setTopApps] = useState<AppSearchResult[]>([]);
  const [isLoadingTopApps, setIsLoadingTopApps] = useState(false);
  const [topAppsError, setTopAppsError] = useState<string | null>(null);
  const [savedScrollPosition, setSavedScrollPosition] = useState(0);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState<number>(-1);
  
  // debouncing handled via callback-based useDebounce below

  const { showError } = useErrorStore();
  const { selectedAccount, isAuthenticated } = useAccountStore();
  const { startDownload, getActiveDownloadTaskByBundleId } = useDownloadStore();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const listContainerRef = useRef<HTMLDivElement>(null);
  const shouldShowSuggestionsRef = useRef<boolean>(true);
  const prevCountryCodeRef = useRef<string | null>(null);
  const suggestionItemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const subtitleCacheRef = useRef<Record<string, string>>({});
  const subtitleInFlightRef = useRef<Set<string>>(new Set());

  const applySubtitleMap = (subtitleMap: Record<string, string>) => {
    if (!subtitleMap || Object.keys(subtitleMap).length === 0) {
      return;
    }

    Object.assign(subtitleCacheRef.current, subtitleMap);

    setTopApps((prev) => prev.map((app) => ({
      ...app,
      subtitle: app.subtitle || subtitleMap[app.bundle_id] || app.subtitle,
    })));
    setSuggestions((prev) => prev.map((app) => ({
      ...app,
      subtitle: app.subtitle || subtitleMap[app.bundle_id] || app.subtitle,
    })));
    setAppStoreResults((prev) => prev.map((app) => ({
      ...app,
      subtitle: app.subtitle || subtitleMap[app.bundle_id] || app.subtitle,
    })));
    setDisplayedResults((prev) => prev.map((app) => ({
      ...app,
      subtitle: app.subtitle || subtitleMap[app.bundle_id] || app.subtitle,
    })));
    setSelectedStoreApp((prev) => {
      if (!prev) return prev;
      const subtitle = subtitleMap[prev.bundle_id];
      if (!subtitle || prev.subtitle) return prev;
      return { ...prev, subtitle };
    });
  };

  const requestSubtitleBatches = async (bundleIds: string[], country: string) => {
    const uniqueBundleIds = Array.from(new Set(bundleIds.filter(Boolean)));
    const pendingBundleIds = uniqueBundleIds.filter(
      (bundleId) => !subtitleCacheRef.current[bundleId] && !subtitleInFlightRef.current.has(bundleId)
    );

    if (pendingBundleIds.length === 0) {
      return;
    }

    pendingBundleIds.forEach((bundleId) => subtitleInFlightRef.current.add(bundleId));

    try {
      for (let index = 0; index < pendingBundleIds.length; index += SUBTITLE_REQUEST_BATCH_SIZE) {
        const batch = pendingBundleIds.slice(index, index + SUBTITLE_REQUEST_BATCH_SIZE);
        const subtitles = await goServiceClient.getAppSubtitles(batch, country);
        applySubtitleMap(subtitles);
      }
    } catch (error) {
      console.error("Failed to request subtitle batches:", error);
    } finally {
      pendingBundleIds.forEach((bundleId) => subtitleInFlightRef.current.delete(bundleId));
    }
  };

  const scheduleVisibleSubtitleFetch = (apps: AppSearchResult[], country: string, scrollTop?: number) => {
    if (!apps || apps.length === 0) {
      return;
    }

    const container = listContainerRef.current;
    const containerScrollTop = scrollTop ?? container?.scrollTop ?? 0;
    const containerHeight = container?.clientHeight ?? 800;
    const approxRowHeight = 86;
    const startRow = Math.max(0, Math.floor(containerScrollTop / approxRowHeight));
    const visibleRows = Math.max(1, Math.ceil(containerHeight / approxRowHeight));
    const startIndex = startRow * 2;
    const endIndex = Math.min(
      apps.length,
      startIndex + SUBTITLE_VIEWPORT_BATCH_SIZE + visibleRows * 2 + SUBTITLE_VIEWPORT_PREFETCH_SIZE
    );
    const targetBundleIds = apps.slice(startIndex, endIndex).map((app) => app.bundle_id);
    void requestSubtitleBatches(targetBundleIds, country);
  };

  // Available countries for store region selection
  const AVAILABLE_COUNTRIES = [
    'US', 'CN', 'JP', 'GB', 'FR', 'DE', 'AU', 'CA', 
    'KR', 'IT', 'ES', 'BR', 'IN', 'RU', 'MX', 'TW', 'HK', 'SG'
  ];

  // Load country code and top apps on mount
  useEffect(() => {
    if (isAuthenticated && selectedAccount?.email) {
      loadCountryCode();
    }
    loadTopApps();
  }, [isAuthenticated, selectedAccount]);

  // Reload top apps when country code changes (from loadCountryCode or user selection)
  useEffect(() => {
    const effectiveCountryCode = selectedCountryCode || countryCode;
    if (effectiveCountryCode !== null) {
      loadTopApps();
    }
  }, [countryCode, selectedCountryCode]);

  const loadTopApps = async () => {
    setIsLoadingTopApps(true);
    setTopAppsError(null);
    try {
      const effectiveCountryCode = selectedCountryCode || countryCode || 'us';
      const apps = await goServiceClient.getTopApps(effectiveCountryCode, 50);
      const hydratedApps = apps.map((app) => ({
        ...app,
        subtitle: app.subtitle || subtitleCacheRef.current[app.bundle_id] || app.subtitle,
      }));
      setTopApps(hydratedApps);
      scheduleVisibleSubtitleFetch(hydratedApps, effectiveCountryCode, 0);
    } catch (error: any) {
      console.error("Failed to load top apps:", error);
      setTopAppsError(error.toString());
    } finally {
      setIsLoadingTopApps(false);
    }
  };

  // Auto refresh search when store region changes (if there are search results)
  useEffect(() => {
    const effectiveCountry = selectedCountryCode || countryCode || null;
    const countryChanged = prevCountryCodeRef.current !== effectiveCountry;
    const hadPrevCountry = prevCountryCodeRef.current !== null;

    // If country changed and user has searched before, re-search automatically
    if (countryChanged && hadPrevCountry && searchQuery.trim() && appStoreResults.length > 0) {
      handleSearch(undefined, searchQuery);
    }

    prevCountryCodeRef.current = effectiveCountry;
  }, [countryCode, selectedCountryCode]);

  // Infinite scroll observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isSearching && !isLoadingMore) {
          handleLoadMore();
        }
      },
      { threshold: 1.0 }
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [hasMore, isSearching, isLoadingMore]);

  // No scroll restore logic needed with KeepAlive

  // Recompute displayed results and hasMore when global results or page changes
  useEffect(() => {
    const newDisplayed = appStoreResults.slice(0, displayPage * DISPLAY_PAGE_SIZE);
    setDisplayedResults(newDisplayed);
    setHasMore(appStoreResults.length > newDisplayed.length);
  }, [appStoreResults, displayPage]);

  // Check license for paid apps in search results
  useEffect(() => {
    if (displayedResults.length > 0 && selectedAccount?.email) {
      displayedResults.forEach(app => {
        if (app.price > 0 && !licenseStatus[app.bundle_id]) {
          checkAppLicense(app);
        }
      });
    }
  }, [displayedResults, selectedAccount]);

  // Handle click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showSuggestions) {
        setShowSuggestions(false);
        searchInputRef.current?.blur();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [showSuggestions]);

  // Handle debounced search query changes for suggestions (react-use callback style)
  useDebounce(() => {
    const query = searchQuery.trim();
    if (query.length > 1) {
      loadSuggestions(query);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
      setIsLoadingSuggestions(false);
      // Clear search results when input is empty to show top apps
      setAppStoreResults([]);
      setDisplayedResults([]);
    }
  }, 300, [searchQuery, selectedCountryCode, countryCode]);

  // Show loading state immediately when user types
  useEffect(() => {
    if (searchQuery.trim().length > 1 && shouldShowSuggestionsRef.current) {
      setIsLoadingSuggestions(true);
    } else {
      setIsLoadingSuggestions(false);
    }
  }, [searchQuery]);

  // Auto scroll selected suggestion into view
  useEffect(() => {
    if (selectedSuggestionIndex >= 0 && suggestionItemRefs.current[selectedSuggestionIndex]) {
      suggestionItemRefs.current[selectedSuggestionIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedSuggestionIndex]);

  // Update input rect when showing suggestions
  useEffect(() => {
    if ((showSuggestions || isLoadingSuggestions) && searchInputRef.current) {
      const rect = searchInputRef.current.getBoundingClientRect();
      setInputRect(rect);
    }
  }, [showSuggestions, isLoadingSuggestions]);

  // Update position on scroll or close suggestions (listen on page container)
  useEffect(() => {
    const handleScroll = () => {
      if (searchInputRef.current && (showSuggestions || isLoadingSuggestions)) {
        const rect = searchInputRef.current.getBoundingClientRect();
        setInputRect(rect);
      }
    };

    const scrollContainer = listContainerRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }
  }, [showSuggestions, isLoadingSuggestions]);

  const loadSuggestions = async (query: string) => {
    const effectiveCountryCode = selectedCountryCode || countryCode || 'US';
    
    try {
      const results = await goServiceClient.searchApps(query, effectiveCountryCode, 5);
      const filteredResults = results.filter(app => app.id !== 0 && app.name !== "");
      const hydratedResults = filteredResults.map((app) => ({
        ...app,
        subtitle: app.subtitle || subtitleCacheRef.current[app.bundle_id] || app.subtitle,
      }));
      setSuggestions(hydratedResults);
      void requestSubtitleBatches(hydratedResults.map((app) => app.bundle_id), effectiveCountryCode);
      setSelectedSuggestionIndex(-1);
      if (shouldShowSuggestionsRef.current) {
        setShowSuggestions(true);
      }
    } catch (error: any) {
      console.error('[Search Suggestions] Failed to load suggestions:', error);
      if (error instanceof TokenExpiredError) {
        handleTokenExpired();
      }
      setSuggestions([]);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const loadCountryCode = async () => {
    if (!selectedAccount?.email) return;
    try {
      const code = await goServiceClient.getCountryCode(selectedAccount.email);
      setCountryCode(code);
    } catch (error: any) {
      console.error("Failed to load country code:", error);
      // Do not set fallback - let loadTopApps use default "us"
    }
  };

  // Monitor download task progress from WebSocket
  useEffect(() => {
    // This useEffect is no longer needed as download states are managed by the task store.
    // The `getActiveDownloadTaskByBundleId` selector will update the UI when a task changes.
  }, [getActiveDownloadTaskByBundleId]);


  const handleSearch = async (e?: React.FormEvent, directQuery?: string) => {
    if (e) e.preventDefault();
    const query = directQuery || searchQuery;
    if (!query.trim()) return;

    shouldShowSuggestionsRef.current = false;
    setShowSuggestions(false);
    setIsLoadingSuggestions(false);
    setIsSearching(true);
    setAppStoreResults([]);
    setDisplayedResults([]);
    setDisplayPage(1);
    setHasMore(false);
    try {
      const effectiveCountryCode = selectedCountryCode || countryCode || 'US';
      const results = await goServiceClient.searchApps(query, effectiveCountryCode, SEARCH_RESULTS_LIMIT);
      const filteredResults = results.filter(app => app.id !== 0 && app.name !== "");
      const hydratedResults = filteredResults.map((app) => ({
        ...app,
        subtitle: app.subtitle || subtitleCacheRef.current[app.bundle_id] || app.subtitle,
      }));
      setAppStoreResults(hydratedResults);
      setDisplayedResults(hydratedResults.slice(0, DISPLAY_PAGE_SIZE));
      setDisplayPage(1);
      setHasMore(hydratedResults.length > DISPLAY_PAGE_SIZE);
      scheduleVisibleSubtitleFetch(hydratedResults, effectiveCountryCode, 0);
    } catch (error: any) {
      console.error('[Search] Failed:', error);
      if (error instanceof TokenExpiredError) {
        handleTokenExpired();
      } else {
        showError(t('search.searchFailed'), error.toString());
      }
    } finally {
      setIsSearching(false);
    }
  };

  const handleLoadMore = () => {
    if (isLoadingMore) return;

    setIsLoadingMore(true);

    // Simulate a small delay for better UX, showing the loader
    setTimeout(() => {
      const nextPage = displayPage + 1;
      const newDisplayedResults = appStoreResults.slice(0, nextPage * DISPLAY_PAGE_SIZE);
      
      setDisplayedResults(newDisplayedResults);
      setDisplayPage(nextPage);
      setHasMore(appStoreResults.length > newDisplayedResults.length);
      setIsLoadingMore(false);

      const effectiveCountryCode = selectedCountryCode || countryCode || 'US';
      scheduleVisibleSubtitleFetch(appStoreResults, effectiveCountryCode, listContainerRef.current?.scrollTop ?? 0);
    }, 500);
  };

  const handleSuggestionClick = (suggestion: AppSearchResult) => {
    shouldShowSuggestionsRef.current = false;
    setShowSuggestions(false);
    setIsLoadingSuggestions(false);
    setSelectedSuggestionIndex(-1);
    searchInputRef.current?.blur();
    handleSelectApp(suggestion);
  };

  const handleSelectApp = async (app: AppSearchResult) => {
    // Save current scroll position before showing details
    if (listContainerRef.current) {
      setSavedScrollPosition(listContainerRef.current.scrollTop);
    }
    
    setSelectedStoreApp(app);
    setShowAppDetails(true);
    setIsDescriptionExpanded(false);
    setIsReleaseNotesExpanded(false);

    if (app.price > 0 && !licenseStatus[app.bundle_id] && selectedAccount?.email) {
      checkAppLicense(app);
    }

    // Scroll to top when showing details
    setTimeout(() => {
      const detailsContainer = document.getElementById('app-details-container');
      if (detailsContainer) {
        detailsContainer.scrollTop = 0;
      }
    }, 0);
  };

  const handleBackToSearch = () => {
    setShowAppDetails(false);
    setSelectedStoreApp(null);
    setIsDescriptionExpanded(false);
    setIsReleaseNotesExpanded(false);
    
    // Restore scroll position after transition
    setTimeout(() => {
      if (listContainerRef.current) {
        listContainerRef.current.scrollTop = savedScrollPosition;
      }
    }, 0);
  };

  const handleDownload = async (bundleId: string, version?: string, appName?: string) => {
    const accountState = useAccountStore.getState();
    if (!await accountState.requireAuth()) {
      return;
    }
    const email = accountState.selectedAccount!.email;

    try {
      const downloadDir = isTauriRuntime()
        ? await invoke<string>("get_download_directory")
        : "~/Downloads/iPAGet";
      // Try to find icon_url from current selected app context
      const iconUrl = selectedStoreApp?.icon_url || undefined;
      await startDownload(bundleId, email, downloadDir, appName || bundleId, iconUrl, version);
    } catch (error: any) {
      console.log('[handleDownload] Caught error:', error);
      console.log('[handleDownload] error.name:', error.name);
      console.log('[handleDownload] Is TokenExpiredError?', error instanceof TokenExpiredError);

      if (error instanceof TokenExpiredError) {
        handleTokenExpired();
      } else {
        showError(t('downloads.failed'), error.toString());
      }
    }
  };

  // Create a small floating dot animation from a button to the downloads FAB
  const animateFlyToDownloadsFab = (startEl: HTMLElement | null) => {
    const fab = document.getElementById('downloads-fab');
    if (!startEl || !fab) return;

    const startRect = startEl.getBoundingClientRect();
    const endRect = fab.getBoundingClientRect();

    const fly = document.createElement('div');
    fly.style.position = 'fixed';
    fly.style.width = '14px';
    fly.style.height = '14px';
    fly.style.borderRadius = '9999px';
    fly.style.background = '#3b82f6';
    fly.style.boxShadow = '0 4px 12px rgba(59,130,246,0.5)';
    fly.style.zIndex = '9999';
    fly.style.left = `${startRect.left + startRect.width / 2 - 7}px`;
    fly.style.top = `${startRect.top + startRect.height / 2 - 7}px`;
    fly.style.transition = 'transform 450ms cubic-bezier(0.22, 1, 0.36, 1), opacity 450ms ease';
    document.body.appendChild(fly);

    // Force reflow
    void fly.offsetHeight;

    const dx = endRect.left + endRect.width / 2 - (startRect.left + startRect.width / 2);
    const dy = endRect.top + endRect.height / 2 - (startRect.top + startRect.height / 2);
    fly.style.transform = `translate(${dx}px, ${dy}px) scale(0.6)`;
    fly.style.opacity = '0.8';

    const removeAfter = () => {
      if (fly && fly.parentNode) fly.parentNode.removeChild(fly);
    };
    fly.addEventListener('transitionend', removeAfter, { once: true });
    setTimeout(removeAfter, 600);
  };

  const checkAppLicense = async (app: AppSearchResult) => {
    const accountState = useAccountStore.getState();
    if (!accountState.selectedAccount?.email) return;
    
    setLicenseStatus(prev => ({
      ...prev,
      [app.bundle_id]: { has_license: prev[app.bundle_id]?.has_license || false, is_checking: true },
    }));

    try {
      const hasLicense = await goServiceClient.checkLicense(app.bundle_id, accountState.selectedAccount.email);
      setLicenseStatus(prev => ({
        ...prev,
        [app.bundle_id]: { has_license: hasLicense, is_checking: false },
      }));
    } catch (error: any) {
      console.error('Failed to check license:', error);
      if (error instanceof TokenExpiredError) {
        handleTokenExpired();
      }
      setLicenseStatus(prev => ({
        ...prev,
        [app.bundle_id]: { has_license: false, is_checking: false },
      }));
    }
  };

  const handleVersionHistory = async (app: AppSearchResult) => {
    setVersionDialogApp(app);
    setShowVersionDialog(true);
  };

  const handleDownloadVersion = async (versionId: string) => {
    if (!versionDialogApp) return;

    const accountState = useAccountStore.getState();
    if (!await accountState.requireAuth()) {
      setShowVersionDialog(false); // Close dialog if login is cancelled
      return;
    }
    const email = accountState.selectedAccount!.email;
    
    try {
      const downloadDir = await invoke<string>("get_download_directory");
      const iconUrl = versionDialogApp.icon_url || undefined;
      await startDownload(versionDialogApp.bundle_id, email, downloadDir, versionDialogApp.name, iconUrl, versionId);
      
      // Close the dialog after initiating download
      setShowVersionDialog(false);
    } catch (error: any) {
      console.log('[handleDownloadVersion] Caught error:', error);
      console.log('[handleDownloadVersion] error.name:', error.name);
      console.log('[handleDownloadVersion] Is TokenExpiredError?', error instanceof TokenExpiredError);

      if (error instanceof TokenExpiredError) {
        handleTokenExpired();
      } else {
        showError(t('downloads.failed'), error.toString());
      }
    } finally {
    }
  };

  const getRegionName = (code: string): string => {
    return t(`countries.${code.toUpperCase()}`) || code;
  };

  const handleCountrySelect = (code: string) => {
    setSelectedCountryCode(code === countryCode ? null : code);
    setShowCountryDropdown(false);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (countryDropdownRef.current && !countryDropdownRef.current.contains(event.target as Node)) {
        setShowCountryDropdown(false);
      }
    };

    if (showCountryDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showCountryDropdown]);

  const handleCopyIcon = async () => {
    if (!selectedStoreApp?.icon_url) return;
    
    try {
      await navigator.clipboard.writeText(selectedStoreApp.icon_url);
      setIconCopied(true);
      setTimeout(() => setIconCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy icon URL:', error);
    }
  };

  useEffect(() => {
    const container = listContainerRef.current;
    if (!container) {
      return;
    }

    let ticking = false;
    const handleListScroll = () => {
      if (ticking) {
        return;
      }
      ticking = true;
      requestAnimationFrame(() => {
        const effectiveCountryCode = selectedCountryCode || countryCode || 'US';
        const sourceApps = searchQuery ? displayedResults : topApps;
        scheduleVisibleSubtitleFetch(sourceApps, effectiveCountryCode, container.scrollTop);
        ticking = false;
      });
    };

    container.addEventListener('scroll', handleListScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleListScroll);
  }, [countryCode, selectedCountryCode, searchQuery, displayedResults, topApps]);

  return (
    <>
      <div id="app-details-container" className={`h-full overflow-auto scrollbar-thin bg-gray-50 px-8 pb-8 pt-6 ${showAppDetails && selectedStoreApp ? '' : 'hidden'}`}>
        {selectedStoreApp && (
          <>
            <div className="px-0 py-0 mb-6">
              <button
                onClick={handleBackToSearch}
                className="group inline-flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-all active:scale-95"
              >
                <ArrowLeft size={24} className="group-hover:-translate-x-1 transition-transform" />
                <span className="text-lg font-semibold">{t('common.back')}</span>
              </button>
            </div>

            <div className="max-w-4xl mx-auto px-0 pb-0">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-6">
              <div className="p-8">
                <div className="flex items-start gap-6 mb-8">
                  {selectedStoreApp.icon_url ? (
                    <div className="relative group">
                      <img 
                        src={selectedStoreApp.icon_url} 
                        alt={selectedStoreApp.name} 
                        onClick={handleCopyIcon}
                        className="w-32 h-32 rounded-[28px] shadow-lg flex-shrink-0 cursor-pointer transition-all hover:shadow-xl hover:scale-105" 
                        title={t('common.clickToCopyIconUrl')}
                      />
                      {iconCopied && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-60 rounded-[28px] transition-opacity">
                          <span className="text-white text-sm font-medium">{t('common.copied')}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="w-32 h-32 bg-gradient-to-br from-primary-400 to-primary-600 rounded-[28px] flex items-center justify-center text-white font-bold text-5xl shadow-lg flex-shrink-0">
                      {selectedStoreApp.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  
                  <div className="flex-1 min-w-0">
                    <h1 className="text-3xl font-bold text-gray-900 mb-3">{selectedStoreApp.name}</h1>

                    {selectedStoreApp.subtitle && (
                      <p className="text-base text-gray-600 mb-3 leading-relaxed">{selectedStoreApp.subtitle}</p>
                    )}
                    
                    <div className="flex items-center text-sm text-gray-600 mb-4">
                      <span>v{selectedStoreApp.version}</span>
                      {selectedStoreApp.average_rating && selectedStoreApp.average_rating > 0 && (
                        <>
                          <span className="mx-2 text-gray-400">|</span>
                          <Star size={14} className="text-yellow-500 fill-current mr-1" />
                          <span>{selectedStoreApp.average_rating.toFixed(1)}</span>
                        </>
                      )}
                      {selectedStoreApp.file_size_formatted && (
                        <>
                          <span className="mx-2 text-gray-400">|</span>
                          <span>{selectedStoreApp.file_size_formatted}</span>
                        </>
                      )}
                      {selectedStoreApp.price === 0 ? (
                        <>
                          <span className="mx-2 text-gray-400">|</span>
                          <span className="text-green-600 font-medium">{t('common.free')}</span>
                        </>
                      ) : (
                        <>
                          <span className="mx-2 text-gray-400">|</span>
                          <span className="text-blue-600 font-medium">{selectedStoreApp.formatted_price}</span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      {(() => {
                        const isPaid = selectedStoreApp.price > 0;
                        const status = licenseStatus[selectedStoreApp.bundle_id];
                        const hasLicense = status?.has_license || false;
                        const isChecking = status?.is_checking || false;
                        const canShowVersionHistory = !isPaid || hasLicense;

                        return (
                          <>
                            {isPaid && !hasLicense ? (
                              <Tooltip.Provider delayDuration={200}>
                                <Tooltip.Root>
                                  <Tooltip.Trigger asChild>
                                    <button
                                      disabled={true}
                                      className="px-6 py-2.5 bg-orange-50 text-orange-600 text-sm font-medium rounded-lg cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                      {isChecking ? (
                                        <>
                                          <Loader2 className="animate-spin" size={18} />
                                          <span>{t('search.checkingLicense')}</span>
                                        </>
                                      ) : (
                                        <>
                                          <ShoppingCart size={18} />
                                          <span>{t('search.requiresPurchase')}</span>
                                        </>
                                      )}
                                    </button>
                                  </Tooltip.Trigger>
                                  <Tooltip.Portal>
                                    <Tooltip.Content
                                      className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-[9999]"
                                      sideOffset={5}
                                    >
                                      {t('search.paidAppRequiresPurchaseOnDevice')}
                                      <Tooltip.Arrow className="fill-gray-900" />
                                    </Tooltip.Content>
                                  </Tooltip.Portal>
                                </Tooltip.Root>
                              </Tooltip.Provider>
                            ) : (
                              <Button3D
                                variant="primary"
                                size="md"
                                onClick={(e) => {
                                  const btn = e.currentTarget as HTMLElement;
                                  animateFlyToDownloadsFab(btn);
                                  handleDownload(selectedStoreApp.bundle_id, undefined, selectedStoreApp.name);
                                }}
                                disabled={!!getActiveDownloadTaskByBundleId(selectedStoreApp.bundle_id)}
                                loading={!!getActiveDownloadTaskByBundleId(selectedStoreApp.bundle_id)}
                              >
                                {!getActiveDownloadTaskByBundleId(selectedStoreApp.bundle_id) && <Download size={18} />}
                                <span>{t('search.download')}</span>
                              </Button3D>
                            )}
                            
                            <Tooltip.Provider delayDuration={200}>
                              <Tooltip.Root>
                                <Tooltip.Trigger asChild>
                                  <div>
                                    <Button3D
                                      variant="secondary"
                                      size="md"
                                      onClick={() => {
                                        if (canShowVersionHistory) {
                                          handleVersionHistory(selectedStoreApp);
                                        }
                                      }}
                                      disabled={!canShowVersionHistory}
                                    >
                                      <History size={18} />
                                      <span>{t('search.versionHistory')}</span>
                                    </Button3D>
                                  </div>
                                </Tooltip.Trigger>
                                {!canShowVersionHistory && (
                                  <Tooltip.Portal>
                                    <Tooltip.Content
                                      className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-[9999]"
                                      sideOffset={5}
                                    >
                                      {t('search.requirePurchaseFirst')}
                                      <Tooltip.Arrow className="fill-gray-900" />
                                    </Tooltip.Content>
                                  </Tooltip.Portal>
                                )}
                              </Tooltip.Root>
                            </Tooltip.Provider>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                {selectedStoreApp.description && (
                  <div className="mb-5 pb-5 border-b border-gray-100">
                    <h2 className="text-lg font-semibold text-gray-900 mb-2.5">{t('common.description')}</h2>
                    <div className="relative">
                      <div
                        className={`text-sm text-gray-700 leading-relaxed whitespace-pre-line ${
                          !isDescriptionExpanded ? 'line-clamp-4' : ''
                        }`}
                      >
                        {selectedStoreApp.description}
                      </div>
                      {!isDescriptionExpanded && selectedStoreApp.description.split('\n').length > 4 && (
                        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none" />
                      )}
                    </div>
                    {selectedStoreApp.description.split('\n').length > 4 && (
                      <button
                        onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                        className="mt-2 flex items-center space-x-1 text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
                      >
                        <span>{isDescriptionExpanded ? t('common.showLess') : t('common.showMore')}</span>
                        {isDescriptionExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    )}
                  </div>
                )}

                {selectedStoreApp.release_notes && (
                  <div className="mb-5 pb-5 border-b border-gray-100">
                    <h2 className="text-lg font-semibold text-gray-900 mb-2.5">{t('common.releaseNotes')}</h2>
                    <div className="relative">
                      <div
                        className={`text-sm text-gray-700 leading-relaxed whitespace-pre-line ${
                          !isReleaseNotesExpanded ? 'line-clamp-4' : ''
                        }`}
                      >
                        {selectedStoreApp.release_notes}
                      </div>
                      {!isReleaseNotesExpanded && selectedStoreApp.release_notes.split('\n').length > 4 && (
                        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white to-transparent pointer-events-none" />
                      )}
                    </div>
                    {selectedStoreApp.release_notes.split('\n').length > 4 && (
                      <button
                        onClick={() => setIsReleaseNotesExpanded(!isReleaseNotesExpanded)}
                        className="mt-2 flex items-center space-x-1 text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
                      >
                        <span>{isReleaseNotesExpanded ? t('common.showLess') : t('common.showMore')}</span>
                        {isReleaseNotesExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    )}
                  </div>
                )}

                <div className="mt-5 pt-5 border-t border-gray-100">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('common.appInformation')}</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <div className="text-xs text-gray-500 mb-1.5">{t('common.bundleId')}</div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-mono text-gray-900 break-all flex-1">{selectedStoreApp.bundle_id}</div>
                        <CopyButton text={selectedStoreApp.bundle_id} size={14} />
                      </div>
                    </div>

                    <div className="p-3 bg-gray-50 rounded-lg">
                      <div className="text-xs text-gray-500 mb-1.5">{t('common.developer')}</div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm text-gray-900 truncate flex-1">{selectedStoreApp.developer_name}</div>
                        <CopyButton text={selectedStoreApp.developer_name} size={14} />
                      </div>
                    </div>

                    {selectedStoreApp.primary_genre && (
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs text-gray-500 mb-1.5">{t('common.category')}</div>
                        <div className="text-sm text-gray-900">{selectedStoreApp.primary_genre}</div>
                      </div>
                    )}

                    {selectedStoreApp.content_rating && (
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs text-gray-500 mb-1.5">{t('common.contentRating')}</div>
                        <div className="text-sm text-gray-900">{selectedStoreApp.content_rating}</div>
                      </div>
                    )}

                    {selectedStoreApp.average_rating !== undefined && selectedStoreApp.average_rating > 0 && (
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs text-gray-500 mb-1.5">{t('common.rating')}</div>
                        <div className="text-sm text-gray-900 flex items-center gap-1.5">
                          <Star size={14} className="text-yellow-500 fill-current flex-shrink-0" />
                          <span>{selectedStoreApp.average_rating.toFixed(1)}</span>
                          {selectedStoreApp.rating_count !== undefined && selectedStoreApp.rating_count > 0 && (
                            <span className="text-gray-500">
                              ({selectedStoreApp.rating_count >= 10000 
                                ? `${(selectedStoreApp.rating_count / 10000).toFixed(1)}${t('common.tenThousand')}`
                                : selectedStoreApp.rating_count.toLocaleString()})
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {selectedStoreApp.file_size_formatted && (
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs text-gray-500 mb-1.5">{t('common.fileSize')}</div>
                        <div className="text-sm text-gray-900">{selectedStoreApp.file_size_formatted}</div>
                      </div>
                    )}

                    {selectedStoreApp.minimum_os_version && (
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs text-gray-500 mb-1.5">{t('common.minimumOS')}</div>
                        <div className="text-sm text-gray-900">iOS {selectedStoreApp.minimum_os_version}+</div>
                      </div>
                    )}

                    {selectedStoreApp.current_version_release_date && (
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs text-gray-500 mb-1.5">{t('common.lastUpdated')}</div>
                        <div className="text-sm text-gray-900">
                          {new Date(selectedStoreApp.current_version_release_date).toLocaleDateString()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          </>
        )}
      </div>

      <div ref={listContainerRef} className={`h-full overflow-auto scrollbar-thin p-8 ${showAppDetails && selectedStoreApp ? 'hidden' : ''}`}>
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 mb-2">{t('search.title')}</h2>
                <p className="text-gray-500">{t('search.subtitle')}</p>
              </div>
              <div className="relative" ref={countryDropdownRef}>
                <button
                  onClick={() => setShowCountryDropdown(!showCountryDropdown)}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                >
                  <Globe size={16} className="text-blue-600" />
                  <span className="text-sm font-medium text-blue-700">
                    {t('common.region')}: {getRegionName(selectedCountryCode || countryCode || 'US')}
                  </span>
                  <ChevronDown size={14} className={`text-blue-600 transition-transform ${showCountryDropdown ? 'rotate-180' : ''}`} />
                </button>
                
                {showCountryDropdown && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-[500] max-h-96 overflow-y-auto">
                    {countryCode && (
                      <div className="px-3 py-2 border-b border-gray-100">
                        <div
                          onClick={() => handleCountrySelect(countryCode)}
                          className={`flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors ${
                            !selectedCountryCode ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'
                          }`}
                        >
                          <div className="flex items-center space-x-2">
                            <Globe size={14} />
                            <span className="text-sm font-medium">{getRegionName(countryCode)}</span>
                          </div>
                          {!selectedCountryCode && <Check size={14} className="text-blue-600" />}
                        </div>
                        <p className="text-xs text-gray-500 mt-1 px-3">{t('search.currentAccountRegion') || '当前账号地区'}</p>
                      </div>
                    )}
                    
                    <div className="py-1">
                      {AVAILABLE_COUNTRIES.filter(code => code !== countryCode).map((code) => (
                        <div
                          key={code}
                          onClick={() => handleCountrySelect(code)}
                          className={`flex items-center justify-between px-6 py-2 cursor-pointer transition-colors ${
                            selectedCountryCode === code ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'
                          }`}
                        >
                          <span className="text-sm">{getRegionName(code)}</span>
                          {selectedCountryCode === code && <Check size={14} className="text-blue-600" />}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

          <form onSubmit={handleSearch} className="mb-6 relative z-50">
              <div className="relative" ref={searchContainerRef}>
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 z-10" size={20} />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    shouldShowSuggestionsRef.current = true;
                    setSearchQuery(e.target.value);
                    setSelectedSuggestionIndex(-1);
                  }}
                  onFocus={() => {
                    shouldShowSuggestionsRef.current = true;
                    if (searchInputRef.current) {
                      const rect = searchInputRef.current.getBoundingClientRect();
                      setInputRect(rect);
                    }
                    if (suggestions.length > 0 && searchQuery.trim().length > 1) {
                      setShowSuggestions(true);
                    }
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      shouldShowSuggestionsRef.current = false;
                      setShowSuggestions(false);
                      setIsLoadingSuggestions(false);
                      setSelectedSuggestionIndex(-1);
                    }, 200);
                  }}
                  onKeyDown={(e) => {
                    if (!showSuggestions || suggestions.length === 0) return;
                    
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSelectedSuggestionIndex(prev => 
                        prev < suggestions.length - 1 ? prev + 1 : prev
                      );
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSelectedSuggestionIndex(prev => prev > 0 ? prev - 1 : -1);
                    } else if (e.key === 'Enter' && selectedSuggestionIndex >= 0) {
                      e.preventDefault();
                      const selectedSuggestion = suggestions[selectedSuggestionIndex];
                      if (selectedSuggestion) {
                        handleSuggestionClick(selectedSuggestion);
                      }
                    }
                  }}
                  placeholder={t('search.placeholder')}
                  className="w-full pl-12 pr-4 py-4 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all text-lg shadow-sm"
                />
                
                {(showSuggestions || isLoadingSuggestions) && searchQuery.trim().length > 1 && inputRect && (isLoadingSuggestions || suggestions.length > 0) && (
                  <div 
                    className="fixed z-[100] bg-white rounded-lg shadow-xl border border-gray-200 max-h-[min(384px,calc(100vh-200px))] overflow-y-auto"
                    style={{
                      top: `${inputRect.bottom + 8}px`,
                      left: `${inputRect.left}px`,
                      width: `${inputRect.width}px`,
                    }}
                  >
                    {isLoadingSuggestions ? (
                      <>
                        {[1, 2, 3].map((i) => (
                          <div key={i} className="flex items-center space-x-3 px-4 py-3 border-b border-gray-100">
                            <div className="w-12 h-12 rounded-lg bg-gray-200 flex-shrink-0 overflow-hidden relative">
                              <div className="absolute inset-0 animate-shimmer" />
                            </div>
                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="h-4 bg-gray-200 rounded w-3/4 overflow-hidden relative">
                                <div className="absolute inset-0 animate-shimmer" />
                              </div>
                              <div className="h-3 bg-gray-200 rounded w-1/2 overflow-hidden relative">
                                <div className="absolute inset-0 animate-shimmer" style={{ animationDelay: '0.1s' }} />
                              </div>
                            </div>
                            <div className="flex-shrink-0 w-12 h-4 bg-gray-200 rounded overflow-hidden relative">
                              <div className="absolute inset-0 animate-shimmer" style={{ animationDelay: '0.2s' }} />
                            </div>
                          </div>
                        ))}
                      </>
                    ) : suggestions.length > 0 ? (
                      suggestions.map((suggestion, index) => (
                          <div
                            key={suggestion.bundle_id}
                            ref={(el) => (suggestionItemRefs.current[index] = el)}
                            onClick={() => handleSuggestionClick(suggestion)}
                            className={`flex items-center space-x-3 px-4 py-3 cursor-pointer border-b border-gray-100 last:border-b-0 transition-colors ${
                              index === selectedSuggestionIndex ? 'bg-primary-50' : 'hover:bg-gray-50'
                            }`}
                          >
                          {suggestion.icon_url ? (
                            <img
                              src={suggestion.icon_url}
                              alt={suggestion.name}
                              className="w-12 h-12 rounded-lg shadow-sm flex-shrink-0"
                            />
                          ) : (
                            <div className="w-12 h-12 bg-gradient-to-br from-primary-400 to-primary-600 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-sm flex-shrink-0">
                              {suggestion.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-gray-900 truncate">{suggestion.name}</h4>
                            <p className="text-xs text-gray-500 truncate">{suggestion.developer_name}</p>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            {suggestion.average_rating && suggestion.average_rating > 0 && (
                              <div className="flex items-center text-yellow-600 text-sm">
                                <Star size={14} className="mr-1 fill-current" />
                                <span>{suggestion.average_rating.toFixed(1)}</span>
                              </div>
                            )}
                            {suggestion.price === 0 ? (
                              <span className="text-xs text-green-600 font-medium">{t('common.free')}</span>
                            ) : (
                              <span className="text-xs text-blue-600 font-medium">{suggestion.formatted_price}</span>
                            )}
                          </div>
                        </div>
                      ))
                    ) : null}
                  </div>
                )}
              </div>
            </form>
          </div>

          {isSearching ? (
            <PageLoading message={t("search.searching")} />
          ) : (
            <>
              {!searchQuery && appStoreResults.length === 0 && (
                <div className="mb-8">
                  <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                    {t('search.topCharts') || "Top Charts"}
                  </h3>
                  
                  {isLoadingTopApps ? (
                    <div className="grid grid-cols-2 gap-3">
                      {[...Array(10)].map((_, i) => (
                        <div key={i} className="rounded-lg p-3.5 border border-gray-100 bg-white">
                          <div className="flex items-center gap-3">
                            <div className="w-14 h-14 rounded-xl bg-gray-200 animate-pulse flex-shrink-0" />
                            <div className="flex-1 min-w-0 space-y-2">
                              <div className="h-4 bg-gray-200 rounded w-3/4 animate-pulse" />
                              <div className="h-3 bg-gray-200 rounded w-1/2 animate-pulse" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : topAppsError ? (
                    <div className="flex flex-col items-center justify-center py-12 text-gray-400 bg-gray-50 rounded-xl border border-gray-100 border-dashed">
                      <div className="bg-white p-4 rounded-full mb-3 shadow-sm">
                        <BarChart2 size={32} className="text-gray-300" />
                      </div>
                      <p className="text-sm font-medium text-gray-500">{t('search.failedToLoadTopCharts') || "Failed to load top charts"}</p>
                      <button 
                        onClick={loadTopApps}
                        disabled={isLoadingTopApps}
                        className="mt-4 inline-flex items-center space-x-2 px-4 py-2 text-gray-700 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-all disabled:opacity-50"
                      >
                        <div className="relative w-5 h-5">
                          <RefreshCw
                            className={`absolute inset-0 transition-all duration-300 ${
                              isLoadingTopApps ? "animate-spin opacity-100" : "opacity-100 scale-100"
                            }`}
                            size={20}
                          />
                        </div>
                        <span>{t('common.retry') || "Retry"}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {topApps.map((app) => (
                        <div
                          key={app.bundle_id}
                          data-bundle-id={app.bundle_id}
                          className="rounded-lg p-3.5 hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-200 transition-all cursor-pointer group"
                          onClick={() => handleSelectApp(app)}
                        >
                          <div className="flex items-center gap-3">
                            {app.icon_url ? (
                              <img
                                src={app.icon_url}
                                alt={app.name}
                                className="w-14 h-14 rounded-xl flex-shrink-0"
                              />
                            ) : (
                              <div className="w-14 h-14 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
                                {app.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            
                            <div className="flex-1 min-w-0">
                              <h3 className="font-medium text-gray-900 group-hover:text-primary-600 transition-colors truncate text-sm mb-1">
                                {app.name}
                              </h3>
                              <div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
                                {app.average_rating && app.average_rating > 0 && (
                                  <span className="flex items-center gap-0.5">
                                    <Star size={11} className="text-yellow-500 fill-current" />
                                    <span>{app.average_rating.toFixed(1)}</span>
                                    {app.rating_count && app.rating_count > 0 && (
                                      <span className="text-gray-400">
                                        ({app.rating_count >= 10000 
                                          ? `${(app.rating_count / 10000).toFixed(1)}${t('common.tenThousand')}`
                                          : app.rating_count.toLocaleString()})
                                      </span>
                                    )}
                                  </span>
                                )}
                                {app.file_size_formatted && (
                                  <>
                                    {app.average_rating && app.average_rating > 0 && <span className="text-gray-300">·</span>}
                                    <span>{app.file_size_formatted}</span>
                                  </>
                                )}
                              </div>
                              <p className="text-xs text-gray-500 truncate leading-tight">
                                {[app.developer_name, app.subtitle || app.primary_genre].filter(Boolean).join(' · ')}
                              </p>
                            </div>

                            <Button3D
                              variant="secondary"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                const btn = e.currentTarget as HTMLElement;
                                animateFlyToDownloadsFab(btn);
                                handleDownload(app.bundle_id, undefined, app.name);
                              }}
                              disabled={!!getActiveDownloadTaskByBundleId(app.bundle_id)}
                              loading={!!getActiveDownloadTaskByBundleId(app.bundle_id)}
                            >
                              {!getActiveDownloadTaskByBundleId(app.bundle_id) && <Download size={14} />}
                              <span>{t('search.download')}</span>
                            </Button3D>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {searchQuery && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {displayedResults.map((app) => (
                      <div
                        key={app.bundle_id}
                        data-bundle-id={app.bundle_id}
                        className="rounded-lg p-3.5 hover:bg-white hover:shadow-sm border border-transparent hover:border-gray-200 transition-all cursor-pointer group"
                        onClick={() => handleSelectApp(app)}
                      >
                        <div className="flex items-center gap-3">
                          {app.icon_url ? (
                            <img
                              src={app.icon_url}
                              alt={app.name}
                              className="w-14 h-14 rounded-xl flex-shrink-0"
                            />
                          ) : (
                            <div className="w-14 h-14 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
                              {app.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-gray-900 group-hover:text-primary-600 transition-colors truncate text-sm mb-1">
                              {app.name}
                            </h3>
                            <div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
                              {app.average_rating && app.average_rating > 0 && (
                                <span className="flex items-center gap-0.5">
                                  <Star size={11} className="text-yellow-500 fill-current" />
                                  <span>{app.average_rating.toFixed(1)}</span>
                                  {app.rating_count && app.rating_count > 0 && (
                                    <span className="text-gray-400">
                                      ({app.rating_count >= 10000 
                                        ? `${(app.rating_count / 10000).toFixed(1)}${t('common.tenThousand')}`
                                        : app.rating_count.toLocaleString()})
                                    </span>
                                  )}
                                </span>
                              )}
                              {app.file_size_formatted && (
                                <>
                                  {app.average_rating && app.average_rating > 0 && <span className="text-gray-300">·</span>}
                                  <span>{app.file_size_formatted}</span>
                                </>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 truncate leading-tight">
                              {[app.developer_name, app.subtitle || app.primary_genre].filter(Boolean).join(' · ')}
                            </p>
                          </div>

                          {(() => {
                            const isPaid = app.price > 0;
                            const status = licenseStatus[app.bundle_id];
                            const hasLicense = status?.has_license || false;
                            const isChecking = status?.is_checking || false;

                            if (isPaid && !hasLicense) {
                              return (
                                <Tooltip.Provider delayDuration={200}>
                                  <Tooltip.Root>
                                    <Tooltip.Trigger asChild>
                                      <button
                                        onClick={(e) => e.stopPropagation()}
                                        disabled={true}
                                        className="flex-shrink-0 px-3 py-2 bg-orange-50 text-orange-600 rounded-lg cursor-not-allowed flex items-center space-x-1.5 text-xs font-medium"
                                      >
                                        {isChecking ? (
                                          <>
                                            <Loader2 className="animate-spin" size={14} />
                                            <span>{t('search.checkingLicense')}</span>
                                          </>
                                        ) : (
                                          <>
                                            <ShoppingCart size={14} />
                                            <span>{t('search.requiresPurchase')}</span>
                                          </>
                                        )}
                                      </button>
                                    </Tooltip.Trigger>
                                    <Tooltip.Portal>
                                      <Tooltip.Content
                                        className="px-3 py-1.5 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-[9999]"
                                        sideOffset={5}
                                      >
                                        {t('search.paidAppRequiresPurchaseOnDevice')}
                                        <Tooltip.Arrow className="fill-gray-900" />
                                      </Tooltip.Content>
                                    </Tooltip.Portal>
                                  </Tooltip.Root>
                                </Tooltip.Provider>
                              );
                            }

                            const isDownloading = !!getActiveDownloadTaskByBundleId(app.bundle_id);

                            return (
                              <Button3D
                                variant="secondary"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const btn = e.currentTarget as HTMLElement;
                                  animateFlyToDownloadsFab(btn);
                                  handleDownload(app.bundle_id, undefined, app.name);
                                }}
                                disabled={isDownloading}
                                loading={isDownloading}
                              >
                                {!isDownloading && <Download size={14} />}
                                <span>{t('search.download')}</span>
                              </Button3D>
                            );
                          })()}
                        </div>
                      </div>
                    ))}
                  </div>

                  {isLoadingMore && (
                    <div className="col-span-2 flex justify-center py-4">
                      <Loader2 className="animate-spin text-primary-600" size={32} />
                    </div>
                  )}
                  {!hasMore && displayedResults.length > 0 && (
                    <div className="col-span-2 text-center mt-8 pt-6 text-gray-400 text-sm border-t border-gray-100">
                      {t('search.noMore')}
                    </div>
                  )}
                  
                  <div ref={loadMoreRef} style={{ height: '1px' }} />

                  {displayedResults.length === 0 && !isSearching && searchQuery && (
                    <div className="col-span-2 text-center py-20">
                      <Package className="mx-auto text-gray-300 mb-4" size={60} />
                      <p className="text-gray-500 text-lg">{t('search.noResults')}</p>
                      <p className="text-gray-400 text-sm mt-2">{t('search.tryDifferentKeywords')}</p>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

      {showVersionDialog && versionDialogApp && (
        <VersionHistoryDialog
          app={versionDialogApp}
          onClose={() => {
            setShowVersionDialog(false);
            setVersionDialogApp(null);
          }}
          onDownloadVersion={handleDownloadVersion}
        />
      )}
    </>
  );
}

