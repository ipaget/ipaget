import { Fragment, useState, useEffect } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X, HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DeviceInfo, goServiceClient } from "../lib/goService";
import { getDeviceColorName, getDeviceColorDisplay } from "../lib/deviceColorMap";
import { getDeviceModelName } from "../lib/deviceModelMap";
import { useToastStore } from "../store/toastStore";
import ConfirmDialog from "./ConfirmDialog";
import DetailRow from "./DetailRow";
import RawDataViewer from "./RawDataViewer";

interface DeviceDetailsDialogProps {
  device: DeviceInfo | null;
  onClose: () => void;
}

export default function DeviceDetailsDialog({ device, onClose }: DeviceDetailsDialogProps) {
  const { t } = useTranslation();
  const { showToast } = useToastStore();
  const [isOpen, setIsOpen] = useState(false);
  const [currentDevice, setCurrentDevice] = useState<DeviceInfo | null>(null);
  const [detailsTab, setDetailsTab] = useState<'basic' | 'raw'>('basic');
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [showShutdownConfirm, setShowShutdownConfirm] = useState(false);

  useEffect(() => {
    if (device) {
      setCurrentDevice(device);
      setIsOpen(true);
      setDetailsTab('basic');
    } else {
      setIsOpen(false);
    }
  }, [device]);

  const handleClose = () => {
    setIsOpen(false);
  };

  const handleAfterLeave = () => {
    setCurrentDevice(null);
    onClose();
  };

  const handleRestartDevice = async () => {
    if (!currentDevice) return;
    try {
      await goServiceClient.restartDevice(currentDevice.udid);
      showToast(t("devices.restartRequested"), "success");
    } catch (error) {
      showToast(t("devices.restartFailed"), "error");
      console.error("Failed to restart device:", error);
    }
  };

  const handleShutdownDevice = async () => {
    if (!currentDevice) return;
    try {
      await goServiceClient.shutdownDevice(currentDevice.udid);
      showToast(t("devices.shutdownRequested"), "success");
    } catch (error) {
      showToast(t("devices.shutdownFailed"), "error");
      console.error("Failed to shutdown device:", error);
    }
  };

  if (!currentDevice) return null;

  const getActivationStateText = (state: string) => {
    const key = `activationStates.${state}`;
    const translated = t(key);
    return translated === key ? state : translated;
  };

  const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes === 0) return '-';
    const kb = bytes / 1024;
    const mb = kb / 1024;
    const gb = mb / 1024;
    
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    if (mb >= 1) return `${mb.toFixed(2)} MB`;
    if (kb >= 1) return `${kb.toFixed(2)} KB`;
    return `${bytes} B`;
  };

  const detailRows = [
    { label: t("deviceDetails.iosVersion"), value: `${currentDevice.version} (${currentDevice.build_version})`, copyable: true },
    ...(currentDevice.firmware_version ? [{ label: t("deviceDetails.firmwareVersion"), value: currentDevice.firmware_version, copyable: true }] : []),
    ...(currentDevice.color ? [{ label: t("deviceDetails.deviceColor"), value: getDeviceColorDisplay(currentDevice.product_type, currentDevice.color, currentDevice.enclosure_color), copyable: true }] : []),
    { label: t("deviceDetails.activationState"), value: getActivationStateText(currentDevice.activation_state) },
    { label: t("deviceDetails.jailbreakStatus"), value: currentDevice.is_jailbroken ? t("common.yes") : t("common.no") },
    { label: t("deviceDetails.modelNumber"), value: currentDevice.sales_model || `${currentDevice.model_number} ${currentDevice.region_info}`, copyable: true },
    { label: t("deviceDetails.serialNumber"), value: currentDevice.serial_number, copyable: true },
    ...(currentDevice.imei ? [{ label: t("deviceDetails.imei"), value: currentDevice.imei, copyable: true }] : []),
    ...(currentDevice.phone_number ? [{ label: t("deviceDetails.phoneNumber"), value: currentDevice.phone_number, copyable: true }] : []),
    { label: "ECID", value: currentDevice.ecid || "-", copyable: !!currentDevice.ecid },
    { label: "UDID", value: currentDevice.udid, copyable: true },
    ...(currentDevice.time_zone ? [{ label: t("deviceDetails.timeZone"), value: currentDevice.time_zone }] : []),
    { label: t("deviceDetails.appleIdLock"), value: currentDevice.apple_id_locked ? t("common.locked") : t("common.unlocked") },
    { label: t("deviceDetails.icloudStatus"), value: currentDevice.icloud_enabled ? t("common.enabled") : t("common.disabled") },
    { label: t("deviceDetails.productType"), value: `${currentDevice.product_type} (${currentDevice.product_name})`, copyable: true },
    { label: t("deviceDetails.cpuArchitecture"), value: currentDevice.cpu_architecture || "-" },
    ...(currentDevice.battery_cycle_count > 0 ? [
      { label: t("deviceDetails.batteryCycles"), value: currentDevice.battery_cycle_count.toString() },
      { label: t("deviceDetails.batteryHealth"), value: currentDevice.battery_health > 0 ? `${currentDevice.battery_health}%` : "-" },
    ] : []),
    { label: t("deviceDetails.wifiAddress"), value: currentDevice.wifi_address || "-", copyable: !!currentDevice.wifi_address },
    { label: t("deviceDetails.bluetoothAddress"), value: currentDevice.bluetooth_address || "-", copyable: !!currentDevice.bluetooth_address },
  ];

  return (
    <>
    <Transition appear show={isOpen} as={Fragment} afterLeave={handleAfterLeave}>
      <Dialog as="div" className="relative z-50" onClose={handleClose}>
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
              <Dialog.Panel className="w-full max-w-3xl max-h-[80vh] transform overflow-hidden rounded-2xl bg-white text-left align-middle shadow-xl transition-all flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                  <Dialog.Title as="h3" className="text-lg font-bold text-gray-900">
                    {t("deviceDetails.title")}
                  </Dialog.Title>
                  <button
                    onClick={handleClose}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Device Header */}
                <div className="px-6 py-4 bg-gradient-to-r from-primary-50 to-blue-50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h4 className="text-xl font-bold text-gray-900">{currentDevice.name}</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        {getDeviceModelName(currentDevice.product_type)}
                        {(() => {
                          const colorName = getDeviceColorName(currentDevice.product_type, currentDevice.color, currentDevice.enclosure_color);
                          return colorName ? ` | ${colorName}` : '';
                        })()}
                        {` | iOS ${currentDevice.version}`}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2 ml-4">
                      <button
                        onClick={() => setShowRestartConfirm(true)}
                        className="px-4 py-2 text-primary-600 bg-white border border-primary-600 rounded hover:bg-primary-50 transition-colors text-sm font-medium whitespace-nowrap"
                      >
                        {t("devices.restart")}
                      </button>
                      <button
                        onClick={() => setShowShutdownConfirm(true)}
                        className="px-4 py-2 text-primary-600 bg-white border border-primary-600 rounded hover:bg-primary-50 transition-colors text-sm font-medium whitespace-nowrap"
                      >
                        {t("devices.shutdown")}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Tab Navigation */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex border-b border-gray-200">
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
                  </div>

                  {/* Tab Content */}
                  {detailsTab === 'basic' && (
                    <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4 select-text">
                      {/* Storage Info Section */}
                      {currentDevice.storage_info && (
                        <div className="mb-6 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
                          <div className="flex items-center space-x-2 mb-3">
                            <HardDrive size={18} className="text-blue-600" />
                            <h4 className="text-sm font-semibold text-gray-900">
                              {t("deviceDetails.storage")}
                            </h4>
                          </div>
                          
                          {/* Progress Bar */}
                          <div className="mb-2">
                            <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                              <span>{currentDevice.storage_info.formatted_used} {t("deviceDetails.used")}</span>
                              <span className="font-semibold">{currentDevice.storage_info.used_percentage.toFixed(1)}%</span>
                              <span>{currentDevice.storage_info.formatted_available} {t("deviceDetails.available")}</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  currentDevice.storage_info.used_percentage >= 90 ? 'bg-red-500' :
                                  currentDevice.storage_info.used_percentage >= 75 ? 'bg-orange-500' :
                                  'bg-blue-500'
                                }`}
                                style={{ width: `${Math.min(currentDevice.storage_info.used_percentage, 100)}%` }}
                              />
                            </div>
                          </div>
                          
                          {/* Storage Details */}
                          <div className="grid grid-cols-2 gap-2 text-xs mt-3">
                            <div className="flex justify-between">
                              <span className="text-gray-600">{t("deviceDetails.totalCapacity")}:</span>
                              <span className="font-medium text-gray-900">{currentDevice.storage_info.formatted_total}</span>
                            </div>
                            {currentDevice.storage_info.photo_usage && currentDevice.storage_info.photo_usage > 0 && (
                              <div className="flex justify-between">
                                <span className="text-gray-600">{t("deviceDetails.photos")}:</span>
                                <span className="font-medium text-gray-900">{formatBytes(currentDevice.storage_info.photo_usage)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {/* Device Details Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                        {detailRows.map((row, index) => (
                          <DetailRow
                            key={index}
                            label={row.label}
                            value={row.value}
                            copyable={row.copyable}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {detailsTab === 'raw' && currentDevice.raw_data && (
                    <RawDataViewer data={currentDevice.raw_data} />
                  )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                  >
                    {t("common.close")}
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>

    {/* Confirm Dialogs */}
    <ConfirmDialog
      isOpen={showRestartConfirm}
      title={t("devices.restart")}
      message={t("devices.confirmRestart")}
      confirmText={t("devices.restart")}
      cancelText={t("common.cancel")}
      onConfirm={handleRestartDevice}
      onCancel={() => setShowRestartConfirm(false)}
      type="warning"
    />

    <ConfirmDialog
      isOpen={showShutdownConfirm}
      title={t("devices.shutdown")}
      message={t("devices.confirmShutdown")}
      confirmText={t("devices.shutdown")}
      cancelText={t("common.cancel")}
      onConfirm={handleShutdownDevice}
      onCancel={() => setShowShutdownConfirm(false)}
      type="danger"
    />
    </>
  );
}

