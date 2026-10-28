import { useState, useEffect, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { X, Package, Loader2, ShieldCheck, AlertCircle, Check, ChevronDown, Smartphone } from "lucide-react";
import { Dialog, Transition, Listbox } from "@headlessui/react";
import { useTranslation } from "react-i18next";
import { stat } from "@tauri-apps/plugin-fs";
import { parseIPA } from "../lib/goService";
import { useCertificateStore } from "../store/certificateStore";
import { useDeviceStore } from "../store/deviceStore";
import { getDeviceColorName } from "../lib/deviceColorMap";
import { getDeviceModelName } from "../lib/deviceModelMap";
import IpaDetailsDialog from "./IpaDetailsDialog";

interface IpaInfo {
  name: string;
  bundleId: string;
  version: string;
  icon?: string;
  filePath: string;
  fileSize: number;
  minimumOSVersion?: string;
  certificateStatus?: string;
  signerName?: string;
}

interface IpaPreviewDialogProps {
  filePath: string | null;
  onClose: () => void;
  onInstall: (filePath: string, deviceUdid: string, certificateId?: string | null) => void;
}

const isSimulatedDevice = (device: {
  udid: string;
  activation_state?: string;
  raw_data?: Record<string, any>;
}) =>
  device.activation_state === "Simulated" ||
  device.raw_data?.simulated === true;

export default function IpaPreviewDialog({
  filePath,
  onClose,
  onInstall,
}: IpaPreviewDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { certificates, loadCertificates } = useCertificateStore();
  const { connectedDevices } = useDeviceStore();
  const [displayFilePath, setDisplayFilePath] = useState<string | null>(null);
  const [ipaInfo, setIpaInfo] = useState<IpaInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [detailsDialogView, setDetailsDialogView] = useState<"details"|"plugins"|"properties">("details");
  const [selectedDeviceUdid, setSelectedDeviceUdid] = useState<string>("");
  const [selectedCertificateId, setSelectedCertificateId] = useState<string>("none");

  useEffect(() => {
    if (filePath) {
      setDisplayFilePath(filePath);
    }
  }, [filePath]);

  useEffect(() => {
    if (!displayFilePath) {
      return;
    }

    const loadIpaInfo = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const stats = await stat(displayFilePath);
        
        const parsedInfo = await parseIPA(displayFilePath);

        setIpaInfo({
          name: parsedInfo.name,
          bundleId: parsedInfo.bundle_id,
          version: parsedInfo.version,
          icon: parsedInfo.icon_base64,
          filePath: displayFilePath,
          fileSize: stats.size || 0,
          minimumOSVersion: parsedInfo.minimum_os_version,
          certificateStatus: parsedInfo.certificate_status,
          signerName: parsedInfo.signer_name,
        });
      } catch (err: any) {
        console.error("Failed to parse IPA:", err);
        setError(err.message || "Failed to load IPA information");
      } finally {
        setIsLoading(false);
      }
    };

    loadIpaInfo();
  }, [displayFilePath]);

  useEffect(() => {
    if (!displayFilePath) {
      return;
    }

    if (!selectedDeviceUdid) {
      if (connectedDevices.length > 0) {
        setSelectedDeviceUdid(connectedDevices[0].udid);
      }
      return;
    }

    if (!connectedDevices.some(device => device.udid === selectedDeviceUdid)) {
      setSelectedDeviceUdid(connectedDevices[0]?.udid ?? "");
    }
  }, [displayFilePath, connectedDevices, selectedDeviceUdid]);

  useEffect(() => {
    if (!displayFilePath) {
      return;
    }
    
    loadCertificates();
  }, [displayFilePath, loadCertificates]);

  const handleInstall = () => {
    if (displayFilePath && selectedDeviceUdid) {
      onInstall(displayFilePath, selectedDeviceUdid, selectedCertificateId === "none" ? null : selectedCertificateId);
      onClose();
    }
  };

  const formatSize = (bytes: number): string => {
    const mb = bytes / (1024 * 1024);
    const gb = mb / 1024;

    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    return `${mb.toFixed(2)} MB`;
  };

  const originalSignature = (() => {
    const status = (ipaInfo?.certificateStatus || "").trim();
    const labels: Record<string, string> = {
      "App Store": t("signatureStatus.official"),
      Enterprise: t("signatureStatus.enterprise"),
      Developer: t("signatureStatus.developer"),
      "Ad-Hoc": t("signatureStatus.adHoc"),
    };
    // "Unknown" means no usable signature could be read, so report it as unsigned.
    const label = labels[status] || t("signatureStatus.unsigned");
    const signer = (ipaInfo?.signerName || "").trim();
    return signer ? `${label}\uff1a${signer}` : label;
  })();

  const originalSignatureIsUnsigned = (() => {
    const status = (ipaInfo?.certificateStatus || "").trim();
    return status === "" || status === "Unknown" || status === "Unsigned";
  })();

  return (
    <Transition
      appear
      show={!!filePath}
      as={Fragment}
      afterLeave={() => {
        setDisplayFilePath(null);
        setIpaInfo(null);
        setIsLoading(false);
        setError(null);
        setShowDetailsDialog(false);
      }}
    >
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
              <Dialog.Panel className="w-full max-w-md transform overflow-visible rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
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
                    <div className="flex flex-col items-center mb-4">
                      {ipaInfo.icon ? (
                        <img
                          src={`data:image/png;base64,${ipaInfo.icon}`}
                          alt={ipaInfo.name}
                          className="w-20 h-20 rounded-2xl shadow-lg mb-3"
                        />
                      ) : (
                        <div className="w-20 h-20 rounded-2xl shadow-lg mb-3 bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
                          <Package className="text-white" size={40} />
                        </div>
                      )}
                      <h4 className="text-lg font-semibold text-gray-900 mb-2">
                        {ipaInfo.name}
                      </h4>
                      
                      <div className="inline-flex items-center gap-3 px-3 py-1 bg-gray-100 rounded-full">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-600">{t("common.version")}</span>
                          <span className="text-xs font-semibold text-gray-900">{ipaInfo.version}</span>
                        </div>
                        <div className="w-px h-3 bg-gray-300"></div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-600">{t("common.fileSize")}</span>
                          <span className="text-xs font-semibold text-gray-900">{formatSize(ipaInfo.fileSize)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4 mb-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t("ipaPreview.selectCertificate")}
                        </label>
                        <Listbox value={selectedCertificateId} onChange={setSelectedCertificateId}>
                          <div className="relative">
                            <Listbox.Button className="relative w-full cursor-pointer rounded-lg bg-white py-3 pl-3 pr-10 text-left border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500 hover:border-gray-400 transition-colors">
                              {(() => {
                                if (selectedCertificateId === "none") {
                                  return (
                                    <span className="flex items-center">
                                      <ShieldCheck size={18} className="text-gray-400 mr-2" />
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm text-gray-700">{t("ipaPreview.noResign")}</p>
                                        <p className="truncate text-xs text-gray-400">{originalSignature}</p>
                                        {originalSignatureIsUnsigned && (
                                          <p className="truncate text-xs text-amber-600">{t("ipaPreview.unsignedWarning")}</p>
                                        )}
                                      </div>
                                    </span>
                                  );
                                }
                                const cert = certificates.find(c => c.id === selectedCertificateId);
                                if (cert) {
                                  return (
                                    <span className="flex items-center">
                                      <ShieldCheck 
                                        size={18} 
                                        className={`mr-2 ${
                                          cert.is_expired ? "text-red-500" :
                                          cert.days_until_expiry <= 7 ? "text-orange-500" :
                                          cert.days_until_expiry <= 30 ? "text-yellow-500" :
                                          "text-green-500"
                                        }`}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <p className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                                          <span className="truncate">{cert.name}</span>
                                          {cert.type === "free_sign" && (
                                            <span className="shrink-0 self-center rounded-full bg-blue-50 px-1.5 py-[1px] text-[10px] font-semibold leading-none text-blue-700 ring-1 ring-inset ring-blue-200">
                                              {t("signing.selfSignedBadge")}
                                            </span>
                                          )}
                                        </p>
                                        <p className="text-xs text-gray-500 truncate">{cert.common_name}</p>
                                      </div>
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                                <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden="true" />
                              </span>
                            </Listbox.Button>
                            <Transition
                              as={Fragment}
                              leave="transition ease-in duration-100"
                              leaveFrom="opacity-100"
                              leaveTo="opacity-0"
                            >
                              <Listbox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto scrollbar-thin rounded-lg bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none text-sm">
                                <Listbox.Option
                                  value="none"
                                  className={({ active }) =>
                                    `relative cursor-pointer select-none py-3 pl-10 pr-4 ${
                                      active ? 'bg-primary-50 text-primary-900' : 'text-gray-900'
                                    }`
                                  }
                                >
                                  {({ selected }) => (
                                    <>
                                      <div className="flex items-center">
                                        <ShieldCheck size={18} className="text-gray-400 mr-2" />
                                        <div className="min-w-0 flex-1">
                                          <p className={`truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                                            {t("ipaPreview.noResign")}
                                          </p>
                                          <p className="truncate text-xs text-gray-400">{originalSignature}</p>
                                          {originalSignatureIsUnsigned && (
                                            <p className="truncate text-xs text-amber-600">{t("ipaPreview.unsignedWarning")}</p>
                                          )}
                                        </div>
                                      </div>
                                      {selected && (
                                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-primary-600">
                                          <Check className="h-4 w-4" aria-hidden="true" />
                                        </span>
                                      )}
                                    </>
                                  )}
                                </Listbox.Option>
                                {certificates.map((cert) => (
                                  <Listbox.Option
                                    key={cert.id}
                                    value={cert.id}
                                    disabled={cert.is_expired}
                                    className={({ active }) =>
                                      `relative cursor-pointer select-none py-3 pl-10 pr-4 ${
                                        cert.is_expired ? 'opacity-50 cursor-not-allowed' :
                                        active ? 'bg-primary-50 text-primary-900' : 'text-gray-900'
                                      }`
                                    }
                                  >
                                    {({ selected }) => (
                                      <>
                                        <div className="flex items-center">
                                          <ShieldCheck 
                                            size={18} 
                                            className={`mr-2 ${
                                              cert.is_expired ? "text-red-500" :
                                              cert.days_until_expiry <= 7 ? "text-orange-500" :
                                              cert.days_until_expiry <= 30 ? "text-yellow-500" :
                                              "text-green-500"
                                            }`}
                                          />
                                          <div className="flex-1 min-w-0">
                                            <p className={`flex items-center gap-1.5 text-sm ${selected ? 'font-medium' : 'font-normal'}`}>
                                              <span className="truncate">{cert.name}</span>
                                              {cert.type === "free_sign" && (
                                                <span className="shrink-0 self-center rounded-full bg-blue-50 px-1.5 py-[1px] text-[10px] font-semibold leading-none text-blue-700 ring-1 ring-inset ring-blue-200">
                                                  {t("signing.selfSignedBadge")}
                                                </span>
                                              )}
                                            </p>
                                            <p className="text-xs text-gray-500 truncate">{cert.common_name}</p>
                                            <p className="text-xs text-gray-400">
                                              {cert.is_expired ? t("ipaPreview.statusExpired") :
                                               cert.days_until_expiry <= 30 ? `${cert.days_until_expiry}${t("ipaPreview.daysLeft")}` :
                                               new Date(cert.expires_at).toLocaleDateString()}
                                            </p>
                                          </div>
                                        </div>
                                        {selected && (
                                          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-primary-600">
                                            <Check className="h-4 w-4" aria-hidden="true" />
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </Listbox.Option>
                                ))}
                              </Listbox.Options>
                            </Transition>
                          </div>
                        </Listbox>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-sm font-medium text-gray-700">
                            {t("ipaPreview.selectDevice")}
                          </label>
                          {ipaInfo?.minimumOSVersion && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                              需要 iOS {ipaInfo.minimumOSVersion}+
                            </span>
                          )}
                        </div>
                        {connectedDevices.length === 0 ? (
                          <div className="flex items-center justify-center py-3 bg-yellow-50 rounded-lg border border-yellow-200">
                            <AlertCircle className="text-yellow-600 mr-2" size={16} />
                            <span className="text-sm text-yellow-700">{t("ipaPreview.waitingForDevice")}</span>
                          </div>
                        ) : (
                          <Listbox value={selectedDeviceUdid} onChange={setSelectedDeviceUdid}>
                            <div className="relative">
                              <Listbox.Button className="relative w-full cursor-pointer rounded-lg bg-white py-3 pl-3 pr-10 text-left border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500 hover:border-gray-400 transition-colors">
                                {(() => {
                                  const device = connectedDevices.find(d => d.udid === selectedDeviceUdid);
                                  if (device) {
                                    const colorName = getDeviceColorName(device.product_type, device.color, device.enclosure_color);
                                    const modelName = getDeviceModelName(device.product_type || device.model);
                                    const simulated = isSimulatedDevice(device);
                                    return (
                                      <span className="flex items-center">
                                        <Smartphone size={18} className={`mr-2 flex-shrink-0 ${simulated ? "text-gray-400" : "text-primary-500"}`} />
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium text-gray-900 truncate">{device.name}</p>
                                          <p className="text-xs text-gray-500 truncate">
                                            {modelName} • {colorName} • iOS {device.version}{simulated ? ` • ${t("common.simulated")}` : ""}
                                          </p>
                                        </div>
                                      </span>
                                    );
                                  }
                                  return <span className="text-sm text-gray-400">{t("ipaPreview.chooseDevice")}</span>;
                                })()}
                                <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                                  <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden="true" />
                                </span>
                              </Listbox.Button>
                              <Transition
                                as={Fragment}
                                leave="transition ease-in duration-100"
                                leaveFrom="opacity-100"
                                leaveTo="opacity-0"
                              >
                                <Listbox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto scrollbar-thin rounded-lg bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none text-sm">
                                  {connectedDevices.map((device) => {
                                    const colorName = getDeviceColorName(device.product_type, device.color, device.enclosure_color);
                                    const modelName = getDeviceModelName(device.product_type || device.model);
                                    const simulated = isSimulatedDevice(device);
                                    return (
                                      <Listbox.Option
                                        key={device.udid}
                                        value={device.udid}
                                        className={({ active }) =>
                                          `relative cursor-pointer select-none py-3 pl-10 pr-4 ${
                                            active ? 'bg-primary-50 text-primary-900' : 'text-gray-900'
                                          }`
                                        }
                                      >
                                        {({ selected }) => (
                                          <>
                                            <div className="flex items-center">
                                              <Smartphone size={18} className={`mr-2 flex-shrink-0 ${simulated ? "text-gray-400" : "text-primary-500"}`} />
                                              <div className="flex-1 min-w-0">
                                                <p className={`text-sm truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                                                  {device.name}
                                                </p>
                                                <p className="text-xs text-gray-500 truncate">{modelName}</p>
                                                <p className="text-xs text-gray-400">
                                                  {colorName} • iOS {device.version}{simulated ? ` • ${t("common.simulated")}` : ""}
                                                </p>
                                              </div>
                                            </div>
                                            {selected && (
                                              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-primary-600">
                                                <Check className="h-4 w-4" aria-hidden="true" />
                                              </span>
                                            )}
                                          </>
                                        )}
                                      </Listbox.Option>
                                    );
                                  })}
                                </Listbox.Options>
                              </Transition>
                            </div>
                          </Listbox>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col space-y-4">
                      <div className="flex items-center rounded-lg border border-gray-300 overflow-hidden bg-white">
                      <button
                        onClick={() => {
                          setDetailsDialogView("details");
                          setShowDetailsDialog(true);
                        }}
                          className="flex-1 px-4 py-2 text-gray-700 hover:bg-gray-50 transition-colors text-sm"
                      >
                        {t("ipaDetails.tabs.details")}
                      </button>
                        <div className="w-px h-8 bg-gray-300"></div>
                        <button
                          onClick={() => {
                            if (!displayFilePath) return;
                            navigate("/editor", { state: { ipaPath: displayFilePath } });
                            onClose();
                          }}
                          className="flex-1 px-4 py-2 text-gray-700 hover:bg-gray-50 transition-colors text-sm"
                        >
                          {t("common.edit")}
                        </button>
                        <div className="w-px h-8 bg-gray-300"></div>
                        <button
                          onClick={() => {
                            setDetailsDialogView("properties");
                            setShowDetailsDialog(true);
                          }}
                          className="flex-1 px-4 py-2 text-gray-700 hover:bg-gray-50 transition-colors text-sm"
                        >
                          {t("ipaDetails.tabs.properties")}
                        </button>
                      </div>
                      
                      <div className="flex space-x-3">
                        <button
                          onClick={onClose}
                          className="flex-1 px-4 py-2 bg-white text-gray-700 rounded-lg hover:bg-gray-50 transition-colors border border-gray-300"
                        >
                          {t("common.cancel")}
                        </button>
                        <button
                          onClick={handleInstall}
                          disabled={!selectedDeviceUdid}
                          className={`flex-1 px-4 py-2 rounded-lg transition-colors ${
                            selectedDeviceUdid
                              ? "bg-primary-600 text-white hover:bg-primary-700"
                              : connectedDevices.length === 0
                                ? "bg-blue-100 text-blue-400 cursor-not-allowed"
                                : "bg-gray-300 text-gray-500 cursor-not-allowed"
                          }`}
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
          filePath={showDetailsDialog ? displayFilePath : null}
          onClose={() => setShowDetailsDialog(false)}
          view={detailsDialogView}
        />
      </Dialog>
    </Transition>
  );
}

