import { Fragment, useState, useEffect } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X, ChevronRight, Battery, BatteryCharging, BatteryFull, BatteryMedium, BatteryLow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DeviceInfo, goServiceClient } from "../lib/goService";
import { getDeviceColorName } from "../lib/deviceColorMap";
import { getDeviceModelName } from "../lib/deviceModelMap";
import { useToastStore } from "../store/toastStore";
import ConfirmDialog from "./ConfirmDialog";
import DetailRow from "./DetailRow";
import Button3D from "./Button3D";

interface DeviceDetailsDialogProps {
  device: DeviceInfo | null;
  onClose: () => void;
}

export default function DeviceDetailsDialog({ device, onClose }: DeviceDetailsDialogProps) {
  const { t } = useTranslation();
  const { showToast } = useToastStore();
  const [isOpen, setIsOpen] = useState(false);
  const [currentDevice, setCurrentDevice] = useState<DeviceInfo | null>(null);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [showShutdownConfirm, setShowShutdownConfirm] = useState(false);
  const [showMoreDetailsDialog, setShowMoreDetailsDialog] = useState(false);

  useEffect(() => {
    if (device) {
      setCurrentDevice(device);
      setIsOpen(true);
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
  const getJailbreakStatusText = (isJailbroken: boolean | undefined | null) => {
    if (isJailbroken) {
      return t("deviceDetails.jailbroken");
    }
    return t("deviceDetails.notJailbroken");
  };

  const getSalesRegionText = (regionInfo: string | undefined | null) => {
    if (!regionInfo) return "-";
    const code = regionInfo.split("/")[0].toUpperCase();
    const map: Record<string, string> = {
      AB: "Egypt, Jordan, Saudi Arabia, United Arab Emirates",
      AM: "United States (Assembled in Vietnam)",
      B: "Ireland, UK, also used for some replacement units",
      BR: "Brazil (Assembled in Brazil)",
      BZ: "Brazil (Assembled in China)",
      C: "Canada",
      CL: "Canada",
      CH: "China",
      CZ: "Czech Republic",
      D: "Germany",
      DN: "Austria, Germany, Netherlands",
      E: "Mexico",
      EE: "Estonia",
      FB: "France, Luxembourg",
      FD: "Austria, Liechtenstein, Switzerland",
      GR: "Greece",
      HN: "India",
      IP: "Italy",
      HB: "Israel",
      J: "Japan",
      KH: "Korea",
      KN: "Norway",
      KS: "Finland, Sweden",
      LA: "Colombia, Ecuador, El Salvador, Guatemala, Honduras, Peru",
      LE: "Argentina",
      LL: "USA, Canada, also used for some replacement units",
      LZ: "Chile, Paraguay, Uruguay",
      MG: "Hungary",
      MO: "Macau, Hong Kong(?)",
      MY: "Malaysia",
      NF: "Belgium, France, Luxembourg",
      PL: "Poland",
      PO: "Portugal",
      PP: "Philippines",
      RO: "Romania",
      RS: "Russia",
      SL: "Slovakia",
      SO: "South Africa",
      T: "Italy",
      TA: "Taiwan",
      TU: "Turkey",
      TY: "Italy",
      VC: "Canada",
      X: "Australia, New Zealand",
      Y: "Spain",
      ZA: "Singapore",
      ZP: "Hong Kong, Macau",
    };
    const description = map[code];
    if (!description) {
      return regionInfo;
    }
    return `${description} (${regionInfo})`;
  };

  const detailRows = [
    { label: t("deviceDetails.iosVersion"), value: `${currentDevice.version} (${currentDevice.build_version})`, copyable: true },
    { label: t("deviceDetails.serialNumber"), value: currentDevice.serial_number, copyable: true },
    { label: "IMEI1", value: currentDevice.imei || "-", copyable: !!currentDevice.imei },
    { label: "IMEI2", value: currentDevice.imei2 || "-", copyable: !!currentDevice.imei2 },
    { label: t("deviceDetails.productType"), value: `${currentDevice.product_type} (${currentDevice.regulatory_model || currentDevice.product_name})`, copyable: true },
    { label: t("deviceDetails.modelNumber"), value: currentDevice.sales_model || `${currentDevice.model_number} ${currentDevice.region_info}`, copyable: true },
    { label: t("deviceDetails.salesRegion"), value: getSalesRegionText(currentDevice.region_info) },
    { label: t("deviceDetails.activationState"), value: getActivationStateText(currentDevice.activation_state) },
    { label: t("deviceDetails.jailbreakStatus"), value: getJailbreakStatusText(currentDevice.is_jailbroken) },
    { label: t("deviceDetails.appleIdLock"), value: currentDevice.apple_id_locked ? t("common.locked") : t("common.unlocked") },
    { label: "iCloud", value: currentDevice.icloud_enabled ? t("common.enabled") : t("common.disabled") },
    { label: t("deviceDetails.manufactureDate"), value: currentDevice.manufacture_date || "-" },
    { label: t("deviceDetails.warrantyExpiration"), value: currentDevice.warranty_expiration || "-" },
    { label: t("deviceDetails.crashLogCount"), value: currentDevice.crash_log_count.toString() },
  ];

  // Translate carrier bundle ID to friendly name
  const translateCarrier = (bundleId: string): string => {
    const carriers: Record<string, string> = {
      'CBN_cn': '中国广电',
      'ChinaTelecom_USIM_cn': '中国电信',
      'CMCC_cn': '中国移动',
      'Unicom_cn': '中国联通',
    };
    
    // Remove .ipcc suffix if present
    const cleanId = bundleId.replace('.ipcc', '');
    return carriers[cleanId] || bundleId;
  };

  // Combine carrier info from both SIM slots
  const getCarrierInfo = () => {
    if (currentDevice.sim1_info && currentDevice.sim2_info) {
      const carrier1 = translateCarrier(currentDevice.sim1_info);
      const carrier2 = translateCarrier(currentDevice.sim2_info);
      return `${carrier1} (1), ${carrier2} (2)`;
    } else if (currentDevice.sim1_info) {
      return translateCarrier(currentDevice.sim1_info);
    } else if (currentDevice.sim2_info) {
      return translateCarrier(currentDevice.sim2_info);
    }
    return null;
  };

  const carrierInfo = getCarrierInfo();

  const hardwareDetails = currentDevice.hardware_details;

  const getDisplayStorageBytes = () => {
    const storageInfo = currentDevice.storage_info;
    if (!storageInfo) return null;
    return storageInfo.total_data_capacity || storageInfo.total_disk_capacity || null;
  };
  
  const getStorageCapacityLabel = () => {
    const totalBytes = getDisplayStorageBytes();
    if (!totalBytes) return null;
    const totalGB = totalBytes / (1000 * 1000 * 1000);
    const tiers = [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192];
    let tier = tiers[0];
    for (const t of tiers) {
      if (totalGB <= t) {
        tier = t;
        break;
      }
    }
    return tier >= 1024 ? `${tier / 1024}T` : `${tier}G`;
  };

  const chargingState = currentDevice.battery_fully_charged
    ? t("deviceDetails.batteryStatusFull")
    : currentDevice.battery_is_charging
      ? t("deviceDetails.batteryStatusCharging")
      : currentDevice.battery_external_connected
        ? t("deviceDetails.batteryStatusConnected")
        : t("deviceDetails.batteryStatusNotCharging");

  const chargingSpeed = currentDevice.battery_watts && currentDevice.battery_watts > 0
    ? currentDevice.battery_watts >= 18
      ? t("deviceDetails.fastCharging")
      : t("deviceDetails.slowCharging")
    : null;

  const getBatteryIcon = (batteryLevel: number, isCharging: boolean) => {
    if (isCharging) {
      return BatteryCharging;
    }
    if (batteryLevel >= 80) return BatteryFull;
    if (batteryLevel >= 40) return BatteryMedium;
    if (batteryLevel >= 20) return BatteryLow;
    return Battery;
  };
  
  const extraRows = [
    ...(currentDevice.imei ? [{ label: t("deviceDetails.imei"), value: currentDevice.imei, copyable: true }] : []),
    ...(currentDevice.imei2 ? [{ label: "IMEI2", value: currentDevice.imei2, copyable: true }] : []),
    ...(currentDevice.regulatory_model ? [{ label: t("deviceDetails.regulatoryModel"), value: currentDevice.regulatory_model, copyable: true }] : []),
    ...(currentDevice.ethernet_address ? [{ label: t("deviceDetails.ethernetAddress"), value: currentDevice.ethernet_address, copyable: true }] : []),
    ...(currentDevice.imsi ? [{ label: "IMSI", value: currentDevice.imsi, copyable: true }] : []),
    ...(currentDevice.sim_status ? [{ label: t("deviceDetails.simStatus"), value: currentDevice.sim_status }] : []),
    ...(currentDevice.sim_tray_status ? [{ label: t("deviceDetails.simTrayStatus"), value: currentDevice.sim_tray_status }] : []),
    ...(carrierInfo ? [{ label: t("deviceDetails.carrier"), value: carrierInfo }] : []),
    { label: t("deviceDetails.crashLogCount"), value: currentDevice.crash_log_count.toString() },
    ...(currentDevice.battery_level > 0 ? [{ label: t("deviceDetails.batteryLevel"), value: `${currentDevice.battery_level}%` }] : []),
    ...(currentDevice.battery_external_connected || currentDevice.battery_is_charging || currentDevice.battery_fully_charged ? [{ label: t("deviceDetails.batteryStatus"), value: chargingSpeed ? `${chargingState} · ${chargingSpeed}` : chargingState }] : []),
    ...(currentDevice.battery_watts ? [{ label: t("deviceDetails.batteryWatts"), value: `${currentDevice.battery_watts}W` }] : []),
    
    // Hardware Details Section
    ...(hardwareDetails?.mlb_serial_number ? [{ label: "主板序列号 (MLB)", value: hardwareDetails.mlb_serial_number, copyable: true }] : []),
    ...(hardwareDetails?.hardware_model ? [{ label: "硬件型号", value: hardwareDetails.hardware_model, copyable: true }] : []),
    ...(hardwareDetails?.hardware_platform ? [{ label: "芯片平台", value: hardwareDetails.hardware_platform, copyable: true }] : []),
    ...(hardwareDetails?.chip_id ? [{ label: "芯片ID", value: `0x${hardwareDetails.chip_id.toString(16).toUpperCase()}`, copyable: true }] : []),
    ...(hardwareDetails?.die_id ? [{ label: "Die ID (ECID)", value: hardwareDetails.die_id.toString(), copyable: true }] : []),
    ...(hardwareDetails?.board_id ? [{ label: "主板ID", value: hardwareDetails.board_id.toString(), copyable: true }] : []),
    
    ...(hardwareDetails?.baseband_version ? [{ label: "基带版本", value: hardwareDetails.baseband_version, copyable: true }] : []),
    ...(hardwareDetails?.baseband_chip_id ? [{ label: "基带芯片ID", value: `0x${hardwareDetails.baseband_chip_id.toString(16).toUpperCase()}`, copyable: true }] : []),
    ...(hardwareDetails?.baseband_serial_number ? [{ label: "基带序列号", value: hardwareDetails.baseband_serial_number, copyable: true }] : []),
    ...(hardwareDetails?.iccid ? [{ label: "ICCID (SIM1)", value: hardwareDetails.iccid, copyable: true }] : []),
    ...(hardwareDetails?.iccid2 ? [{ label: "ICCID (SIM2)", value: hardwareDetails.iccid2, copyable: true }] : []),
    ...(hardwareDetails?.imsi2 ? [{ label: "IMSI (SIM2)", value: hardwareDetails.imsi2, copyable: true }] : []),
    ...(hardwareDetails?.meid ? [{ label: "MEID", value: hardwareDetails.meid, copyable: true }] : []),
    
    ...(hardwareDetails?.ambient_light_sensor ? [{ label: "环境光传感器", value: hardwareDetails.ambient_light_sensor, copyable: true }] : []),
    ...(hardwareDetails?.proximity_sensor ? [{ label: "距离传感器", value: hardwareDetails.proximity_sensor, copyable: true }] : []),
    ...(hardwareDetails?.cover_glass_serial ? [{ label: "盖板序列号", value: hardwareDetails.cover_glass_serial, copyable: true }] : []),
    
    ...(hardwareDetails?.battery_serial ? [{ label: "电池序列号", value: hardwareDetails.battery_serial, copyable: true }] : []),
    ...(hardwareDetails?.battery_manufacturer ? [{ label: "电池制造商", value: hardwareDetails.battery_manufacturer, copyable: true }] : []),
    
    ...(hardwareDetails?.wifi_chipset ? [{ label: "WiFi芯片组", value: hardwareDetails.wifi_chipset, copyable: true }] : []),
    ...(hardwareDetails?.wifi_module_serial ? [{ label: "WiFi模块序列号", value: hardwareDetails.wifi_module_serial, copyable: true }] : []),
    ...(hardwareDetails?.wifi_driver_version ? [{ label: "WiFi驱动版本", value: hardwareDetails.wifi_driver_version, copyable: true }] : []),
    ...(hardwareDetails?.wireless_board_serial ? [{ label: "无线板序列号", value: hardwareDetails.wireless_board_serial, copyable: true }] : []),
    
    ...(hardwareDetails?.display_max_brightness ? [{ label: "最大亮度", value: `${hardwareDetails.display_max_brightness} nits`, copyable: true }] : []),
    ...(hardwareDetails?.display_type ? [{ label: "显示类型", value: hardwareDetails.display_type, copyable: true }] : []),
    
    ...(hardwareDetails?.partition_type ? [{ label: "分区类型", value: hardwareDetails.partition_type, copyable: true }] : []),
    ...(hardwareDetails?.apfs_container_uuid ? [{ label: "APFS容器UUID", value: hardwareDetails.apfs_container_uuid, copyable: true }] : []),
    ...(hardwareDetails?.boot_session_id ? [{ label: "启动会话ID", value: hardwareDetails.boot_session_id, copyable: true }] : []),
  ];

  return (
    <>
    <Transition appear show={isOpen} as={Fragment} afterLeave={handleAfterLeave}>
      <Dialog as="div" className="relative z-40" onClose={handleClose}>
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
              <Dialog.Panel className="w-full max-w-4xl max-h-[85vh] transform overflow-hidden rounded-2xl bg-white text-left align-middle shadow-xl transition-all flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200">
                  <Dialog.Title as="div" className="flex items-center gap-2 min-w-0">
                    <span className="text-base font-semibold text-gray-900 truncate">
                      {currentDevice.name}
                    </span>
                    <span className="text-sm text-gray-600 truncate">
                      {(() => {
                        const modelName = getDeviceModelName(currentDevice.product_type);
                        const colorName = getDeviceColorName(
                          currentDevice.product_type,
                          currentDevice.color,
                          currentDevice.enclosure_color
                        );
                        return colorName ? `${modelName} ${colorName}` : modelName;
                      })()}
                    </span>
                    {getStorageCapacityLabel() && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-200 text-[11px] font-medium flex-shrink-0">
                        {getStorageCapacityLabel()}
                      </span>
                    )}
                  </Dialog.Title>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {currentDevice.battery_level > 0 && (
                      <div className="flex items-center gap-1.5 text-gray-600">
                        {(() => {
                          const BatteryIcon = getBatteryIcon(
                            currentDevice.battery_level,
                            currentDevice.battery_is_charging
                          );
                          const Icon = BatteryIcon;
                          return (
                            <Icon
                              size={16}
                              className={
                                currentDevice.battery_level <= 20 && !currentDevice.battery_is_charging
                                  ? "text-red-500"
                                  : currentDevice.battery_is_charging
                                    ? "text-green-500"
                                    : "text-gray-700"
                              }
                            />
                          );
                        })()}
                        <span
                          className={`text-xs font-medium ${
                            currentDevice.battery_level <= 20 && !currentDevice.battery_is_charging
                              ? "text-red-600"
                              : "text-gray-700"
                          }`}
                        >
                          {currentDevice.battery_level}%
                        </span>
                      </div>
                    )}
                    <div className="hidden sm:flex items-center gap-2">
                      <Button3D
                        variant="accent"
                        size="sm"
                        onClick={() => setShowRestartConfirm(true)}
                      >
                        {t("devices.restart")}
                      </Button3D>
                      <Button3D
                        variant="dangerFilled"
                        size="sm"
                        onClick={() => setShowShutdownConfirm(true)}
                      >
                        {t("devices.shutdown")}
                      </Button3D>
                    </div>
                    <button
                      onClick={handleClose}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden px-6 py-4 bg-slate-50/40">
                  <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(280px,1.2fr)] gap-4 lg:gap-4 h-full">
                    {/* Details column */}
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3 flex flex-col min-h-0">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-gray-900">
                          {t("deviceDetails.deviceInfo")}
                        </h4>
                        {extraRows.length > 0 && (
                          <button
                            onClick={() => setShowMoreDetailsDialog(true)}
                            className="text-xs font-medium text-gray-600 hover:text-primary-600 inline-flex items-center gap-1"
                          >
                            <ChevronRight size={14} />
                            <span>{t("deviceDetails.moreDetails")}</span>
                          </button>
                        )}
                      </div>
                      <div className="mt-1 flex-1 min-h-0 overflow-y-auto pr-1 scrollbar-thin">
                        <div>
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
                    </div>

                    {/* Right: Battery on top, Storage below */}
                    <div className="space-y-4">
                      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <h4 className="text-sm font-semibold text-gray-900">
                              {t("deviceDetails.batteryHealth")}
                            </h4>
                            <p className="mt-0.5 text-xs text-gray-500">
                              {t("deviceDetails.batteryCycles")}: {currentDevice.battery_cycle_count > 0 ? currentDevice.battery_cycle_count : '-'}
                            </p>
                          </div>
                          <div className="flex flex-col items-center">
                            <div className="relative inline-flex items-center justify-center w-16 h-16">
                              <svg className="w-16 h-16 transform -rotate-90">
                                <circle
                                  cx="32"
                                  cy="32"
                                  r="28"
                                  stroke="#e5e7eb"
                                  strokeWidth="6"
                                  fill="none"
                                />
                                <circle
                                  cx="32"
                                  cy="32"
                                  r="28"
                                  stroke="#fbbf24"
                                  strokeWidth="6"
                                  fill="none"
                                  strokeDasharray={`${2 * Math.PI * 28}`}
                                  strokeDashoffset={`${2 * Math.PI * 28 * (1 - (currentDevice.battery_health > 0 ? currentDevice.battery_health : 0) / 100)}`}
                                  strokeLinecap="round"
                                  className="transition-all duration-500"
                                />
                              </svg>
                              <span className="absolute text-sm font-semibold text-gray-900">
                                {currentDevice.battery_health > 0 ? `${currentDevice.battery_health}%` : '--'}
                              </span>
                            </div>
                          </div>
                        </div>
                        {currentDevice.battery_level > 0 && (
                          <p className="text-xs text-gray-600">
                            {t("deviceDetails.batteryLevel")}: {currentDevice.battery_level}%
                          </p>
                        )}
                        <p className="mt-1 text-xs text-gray-600">
                          {t("deviceDetails.batteryStatus")}: {chargingSpeed ? `${chargingState} · ${chargingSpeed}` : chargingState}
                        </p>
                        {currentDevice.battery_watts && (
                          <p className="mt-1 text-xs text-gray-600">
                            {t("deviceDetails.batteryWatts")}: {currentDevice.battery_watts.toFixed(1)}W
                          </p>
                        )}
                      </div>

                      {currentDevice.storage_info && (
                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-gray-900">
                              {t("deviceDetails.storage")}
                            </h4>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-200 text-[11px] font-medium">
                              {getStorageCapacityLabel()}
                            </span>
                          </div>
                          <div className="space-y-1 text-xs text-gray-700 mb-2">
                            <div className="flex items-center justify-between">
                              <span>{currentDevice.storage_info.formatted_used} {t("deviceDetails.used")}</span>
                              <span className="font-semibold">{currentDevice.storage_info.used_percentage.toFixed(1)}%</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span>{currentDevice.storage_info.formatted_available} {t("deviceDetails.available")}</span>
                              <span className="text-gray-500">{t("deviceDetails.totalCapacity")}: {currentDevice.storage_info.formatted_total}</span>
                            </div>
                          </div>
                          <div className="w-full bg-white/60 rounded-full h-3 overflow-hidden border border-blue-100">
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
                      )}

                      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 text-xs text-gray-700">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold">{t("deviceDetails.crashLogCount")}</span>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 font-mono text-xs">
                            {currentDevice.crash_log_count}
                          </span>
                        </div>
                        <p className="text-gray-500">
                          {t("deviceDetails.timeZone")}: {currentDevice.time_zone || '-'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-200 flex justify-end bg-white">
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

    {/* More Details Dialog */}
    <Transition appear show={showMoreDetailsDialog} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={() => setShowMoreDetailsDialog(false)}>
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
              <Dialog.Panel className="w-full max-w-2xl max-h-[85vh] transform overflow-hidden rounded-2xl bg-white text-left align-middle shadow-xl transition-all flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                  <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900">
                    {t("deviceDetails.moreDetails")}
                  </Dialog.Title>
                  <button
                    onClick={() => setShowMoreDetailsDialog(false)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div>
                    {extraRows.map((row, index) => (
                      <DetailRow
                        key={`extra-${index}`}
                        label={row.label}
                        value={row.value}
                        copyable={row.copyable}
                      />
                    ))}
                  </div>
                </div>
                <div className="px-6 py-4 border-t border-gray-200 flex justify-end bg-white">
                  <button
                    onClick={() => setShowMoreDetailsDialog(false)}
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
    </>
  );
}

