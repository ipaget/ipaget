import { useState, useEffect, Fragment } from "react";
import { X, Loader2, FileText, Shield } from "lucide-react";
import { Dialog, Transition, Tab } from "@headlessui/react";
import { useTranslation } from "react-i18next";
import EntitlementsView from "./EntitlementsView";
import FileTree from "./FileTree";
import PluginsView from "./PluginsView";
import PropertiesView from "./PropertiesView";
import { goServiceClient, IPADetails } from "../lib/goService";

interface IpaDetailsDialogProps {
  filePath: string | null;
  onClose: () => void;
  onModified?: (modified: boolean) => void;
  view?: "details" | "plugins" | "properties";
}

export default function IpaDetailsDialog({
  filePath,
  onClose,
  onModified,
  view = "details",
}: IpaDetailsDialogProps) {
  const { t } = useTranslation();
  const [displayFilePath, setDisplayFilePath] = useState<string | null>(null);
  const [details, setDetails] = useState<IPADetails | null>(null);
  const [originalDetails, setOriginalDetails] = useState<IPADetails | null>(null);
  const [isModified, setIsModified] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (filePath) {
      setDisplayFilePath(filePath);
    }
  }, [filePath]);

  useEffect(() => {
    if (!displayFilePath) {
      return;
    }

    const loadDetails = async () => {
      setIsLoading(true);
      setError(null);
      setDetails(null);
      setOriginalDetails(null);
      setIsModified(false);

      try {
        console.log("IPA Details - Loading details for:", displayFilePath);
        const data = await goServiceClient.getIpaDetails(displayFilePath);
        console.log("IPA Details - Loaded successfully");
        setDetails(data);
        setOriginalDetails(JSON.parse(JSON.stringify(data)));
      } catch (err: any) {
        console.error("Failed to load IPA details:", err);
        setError(err.message || "Failed to load IPA details");
      } finally {
        setIsLoading(false);
      }
    };

    loadDetails();
  }, [displayFilePath]);

  const handlePluginsModified = () => {
    if (!details || !originalDetails) return;
    
    const modified = JSON.stringify(details) !== JSON.stringify(originalDetails);
    setIsModified(modified);
    if (onModified) {
      onModified(modified);
    }
  };


  return (
    <Transition
      appear
      show={!!filePath}
      as={Fragment}
      afterLeave={() => {
        setDisplayFilePath(null);
        setDetails(null);
        setOriginalDetails(null);
        setIsModified(false);
        setIsLoading(false);
        setError(null);
      }}
    >
      <Dialog as="div" className="relative z-[80]" onClose={onClose}>
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
              leaveTo="opacity-0 scale-100"
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

                <div className="flex-1 px-4 pb-4 pt-2">
                {isLoading ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <Loader2 className="animate-spin text-primary-600" size={40} />
                    <p className="text-sm text-gray-600">{t("ipaDetails.loading")}</p>
                  </div>
                ) : error ? (
                  <div className="py-6">
                    <p className="text-red-600 text-center">{error}</p>
                  </div>
                ) : details ? (
                  <>
                    {isModified && (
                      <div className="mb-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-sm text-red-700 font-medium">
                          {t("ipaDetails.modified.warning")}
                        </p>
                        <p className="text-xs text-red-600 mt-1">
                          {t("ipaDetails.modified.allowInstall")}
                        </p>
                      </div>
                    )}
                    {view === "details" && (
                      <Tab.Group>
                        <Tab.List className="flex space-x-1 rounded-xl bg-gray-100 p-1 mb-2">
                          <Tab
                            className={({ selected }) =>
                              [
                                "w-full rounded-lg py-2 text-sm font-medium leading-5",
                                "ring-white ring-opacity-60 focus:outline-none focus:ring-2",
                                selected
                                  ? "bg-white text-gray-900 shadow"
                                  : "text-gray-600 hover:bg-white/[0.5] hover:text-gray-900",
                              ].join(" ")
                            }
                          >
                            <div className="flex items-center justify-center space-x-2">
                              <Shield size={16} />
                              <span>{t("ipaDetails.tabs.entitlements")}</span>
                            </div>
                          </Tab>
                          <Tab
                            className={({ selected }) =>
                              [
                                "w-full rounded-lg py-2 text-sm font-medium leading-5",
                                "ring-white ring-opacity-60 focus:outline-none focus:ring-2",
                                selected
                                  ? "bg-white text-gray-900 shadow"
                                  : "text-gray-600 hover:bg-white/[0.5] hover:text-gray-900",
                              ].join(" ")
                            }
                          >
                            <div className="flex items-center justify-center space-x-2">
                              <FileText size={16} />
                              <span>{t("ipaDetails.tabs.files")}</span>
                            </div>
                          </Tab>
                        </Tab.List>
                        <Tab.Panels className="h-[450px]">
                          <Tab.Panel className="rounded-xl bg-white p-3 h-full overflow-y-auto scrollbar-thin">
                            {details.entitlements_xml ? (
                              <EntitlementsView entitlementsXml={details.entitlements_xml} />
                            ) : (
                              <p className="text-gray-500 text-center py-4 text-sm">
                                {t("ipaDetails.noEntitlements")}
                              </p>
                            )}
                          </Tab.Panel>
                          <Tab.Panel className="rounded-xl bg-white p-3 h-full overflow-y-auto scrollbar-thin">
                            {details.files && details.files.length > 0 && displayFilePath ? (
                              <FileTree files={details.files} ipaPath={displayFilePath} />
                            ) : (
                              <p className="text-gray-500 text-center py-4 text-sm">
                                {t("ipaDetails.noFiles")}
                              </p>
                            )}
                          </Tab.Panel>
                        </Tab.Panels>
                      </Tab.Group>
                    )}
                    {view === "plugins" && (
                      <div className="rounded-xl bg-white pt-1 px-2 pb-2 h-[450px]">
                        <PluginsView
                          dylibs={details.dylibs || []}
                          frameworks={details.frameworks || []}
                          plugins={details.plugins || []}
                          onModified={handlePluginsModified}
                        />
                      </div>
                    )}
                    {view === "properties" && (
                      <div className="rounded-xl bg-white p-3 h-[450px] overflow-y-auto scrollbar-thin">
                        <PropertiesView properties={details.properties || {}} />
                      </div>
                    )}
                  </>
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

