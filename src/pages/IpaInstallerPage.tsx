import { useState, useEffect } from "react";
import { Package, Loader2, Smartphone, Check, X, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { stat } from "@tauri-apps/plugin-fs";
import { parseIPA, goServiceClient } from "../lib/goService";
import DetailRow from "../components/DetailRow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface IpaInfo {
  name: string;
  bundleId: string;
  version: string;
  icon?: string;
  filePath: string;
  fileSize: number;
  minimumOSVersion?: string;
}

interface Device {
  udid: string;
  name: string;
  model: string;
  ios_version: string;
  battery_level?: number;
  connection_type?: string;
}

type InstallStatus = "idle" | "installing" | "success" | "error";

export default function IpaInstallerPage() {
  const { t } = useTranslation();
  const [ipaInfo, setIpaInfo] = useState<IpaInfo | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [isLoadingIpa, setIsLoadingIpa] = useState(false);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [ipaError, setIpaError] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<InstallStatus>("idle");
  const [installProgress, setInstallProgress] = useState(0);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    let deviceCheckInterval: NodeJS.Timeout | null = null;
    let unlisten: (() => void) | null = null;

    const init = async () => {
      // Listen for IPA path event from Rust
      const unlistenFn = await listen<string>("ipa-path", (event) => {
        console.log("Received IPA path:", event.payload);
        loadIpaInfo(event.payload);
        loadDevices();
        
        // Set up device check interval
        deviceCheckInterval = setInterval(() => {
          if (devices.length === 0) {
            loadDevices();
          }
        }, 3000);
      });
      
      unlisten = unlistenFn;
    };

    init();

    return () => {
      if (deviceCheckInterval) {
        clearInterval(deviceCheckInterval);
      }
      if (unlisten) {
        unlisten();
      }
    };
  }, [devices.length]);

  const loadIpaInfo = async (filePath: string) => {
    setIsLoadingIpa(true);
    setIpaError(null);

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
      setIpaError(err.message || "Failed to load IPA information");
    } finally {
      setIsLoadingIpa(false);
    }
  };

  const loadDevices = async () => {
    setIsLoadingDevices(true);
    try {
      const deviceList = await goServiceClient.listDevices();
      setDevices(deviceList);
      if (deviceList.length === 1) {
        setSelectedDevice(deviceList[0].udid);
      }
    } catch (err) {
      console.error("Failed to load devices:", err);
      setDevices([]);
    } finally {
      setIsLoadingDevices(false);
    }
  };

  const handleInstall = async () => {
    if (!ipaInfo || !selectedDevice) return;

    setInstallStatus("installing");
    setInstallProgress(0);
    setInstallError(null);

    try {
      await goServiceClient.installIPA(selectedDevice, ipaInfo.filePath, (progress) => {
        setInstallProgress(progress);
      });

      setInstallStatus("success");
    } catch (err: any) {
      console.error("Installation failed:", err);
      setInstallError(err.message || "Installation failed");
      setInstallStatus("error");
    }
  };

  const handleOpenMainApp = async () => {
    try {
      await invoke("open_main_window");
      const currentWindow = getCurrentWindow();
      await currentWindow.close();
    } catch (err) {
      console.error("Failed to open main app:", err);
    }
  };

  const handleClose = async () => {
    const currentWindow = getCurrentWindow();
    await currentWindow.close();
  };

  const formatSize = (bytes: number): string => {
    const mb = bytes / (1024 * 1024);
    const gb = mb / 1024;

    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    return `${mb.toFixed(2)} MB`;
  };

  if (isLoadingIpa) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-white">
        <div className="text-center">
          <Loader2 className="animate-spin text-primary-600 mx-auto mb-4" size={48} />
          <p className="text-gray-600">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (ipaError) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-white">
        <div className="max-w-md mx-auto p-8 bg-white rounded-2xl shadow-lg">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <X className="text-red-600" size={32} />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              {t("common.error")}
            </h2>
            <p className="text-gray-600 mb-6">{ipaError}</p>
            <button
              onClick={handleClose}
              className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!ipaInfo) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-white">
        <p className="text-gray-600">{t("common.noData")}</p>
      </div>
    );
  }

  if (installStatus === "success") {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-white">
        <div className="max-w-md mx-auto p-8 bg-white rounded-2xl shadow-lg">
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Check className="text-green-600" size={32} />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              {t("devices.installSuccess")}
            </h2>
            <p className="text-gray-600 mb-6">
              {ipaInfo.name} {t("devices.installedSuccessfully")}
            </p>
            <div className="flex space-x-3">
              <button
                onClick={handleOpenMainApp}
                className="flex-1 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center justify-center space-x-2"
              >
                <ExternalLink size={18} />
                <span>{t("installer.openIpaget")}</span>
              </button>
              <button
                onClick={handleClose}
                className="flex-1 px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (installStatus === "error") {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-white">
        <div className="max-w-md mx-auto p-8 bg-white rounded-2xl shadow-lg">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <X className="text-red-600" size={32} />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              {t("devices.installFailed")}
            </h2>
            <p className="text-gray-600 mb-6">{installError}</p>
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setInstallStatus("idle");
                  setInstallError(null);
                }}
                className="flex-1 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
              >
                {t("common.retry")}
              </button>
              <button
                onClick={handleClose}
                className="flex-1 px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-white p-6">
      <div className="max-w-2xl w-full mx-auto p-8 bg-white rounded-2xl shadow-xl">
        {/* IPA Info Section */}
        <div className="flex flex-col items-center mb-8">
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
          <h2 className="text-2xl font-semibold text-gray-900 mb-1">
            {ipaInfo.name}
          </h2>
          <p className="text-gray-500">{t("installer.readyToInstall")}</p>
        </div>

        {/* IPA Details */}
        <div className="space-y-1 mb-8 bg-gray-50 rounded-xl p-4">
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
          {ipaInfo.minimumOSVersion && (
            <DetailRow
              label={t("common.minimumOS")}
              value={ipaInfo.minimumOSVersion}
              copyable={false}
            />
          )}
        </div>

        {/* Device Selection */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              {t("installer.selectDevice")}
            </h3>
            <button
              onClick={loadDevices}
              disabled={isLoadingDevices}
              className="text-primary-600 hover:text-primary-700 text-sm flex items-center space-x-1"
            >
              {isLoadingDevices ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <span>{t("common.refresh")}</span>
              )}
            </button>
          </div>

          {devices.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-xl">
              <Smartphone className="text-gray-400 mx-auto mb-3" size={48} />
              <p className="text-gray-600 mb-1">{t("installer.noDevices")}</p>
              <p className="text-gray-400 text-sm">{t("installer.waitingForDevice")}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {devices.map((device) => (
                <button
                  key={device.udid}
                  onClick={() => setSelectedDevice(device.udid)}
                  className={`w-full p-4 rounded-xl border-2 transition-all text-left ${
                    selectedDevice === device.udid
                      ? "border-primary-500 bg-primary-50"
                      : "border-gray-200 hover:border-gray-300 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          selectedDevice === device.udid
                            ? "bg-primary-500"
                            : "bg-gray-200"
                        }`}
                      >
                        <Smartphone
                          className={
                            selectedDevice === device.udid
                              ? "text-white"
                              : "text-gray-600"
                          }
                          size={20}
                        />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{device.name}</p>
                        <p className="text-sm text-gray-500">
                          {device.model} • iOS {device.ios_version}
                        </p>
                      </div>
                    </div>
                    {selectedDevice === device.udid && (
                      <Check className="text-primary-600" size={24} />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Install Progress */}
        {installStatus === "installing" && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">{t("devices.installing")}</span>
              <span className="text-sm font-medium text-primary-600">
                {installProgress}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-primary-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${installProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex space-x-3">
          <button
            onClick={handleClose}
            disabled={installStatus === "installing"}
            className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleInstall}
            disabled={!selectedDevice || installStatus === "installing"}
            className="flex-1 px-6 py-3 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
          >
            {installStatus === "installing" ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                <span>{t("devices.installing")}</span>
              </>
            ) : (
              <span>{t("devices.install")}</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

