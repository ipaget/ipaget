import { useState, useEffect, useRef, Fragment } from 'react';
import { useDownloadStore } from '../store/downloadStore';
import { useAccountStore } from '../store/accountStore';
import { useInstallStore } from '../store/installStore';
import { invoke } from '@tauri-apps/api/core';
import { Download, Loader2, CheckCircle, AlertCircle, ArrowRight, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import IpaPreviewDialog from './IpaPreviewDialog';
import { useErrorStore } from '../store/errorStore';
import { goServiceClient } from '../lib/goService';
import { Dialog, Transition } from '@headlessui/react';
import CopyButton from './CopyButton';
import type { DownloadTask } from '../store/downloadStore';

export default function ActiveDownloadsPopup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const downloads = useDownloadStore((state) => state.downloads);
  const startDownload = useDownloadStore((state) => state.startDownload);
  const removeDownload = useDownloadStore((state) => state.removeDownload);
  const updateDownload = useDownloadStore((state) => state.updateDownload);
	const { selectedAccount } = useAccountStore();
  const [isOpen, setIsOpen] = useState(false);
  const prevTaskCountRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const { showError } = useErrorStore();
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const { startInstall } = useInstallStore();
  const [fadingOutTasks, setFadingOutTasks] = useState<Set<string>>(new Set());
  const [errorDetailsTask, setErrorDetailsTask] = useState<DownloadTask | null>(null);

  const downloadTasks = downloads.filter(d => d.status === 'downloading' || d.status === 'cancelled');
  const completedTasks = downloads
    .filter(d => d.status === 'completed')
    .sort((a, b) => (b.endTime || 0) - (a.endTime || 0))
    .slice(0, 3);

  const errorTasks = downloads
    .filter(d => d.status === 'failed')
    .sort((a, b) => (b.endTime || 0) - (a.endTime || 0))
    .slice(0, 3);

	// Check if there are any active tasks (updated within last 3 seconds)
	const hasActiveTasks = () => {
		const now = Date.now();
		const activeThreshold = 3000; // 3 seconds
		return downloadTasks.some(task => 
			task.status === 'downloading' && (now - task.lastUpdateTime) < activeThreshold
		);
	};

	useEffect(() => {
    const currentTaskCount = downloadTasks.length;
    if (currentTaskCount > 0 && currentTaskCount > prevTaskCountRef.current) {
      setIsOpen(true);
    }
    prevTaskCountRef.current = currentTaskCount;
  }, [downloadTasks.length]);

	// Auto-close when there are no active tasks
	useEffect(() => {
		if (!isOpen || downloadTasks.length === 0) return;
		
		const checkInterval = setInterval(() => {
			// Don't auto-close if there are active tasks or error tasks
			if (hasActiveTasks() || errorTasks.length > 0) {
				return;
			}
			
			// Auto-close if all tasks are inactive
			const allInactive = downloadTasks.every(task => {
				const now = Date.now();
				return task.status !== 'downloading' || (now - task.lastUpdateTime) >= 3000;
			});
			
			if (allInactive) {
				setIsOpen(false);
			}
		}, 1000); // Check every second
		
		return () => clearInterval(checkInterval);
	}, [isOpen, downloadTasks, errorTasks.length]);

	// Keep popup open when there are error tasks
	useEffect(() => {
		if (errorTasks.length > 0) {
			setIsOpen(true);
		}
	}, [errorTasks.length]);

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

  // Close when clicking outside the popup/button
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!errorDetailsTask) return;
    const stillExists = downloads.some((d) => d.id === errorDetailsTask.id);
    if (!stillExists) {
      setErrorDetailsTask(null);
    }
  }, [downloads, errorDetailsTask]);

  // Always show the floating action button; allow expanded list even when empty (show empty state)

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'purchasing':
      case 'downloading':
        return <Loader2 className="animate-spin text-blue-500" size={20} />;
      case 'completed':
        return <CheckCircle className="text-green-500" size={20} />;
      case 'failed':
        return <AlertCircle className="text-red-500" size={20} />;
      default:
        return <Loader2 className="animate-spin text-gray-500" size={20} />;
    }
  };

	const classifyError = (message?: string, dataError?: string): 'network' | 'account' | 'unknown' => {
		const m = String(message || dataError || '').toLowerCase();
		if (!m) return 'unknown';
		const networkPatterns = [
			'timeout',
			'handshake',
			'tls',
			'network',
			'failed to make round trip',
			'context deadline exceeded',
			'context canceled',
			'connection refused',
			'dial tcp',
		];
		if (networkPatterns.some(p => m.includes(p))) return 'network';
		const accountPatterns = [
			'could not be verified',
			'verify',
			'token',
			'auth',
			'password',
			'invalid',
			'credential',
			'password token is expired',
		];
		if (accountPatterns.some(p => m.includes(p))) return 'account';
		return 'unknown';
	};

  const retryDownload = async (task: DownloadTask) => {
		try {
			const bundleId = task?.bundleId as string | undefined;
			const appName = (task?.appName as string | undefined) || bundleId || 'App';
			const iconUrl = task?.iconUrl as string | undefined;
			if (!bundleId || !selectedAccount?.email) return;
			const downloadDir = await invoke<string>('get_download_directory');
			// Remove the failed task to declutter
			removeDownload(task.id);
			await startDownload(bundleId, selectedAccount.email, downloadDir, appName, iconUrl);
			setIsOpen(true);
		} catch (e) {
			// No-op: errors will surface via task events again
		}
	};

  const closeErrorDetails = () => setErrorDetailsTask(null);

  return (
    <>
    <div ref={containerRef} className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'tween', duration: 0.18, ease: 'easeOut' }}
            className="mb-2 w-80 bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden"
          >
            <div className="p-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">
                {t('downloads.activeDownloads')} ({downloadTasks.length})
              </h3>
            </div>
			<div className="max-h-60 overflow-y-auto p-2">
				{errorTasks.length > 0 && (
					<div className="space-y-2">
                        {errorTasks.map((task) => {
                            const classification = classifyError(task.error, undefined);
                            const getErrorText = () => {
                                if (classification === 'network') return '网络错误';
                                if (classification === 'account') return '账号错误';
                                // For unknown errors, try to extract meaningful info
                                const errorMsg = task.error;
                                if (errorMsg) {
                                    // If it's "An unknown error has occurred", show "未知错误"
                                    if (errorMsg.toLowerCase().includes('unknown error')) {
                                        return '未知错误';
                                    }
                                    // For other errors, show a truncated version
                                    if (errorMsg.length > 30) {
                                        return errorMsg.substring(0, 30) + '...';
                                    }
                                    return errorMsg;
                                }
                                return '错误';
                            };
							return (
	<div
	key={task.id}
  className="flex items-center space-x-3 p-2 rounded-md bg-red-50 border border-red-100 cursor-pointer hover:bg-red-100/60 transition-colors"
		onClick={() => setErrorDetailsTask(task as DownloadTask)}
	role="button"
		tabIndex={0}
		onKeyDown={(e) => {
	if (e.key === 'Enter' || e.key === ' ') {
		e.preventDefault();
	setErrorDetailsTask(task as DownloadTask);
	}
	}}
		title={task.error || ''}
	>
									<div className="flex-shrink-0">
										<AlertCircle className="text-red-500" size={20} />
									</div>
									<div className="flex-1 min-w-0">
										<p className="text-xs font-medium text-gray-800 truncate">
											{task.appName || task.bundleId || 'Unknown App'}
										</p>
										<p className="text-[11px] text-gray-600 mt-0.5">
											{getErrorText()}
										</p>
									</div>
									<div className="flex-shrink-0 flex items-center gap-1.5">
										<button
                onClick={(e) => {
                e.stopPropagation();
                retryDownload(task as DownloadTask);
              }}
											className="w-8 h-8 rounded-full text-gray-600 hover:bg-gray-100 flex items-center justify-center"
											title={t('common.retry')}
										>
											<RotateCcw size={14} />
										</button>
										<button
                onClick={(e) => {
                e.stopPropagation();
              removeDownload(task.id);
              }}
											className="w-8 h-8 rounded-full text-red-600 hover:bg-gray-100 flex items-center justify-center"
											title={t('downloads.delete')}
										>
											<X size={14} />
										</button>
									</div>
								</div>
							);
						})}
					</div>
				)}
              <AnimatePresence mode="popLayout">
                {downloadTasks.length === 0 ? (
                  <motion.div
                    key="empty-state"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.3 }}
                    className="py-8 text-center text-xs text-gray-500"
                  >
                    {t('downloads.noActiveDownloads')}
                  </motion.div>
                ) : (
                  downloadTasks.map((task) => (
                    <motion.div
                      key={task.id}
                      layout
                      initial={{ opacity: 1, height: 'auto' }}
                      animate={{ 
                        opacity: task.status === 'cancelled' && fadingOutTasks.has(task.id) ? 0 : 1,
                        height: task.status === 'cancelled' && fadingOutTasks.has(task.id) ? 0 : 'auto',
                        marginBottom: task.status === 'cancelled' && fadingOutTasks.has(task.id) ? 0 : 8
                      }}
                      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                      transition={{ duration: 0.3, ease: 'easeInOut' }}
                      className={`p-2 rounded-md overflow-hidden ${
                        task.status === 'cancelled' ? 'bg-gray-100 border border-gray-300' : 'bg-gray-50'
                      }`}
                    >
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0">
                        {task.status === 'cancelled' ? (
                          <X className="text-gray-500" size={20} />
                        ) : (
                          getStatusIcon(task.status)
                        )}
                      </div>
										<div className="flex-1 min-w-0">
											<div className="flex items-center gap-2 min-w-0">
										{(() => {
											const name = (task.appName || task.bundleId || 'Unknown App') as string;
											const letter = name.charAt(0).toUpperCase();
											const iconUrl = task.iconUrl as string | undefined;
											return (
												<>
													{iconUrl ? (
														<img src={iconUrl} alt={name} className="w-5 h-5 rounded-md shadow-sm flex-shrink-0" />
													) : (
														<div className="w-5 h-5 rounded-md bg-gray-200 text-[10px] font-semibold text-gray-700 flex items-center justify-center flex-shrink-0">
															{letter}
														</div>
													)}
													<div className="flex-1 min-w-0">
														<p className="text-xs font-medium text-gray-800 truncate">{name}</p>
														{task.status === 'cancelled' && (
															<p className="text-[10px] text-gray-500">已取消</p>
														)}
													</div>
												</>
											);
										})()}
											</div>
										</div>
                      {task.status !== 'cancelled' && (
                        <div className="flex-shrink-0 flex items-center gap-2">
                          <div className="text-xs font-medium text-gray-600">
                            {Math.round(task.progress || 0)}%
                          </div>
                          <button
                          onClick={async () => {
                            // Optimistic UI update: mark as cancelled immediately
                            updateDownload(task.id, { status: 'cancelled', endTime: Date.now() });
                            try {
                              await goServiceClient.cancelTask(task.id);
                            } catch (err) {
                              console.error('Failed to cancel task:', err);
                            }
                          }}
                            className="w-6 h-6 rounded-full text-gray-600 hover:bg-gray-200 flex items-center justify-center transition-colors"
                            title={t('common.cancel')}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                    {/* Progress bar - only show for downloading tasks */}
                    {task.status === 'downloading' && (
                      <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden mt-2">
                        <div
                          className="h-full bg-blue-500 transition-all duration-300 ease-out"
                          style={{ width: `${Math.max(0, Math.min(100, task.progress || 0))}%` }}
                        />
                      </div>
                    )}
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
            {completedTasks.length > 0 && (
              <div className="border-t border-gray-100">
                <div className="px-3 pt-2 pb-1">
                  <h4 className="text-[11px] font-semibold text-gray-500">{t('downloads.recentCompleted')}</h4>
                </div>
                <div className="p-2 space-y-2">
                  {completedTasks.map((task) => (
                    <div key={task.id} className="flex items-center space-x-3 p-2 rounded-md bg-green-50">
                      <div className="flex-shrink-0">
                        {(() => {
                          const name = (task.appName || task.bundleId || 'Unknown App') as string;
                          const letter = name.charAt(0).toUpperCase();
                          const iconUrl = task.iconUrl as string | undefined;
                          return iconUrl ? (
                            <img src={iconUrl} alt={name} className="w-5 h-5 rounded-md shadow-sm flex-shrink-0" />
                          ) : (
                            <div className="w-5 h-5 rounded-md bg-white/70 text-[10px] font-semibold text-green-700 flex items-center justify-center flex-shrink-0">
                              {letter}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">
                          {task.appName || task.bundleId || 'Unknown App'}
                        </p>
                      </div>
                      <div className="flex-shrink-0">
                        <button
                          onClick={() => {
                            const filePath = task.filePath as string | undefined;
                            if (filePath) {
                              setPreviewPath(filePath);
                            }
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium rounded border border-green-600 text-green-600 bg-white hover:bg-green-50"
                        >
                          {t('downloads.install')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-3 pb-3">
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      navigate('/library');
                    }}
                    className="w-full flex items-center justify-center gap-1 text-[11px] text-gray-600 hover:text-gray-800"
                  >
                    <span>{t('downloads.viewMoreInManager')}</span>
                    <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <button
        onClick={() => setIsOpen(!isOpen)}
        id="downloads-fab"
        className="w-12 h-12 bg-white text-primary-600 rounded-full shadow-xl border border-gray-200 flex items-center justify-center hover:shadow-2xl hover:bg-gray-50 transition-all active:scale-95"
        aria-label={t('downloads.toggleDownloadsView')}
      >
        <Download size={18} />
      </button>
    </div>

        <Transition appear show={!!errorDetailsTask} as={Fragment}>
          <Dialog as="div" className="relative z-[60]" onClose={closeErrorDetails}>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black/50" />
            </Transition.Child>

            <div className="fixed inset-0 overflow-y-auto">
              <div className="flex min-h-full items-center justify-center p-4">
                <Transition.Child
                  as={Fragment}
                  enter="ease-out duration-200"
                  enterFrom="opacity-0 scale-95"
                  enterTo="opacity-100 scale-100"
                  leave="ease-in duration-150"
                  leaveFrom="opacity-100 scale-100"
                  leaveTo="opacity-0 scale-95"
                >
                  <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-2xl transition-all">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                          {t('downloads.errorDetailsTitle')}
                        </Dialog.Title>
                        <p className="text-sm text-gray-600 mt-1 truncate">
                          {errorDetailsTask?.appName || errorDetailsTask?.bundleId || t('common.unknownApp')}
                        </p>
                      </div>
                      <button
                        onClick={closeErrorDetails}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                        aria-label={t('common.close')}
                      >
                        <X size={20} />
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
	<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
  <div className="rounded-lg border border-gray-200 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-gray-500">{t('common.bundleId')}</div>
                            {errorDetailsTask?.bundleId && <CopyButton text={errorDetailsTask.bundleId} />}
                          </div>
                          <div className="text-sm text-gray-900 break-words overflow-wrap-anywhere">
                            {errorDetailsTask?.bundleId || '-'}
                          </div>
                        </div>
  <div className="rounded-lg border border-gray-200 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs text-gray-500">{t('common.taskId')}</div>
                            {errorDetailsTask?.id && <CopyButton text={errorDetailsTask.id} />}
                          </div>
                          <div className="text-sm text-gray-900 break-words overflow-wrap-anywhere">
                            {errorDetailsTask?.id || '-'}
                          </div>
                        </div>
                      </div>

  <div className="rounded-lg border border-gray-200 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs text-gray-500">{t('downloads.errorMessage')}</div>
                          {errorDetailsTask?.error && <CopyButton text={errorDetailsTask.error} />}
                        </div>
  <pre className="mt-2 text-[12px] leading-5 whitespace-pre-wrap break-words overflow-wrap-anywhere text-gray-900 bg-gray-50 border border-gray-100 rounded-lg p-3 max-h-[45vh] overflow-auto">
                          {errorDetailsTask?.error || '-'}
                        </pre>
                      </div>
                    </div>

                    <div className="mt-5 flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          if (errorDetailsTask) {
                            retryDownload(errorDetailsTask);
                            closeErrorDetails();
                          }
                        }}
  className="px-4 py-2 bg-white border border-gray-200 text-gray-800 rounded-lg hover:bg-gray-50 transition-colors inline-flex items-center gap-2"
                        disabled={!errorDetailsTask}
                      >
                        <RotateCcw size={16} />
                        {t('common.retry')}
                      </button>
                      <button
                        onClick={() => {
                          if (errorDetailsTask) {
                            removeDownload(errorDetailsTask.id);
                            closeErrorDetails();
                          }
                        }}
  className="px-4 py-2 bg-white border border-red-200 text-red-700 rounded-lg hover:bg-red-50 transition-colors"
                        disabled={!errorDetailsTask}
                      >
                        {t('downloads.delete')}
                      </button>
                      <button
                        onClick={closeErrorDetails}
                        className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                      >
                        {t('common.close')}
                      </button>
                    </div>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>

    <IpaPreviewDialog
      filePath={previewPath}
      onClose={() => setPreviewPath(null)}
      onInstall={async (filePath, deviceUdid, certificateId) => {
        try {
          await startInstall(deviceUdid, filePath, undefined, undefined, undefined, certificateId);
          setPreviewPath(null);
        } catch (error: any) {
          showError(t('devices.installIpaFailed'), error?.toString?.() || String(error));
        }
      }}
    />
  </>
  );
}
