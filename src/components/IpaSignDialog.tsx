import { Fragment, useEffect, useMemo, useState } from "react";
import { Dialog, Listbox, Transition } from "@headlessui/react";
import { Check, ChevronDown, Loader2, ShieldCheck, Smartphone, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { parseIPA, goServiceClient, type SigningOptions } from "../lib/goService";
import { useCertificateStore } from "../store/certificateStore";
import { useDeviceStore } from "../store/deviceStore";
import { useErrorStore } from "../store/errorStore";
import { useToastStore } from "../store/toastStore";
import { getDeviceColorName } from "../lib/deviceColorMap";
import { getDeviceModelName } from "../lib/deviceModelMap";

interface IpaSignDialogProps {
  filePath: string | null;
  onClose: () => void;
  onSigned: () => Promise<void> | void;
  /** When opened from Editor, apply these edits during certificate signing. */
  editorOptions?: SigningOptions | null;
  iconPath?: string | null;
  applyEditsHint?: string | null;
}

interface ParsedIpaSummary {
  name: string;
  bundleId: string;
  version: string;
  icon?: string;
}

const isSimulatedDevice = (device: {
  udid: string;
  activation_state?: string;
  raw_data?: Record<string, any>;
}) =>
  device.activation_state === "Simulated" ||
  device.raw_data?.simulated === true;

export default function IpaSignDialog({
  filePath,
  onClose,
  onSigned,
  editorOptions = null,
  iconPath = null,
  applyEditsHint = null,
}: IpaSignDialogProps) {
  const { t } = useTranslation();
  const { certificates, loadCertificates } = useCertificateStore();
  const { connectedDevices } = useDeviceStore();
  const { showError } = useErrorStore();
  const { showToast } = useToastStore();
  const [displayFilePath, setDisplayFilePath] = useState<string | null>(null);
  const [ipaInfo, setIpaInfo] = useState<ParsedIpaSummary | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedCertificateId, setSelectedCertificateId] = useState<string>("");
  const [selectedDeviceUdid, setSelectedDeviceUdid] = useState<string>("");

  useEffect(() => {
    if (filePath) {
      setDisplayFilePath(filePath);
    }
  }, [filePath]);

  useEffect(() => {
    if (!displayFilePath) {
      return;
    }

    const loadInfo = async () => {
      setIsLoadingInfo(true);
      try {
        const parsed = await parseIPA(displayFilePath);
        setIpaInfo({
          name: parsed.name,
          bundleId: parsed.bundle_id,
          version: parsed.version,
          icon: parsed.icon_base64,
        });
      } finally {
        setIsLoadingInfo(false);
      }
    };

    loadCertificates();
    loadInfo();
  }, [displayFilePath, loadCertificates]);

  useEffect(() => {
    if (!selectedCertificateId) {
      const defaultCertificate = certificates.find(cert => cert.is_default && !cert.is_expired) ?? certificates.find(cert => !cert.is_expired);
      if (defaultCertificate) {
        setSelectedCertificateId(defaultCertificate.id);
      }
    }
  }, [certificates, selectedCertificateId]);

  useEffect(() => {
    if (!selectedDeviceUdid && connectedDevices.length > 0) {
      setSelectedDeviceUdid(connectedDevices[0].udid);
    }
  }, [connectedDevices, selectedDeviceUdid]);

  const selectedCertificate = useMemo(
    () => certificates.find(cert => cert.id === selectedCertificateId) ?? null,
    [certificates, selectedCertificateId]
  );
  const requiresDevice = selectedCertificate?.type === "free_sign";
  const canSubmit = Boolean(displayFilePath && selectedCertificateId && (!requiresDevice || selectedDeviceUdid)) && !isSubmitting;

  useEffect(() => {
    if (!requiresDevice) {
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
  }, [requiresDevice, connectedDevices, selectedDeviceUdid]);

  const handleSubmit = async () => {
    if (!displayFilePath || !selectedCertificateId || (requiresDevice && !selectedDeviceUdid)) {
      return;
    }

    setIsSubmitting(true);
    try {
      await goServiceClient.signIPA({
        ipa_path: displayFilePath,
        certificate_id: selectedCertificateId,
        device_udid: requiresDevice ? selectedDeviceUdid : undefined,
        bundle_id: ipaInfo?.bundleId,
        sign_mode: "certificate",
        editor_options: editorOptions || undefined,
        icon_path: iconPath || undefined,
      });
      showToast(t("library.signStarted"), "info");
      await onSigned();
      onClose();
    } catch (error: any) {
      showError(t("library.signFailed"), error.message || String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Transition
      appear
      show={!!filePath}
      as={Fragment}
      afterLeave={() => {
        setDisplayFilePath(null);
        setIpaInfo(null);
        setIsLoadingInfo(false);
        setSelectedCertificateId("");
        setSelectedDeviceUdid("");
      }}
    >
      <Dialog as="div" className="relative z-40" onClose={isSubmitting ? () => {} : onClose}>
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
                <div className="mb-4 flex items-center justify-between">
                  <Dialog.Title as="h3" className="text-lg font-medium leading-6 text-gray-900">
                    {t("library.actions.sign")}
                  </Dialog.Title>
                  <button onClick={onClose} disabled={isSubmitting} className="text-gray-400 hover:text-gray-500 disabled:opacity-50">
                    <X size={20} />
                  </button>
                </div>

                {isLoadingInfo ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="animate-spin text-primary-600" size={36} />
                  </div>
                ) : (
                  <div className="space-y-4">
                    {applyEditsHint && (
                      <div className="rounded-xl border border-primary-100 bg-primary-50 px-3 py-2 text-sm text-primary-800">
                        {applyEditsHint}
                      </div>
                    )}
                    {ipaInfo && (
                      <div className="flex items-center gap-3 rounded-xl bg-gray-50 p-4">
                        {ipaInfo.icon ? (
                          <img
                            src={`data:image/png;base64,${ipaInfo.icon}`}
                            alt={ipaInfo.name}
                            className="h-14 w-14 rounded-2xl shadow-sm"
                          />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 text-white">
                            <ShieldCheck size={24} />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base font-semibold text-gray-900">{ipaInfo.name}</p>
                          <p className="truncate text-sm text-gray-500">{ipaInfo.bundleId}</p>
                          <p className="text-xs text-gray-400">{t("common.version")}: {ipaInfo.version || "-"}</p>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="mb-2 block text-sm font-medium text-gray-700">
                        {t("ipaPreview.selectCertificate")}
                      </label>
                      <Listbox value={selectedCertificateId} onChange={setSelectedCertificateId}>
                        <div className="relative">
                          <Listbox.Button className="relative w-full cursor-pointer rounded-lg border border-gray-300 bg-white py-3 pl-3 pr-10 text-left focus:outline-none focus:ring-2 focus:ring-primary-500 hover:border-gray-400 transition-colors">
                            {selectedCertificate ? (
                              <span className="flex items-center">
                                <ShieldCheck
                                  size={18}
                                  className={`mr-2 ${selectedCertificate.is_expired ? "text-red-500" : selectedCertificate.type === "free_sign" ? "text-blue-500" : "text-green-500"}`}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium text-gray-900">{selectedCertificate.name}</span>
                                  <span className="block truncate text-xs text-gray-500">{selectedCertificate.common_name}</span>
                                </span>
                              </span>
                            ) : (
                              <span className="text-sm text-gray-400">{t("ipaPreview.noCertificates")}</span>
                            )}
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
                              {certificates.filter(cert => !cert.is_expired).map(cert => (
                                <Listbox.Option
                                  key={cert.id}
                                  value={cert.id}
                                  className={({ active }) =>
                                    `relative cursor-pointer select-none py-3 pl-10 pr-4 ${active ? "bg-primary-50 text-primary-900" : "text-gray-900"}`
                                  }
                                >
                                  {({ selected }) => (
                                    <>
                                      <div className="flex items-center">
                                        <ShieldCheck
                                          size={18}
                                          className={`mr-2 ${cert.type === "free_sign" ? "text-blue-500" : "text-green-500"}`}
                                        />
                                        <div className="min-w-0 flex-1">
                                          <p className={`truncate text-sm ${selected ? "font-medium" : "font-normal"}`}>{cert.name}</p>
                                          <p className="truncate text-xs text-gray-500">{cert.common_name}</p>
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

                    {requiresDevice && (
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">
                          {t("ipaPreview.selectDevice")}
                        </label>
                        {connectedDevices.length === 0 ? (
                          <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-3 text-sm text-yellow-700">
                            {t("ipaPreview.waitingForDevice")}
                          </div>
                        ) : (
                          <Listbox value={selectedDeviceUdid} onChange={setSelectedDeviceUdid}>
                            <div className="relative">
                              <Listbox.Button className="relative w-full cursor-pointer rounded-lg border border-gray-300 bg-white py-3 pl-3 pr-10 text-left focus:outline-none focus:ring-2 focus:ring-primary-500 hover:border-gray-400 transition-colors">
                                {(() => {
                                  const device = connectedDevices.find(item => item.udid === selectedDeviceUdid);
                                  if (!device) {
                                    return <span className="text-sm text-gray-400">{t("ipaPreview.chooseDevice")}</span>;
                                  }
                                  const colorName = getDeviceColorName(device.product_type, device.color, device.enclosure_color);
                                  const modelName = getDeviceModelName(device.product_type || device.model);
                                  const simulated = isSimulatedDevice(device);
                                  return (
                                    <span className="flex items-center">
                                      <Smartphone size={18} className={`mr-2 ${simulated ? "text-gray-400" : "text-primary-500"}`} />
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium text-gray-900">{device.name}</span>
                                        <span className="block truncate text-xs text-gray-500">{modelName} • {colorName} • iOS {device.version}{simulated ? ` • ${t("common.simulated")}` : ""}</span>
                                      </span>
                                    </span>
                                  );
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
                                  {connectedDevices.map(device => {
                                    const colorName = getDeviceColorName(device.product_type, device.color, device.enclosure_color);
                                    const modelName = getDeviceModelName(device.product_type || device.model);
                                    const simulated = isSimulatedDevice(device);
                                    return (
                                      <Listbox.Option
                                        key={device.udid}
                                        value={device.udid}
                                        className={({ active }) =>
                                          `relative cursor-pointer select-none py-3 pl-10 pr-4 ${active ? "bg-primary-50 text-primary-900" : "text-gray-900"}`
                                        }
                                      >
                                        {({ selected }) => (
                                          <>
                                            <div className="flex items-center">
                                              <Smartphone size={18} className={`mr-2 ${simulated ? "text-gray-400" : "text-primary-500"}`} />
                                              <div className="min-w-0 flex-1">
                                                <p className={`truncate text-sm ${selected ? "font-medium" : "font-normal"}`}>{device.name}</p>
                                                <p className="truncate text-xs text-gray-500">{modelName} • {colorName} • iOS {device.version}{simulated ? ` • ${t("common.simulated")}` : ""}</p>
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
                    )}

                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                      >
                        {t("common.cancel")}
                      </button>
                      <button
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="flex-1 rounded-lg bg-primary-600 px-4 py-2 text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                      >
                        {isSubmitting ? t("common.loading") : t("library.actions.sign")}
                      </button>
                    </div>
                  </div>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}