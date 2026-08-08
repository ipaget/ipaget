import { Fragment, useState, useEffect } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X, ChevronRight, Battery, BatteryCharging, BatteryFull, BatteryMedium, BatteryLow, Wifi, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DeviceInfo, goServiceClient } from "../lib/goService";
import { getDeviceColorName } from "../lib/deviceColorMap";
import { getDeviceModelName, getDeviceSalesType } from "../lib/deviceModelMap";
import { getDeviceSocName, getDeviceCpuSpec } from "../lib/deviceSocMap";
import { getDeviceReleaseDate } from "../lib/deviceReleaseDateMap";
import { getDeviceCoprocessor } from "../lib/deviceCoprocessorMap";
import { getDeviceDisplay, getDeviceDiskType } from "../lib/deviceDisplayMap";
import { useToastStore } from "../store/toastStore";
import ConfirmDialog from "./ConfirmDialog";
import DetailRow from "./DetailRow";
import Button3D from "./Button3D";

interface DeviceDetailsDialogProps {
  device: DeviceInfo | null;
  onClose: () => void;
  onDeviceUpdated?: (device: DeviceInfo) => void;
}

export default function DeviceDetailsDialog({ device, onClose, onDeviceUpdated }: DeviceDetailsDialogProps) {
  const { t } = useTranslation();
  const { showToast } = useToastStore();
  const [isOpen, setIsOpen] = useState(false);
  const [currentDevice, setCurrentDevice] = useState<DeviceInfo | null>(null);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [showShutdownConfirm, setShowShutdownConfirm] = useState(false);
  const [showMoreDetailsDialog, setShowMoreDetailsDialog] = useState(false);
  const [fullDeviceInfo, setFullDeviceInfo] = useState<Record<string, any> | null>(null);
  const [isLoadingFullDeviceInfo, setIsLoadingFullDeviceInfo] = useState(false);
  const [isUpdatingWiFi, setIsUpdatingWiFi] = useState(false);

  useEffect(() => {
    if (device) {
      setCurrentDevice(device);
      setFullDeviceInfo(null);
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }, [device]);

  const handleClose = () => {
    setShowMoreDetailsDialog(false);
    setFullDeviceInfo(null);
    setShowRestartConfirm(false);
    setShowShutdownConfirm(false);
    setIsOpen(false);
  };

  const handleDialogClose = () => {
    if (showMoreDetailsDialog) {
      return;
    }
    handleClose();
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

  const handleWiFiDebuggingToggle = async () => {
    if (!currentDevice || isUpdatingWiFi || currentDevice.connection_type?.toLowerCase() !== "usb") return;

    const enabled = !currentDevice.wifi_debugging_enabled;
    setIsUpdatingWiFi(true);
    try {
      const applied = await goServiceClient.setWiFiDebugging(currentDevice.udid, enabled);
      const updatedDevice = { ...currentDevice, wifi_debugging_enabled: applied };
      setCurrentDevice(updatedDevice);
      onDeviceUpdated?.(updatedDevice);
      showToast(applied ? t("devices.wifiDebuggingEnabled") : t("devices.wifiDebuggingDisabled"), "success");
    } catch (error) {
      showToast(t("devices.wifiDebuggingFailed"), "error");
      console.error("Failed to configure Wi-Fi debugging:", error);
    } finally {
      setIsUpdatingWiFi(false);
    }
  };

  const handleShowMoreDetails = async () => {
    if (!currentDevice || isLoadingFullDeviceInfo) return;

    setShowMoreDetailsDialog(true);
    if (fullDeviceInfo) return;

    setIsLoadingFullDeviceInfo(true);
    try {
      const info = await goServiceClient.getFullDeviceInfo(currentDevice.udid);
      setFullDeviceInfo(info);
    } catch (error) {
      console.error("Failed to load full device info:", error);
    } finally {
      setIsLoadingFullDeviceInfo(false);
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
      A: "Canada",
      AB: "Egypt, Jordan, Saudi Arabia, United Arab Emirates",
      AE: "Bahrain, Kuwait, Qatar, Saudi Arabia, United Arab Emirates",
      AH: "Bahrain, Kuwait",
      AM: "United States (Assembled in Vietnam)",
      B: "Ireland, UK, also used for some replacement units",
      BR: "Brazil (Assembled in Brazil)",
      BZ: "Brazil (Assembled in China)",
      C: "Canada",
      CL: "Canada",
      CH: "中国大陆",
      CN: "Slovakia",
      CZ: "Czech Republic",
      D: "Germany",
      DN: "Austria, Germany, Netherlands",
      E: "Mexico",
      EE: "Estonia",
      ET: "Estonia",
      F: "France",
      FB: "France, Luxembourg",
      FD: "Austria, Liechtenstein, Switzerland",
      FS: "Finland",
      GR: "Greece",
      HN: "India",
      HB: "Israel",
      HU: "Ukraine",
      IP: "Italy",
      J: "Japan",
      KH: "China, South Korea",
      KN: "Denmark, Norway",
      KS: "Finland, Sweden",
      LA: "Colombia, Ecuador, El Salvador, Guatemala, Honduras, Peru",
      LE: "Argentina",
      LL: "USA, Canada, also used for some replacement units",
      LP: "Poland",
      LT: "Lithuania",
      LV: "Latvia",
      LW: "USA (Apple Watches sold after January 18th, 2024 without Blood Oxygen functionality)",
      LZ: "Chile, Paraguay, Uruguay",
      MG: "Hungary",
      MO: "Macau, Hong Kong",
      MY: "Malaysia",
      NF: "Belgium, France, Luxembourg",
      PK: "Finland, Poland",
      PL: "Poland",
      PM: "Poland",
      PO: "Portugal",
      PP: "Philippines",
      QL: "Italy, Spain, Portugal",
      QN: "Denmark, Norway, Sweden, Iceland",
      RK: "Kazakhstan",
      RM: "Russia, Kazakhstan",
      RO: "Romania",
      RP: "Russia",
      RR: "Russia",
      RS: "Russia",
      RU: "Russia",
      SA: "Vietnam (used mostly on iPad and Mac)",
      SE: "Serbia",
      SL: "Slovakia",
      SO: "South Africa",
      SU: "Ukraine",
      T: "Italy",
      TA: "Taiwan",
      TH: "Thailand",
      TU: "Turkey",
      TY: "Italy",
      UA: "Ukraine",
      VC: "Canada",
      VN: "Vietnam",
      X: "Australia, New Zealand",
      Y: "Spain",
      ZA: "Singapore",
      ZD: "Germany, Belgium, Luxembourg, Netherlands, Austria, France, Switzerland, Monaco",
      ZP: "Hong Kong, Macau",
    };
    const description = map[code];
    if (!description) {
      return regionInfo;
    }
    return description;
  };

  const detailRows = [
    {
      label: t("deviceDetails.connectionType"),
      value:
        (currentDevice.connection_type || "").toLowerCase() === "usb"
          ? t("devices.connectionUsb")
          : (currentDevice.connection_type || "").toLowerCase() === "network"
            ? t("devices.connectionNetwork")
            : t("devices.connectionUnknown"),
    },
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

  const sanitizeDisplayText = (value: string | number | null | undefined): string => {
    if (value === null || value === undefined) {
      return "";
    }
    const text = String(value);
    // Drop control chars / replacement chars that can break UI layout/focus.
    return text.replace(/[\u0000-\u001F\u007F\uFFFD]/g, "").trim();
  };

  const getDisplayStorageBytes = () => {
    const storageInfo = currentDevice.storage_info;
    if (!storageInfo) return null;
    // Prefer nominal disk capacity (e.g. 256GB). Data partition is smaller and
    // should not be used for the capacity badge.
    return storageInfo.total_disk_capacity || storageInfo.total_data_capacity || null;
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
    return tier >= 1024 ? `${tier / 1024}TB` : `${tier}GB`;
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
    ...(currentDevice.imei ? [{ label: t("deviceDetails.imei"), value: sanitizeDisplayText(currentDevice.imei), copyable: true }] : []),
    ...(currentDevice.imei2 ? [{ label: "IMEI2", value: sanitizeDisplayText(currentDevice.imei2), copyable: true }] : []),
    ...(currentDevice.regulatory_model ? [{ label: t("deviceDetails.regulatoryModel"), value: sanitizeDisplayText(currentDevice.regulatory_model), copyable: true }] : []),
    ...(currentDevice.ethernet_address ? [{ label: t("deviceDetails.ethernetAddress"), value: sanitizeDisplayText(currentDevice.ethernet_address), copyable: true }] : []),
    ...(currentDevice.imsi ? [{ label: "IMSI", value: sanitizeDisplayText(currentDevice.imsi), copyable: true }] : []),
    ...(currentDevice.sim_status ? [{ label: t("deviceDetails.simStatus"), value: currentDevice.sim_status }] : []),
    ...(currentDevice.sim_tray_status ? [{ label: t("deviceDetails.simTrayStatus"), value: currentDevice.sim_tray_status }] : []),
    ...(carrierInfo ? [{ label: t("deviceDetails.carrier"), value: carrierInfo }] : []),
    { label: t("deviceDetails.crashLogCount"), value: currentDevice.crash_log_count.toString() },
    ...(currentDevice.battery_level > 0 ? [{ label: t("deviceDetails.batteryLevel"), value: `${currentDevice.battery_level}%` }] : []),
    ...(currentDevice.battery_external_connected || currentDevice.battery_is_charging || currentDevice.battery_fully_charged ? [{ label: t("deviceDetails.batteryStatus"), value: chargingSpeed ? `${chargingState} · ${chargingSpeed}` : chargingState }] : []),
    ...(currentDevice.battery_watts && currentDevice.battery_watts >= 1
      ? [{ label: t("deviceDetails.batteryWatts"), value: `${currentDevice.battery_watts.toFixed(1)}W` }]
      : []),
    
    // Hardware Details Section
    ...(hardwareDetails?.mlb_serial_number ? [{ label: "主板序列号 (MLB)", value: sanitizeDisplayText(hardwareDetails.mlb_serial_number), copyable: true }] : []),
    ...(hardwareDetails?.hardware_model ? [{ label: "硬件型号", value: sanitizeDisplayText(hardwareDetails.hardware_model), copyable: true }] : []),
    ...(hardwareDetails?.hardware_platform ? [{ label: "芯片平台", value: sanitizeDisplayText(hardwareDetails.hardware_platform), copyable: true }] : []),
    ...(hardwareDetails?.chip_id ? [{ label: "芯片ID", value: `0x${hardwareDetails.chip_id.toString(16).toUpperCase()}`, copyable: true }] : []),
    ...(hardwareDetails?.die_id ? [{ label: "Die ID (ECID)", value: hardwareDetails.die_id.toString(), copyable: true }] : []),
    ...(hardwareDetails?.board_id ? [{ label: "主板ID", value: hardwareDetails.board_id.toString(), copyable: true }] : []),
    
    ...(hardwareDetails?.baseband_version ? [{ label: "基带版本", value: sanitizeDisplayText(hardwareDetails.baseband_version), copyable: true }] : []),
    ...(hardwareDetails?.baseband_chip_id ? [{ label: "基带芯片ID", value: `0x${hardwareDetails.baseband_chip_id.toString(16).toUpperCase()}`, copyable: true }] : []),
    ...(sanitizeDisplayText(hardwareDetails?.baseband_serial_number)
      ? [{ label: "基带序列号", value: sanitizeDisplayText(hardwareDetails?.baseband_serial_number), copyable: true }]
      : []),
    ...(hardwareDetails?.iccid ? [{ label: "ICCID (SIM1)", value: sanitizeDisplayText(hardwareDetails.iccid), copyable: true }] : []),
    ...(hardwareDetails?.iccid2 ? [{ label: "ICCID (SIM2)", value: sanitizeDisplayText(hardwareDetails.iccid2), copyable: true }] : []),
    ...(hardwareDetails?.imsi2 ? [{ label: "IMSI (SIM2)", value: sanitizeDisplayText(hardwareDetails.imsi2), copyable: true }] : []),
    ...(hardwareDetails?.meid ? [{ label: "MEID", value: sanitizeDisplayText(hardwareDetails.meid), copyable: true }] : []),
    
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

  const formatDetailValue = (value: unknown): string => {
    if (value === null || value === undefined || value === "") {
      return "-";
    }
    if (typeof value === "boolean") {
      return value ? t("common.yes") : t("common.no");
    }
    if (typeof value === "object") {
      return sanitizeDisplayText(JSON.stringify(value)) || "-";
    }
    return sanitizeDisplayText(String(value)) || "-";
  };

  const detailData: Record<string, any> = { ...(currentDevice.raw_data || {}) };
  const mergeDetailData = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(mergeDetailData);
      return;
    }
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      if (!(key in detailData)) {
        detailData[key] = child;
      }
      mergeDetailData(child);
    });
  };
  mergeDetailData(fullDeviceInfo);

  const normalizeDetailKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

  const findDetailValue = (...keys: string[]): unknown => {
    const wanted = new Set(keys.map(normalizeDetailKey));
    let found: unknown;
    const visit = (value: unknown) => {
      if (found !== undefined || value === null || value === undefined || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
        if (found !== undefined) return;
        if (wanted.has(normalizeDetailKey(key))) {
          found = child;
          return;
        }
        visit(child);
      });
    };
    visit(detailData);
    return found;
  };

  const rawDetailValue = (key: string): string => formatDetailValue(findDetailValue(key));
  const rawDetailValueOr = (...keys: string[]): string => {
    const value = findDetailValue(...keys);
    if (value !== null && value !== undefined && value !== "") {
      return formatDetailValue(value);
    }
    return "-";
  };
  const formatHardwareSerialValue = (value: unknown): string => {
    if (typeof value !== "string") return formatDetailValue(value);
    const encoded = value.trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
      return formatDetailValue(value);
    }
    try {
      const decoded = atob(encoded).replace(/\0+$/, "");
      const isPrintable = [...decoded].every((char) => {
        const code = char.charCodeAt(0);
        return code >= 0x20 && code <= 0x7e;
      });
      return isPrintable && decoded ? formatDetailValue(decoded) : formatDetailValue(value);
    } catch {
      return formatDetailValue(value);
    }
  };
  const displayInfo = getDeviceDisplay(currentDevice.product_type);
  const liveScreenWidth = findDetailValue("ScreenWidth", "MainScreenWidth", "DisplayWidth");
  const liveScreenHeight = findDetailValue("ScreenHeight", "MainScreenHeight", "DisplayHeight");
  const screenResolutionValue = (() => {
    const width = Number(liveScreenWidth);
    const height = Number(liveScreenHeight);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      return `${width} x ${height}`;
    }
    if (displayInfo) return displayInfo.resolution;
    const value = rawDetailValueOr("ScreenResolution", "DisplayResolution");
    if (value !== "-") return value;
    if (detailData.ScreenWidth !== undefined && detailData.ScreenHeight !== undefined) {
      return `${formatDetailValue(detailData.ScreenWidth)} x ${formatDetailValue(detailData.ScreenHeight)}`;
    }
    return "-";
  })();
  const formatReleaseDate = (value: string | null): string => {
    if (!value) return "-";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric" }).format(date);
  };
  const formatCpuCores = (value: unknown): string => {
    const text = formatDetailValue(value);
    return text === "-" ? "-" : `${text}核`;
  };
  const formatCpuFrequency = (value: unknown): string => {
    if (value === null || value === undefined || value === "") return "-";
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return formatDetailValue(value);
    if (numeric >= 100000000) return `${(numeric / 1000000000).toFixed(2)}GHz`;
    if (numeric >= 100000) return `${(numeric / 1000000).toFixed(0)}MHz`;
    return `${numeric}MHz`;
  };
  const socName = getDeviceSocName(currentDevice.product_type) || rawDetailValueOr("CPUName", "CPUType", "CPUModel", "hwCPUtype");
  const screenSizeValue = displayInfo
    ? t("deviceDetails.screenSizeInches", { size: displayInfo.sizeInches })
    : rawDetailValueOr("ScreenSize", "DisplaySize");
  const coprocessorValue = (() => {
    const mapped = getDeviceCoprocessor(currentDevice.product_type);
    if (mapped === "none") return t("deviceDetails.coprocessor.none");
    if (mapped === "integrated") return t("deviceDetails.coprocessor.integrated");
    return mapped || rawDetailValueOr("Coprocessor", "CoProcessor");
  })();
  const diskTypeValue = (() => {
    const mapped = getDeviceDiskType(currentDevice.product_type);
    if (mapped === "flash") return t("deviceDetails.diskType.flash");
    if (mapped === "nvme") return t("deviceDetails.diskType.nvme");
    if (mapped === "emmc") return t("deviceDetails.diskType.emmc");
    return mapped || rawDetailValueOr("DiskType");
  })();
  const cpuSpecFallback = getDeviceCpuSpec(currentDevice.product_type);
  const liveCpuCores = findDetailValue("CPUCoreCount", "NumberOfPhysicalCpus", "numberOfPhysicalCpus", "NumberOfCpus", "numberOfCpus", "hardware:NumberOfPhysicalCpus", "hardware:numberOfPhysicalCpus");
  const cpuCoresValue = liveCpuCores !== null && liveCpuCores !== undefined && liveCpuCores !== "" ? liveCpuCores : cpuSpecFallback?.cores;
  const liveCpuFrequency = findDetailValue("CPUFrequency", "SpeedOfCpus", "speedOfCpus", "hardware:SpeedOfCpus", "hardware:speedOfCpus");
  const cpuFrequencyValue = liveCpuFrequency !== null && liveCpuFrequency !== undefined && liveCpuFrequency !== "" ? liveCpuFrequency : cpuSpecFallback?.frequency;
  const modelName = getDeviceModelName(currentDevice.product_type);
  const salesTypeValue = (() => {
    const modelNumber = findDetailValue("ModelNumber") ?? currentDevice.model_number ?? currentDevice.sales_model;
    const mapped = getDeviceSalesType(typeof modelNumber === "string" ? modelNumber : null);
    return mapped ? t(`deviceDetails.salesType.${mapped}`) : rawDetailValue("SalesType");
  })();
  const colorName = getDeviceColorName(
    currentDevice.product_type,
    currentDevice.color,
    currentDevice.enclosure_color
  );
  const simType = currentDevice.sim1_info && currentDevice.sim2_info
    ? "双卡"
    : currentDevice.sim1_info || currentDevice.sim2_info
      ? "单卡"
      : "-";

  const moreDetailSections = [
    {
      rows: [
        { label: "设备名称", value: formatDetailValue(currentDevice.name), copyable: true },
        { label: "容量颜色", value: [getStorageCapacityLabel(), colorName].filter(Boolean).join(" ") || "-" },
        { label: "上市日期", value: formatReleaseDate(getDeviceReleaseDate(currentDevice.product_type) || (rawDetailValue("PurchaseDate") === "-" ? null : rawDetailValue("PurchaseDate"))) },
        { label: "设备型号", value: modelName, copyable: true },
        { label: "激活状态", value: getActivationStateText(currentDevice.activation_state) },
        { label: "生产日期", value: formatDetailValue(currentDevice.manufacture_date) },
        { label: "序列号", value: formatDetailValue(currentDevice.serial_number), copyable: true },
        { label: "越狱状态", value: getJailbreakStatusText(currentDevice.is_jailbroken) },
        { label: "销售类型", value: salesTypeValue },
        { label: "主板序列号", value: formatDetailValue(hardwareDetails?.mlb_serial_number), copyable: true },
        { label: "产品类型", value: `${formatDetailValue(currentDevice.product_type)} (${formatDetailValue(currentDevice.regulatory_model || currentDevice.product_name)})` },
        { label: "销售型号", value: formatDetailValue(currentDevice.sales_model) },
        { label: "ECID", value: formatDetailValue(currentDevice.ecid || detailData.UniqueChipID), copyable: true },
        { label: "固件版本", value: `${formatDetailValue(currentDevice.version)} (${formatDetailValue(currentDevice.build_version)})` },
        { label: "销售地区", value: getSalesRegionText(currentDevice.region_info) },
        { label: "UDID", value: formatDetailValue(currentDevice.udid), copyable: true },
      ],
    },
    {
      rows: [
        { label: "时区", value: formatDetailValue(currentDevice.time_zone) },
        { label: "地区", value: rawDetailValue("Locale") },
        { label: "24小时制", value: rawDetailValue("Uses24HourClock") },
        { label: "充电次数", value: formatDetailValue(currentDevice.battery_cycle_count > 0 ? `${currentDevice.battery_cycle_count}次` : "-") },
        { label: "剩余电量", value: formatDetailValue(currentDevice.battery_level > 0 ? `${currentDevice.battery_level}%` : "-") },
        { label: "电池寿命", value: formatDetailValue(currentDevice.battery_health > 0 ? `${currentDevice.battery_health}%` : "-") },
      ],
    },
    {
      rows: [
        { label: "卡槽类型", value: simType },
        { label: "IMEI 1", value: formatDetailValue(currentDevice.imei), copyable: true },
        { label: "SIM卡1信息", value: formatDetailValue(currentDevice.sim1_info ? translateCarrier(currentDevice.sim1_info) : "-") },
        { label: "有无卡托", value: currentDevice.sim_tray_status ? t("common.yes") : "-" },
        { label: "IMEI 2", value: formatDetailValue(currentDevice.imei2), copyable: true },
        { label: "SIM卡2信息", value: formatDetailValue(currentDevice.sim2_info ? translateCarrier(currentDevice.sim2_info) : "-") },
        { label: "基带版本", value: formatDetailValue(hardwareDetails?.baseband_version || detailData.BasebandVersion), copyable: true },
        { label: "Wi-Fi地址", value: formatDetailValue(currentDevice.wifi_address), copyable: true },
        { label: "SIM卡状态", value: formatDetailValue(currentDevice.sim_status) },
        { label: "基带激活版本", value: rawDetailValue("BasebandActivationTicketVersion") },
        { label: "蓝牙地址", value: formatDetailValue(currentDevice.bluetooth_address), copyable: true },
        { label: "SIM卡托状态", value: formatDetailValue(currentDevice.sim_tray_status) },
        { label: "基带状态", value: rawDetailValue("BasebandStatus") },
        { label: "蜂窝地址", value: formatDetailValue(currentDevice.ethernet_address), copyable: true },
        { label: "通话功能", value: rawDetailValue("TelephonyCapability") },
        { label: "基带序列号", value: formatDetailValue(hardwareDetails?.baseband_serial_number), copyable: true },
        { label: "IMSI", value: formatDetailValue(currentDevice.imsi), copyable: true },
        { label: "协议版本", value: rawDetailValue("ProtocolVersion") },
      ],
    },
    {
      rows: [
        { label: "CPU类型", value: socName },
        { label: "Wi-Fi模块", value: formatDetailValue(hardwareDetails?.wifi_chipset || detailData.WiFiModule || detailData.WiFiChipset) },
        { label: "屏幕大小", value: screenSizeValue },
        { label: "CPU核心", value: formatCpuCores(cpuCoresValue) },
        { label: "Wi-Fi序号", value: formatDetailValue(hardwareDetails?.wifi_module_serial || detailData.WiFiModuleSerial || detailData.WiFiSerialNumber), copyable: true },
        { label: "屏幕分辨率", value: screenResolutionValue },
        { label: "CPU频率", value: formatCpuFrequency(cpuFrequencyValue) },
        { label: "无线技术类型", value: rawDetailValueOr("ActiveWirelessTechnology", "kCTWirelessTechnology", "WirelessTechnology", "WirelessTechnologyType", "BasebandRegionSKURadioTechnology", "TelephonyMaximumGeneration") },
        { label: "硬盘类型", value: diskTypeValue },
        { label: "协处理器", value: coprocessorValue },
        { label: "硬件版本", value: formatDetailValue(hardwareDetails?.hardware_platform) },
        { label: "分区类型", value: formatDetailValue(hardwareDetails?.partition_type) },
      ],
    },
    {
      rows: [
        { label: "距离传感器", value: formatHardwareSerialValue(findDetailValue("sensor:proximitySensor", "sensor:ProximitySensor", "sensor:ProximitySensorSerialNumber", "ProximitySensorSerialNumber", "ProximitySensorSerial", "RosalineSerialNumber", "Rosaline") ?? hardwareDetails?.proximity_sensor) },
        { label: "环境光", value: formatHardwareSerialValue(findDetailValue("sensor:ambientLightSensor", "sensor:AmbientLightSensor", "sensor:AmbientLightSensorSerialNumber", "AmbientLightSensorSerialNumber", "ambient-light-sensor-serial-num") ?? hardwareDetails?.ambient_light_sensor) },
        { label: "点阵", value: formatHardwareSerialValue(findDetailValue("sensor:dotProjector", "sensor:DotProjector", "sensor:DotMatrix", "sensor:DotProjectorSerialNumber", "FrontFacingIRStructuredLightProjectorModuleSerialNumber")) },
        { label: "红外摄像头", value: formatHardwareSerialValue(findDetailValue("sensor:infraredCamera", "sensor:InfraredCameraSerialNumber", "sensor:InfraredCameraModuleSerial", "FrontFacingIRCameraModuleSerialNumber", "front-facing-ir-camera-module-serial-number", "FrontCameraSerialNumber")) },
        { label: "电池序列号", value: formatHardwareSerialValue(findDetailValue("sensor:battery", "BatterySerialNumber", "battery-serial-number") ?? (hardwareDetails?.battery_serial || detailData.BatterySerialNumber)), copyable: true },
        { label: "震动器编码", value: rawDetailValueOr("VibrationMotorCode", "TapticEngineCode") },
        { label: "盖板码", value: formatHardwareSerialValue(findDetailValue("sensor:coverGlass", "CoverglassSerialNumber", "CoverGlassSerialNumber", "coverglass-serial-number") ?? (hardwareDetails?.cover_glass_serial || detailData.CoverGlassSerialNumber)), copyable: true, span: 3 },
        { label: "屏幕序列号", value: formatHardwareSerialValue(findDetailValue("sensor:screen", "DisplaySerialNumber", "ScreenSerialNumber", "PanelSerialNumber", "RawPanelSerialNumber", "raw-panel-serial-number") ), span: 3 },
      ],
    },
  ];

  return (
    <>
    <Transition appear show={isOpen} as={Fragment} afterLeave={handleAfterLeave}>
      <Dialog as="div" open={isOpen} static className="relative z-40" onClose={handleDialogClose}>
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
              {showMoreDetailsDialog ? (
                <Dialog.Panel className="flex h-[min(90vh,760px)] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white text-left shadow-xl">
                  <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                    <Dialog.Title className="text-lg font-semibold text-gray-900">
                      {t("deviceDetails.title")}
                    </Dialog.Title>
                    <button
                      type="button"
                      onClick={() => setShowMoreDetailsDialog(false)}
                      className="text-gray-400 transition-colors hover:text-gray-600"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto px-6">
                    {moreDetailSections.map((section, sectionIndex) => (
                      <div
                        key={`section-${sectionIndex}`}
                        className="grid grid-cols-1 gap-x-8 gap-y-3 border-b border-gray-200 py-5 last:border-b-0 md:grid-cols-3"
                      >
                        {section.rows.map((row, rowIndex) => (
                          <div
                            key={`detail-${sectionIndex}-${rowIndex}`}
                            className={"span" in row && row.span === 3 ? "md:col-span-3" : undefined}
                          >
                            <DetailRow
                              label={row.label}
                              value={row.value}
                              copyable={row.copyable}
                            />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end border-t border-gray-200 bg-white px-6 py-4">
                    <button
                      type="button"
                      onClick={() => setShowMoreDetailsDialog(false)}
                      className="rounded-lg bg-gray-100 px-5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200"
                    >
                      {t("common.confirm")}
                    </button>
                  </div>
                </Dialog.Panel>
              ) : (
              <Dialog.Panel className="w-full max-w-4xl max-h-[85vh] transform overflow-hidden rounded-2xl bg-white text-left align-middle shadow-xl transition-all flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200">
                  <Dialog.Title as="div" className="flex items-center gap-2 min-w-0">
                    <span className="text-base font-semibold text-gray-900 truncate">
                      {currentDevice.name}
                    </span>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium flex-shrink-0 ${
                        (currentDevice.connection_type || "").toLowerCase() === "network"
                          ? "bg-sky-50 text-sky-700 border-sky-200"
                          : (currentDevice.connection_type || "").toLowerCase() === "usb"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-gray-50 text-gray-600 border-gray-200"
                      }`}
                    >
                      {(currentDevice.connection_type || "").toLowerCase() === "usb"
                        ? t("devices.connectionUsb")
                        : (currentDevice.connection_type || "").toLowerCase() === "network"
                          ? t("devices.connectionNetwork")
                          : t("devices.connectionUnknown")}
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
                            onClick={handleShowMoreDetails}
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
                      <div className="rounded-xl border border-sky-100 bg-sky-50/60 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <Wifi size={16} className="flex-shrink-0 text-sky-600" />
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-gray-900">{t("deviceDetails.wifiDebugging")}</p>
                              <p className="mt-0.5 text-[11px] text-gray-500">
                                {currentDevice.connection_type?.toLowerCase() === "usb"
                                  ? t("deviceDetails.wifiDebuggingUsbHint")
                                  : t("deviceDetails.wifiDebuggingUsbRequired")}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={currentDevice.wifi_debugging_enabled}
                            aria-label={t("deviceDetails.wifiDebugging")}
                            disabled={isUpdatingWiFi || currentDevice.connection_type?.toLowerCase() !== "usb"}
                            onClick={handleWiFiDebuggingToggle}
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 ${
                              currentDevice.wifi_debugging_enabled ? "bg-sky-600" : "bg-gray-300"
                            } ${isUpdatingWiFi || currentDevice.connection_type?.toLowerCase() !== "usb" ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                          >
                            <span
                              className={`inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow transition-transform ${
                                currentDevice.wifi_debugging_enabled ? "translate-x-5" : "translate-x-0.5"
                              }`}
                            >
                              {isUpdatingWiFi && <Loader2 size={11} className="animate-spin text-sky-600" />}
                            </span>
                          </button>
                        </div>
                      </div>
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
                        {currentDevice.battery_watts && currentDevice.battery_watts >= 1 && (
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
              )}
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
