import { Fragment, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { Package, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useToastStore } from "../store/toastStore";
import { AppInfo } from "../lib/goService";
import EntitlementsView from "./EntitlementsView";
import RawDataViewer from "./RawDataViewer";
import { useCopyToClipboard, useUpdateEffect } from "react-use";

interface AppDetailsDialogProps {
  app: AppInfo | null;
  appIcon?: string;
  onClose: () => void;
}

export default function AppDetailsDialog({ app, appIcon, onClose }: AppDetailsDialogProps) {
  const { t } = useTranslation();
  const { showToast } = useToastStore();
  const [detailsTab, setDetailsTab] = useState<'basic' | 'raw' | 'entitlements'>('basic');
  const [displayedAppDetails, setDisplayedAppDetails] = useState<AppInfo | null>(app);
  const [displayedAppIcon, setDisplayedAppIcon] = useState<string | undefined>(appIcon);
  const [clipboardState, copyToClipboard] = useCopyToClipboard();

  // Update displayed app details when selected app changes using useUpdateEffect
  useUpdateEffect(() => {
    if (app) {
      setDisplayedAppDetails(app);
      setDisplayedAppIcon(appIcon);
      setDetailsTab('basic');
    }
  }, [app, appIcon]);

  const handleCopyToClipboard = (text: string) => {
    copyToClipboard(text);
    if (clipboardState.error) {
      showToast(t("common.copyFailed"), "error");
    } else {
      showToast(t("common.copied"), "success");
    }
  };

  const formatSize = (bytes?: number): string => {
    if (!bytes) return '-';
    const kb = bytes / 1024;
    const mb = kb / 1024;
    const gb = mb / 1024;
    
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    if (mb >= 1) return `${mb.toFixed(2)} MB`;
    if (kb >= 1) return `${kb.toFixed(2)} KB`;
    return `${bytes} B`;
  };

  const getAuthTypeBadge = (authType: string) => {
    const badges = {
      apple_store: (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-[10px] font-medium">
          <span>{t("devices.authType.appleStore")}</span>
        </span>
      ),
      shared: (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-[10px] font-medium">
          <span>{t("devices.authType.shared")}</span>
        </span>
      ),
      development: (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-medium">
          <span>{t("devices.authType.development")}</span>
        </span>
      ),
      system: (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-[10px] font-medium">
          <span>{t("devices.authType.system")}</span>
        </span>
      ),
      jailbreak: (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-medium">
          <span>{t("devices.authType.jailbreak")}</span>
        </span>
      ),
    };
    return badges[authType as keyof typeof badges] || (
      <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px] font-medium">
        <span>{t("devices.authType.unknown")}</span>
      </span>
    );
  };

  return (
    <Transition appear show={!!app} as={Fragment}>
      <Dialog as="div" className="relative z-40" onClose={onClose}>
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
          <div className="flex min-h-full items-center justify-center p-4 text-center">
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
                {displayedAppDetails && (
                  <>
                    {/* App Icon and Name */}
                    <div className="flex items-center space-x-4 p-6 pb-4">
                      <div className="w-16 h-16 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0 shadow-md">
                        {displayedAppDetails.icon_data || displayedAppIcon ? (
                          <img
                            src={`data:image/png;base64,${
                              displayedAppDetails.icon_data || displayedAppIcon
                            }`}
                            alt={displayedAppDetails.name || displayedAppDetails.bundle_id}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary-400 to-primary-600">
                            <Package className="text-white" size={32} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xl font-bold text-gray-900 truncate">{displayedAppDetails.name || displayedAppDetails.bundle_id}</h4>
                        <p className="text-sm text-gray-500 truncate">{displayedAppDetails.bundle_id}</p>
                      </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex border-b border-gray-200 px-6">
                      <button
                        onClick={() => setDetailsTab('basic')}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors relative ${
                          detailsTab === 'basic'
                            ? 'text-primary-600'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        {t("devices.basicInfo")}
                        {detailsTab === 'basic' && (
                          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600"></div>
                        )}
                      </button>
                      <button
                        onClick={() => setDetailsTab('raw')}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors relative ${
                          detailsTab === 'raw'
                            ? 'text-primary-600'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        {t("devices.rawData")}
                        {detailsTab === 'raw' && (
                          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600"></div>
                        )}
                      </button>
                      <button
                        onClick={() => setDetailsTab('entitlements')}
                        className={`flex-1 px-4 py-3 text-sm font-medium transition-colors relative ${
                          detailsTab === 'entitlements'
                            ? 'text-primary-600'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        {t("devices.entitlements")}
                        {detailsTab === 'entitlements' && (
                          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600"></div>
                        )}
                      </button>
                    </div>

                    {/* Tab Content */}
                    {detailsTab === 'basic' && (
                      <div className="space-y-4 p-6 overflow-y-auto scrollbar-thin select-text">
                        {/* Details Grid */}
                        <div className="grid grid-cols-2 gap-4">
                          {/* Version */}
                          <div>
                            <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">{t("common.version")}</label>
                            <div className="flex items-center gap-2 flex-wrap text-sm">
                              <span className="text-gray-900 font-mono">{displayedAppDetails.version}</span>
                              {displayedAppDetails.sequence_number && (
                                <span className="text-xs text-gray-500">
                                  {t("devices.sequenceVersion")}: <span className="font-mono text-gray-700">{displayedAppDetails.sequence_number}</span>
                                </span>
                              )}
                              {displayedAppDetails.cf_bundle_numeric_version && (
                                <span className="text-xs text-gray-500">
                                  {t("devices.numericVersion")}: <span className="font-mono text-gray-700">{displayedAppDetails.cf_bundle_numeric_version}</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Auth Type */}
                          <div>
                            <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">{t("devices.authType.title")}</label>
                            <div>{getAuthTypeBadge(displayedAppDetails.auth_type)}</div>
                          </div>

                          {/* App Size */}
                          {displayedAppDetails.app_size && (
                            <div>
                              <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">{t("devices.appSizeFull")}</label>
                              <p className="text-sm text-gray-900">{formatSize(displayedAppDetails.app_size)}</p>
                            </div>
                          )}

                          {/* Data Size */}
                          {displayedAppDetails.data_size && displayedAppDetails.data_size > 0 && (
                            <div>
                              <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">{t("devices.dataSize")}</label>
                              <p className="text-sm text-gray-900">{formatSize(displayedAppDetails.data_size)}</p>
                            </div>
                          )}

                          {/* Build Machine OS */}
                          {displayedAppDetails.build_machine_os_build && (
                            <div>
                              <label className="text-xs font-semibold text-gray-500 uppercase">{t("devices.buildMachineOS")}</label>
                              <p className="text-sm text-gray-900 font-mono">{displayedAppDetails.build_machine_os_build}</p>
                            </div>
                          )}

                          {/* Executable */}
                          {displayedAppDetails.cf_bundle_executable && (
                            <div>
                              <label className="text-xs font-semibold text-gray-500 uppercase">{t("devices.executable")}</label>
                              <p className="text-sm text-gray-900 font-mono">{displayedAppDetails.cf_bundle_executable}</p>
                            </div>
                          )}

                          {/* Minimum OS */}
                          {displayedAppDetails.minimum_os_version && (
                            <div>
                              <label className="text-xs font-semibold text-gray-500 uppercase">{t("devices.minimumOS")}</label>
                              <p className="text-sm text-gray-900 font-mono">{displayedAppDetails.minimum_os_version}</p>
                            </div>
                          )}

                          {/* Application Type */}
                          {displayedAppDetails.application_type && (
                            <div>
                              <label className="text-xs font-semibold text-gray-500 uppercase">{t("devices.applicationType")}</label>
                              <p className="text-sm text-gray-900">{displayedAppDetails.application_type}</p>
                            </div>
                          )}
                        </div>

                        {/* Signer Identity */}
                        {displayedAppDetails.signer_identity && (
                          <div>
                            <label className="text-xs font-semibold text-gray-500 uppercase">{t("devices.signerIdentity")}</label>
                            <p className="text-sm text-gray-900 font-mono break-all">{displayedAppDetails.signer_identity}</p>
                          </div>
                        )}

                        {/* Path */}
                        {displayedAppDetails.path && (
                          <div>
                            <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">{t("devices.appPath")}</label>
                            <div className="flex items-center space-x-2">
                              <input
                                type="text"
                                value={displayedAppDetails.path}
                                readOnly
                                className="flex-1 text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 rounded px-3 py-2"
                              />
                              <button
                                onClick={() => displayedAppDetails.path && handleCopyToClipboard(displayedAppDetails.path)}
                                className="px-3 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors inline-flex items-center space-x-1"
                              >
                                <Copy size={14} />
                                <span className="text-xs">{t("devices.copyPath")}</span>
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Container */}
                        {displayedAppDetails.container && (
                          <div>
                            <label className="text-xs font-semibold text-gray-500 uppercase mb-1 block">{t("devices.containerPath")}</label>
                            <div className="flex items-center space-x-2">
                              <input
                                type="text"
                                value={displayedAppDetails.container}
                                readOnly
                                className="flex-1 text-xs font-mono text-gray-700 bg-gray-50 border border-gray-200 rounded px-3 py-2"
                              />
                              <button
                                onClick={() => displayedAppDetails.container && handleCopyToClipboard(displayedAppDetails.container)}
                                className="px-3 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors inline-flex items-center space-x-1"
                              >
                                <Copy size={14} />
                                <span className="text-xs">{t("devices.copyPath")}</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {detailsTab === 'raw' && (
                      displayedAppDetails.raw_data ? (
                        <RawDataViewer
                          data={displayedAppDetails.raw_data}
                          excludeKeys={['Entitlements']}
                        />
                      ) : (
                        <div className="p-6 overflow-y-auto scrollbar-thin">
                          <div className="text-center py-12 text-gray-500">
                            {t("devices.noRawData")}
                          </div>
                        </div>
                      )
                    )}

                    {detailsTab === 'entitlements' && (
                      <div className="p-6 overflow-y-auto scrollbar-thin">
                        {displayedAppDetails.entitlements_xml ? (
                          <EntitlementsView entitlementsXml={displayedAppDetails.entitlements_xml} />
                        ) : (
                          <div className="text-center py-12 text-gray-500">
                            {t("devices.noEntitlements")}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="p-6 pt-4 border-t border-gray-200 flex justify-end flex-shrink-0">
                      <button
                        type="button"
                        className="px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 transition-colors"
                        onClick={onClose}
                      >
                        {t("common.close")}
                      </button>
                    </div>
                  </>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
        </Dialog>
      </Transition>
  );
}

