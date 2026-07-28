import { useEffect, useState } from "react";
import { Globe, Languages, Network, HelpCircle, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "../store/settingsStore";
import { useToastStore } from "../store/toastStore";
import { useErrorStore } from "../store/errorStore";
import CustomSelect, { SelectOption } from "../components/CustomSelect";
import { open as openShell } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import * as Tooltip from "@radix-ui/react-tooltip";
import { isTauriRuntime } from "../lib/runtime";

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { settings, isLoaded, loadSettings, updateSettings } = useSettingsStore();
  const { showToast } = useToastStore();
  const { showError } = useErrorStore();

  useEffect(() => {
    if (!isLoaded) {
      loadSettings().catch((error) => {
        console.error("Failed to load settings:", error);
        showError("Failed to load settings", error.toString());
      });
    }
  }, [isLoaded, loadSettings, showError]);

  useEffect(() => {
    if (isLoaded && settings.language) {
      i18n.changeLanguage(settings.language);
    }
  }, [isLoaded, settings.language, i18n]);

  const handleLanguageChange = async (language: string) => {
    try {
      await updateSettings({ language });
      await i18n.changeLanguage(language);
      showToast(t('settings.languageChanged'), 'success');
    } catch (error: any) {
      console.error("Failed to save language setting:", error);
      showError("Failed to save settings", error.toString());
    }
  };

  const languageOptions: SelectOption[] = [
    {
      value: "zh",
      label: t('settings.languages.zh'),
      icon: <span className="text-lg">🇨🇳</span>,
    },
    {
      value: "en",
      label: t('settings.languages.en'),
      icon: <span className="text-lg">🇺🇸</span>,
    },
  ];

  const currentLanguage = i18n.language.startsWith('zh') ? 'zh' : 'en';
  const [anisetteUrl, setAnisetteUrl] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");

  useEffect(() => {
    if (isLoaded) {
      setAnisetteUrl(settings.anisette_url || "");
      setProxyUrl(settings.proxy_url || "");
    }
  }, [isLoaded, settings.anisette_url, settings.proxy_url]);

  const handleAnisetteSave = async () => {
    try {
      await updateSettings({ anisette_url: anisetteUrl.trim() });
      showToast(t('settings.anisetteSaved'), 'success');
    } catch (error: any) {
      console.error("Failed to save anisette setting:", error);
      showError(t('common.error'), error.toString());
    }
  };

  const handleProxySave = async () => {
    try {
      await updateSettings({ proxy_url: proxyUrl.trim() });
      showToast(t('settings.proxySaved'), 'success');
    } catch (error: any) {
      console.error("Failed to save proxy setting:", error);
      showError(t('common.error'), error.toString());
    }
  };

  const openAnisetteDocs = async () => {
    const url = "https://docs.sidestore.io/zh/docs/advanced/anisette/";
    try {
      await openShell(url);
    } catch (_) {
      window.open(url, "_blank");
    }
  };

  const openDevTools = async () => {
    if (!isTauriRuntime()) {
      const debugWindow = window.open(
        `${window.location.origin}/debug`,
        "ipaget-debug",
        "width=1200,height=800,menubar=no,toolbar=no,location=no,status=no"
      );

      if (!debugWindow) {
        showError(t('common.error'), "Unable to open the debug window. Please allow pop-ups for this site.");
      }
      return;
    }

    try {
      await invoke("open_debug_window");
    } catch (error: any) {
      console.error("Failed to open debug window:", error);
      showError(t('common.error'), `Failed to open debug window: ${error.message || error}`);
    }
  };

  return (
    <div className="h-full overflow-auto scrollbar-thin p-8">
      <div className="space-y-6">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">{t('settings.title')}</h2>
            <p className="text-gray-500">{t('settings.subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-6 space-y-6">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start space-x-4 flex-1">
              <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Languages className="text-primary-600" size={24} />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900">
                  {t('settings.language')}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {t('settings.selectLanguage')}
                </p>
              </div>
            </div>
            <div className="w-80 flex-shrink-0">
              <CustomSelect
                options={languageOptions}
                value={currentLanguage}
                onChange={handleLanguageChange}
                disabled={!isLoaded}
              />
            </div>
          </div>
          <div className="h-px bg-gray-200" />
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start space-x-4 flex-1">
              <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Network className="text-primary-600" size={24} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {t('settings.anisette.title')}
                  </h3>
                  <Tooltip.Provider delayDuration={100}>
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <button
                          type="button"
                          className="text-gray-400 hover:text-primary-600"
                          onClick={openAnisetteDocs}
                          aria-label="Open anisette docs"
                        >
                          <HelpCircle size={18} />
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content side="top" className="rounded-md bg-gray-900 px-2 py-1 text-xs text-white shadow">
                          {t('settings.anisette.tooltip')}
                          <Tooltip.Arrow className="fill-gray-900" />
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  </Tooltip.Provider>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  {t('settings.anisette.subtitle')}
                </p>
              </div>
            </div>
            <div className="w-80 flex-shrink-0">
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder={t('settings.anisette.placeholder')}
                value={anisetteUrl}
                onChange={(e) => setAnisetteUrl(e.target.value)}
                onBlur={handleAnisetteSave}
                onKeyDown={(e) => { if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur(); } }}
                disabled={!isLoaded}
              />
            </div>
          </div>
          <div className="h-px bg-gray-200" />
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start space-x-4 flex-1">
              <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Globe className="text-primary-600" size={24} />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900">
                  {t('settings.proxy.title')}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {t('settings.proxy.subtitle')}
                </p>
              </div>
            </div>
            <div className="w-80 flex-shrink-0 space-y-1">
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder={t('settings.proxy.placeholder')}
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                onBlur={handleProxySave}
                onKeyDown={(e) => { if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur(); } }}
                disabled={!isLoaded}
              />
              <p className="text-xs text-gray-500">
                {t('settings.proxy.hint')}
              </p>
            </div>
          </div>
          <div className="h-px bg-gray-200" />
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start space-x-4 flex-1">
              <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Terminal className="text-primary-600" size={24} />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900">
                  {t('settings.debug.title')}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {t('settings.debug.subtitle')}
                </p>
              </div>
            </div>
            <div className="w-80 flex-shrink-0 flex items-center justify-end">
              <button
                onClick={openDevTools}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
              >
                {t('settings.debug.openDevTools')}
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

