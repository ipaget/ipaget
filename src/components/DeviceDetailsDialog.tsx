import { Fragment, useState, useEffect, useMemo, useRef } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { Activity, Info, X, Smartphone, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
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
import RawDataViewer from "./RawDataViewer";
import Button3D from "./Button3D";

interface DeviceDetailsDialogProps {
  device: DeviceInfo | null;
  connectedDeviceUdids: string[];
  onClose: () => void;
  onRefresh?: () => void | Promise<void>;
}

export default function DeviceDetailsDialog({ device, connectedDeviceUdids, onClose, onRefresh }: DeviceDetailsDialogProps) {
  const { t } = useTranslation();
  const { showToast } = useToastStore();
  const [isOpen, setIsOpen] = useState(false);
  const [currentDevice, setCurrentDevice] = useState<DeviceInfo | null>(null);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [showShutdownConfirm, setShowShutdownConfirm] = useState(false);
  const [showMoreDetailsDialog, setShowMoreDetailsDialog] = useState(false);
  const [showRawDataDialog, setShowRawDataDialog] = useState(false);
  const [fullDeviceInfo, setFullDeviceInfo] = useState<Record<string, any> | null>(null);
  const [isLoadingFullDeviceInfo, setIsLoadingFullDeviceInfo] = useState(false);
  const [storageInfo, setStorageInfo] = useState<NonNullable<DeviceInfo["storage_info"]> | null>(null);
  const [isLoadingStorageInfo, setIsLoadingStorageInfo] = useState(false);
  const [deviceImageError, setDeviceImageError] = useState(false);
  const fullDeviceInfoCacheRef = useRef(new Map<string, Record<string, any>>());
  const fullDeviceInfoCompleteRef = useRef(new Set<string>());
  const fullDeviceInfoRequestsRef = useRef(new Map<string, Promise<Record<string, any> | null>>());
  const fullDeviceInfoRequestRef = useRef(0);

  useEffect(() => {
    fullDeviceInfoRequestRef.current += 1;
    if (device) {
      setCurrentDevice(device);
      setStorageInfo(device.storage_info || null);
      setIsLoadingStorageInfo(!device.storage_info);
      setFullDeviceInfo(fullDeviceInfoCacheRef.current.get(device.udid) || null);
      setIsLoadingFullDeviceInfo(false);
      setIsLoadingStorageInfo(false);
      setDeviceImageError(false);
      setIsOpen(true);
    } else {
      setIsOpen(false);
      setFullDeviceInfo(null);
      setIsLoadingFullDeviceInfo(false);
      setStorageInfo(null);
      setIsLoadingStorageInfo(false);
    }
  }, [device]);

  useEffect(() => {
    if (!device || device.storage_info) return;
    let cancelled = false;
    setIsLoadingStorageInfo(true);
    goServiceClient.getStorageInfo(device.udid)
      .then((info) => {
        if (!cancelled) setStorageInfo(info);
      })
      .catch((error) => {
        if (!cancelled) console.error("Failed to load storage info:", error);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingStorageInfo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [device]);

  useEffect(() => {
    const connectedUdidSet = new Set(connectedDeviceUdids);
    fullDeviceInfoCacheRef.current.forEach((_info, udid) => {
      if (!connectedUdidSet.has(udid)) {
        fullDeviceInfoCacheRef.current.delete(udid);
        fullDeviceInfoCompleteRef.current.delete(udid);
      }
    });

    if (currentDevice && !connectedUdidSet.has(currentDevice.udid)) {
      fullDeviceInfoRequestRef.current += 1;
      setFullDeviceInfo(null);
    }
  }, [connectedDeviceUdids, currentDevice]);

  const rawDataForViewer: Record<string, any> = useMemo(() => ({
    ...(currentDevice?.raw_data || {}),
    ...(fullDeviceInfo || {}),
  }), [currentDevice?.raw_data, fullDeviceInfo]);

  const handleClose = () => {
    setShowRawDataDialog(false);
    setShowMoreDetailsDialog(false);
    setFullDeviceInfo(null);
    setShowRestartConfirm(false);
    setShowShutdownConfirm(false);
    setIsOpen(false);
  };

  const handleDialogClose = () => {
    if (showMoreDetailsDialog || showRawDataDialog) {
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

  const loadFullDeviceInfo = async (udid: string, complete: boolean = false): Promise<Record<string, any> | null> => {
    const cachedInfo = fullDeviceInfoCacheRef.current.get(udid);
    if (cachedInfo && (!complete || fullDeviceInfoCompleteRef.current.has(udid))) {
      setFullDeviceInfo(cachedInfo);
      return cachedInfo;
    }

    const requestKey = `${udid}:${complete ? "full" : "fast"}`;
    const pendingRequest = fullDeviceInfoRequestsRef.current.get(requestKey);
    if (pendingRequest) {
      return pendingRequest;
    }

    const requestId = fullDeviceInfoRequestRef.current + 1;
    fullDeviceInfoRequestRef.current = requestId;
    setIsLoadingFullDeviceInfo(true);

    const request = (async () => {
      try {
        const info = await goServiceClient.getFullDeviceInfo(udid, complete);
        if (requestId !== fullDeviceInfoRequestRef.current) return null;
        fullDeviceInfoCacheRef.current.set(udid, info);
        if (complete) fullDeviceInfoCompleteRef.current.add(udid);
        setFullDeviceInfo(info);
        return info;
      } catch (error) {
        console.error("Failed to load full device info:", error);
        return null;
      } finally {
        fullDeviceInfoRequestsRef.current.delete(requestKey);
        if (requestId === fullDeviceInfoRequestRef.current) {
          setIsLoadingFullDeviceInfo(false);
        }
      }
    })();
    fullDeviceInfoRequestsRef.current.set(requestKey, request);
    return request;
  };

  const handleShowMoreDetails = async () => {
    if (!currentDevice || isLoadingFullDeviceInfo) return;

    setShowMoreDetailsDialog(true);
    void loadFullDeviceInfo(currentDevice.udid);
  };

  const handleOpenRawData = () => {
    if (!currentDevice) return;
    setShowRawDataDialog(true);
    if (!fullDeviceInfoCompleteRef.current.has(currentDevice.udid)) {
      void loadFullDeviceInfo(currentDevice.udid, true);
    }
  };

  const getRawDeviceDataText = () => JSON.stringify(rawDataForViewer, null, 2);

  const handleSaveRawData = async () => {
    if (!currentDevice) return;

    try {
      const targetPath = await save({
        defaultPath: `device-data-${currentDevice.udid}.txt`,
        filters: [
          { name: "Text files", extensions: ["txt"] },
          { name: "All files", extensions: ["*"] },
        ],
      });
      if (!targetPath) return;

      await writeTextFile(targetPath, getRawDeviceDataText());
      showToast(t("deviceDetails.rawDataSaved"), "success");
    } catch (error) {
      showToast(t("deviceDetails.rawDataSaveFailed"), "error");
      console.error("Failed to save raw device data:", error);
    }
  };

  const handleOpenInDefaultEditor = async () => {
    if (!currentDevice) return;
    try {
      await invoke("open_text_in_default_editor", { content: getRawDeviceDataText() });
    } catch (error) {
      showToast(t("deviceDetails.openInEditorFailed"), "error");
      console.error("Failed to open device data in the default text editor:", error);
    }
  };

  const handleCapturePrimaryScreen = async () => {
    try {
      await invoke("capture_primary_screen_to_clipboard");
      showToast(t("deviceDetails.screenCaptureCopied"), "success");
    } catch (error) {
      showToast(t("deviceDetails.screenCaptureFailed"), "error");
      console.error("Failed to copy primary screen screenshot:", error);
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
      ? currentDevice.battery_watts !== undefined && currentDevice.battery_watts >= 18
        ? t("deviceDetails.fastCharging")
        : t("deviceDetails.slowCharging")
      : currentDevice.battery_external_connected
        ? t("deviceDetails.batteryStatusConnected")
        : t("deviceDetails.batteryStatusNotCharging");

  const batteryHealthValue = currentDevice.battery_health > 0
    ? Math.min(100, Math.max(0, currentDevice.battery_health))
    : null;
  const storageUsedValue = storageInfo && Number.isFinite(storageInfo.used_percentage)
    ? Math.min(100, Math.max(0, storageInfo.used_percentage))
    : null;
  const batteryRingColor = batteryHealthValue === null
    ? "#cbd5e1"
    : batteryHealthValue >= 80
      ? "#16a34a"
      : batteryHealthValue >= 50
        ? "#d97706"
        : "#dc2626";
  const storageRingColor = storageUsedValue === null
    ? "#cbd5e1"
    : storageUsedValue >= 90
      ? "#dc2626"
      : storageUsedValue >= 75
        ? "#d97706"
        : "#0891b2";

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
        { label: "无线技术类型", value: currentDevice.wireless_technology ? formatDetailValue(currentDevice.wireless_technology) : rawDetailValueOr("ActiveWirelessTechnology", "kCTWirelessTechnology", "WirelessTechnology", "WirelessTechnologyType", "BasebandRegionSKURadioTechnology", "TelephonyMaximumGeneration") },
        { label: "硬盘类型", value: diskTypeValue },
        { label: "协处理器", value: coprocessorValue },
        { label: "硬件版本", value: formatDetailValue(hardwareDetails?.hardware_platform) },
        { label: "分区类型", value: formatDetailValue(hardwareDetails?.partition_type) },
      ],
    },
    {
      rows: [
        { label: "距离传感器", value: formatHardwareSerialValue(findDetailValue("sensor:rosaline-serial-num", "sensor:proximitySensor", "sensor:ProximitySensor", "sensor:ProximitySensorSerialNumber", "rosaline-serial-num", "RosalineSerialNumber", "ProximitySensorSerialNumber", "ProximitySensorSerial", "Rosaline") ?? hardwareDetails?.proximity_sensor) },
        { label: "环境光", value: formatHardwareSerialValue(findDetailValue("sensor:ambientLightSensor", "sensor:AmbientLightSensor", "sensor:AmbientLightSensorSerialNumber", "AmbientLightSensorSerialNumber", "ambient-light-sensor-serial-num") ?? hardwareDetails?.ambient_light_sensor) },
        { label: "点阵", value: formatHardwareSerialValue(findDetailValue("camera:FrontIRStructuredLightProjectorSerialNumString", "sensor:dotProjector", "sensor:DotProjector", "sensor:DotMatrix", "sensor:DotProjectorSerialNumber", "FrontFacingIRStructuredLightProjectorModuleSerialNumber", "FrontIRStructuredLightProjectorSerialNumString")) },
        { label: "红外摄像头", value: formatHardwareSerialValue(findDetailValue("camera:FrontIRCameraModuleSerialNumString", "sensor:infraredCamera", "sensor:InfraredCameraSerialNumber", "sensor:InfraredCameraModuleSerial", "FrontFacingIRCameraModuleSerialNumber", "front-facing-ir-camera-module-serial-number", "FrontCameraSerialNumber", "FrontIRCameraModuleSerialNumString")) },
        { label: "电池序列号", value: formatHardwareSerialValue(findDetailValue("sensor:battery", "BatterySerialNumber", "battery-serial-number") ?? (hardwareDetails?.battery_serial || detailData.BatterySerialNumber)), copyable: true },
        { label: "震动器编码", value: rawDetailValueOr("camera:JasperSNUM", "JasperSNUM", "VibrationMotorCode", "TapticEngineCode") },
        { label: "盖板码", value: formatHardwareSerialValue(findDetailValue("sensor:coverGlass", "CoverglassSerialNumber", "CoverGlassSerialNumber", "coverglass-serial-number") ?? (hardwareDetails?.cover_glass_serial || detailData.CoverGlassSerialNumber)), copyable: true, span: 3 },
        { label: "屏幕序列号", value: formatHardwareSerialValue(findDetailValue("sensor:screen", "DisplaySerialNumber", "ScreenSerialNumber", "PanelSerialNumber", "RawPanelSerialNumber", "raw-panel-serial-number") ), span: 3, truncate: true },
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
              {showRawDataDialog ? (
                <Dialog.Panel className="flex h-[min(calc(100vh-16px),760px)] w-full max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl bg-white text-left shadow-xl">
                  <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                    <Dialog.Title className="text-lg font-semibold text-gray-900">
                      {t("deviceDetails.rawData")}
                    </Dialog.Title>
                    {isLoadingFullDeviceInfo && (
                      <span className="flex items-center gap-1.5 text-xs text-gray-500">
                        <Loader2 size={14} className="animate-spin text-primary-600" />
                        {t("common.loading")}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowRawDataDialog(false)}
                      className="text-gray-400 transition-colors hover:text-gray-600"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  {isLoadingFullDeviceInfo && Object.keys(rawDataForViewer).length === 0 ? (
                    <div className="flex flex-1 items-center justify-center gap-2 text-sm text-gray-500">
                      <Loader2 size={16} className="animate-spin text-primary-600" />
                      {t("common.loading")}
                    </div>
                  ) : (
                    <RawDataViewer
                      data={rawDataForViewer}
                      alwaysShowSearch
                      className="min-h-0"
                      toolbarAction={(
                        <button
                          type="button"
                          onClick={handleSaveRawData}
                          className="text-sm text-gray-700 transition-colors hover:text-primary-600"
                        >
                          {t("deviceDetails.saveToNotepad")}
                        </button>
                      )}
                    />
                  )}
                </Dialog.Panel>
              ) : showMoreDetailsDialog ? (
                <Dialog.Panel className="flex h-[min(calc(100vh-16px),760px)] w-full max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-xl bg-white text-left shadow-xl">
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
                        className="grid grid-cols-1 gap-x-5 gap-y-1 border-b border-gray-200 py-2.5 last:border-b-0 md:grid-cols-3"
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
                              truncate={"truncate" in row ? row.truncate : false}
                            />
                          </div>
                        ))}
                      </div>
                    ))}
                    {isLoadingFullDeviceInfo && (
                      <div className="flex items-center gap-2 py-3 text-xs text-gray-500">
                        <Loader2 size={14} className="animate-spin text-primary-600" />
                        {t("common.loading")}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-white px-6 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleOpenRawData}
                        className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:border-primary-300 hover:text-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {t("deviceDetails.rawData")}
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenInDefaultEditor}
                        className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:border-primary-300 hover:text-primary-600"
                      >
                        {t("deviceDetails.openInDefaultEditor")}
                      </button>
                      <button
                        type="button"
                        onClick={handleCapturePrimaryScreen}
                        className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:border-primary-300 hover:text-primary-600"
                      >
                        {t("deviceDetails.captureScreen")}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowMoreDetailsDialog(false)}
                      className="rounded-md bg-primary-50 px-5 py-2 text-sm font-medium text-primary-700 transition-colors hover:bg-primary-100"
                    >
                      {t("common.confirm")}
                    </button>
                  </div>
                </Dialog.Panel>
              ) : (
              <Dialog.Panel className="flex h-[min(calc(100vh-32px),680px)] w-full max-w-[1040px] flex-col overflow-hidden rounded-xl bg-[#f8fafb] text-left shadow-xl">
                <div className="flex h-16 flex-shrink-0 items-center justify-between border-b border-gray-200 px-6">
                  <Dialog.Title className="flex min-w-0 items-center gap-3 text-[16px] text-gray-800">
                    <span>{currentDevice.name}</span>
                    <span className="text-gray-300">|</span>
                    <span className="truncate">{getDeviceModelName(currentDevice.product_type)} {colorName || ""}</span>
                    {getStorageCapacityLabel() && <span className="flex-shrink-0 rounded-full bg-gray-200 px-2.5 py-1 text-xs text-gray-700">{getStorageCapacityLabel()}</span>}
                  </Dialog.Title>
                  <div className="ml-4 flex flex-shrink-0 items-center gap-2 text-sm text-gray-700">
                    <span>{currentDevice.battery_is_charging || currentDevice.battery_fully_charged ? chargingState : t("deviceDetails.batteryStatusNotCharging")}</span>
                    <span className="rounded bg-gray-900 px-2 py-0.5 font-semibold text-white">{currentDevice.battery_level > 0 ? currentDevice.battery_level : "--"}</span>
                    <span>%</span>
                    <button type="button" onClick={handleClose} className="ml-3 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600" aria-label={t("common.close")}>
                      <X size={21} />
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                  <div className="grid min-h-[450px] grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(360px,1fr)_260px]">
                    <div className="flex min-h-[420px] flex-col items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                      <div className="flex min-h-0 flex-1 items-center justify-center py-2">
                        {!deviceImageError && currentDevice.product_type && currentDevice.color ? (
                          <img
                            src={`https://statici.icloud.com/fmipmobile/deviceImages-9.0/iPhone/${currentDevice.product_type}-1-${currentDevice.color}-0/online-infobox__3x.png`}
                            alt={currentDevice.name}
                            className="max-h-[350px] max-w-[210px] object-contain drop-shadow-[0_14px_14px_rgba(100,116,139,0.22)]"
                            onError={() => setDeviceImageError(true)}
                          />
                        ) : (
                          <Smartphone className="text-gray-300" size={160} strokeWidth={1} />
                        )}
                      </div>
                      <div className="flex w-full flex-wrap items-center justify-center gap-2 border-t border-gray-100 pt-3">
                        <Button3D type="button" variant="secondary" size="sm" onClick={() => setShowRestartConfirm(true)}>{t("devices.restart")}</Button3D>
                        <Button3D type="button" variant="danger" size="sm" onClick={() => setShowShutdownConfirm(true)}>{t("devices.shutdown")}</Button3D>
                        <Button3D type="button" variant="accent" size="sm" onClick={() => onRefresh?.()}>{t("deviceDetails.refresh")}</Button3D>
                      </div>
                    </div>

                    <div className="flex min-h-[420px] flex-col rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
                      <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-thin">
                        <DetailRow label={t("deviceDetails.iosVersion")} value={`${currentDevice.version} (${currentDevice.build_version})`} large />
                        <DetailRow label={t("deviceDetails.serialNumber")} value={currentDevice.serial_number || "-"} large copyable />
                        <DetailRow label="IMEI1" value={currentDevice.imei || "-"} large copyable />
                        <DetailRow label="IMEI2" value={currentDevice.imei2 || "-"} large copyable />
                        <DetailRow label={t("deviceDetails.productType")} value={`${currentDevice.product_type} (${currentDevice.regulatory_model || currentDevice.product_name})`} large />
                        <DetailRow label={t("deviceDetails.modelNumber")} value={currentDevice.sales_model || `${currentDevice.model_number} ${currentDevice.region_info}`} large />
                        <DetailRow label={t("deviceDetails.salesRegion")} value={getSalesRegionText(currentDevice.region_info)} large />
                        <DetailRow label={t("deviceDetails.activationState")} value={getActivationStateText(currentDevice.activation_state)} large />
                        <DetailRow label={t("deviceDetails.jailbreakStatus")} value={getJailbreakStatusText(currentDevice.is_jailbroken)} large />
                        <DetailRow label={t("deviceDetails.appleIdLock")} value={currentDevice.apple_id_locked ? t("common.enabled") : t("common.disabled")} large />
                        <DetailRow label="iCloud" value={currentDevice.icloud_enabled ? t("common.enabled") : t("common.disabled")} large />
                        <DetailRow label={t("deviceDetails.manufactureDate")} value={currentDevice.manufacture_date || t("deviceDetails.unknown")} large />
                        <DetailRow label={t("deviceDetails.crashLogCount")} value={t("common.file", { count: currentDevice.crash_log_count })} large />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                        <Button3D type="button" variant="secondary" size="sm" onClick={handleShowMoreDetails}>
                          <Info size={14} />
                          {t("deviceDetails.title")}
                        </Button3D>
                        <Button3D type="button" variant="accent" size="sm" onClick={handleOpenRawData}>
                          <Activity size={14} />
                          {t("deviceDetails.rawData")}
                        </Button3D>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 self-start">
                      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="text-sm font-medium text-gray-800">{t("deviceDetails.batteryHealth")}</h4>
                            <p className="mt-2 text-xs text-gray-500">{t("deviceDetails.batteryCycles")} {currentDevice.battery_cycle_count > 0 ? t("deviceDetails.batteryCycleCountValue", { count: currentDevice.battery_cycle_count }) : "-"}</p>
                          </div>
                          <div className="relative h-14 w-14 flex-shrink-0">
                            <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
                              <g transform="rotate(-90 32 32)">
                                <circle cx="32" cy="32" r="27" fill="none" stroke="#e5e7eb" strokeWidth="5" pathLength="100" />
                                <circle cx="32" cy="32" r="27" fill="none" stroke={batteryRingColor} strokeWidth="5" strokeLinecap="round" pathLength="100" strokeDasharray="100 100" strokeDashoffset={batteryHealthValue === null ? 100 : 100 - batteryHealthValue} />
                              </g>
                            </svg>
                            <span className="absolute inset-0 flex items-center justify-center text-sm font-medium text-gray-800">{batteryHealthValue === null ? "--" : `${batteryHealthValue}%`}</span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                        <div className="flex items-start justify-between">
                          <div>
                            <h4 className="text-sm font-medium text-gray-800">{t("deviceDetails.storage")} {getStorageCapacityLabel()}</h4>
                            <p className="mt-2 text-xs text-gray-500">{t("deviceDetails.available")} {isLoadingStorageInfo ? t("common.loading") : storageInfo?.formatted_available || "-"}</p>
                          </div>
                          <div className="relative h-14 w-14 flex-shrink-0">
                            <svg viewBox="0 0 64 64" className="h-full w-full" aria-hidden="true">
                              <g transform="rotate(-90 32 32)">
                                <circle cx="32" cy="32" r="27" fill="none" stroke="#e5e7eb" strokeWidth="5" pathLength="100" />
                                <circle cx="32" cy="32" r="27" fill="none" stroke={storageRingColor} strokeWidth="5" strokeLinecap="round" pathLength="100" strokeDasharray="100 100" strokeDashoffset={storageUsedValue === null ? 100 : 100 - storageUsedValue} />
                              </g>
                            </svg>
                            <span className="absolute inset-0 flex items-center justify-center text-sm font-medium text-gray-800">{isLoadingStorageInfo ? "…" : storageUsedValue === null ? "--" : `${Math.round(storageUsedValue)}%`}</span>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>
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
