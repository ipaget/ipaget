import { useState, useEffect, Fragment } from "react";
import { X, Package, Loader2 } from "lucide-react";
import { Dialog, Transition } from "@headlessui/react";
import { useTranslation } from "react-i18next";
import { stat } from "@tauri-apps/plugin-fs";
import { parseIPA } from "../lib/goService";
import DetailRow from "./DetailRow";
import IpaDetailsDialog from "./IpaDetailsDialog";

interface IpaInfo {
  name: string;
  bundleId: string;
  version: string;
  icon?: string;
  filePath: string;
  fileSize: number;
  minimumOSVersion?: string;
}

interface IpaPreviewDialogProps {
  filePath: string | null;
  onClose: () => void;
  onInstall: (filePath: string) => void;
}

export default function IpaPreviewDialog({
  filePath,
  onClose,
  onInstall,
}: IpaPreviewDialogProps) {
  const { t } = useTranslation();
  const [ipaInfo, setIpaInfo] = useState<IpaInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);

  useEffect(() => {
    if (!filePath) {
      setIpaInfo(null);
      setError(null);
      return;
    }

    const loadIpaInfo = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const stats = await stat(filePath);
        
        const parsedInfo = await parseIPA(filePath);

        setIpaInfo({
          name: parsedInfo.name,
          bundleId: parsedInfo.bundle_id,
          version: parsedInfo.version,
          icon: parsedInfo.icon_base64,
          filePath: filePath,
          fileSize: stats.size || 0,
          minimumOSVersion: parsedInfo.minimum_os_version,
        });
      } catch (err: any) {
        console.error("Failed to parse IPA:", err);
        setError(err.message || "Failed to load IPA information");
      } finally {
        setIsLoading(false);
      }
    };

    loadIpaInfo();
  }, [filePath]);

  const handleInstall = () => {
    if (filePath) {
      onInstall(filePath);
      onClose();
    }
  };

  const formatSize = (bytes: number): string => {
    const mb = bytes / (1024 * 1024);
    const gb = mb / 1024;

    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    return `${mb.toFixed(2)} MB`;
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
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                <div className="flex items-center justify-between mb-4">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-medium leading-6 text-gray-900"
                  >
                    {t("ipaPreview.title")}
                  </Dialog.Title>
                  <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-gray-500"
                  >
                    <X size={20} />
                  </button>
                </div>

                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="animate-spin text-primary-600" size={40} />
                  </div>
                ) : error ? (
                  <div className="py-6">
                    <p className="text-red-600 text-center">{error}</p>
                  </div>
                ) : ipaInfo ? (
                  <div>
                    <div className="flex flex-col items-center mb-6">
                      {ipaInfo.icon ? (
                        <img
                          src={`data:image/png;base64,${ipaInfo.icon}`}
                          alt={ipaInfo.name}
                          className="w-24 h-24 rounded-2xl shadow-lg mb-4"
                        />
                      ) : (
                        <div className="w-24 h-24 rounded-2xl shadow-lg mb-4 bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
                          <Package className="text-white" size={48} />
                        </div>
                      )}
                      <h4 className="text-xl font-semibold text-gray-900">
                        {ipaInfo.name}
                      </h4>
                    </div>

                    <div className="space-y-1 mb-6">
                      <DetailRow
                        label={t("common.version")}
                        value={ipaInfo.version}
                        copyable={false}
                      />
                      <DetailRow
                        label={t("common.bundleId")}
                        value={ipaInfo.bundleId}
                        copyable={true}
                      />
                      <DetailRow
                        label={t("common.fileSize")}
                        value={formatSize(ipaInfo.fileSize)}
                        copyable={false}
                      />
                    </div>

                    <div className="flex flex-col space-y-3">
                      <button
                        onClick={() => setShowDetailsDialog(true)}
                        className="w-full px-4 py-2 bg-white text-gray-700 rounded-lg hover:bg-gray-50 transition-colors border border-gray-300"
                      >
                        {t("ipaPreview.viewDetails")}
                      </button>
                      <div className="flex space-x-3">
                        <button
                          onClick={onClose}
                          className="flex-1 px-4 py-2 bg-white text-gray-700 rounded-lg hover:bg-gray-50 transition-colors border border-gray-300"
                        >
                          {t("common.cancel")}
                        </button>
                        <button
                          onClick={handleInstall}
                          className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                        >
                          {t("devices.installIpa")}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
        
        <IpaDetailsDialog
          filePath={showDetailsDialog ? filePath : null}
          onClose={() => setShowDetailsDialog(false)}
        />
      </Dialog>
    </Transition>
  );
}

