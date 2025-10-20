import { useState, useEffect, Fragment } from "react";
import { X, Loader2, FileText, Shield, Package } from "lucide-react";
import { Dialog, Transition, Tab } from "@headlessui/react";
import { useTranslation } from "react-i18next";
import EntitlementsView from "./EntitlementsView";
import { goServiceClient } from "../lib/goService";

interface IpaDetails {
  entitlements_xml: string;
  files: FileItem[];
  resources: ResourceItem[];
}

interface FileItem {
  path: string;
  size: number;
  is_directory: boolean;
}

interface ResourceItem {
  name: string;
  type: string;
  size: number;
}

interface IpaDetailsDialogProps {
  filePath: string | null;
  onClose: () => void;
}

function classNames(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}

export default function IpaDetailsDialog({
  filePath,
  onClose,
}: IpaDetailsDialogProps) {
  const { t } = useTranslation();
  const [details, setDetails] = useState<IpaDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");

  useEffect(() => {
    if (!filePath) {
      setDetails(null);
      setError(null);
      setProgress(0);
      setProgressMessage("");
      return;
    }

    const loadDetails = async () => {
      setIsLoading(true);
      setError(null);
      setProgress(0);
      setProgressMessage(t("ipaDetails.loading"));

      try {
        const { task_id } = await goServiceClient.getIpaDetails(filePath);

        const handleProgress = (event: any) => {
          if (event.type === "task_progress" && 
              event.task_type === "ipa_details" && 
              event.task_id === task_id) {
            setProgress(event.progress);
            setProgressMessage(event.message);
            
            if (event.status === "completed" && event.data) {
              setDetails(event.data as IpaDetails);
              setIsLoading(false);
            } else if (event.status === "error") {
              setError(event.message || "Failed to load IPA details");
              setIsLoading(false);
            }
          }
        };

        goServiceClient.connectWebSocket(handleProgress);
        
        return () => {
          goServiceClient.disconnectWebSocket(handleProgress);
        };
      } catch (err: any) {
        console.error("Failed to load IPA details:", err);
        setError(err.message || "Failed to load IPA details");
        setIsLoading(false);
      }
    };

    loadDetails();
  }, [filePath, t]);

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(2)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(2)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  };

  return (
    <Transition appear show={!!filePath} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl max-h-[75vh] transform overflow-hidden rounded-2xl bg-white text-left align-middle shadow-xl transition-all flex flex-col">
                <div className="flex items-center justify-between p-6 pb-4 border-b border-gray-200">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-medium leading-6 text-gray-900"
                  >
                    {t("ipaDetails.title")}
                  </Dialog.Title>
                  <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-500"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <Loader2 className="animate-spin text-primary-600" size={40} />
                    <div className="w-full max-w-md">
                      <div className="w-full bg-gray-200 rounded-full h-2.5">
                        <div
                          className="bg-primary-600 h-2.5 rounded-full transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        ></div>
                      </div>
                      <p className="text-sm text-gray-600 text-center mt-2">
                        {progressMessage}
                      </p>
                    </div>
                  </div>
                ) : error ? (
                  <div className="py-6">
                    <p className="text-red-600 text-center">{error}</p>
                  </div>
                ) : details ? (
                  <Tab.Group>
                    <Tab.List className="flex space-x-1 rounded-xl bg-primary-100 p-1 mb-4">
                      <Tab
                        className={({ selected }) =>
                          classNames(
                            'w-full rounded-lg py-2.5 text-sm font-medium leading-5',
                            'ring-white ring-opacity-60 ring-offset-2 ring-offset-primary-400 focus:outline-none focus:ring-2',
                            selected
                              ? 'bg-white text-primary-700 shadow'
                              : 'text-primary-600 hover:bg-white/[0.12] hover:text-primary-700'
                          )
                        }
                      >
                        <div className="flex items-center justify-center space-x-2">
                          <Shield size={18} />
                          <span>{t("ipaDetails.tabs.entitlements")}</span>
                        </div>
                      </Tab>
                      <Tab
                        className={({ selected }) =>
                          classNames(
                            'w-full rounded-lg py-2.5 text-sm font-medium leading-5',
                            'ring-white ring-opacity-60 ring-offset-2 ring-offset-primary-400 focus:outline-none focus:ring-2',
                            selected
                              ? 'bg-white text-primary-700 shadow'
                              : 'text-primary-600 hover:bg-white/[0.12] hover:text-primary-700'
                          )
                        }
                      >
                        <div className="flex items-center justify-center space-x-2">
                          <FileText size={18} />
                          <span>{t("ipaDetails.tabs.files")}</span>
                        </div>
                      </Tab>
                      <Tab
                        className={({ selected }) =>
                          classNames(
                            'w-full rounded-lg py-2.5 text-sm font-medium leading-5',
                            'ring-white ring-opacity-60 ring-offset-2 ring-offset-primary-400 focus:outline-none focus:ring-2',
                            selected
                              ? 'bg-white text-primary-700 shadow'
                              : 'text-primary-600 hover:bg-white/[0.12] hover:text-primary-700'
                          )
                        }
                      >
                        <div className="flex items-center justify-center space-x-2">
                          <Package size={18} />
                          <span>{t("ipaDetails.tabs.resources")}</span>
                        </div>
                      </Tab>
                    </Tab.List>
                    <Tab.Panels className="mt-2">
                      <Tab.Panel className="rounded-xl bg-white p-3">
                        {details.entitlements_xml ? (
                          <EntitlementsView entitlementsXml={details.entitlements_xml} />
                        ) : (
                          <p className="text-gray-500 text-center py-8">
                            {t("ipaDetails.noEntitlements")}
                          </p>
                        )}
                      </Tab.Panel>
                      <Tab.Panel className="rounded-xl bg-white p-3">
                        {details.files && details.files.length > 0 ? (
                          <div className="space-y-1">
                            <div className="sticky top-0 bg-white border-b border-gray-200 pb-2 mb-2">
                              <p className="text-sm text-gray-600">
                                {t("ipaDetails.totalFiles", { count: details.files.length })}
                              </p>
                            </div>
                            {details.files.map((file, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded-lg"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-mono text-gray-900 truncate">
                                    {file.path}
                                  </p>
                                </div>
                                <div className="flex items-center space-x-4 ml-4">
                                  {file.is_directory ? (
                                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                                      {t("ipaDetails.directory")}
                                    </span>
                                  ) : (
                                    <span className="text-xs text-gray-600">
                                      {formatSize(file.size)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-gray-500 text-center py-8">
                            {t("ipaDetails.noFiles")}
                          </p>
                        )}
                      </Tab.Panel>
                      <Tab.Panel className="rounded-xl bg-white p-3">
                        {details.resources && details.resources.length > 0 ? (
                          <div className="space-y-1">
                            <div className="sticky top-0 bg-white border-b border-gray-200 pb-2 mb-2">
                              <p className="text-sm text-gray-600">
                                {t("ipaDetails.totalResources", { count: details.resources.length })}
                              </p>
                            </div>
                            {details.resources.map((resource, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 rounded-lg"
                              >
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-900 truncate">
                                    {resource.name}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {resource.type}
                                  </p>
                                </div>
                                <div className="ml-4">
                                  <span className="text-xs text-gray-600">
                                    {formatSize(resource.size)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-gray-500 text-center py-8">
                            {t("ipaDetails.noResources")}
                          </p>
                        )}
                      </Tab.Panel>
                    </Tab.Panels>
                  </Tab.Group>
                ) : null}
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

