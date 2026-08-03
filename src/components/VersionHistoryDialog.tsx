import { Fragment, useEffect, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AppSearchResult, AppVersionHistory, TokenExpiredError, goServiceClient } from "../lib/goService";
import { useAccountStore, handleTokenExpired } from "../store/accountStore";
import { useErrorStore } from "../store/errorStore";
import VersionHistoryProgressDialog from "./VersionHistoryProgressDialog";
import { useTaskSubscription } from "../hooks/useTask";

interface VersionHistoryDialogProps {
  app: AppSearchResult;
  onClose: () => void;
  onDownloadVersion: (versionId: string) => void;
}

export default function VersionHistoryDialog({
  app,
  onClose,
  onDownloadVersion,
}: VersionHistoryDialogProps) {
  const { t } = useTranslation();
  const { selectedAccount } = useAccountStore();
  const { showError } = useErrorStore();

  const [versionHistory, setVersionHistory] = useState<AppVersionHistory | null>(null);
  const [taskId, setTaskId] = useState<string | undefined>();
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");

  const task = useTaskSubscription(taskId, {
    onProgress: (task) => {
      setProgress(task.progress);
      setStatusMessage(task.message);
    },
    onComplete: (task) => {
      if (task.data?.history) {
        setVersionHistory(task.data.history as AppVersionHistory);
      }
    },
    onError: (task) => {
      showError(t("search.versionsFailed"), task.message);
      onClose();
    },
  });

  useEffect(() => {
    const loadVersions = async () => {
      if (!selectedAccount?.email) {
        onClose();
        return;
      }
      try {
        const result = await goServiceClient.getAppVersionHistory(app.bundle_id, selectedAccount.email);
        setTaskId(result.task_id);
      } catch (error: any) {
        if (error instanceof TokenExpiredError) {
          handleTokenExpired();
        } else {
          showError(t("search.versionsFailed"), error?.toString?.() || String(error));
        }
        onClose();
      }
    };
    loadVersions();
  }, [app.bundle_id, onClose, selectedAccount, showError, t]);

  const isLoading = !versionHistory && task?.status !== "error";

  return (
    <>
      {/* Progress Dialog - shows while loading */}
      <VersionHistoryProgressDialog 
        appName={app.name} 
        isOpen={isLoading}
        progress={progress}
        message={statusMessage}
        onClose={onClose}
      />
      
      {/* Main Version History Dialog - shows after loading */}
      <Transition appear show={!isLoading} as={Fragment}>
        <Dialog as="div" className="relative z-40" onClose={onClose}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/40" />
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
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                  <div className="flex items-center justify-between mb-4">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                      {t('search.versionHistoryFor', { appName: app.name })}
                    </Dialog.Title>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                      <X size={20} />
                    </button>
                  </div>

                  {versionHistory && versionHistory.versions?.length > 0 ? (
                    <div className="max-h-[60vh] overflow-y-auto">
                      <table className="w-full text-sm text-left">
                        <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                          <tr>
                            <th className="px-6 py-3">{t('search.version')}</th>
                            <th className="px-6 py-3">{t('search.releaseDate')}</th>
                            <th className="px-6 py-3"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {versionHistory.versions.map((v) => (
                            <tr key={v.version_id} className="bg-white border-b hover:bg-gray-50">
                              <td className="px-6 py-3 font-medium text-gray-900">{v.version_string || v.version_id}</td>
                              <td className="px-6 py-3 text-gray-600">{v.release_date || 'N/A'}</td>
                              <td className="px-6 py-3 text-right">
                                <button
                                  onClick={() => onDownloadVersion(v.version_id)}
                                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                                >
                                  <Download size={16} />
                                  {t('search.download')}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-gray-500">
                      {t('search.noVersionsFound')}
                    </div>
                  )}

                  <div className="mt-6 flex justify-end">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">
                      {t('common.close')}
                    </button>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}

