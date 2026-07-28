import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  Code2,
  Download,
  FileCode2,
  FilePlus2,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  MonitorSpeaker,
  Package,
  PencilLine,
  Plug,
  Puzzle,
  Radio,
  RotateCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  Wifi,
} from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useTranslation } from "react-i18next";
import { useToastStore } from "../store/toastStore";
import { useErrorStore } from "../store/errorStore";
import { useTaskSubscription } from "../hooks/useTask";
import { useTaskStore } from "../store/taskStore";
import { useIpaStore } from "../store/ipaStore";
import {
  DylibItem,
  FrameworkItem,
  goServiceClient,
  IPADetails,
  PluginItem,
  type InjectFolder,
  type InjectPath,
  type SigningOptions,
} from "../lib/goService";
import { isTauriRuntime } from "../lib/runtime";
import CustomSelect from "../components/CustomSelect";
import ConfirmDialog from "../components/ConfirmDialog";
import IpaSignDialog from "../components/IpaSignDialog";
import {
  buildSigningOptionsFromDraft,
  getEditorIconPath,
} from "../lib/editorDraft";

interface PlanChangeItem {
  id: string;
  label: string;
  before?: string;
  after?: string;
}

type EditorTab = "identity" | "plugins" | "capabilities" | "advanced";

interface PluginState {
  dylibs: DylibItem[];
  frameworks: FrameworkItem[];
  plugins: PluginItem[];
  injectionFiles: string[];
  injectPath: InjectPath;
  injectFolder: InjectFolder;
  replaceSubstrateWithEllekit: boolean;
}

// 常用能力开关 —— 用户最常改的 Info.plist 项
interface CapabilityState {
  fileSharing: boolean;
  itunesFileSharing: boolean;
  proMotion: boolean;
  gameMode: boolean;
  ipadFullscreen: boolean;
  removeURLScheme: boolean;
  removeProvisioning: boolean;
  // 新增常用项
  statusBarHidden: boolean;             // UIStatusBarHidden
  viewControllerBasedStatusBar: boolean; // UIViewControllerBasedStatusBarAppearance
  requiresPersistentWiFi: boolean;       // UIRequiresPersistentWiFi
  exitsOnSuspend: boolean;               // UIApplicationExitsOnSuspend
  prerenderedIcon: boolean;              // UIPrerenderedIcon
  noEncryptionDecl: boolean;             // ITSAppUsesNonExemptEncryption = false
  allowsArbitraryLoads: boolean;         // NSAppTransportSecurity.NSAllowsArbitraryLoads
  // 方向锁定
  orientationPortrait: boolean;
  orientationLandscapeLeft: boolean;
  orientationLandscapeRight: boolean;
  orientationPortraitUpsideDown: boolean;
  // 后台模式
  bgAudio: boolean;
  bgLocation: boolean;
  bgFetch: boolean;
  bgVoip: boolean;
}

// 高级参数 —— 不常用但偶尔需要的 Info.plist 项
interface AdvancedState {
  // 设备能力
  requiredDeviceCapabilities: string;    // UIRequiredDeviceCapabilities (逗号分隔)
  removeSupportedDevices: boolean;        // 移除 UISupportedDevices
  // 本地化
  bundleLocalizations: string;            // CFBundleLocalizations (逗号分隔)
  developmentRegion: string;              // CFBundleDevelopmentRegion
  // 分类与场景
  applicationCategoryType: string;        // LSApplicationCategoryType
  supportsMultipleScenes: boolean;         // UIApplicationSupportsMultipleScenes
  // URL Scheme / 文件类型
  customURLScheme: string;                // 替换 CFBundleURLTypes 的 scheme（空=不改）
  removeDocumentTypes: boolean;           // 移除 CFBundleDocumentTypes
  removeExportedTypeDeclarations: boolean; // 移除 UTExportedTypeDeclarations
  removeApplicationQueriesSchemes: boolean; // 移除 LSApplicationQueriesSchemes
  // 隐私权限文案（批量改/删）
  privacyOverrides: Record<string, string>; // key=NSxxxUsageDescription, value=新文案；空串=删除
  // 启动图
  removeLaunchScreen: boolean;            // 删 UILaunchStoryboardName / UILaunchImages
  // Watch / PlugIns
  removeWatchApp: boolean;                // 删 Watch/ 目录
  removePlugIns: boolean;                 // 删 PlugIns/ 目录
}

interface DraftState {
  appName: string;
  displayName: string;
  bundleId: string;
  version: string;
  buildVersion: string;
  minimumOSVersion: string;
  appearance: "default" | "Light" | "Dark";
  renameLocalizedDisplayNames: boolean;
  pluginState: PluginState;
  capabilityState: CapabilityState;
  advancedState: AdvancedState;
  iconPath: string;          // path to replacement icon file (empty = no change)
  originalIconBase64: string; // icon extracted from the loaded IPA (read-only preview)
}

const defaultPluginState: PluginState = {
  dylibs: [],
  frameworks: [],
  plugins: [],
  injectionFiles: [],
  injectPath: "@executable_path",
  injectFolder: "/Frameworks/",
  replaceSubstrateWithEllekit: false,
};

const defaultCapabilityState: CapabilityState = {
  fileSharing: false,
  itunesFileSharing: false,
  proMotion: false,
  gameMode: false,
  ipadFullscreen: false,
  removeURLScheme: false,
  removeProvisioning: false,
  statusBarHidden: false,
  viewControllerBasedStatusBar: false,
  requiresPersistentWiFi: false,
  exitsOnSuspend: false,
  prerenderedIcon: false,
  noEncryptionDecl: false,
  allowsArbitraryLoads: false,
  orientationPortrait: false,
  orientationLandscapeLeft: false,
  orientationLandscapeRight: false,
  orientationPortraitUpsideDown: false,
  bgAudio: false,
  bgLocation: false,
  bgFetch: false,
  bgVoip: false,
};

const defaultAdvancedState: AdvancedState = {
  requiredDeviceCapabilities: "",
  removeSupportedDevices: false,
  bundleLocalizations: "",
  developmentRegion: "",
  applicationCategoryType: "",
  supportsMultipleScenes: false,
  customURLScheme: "",
  removeDocumentTypes: false,
  removeExportedTypeDeclarations: false,
  removeApplicationQueriesSchemes: false,
  privacyOverrides: {},
  removeLaunchScreen: false,
  removeWatchApp: false,
  removePlugIns: false,
};

const emptyDraft: DraftState = {
  appName: "",
  displayName: "",
  bundleId: "",
  version: "",
  buildVersion: "",
  minimumOSVersion: "",
  appearance: "default",
  renameLocalizedDisplayNames: false,
  pluginState: defaultPluginState,
  capabilityState: defaultCapabilityState,
  advancedState: defaultAdvancedState,
  iconPath: "",
  originalIconBase64: "",
};

const importantPropertyKeys = [
  "CFBundleIdentifier",
  "CFBundleDisplayName",
  "CFBundleName",
  "CFBundleShortVersionString",
  "CFBundleVersion",
  "CFBundleExecutable",
  "MinimumOSVersion",
  "UIUserInterfaceStyle",
];

const getFileName = (path: string) => path.split(/[\\/]/).pop() || path;

const getStringProperty = (details: IPADetails, key: string) => {
  const value = details.properties?.[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
};

const createDraftFromDetails = (details: IPADetails): DraftState => {
  const props = details.properties || {};
  const orientations = (props.UISupportedInterfaceOrientations as string[] | undefined) || [];
  const ipadOrientations = (props["UISupportedInterfaceOrientations~ipad"] as string[] | undefined) || [];
  const allOrientations = Array.from(new Set([...orientations, ...ipadOrientations]));
  const bgModes = (props.UIBackgroundModes as string[] | undefined) || [];
  const ats = (props.NSAppTransportSecurity as Record<string, any> | undefined) || {};

  return {
    appName: getStringProperty(details, "CFBundleName"),
    displayName: getStringProperty(details, "CFBundleDisplayName") || getStringProperty(details, "CFBundleName"),
    bundleId: getStringProperty(details, "CFBundleIdentifier"),
    version: getStringProperty(details, "CFBundleShortVersionString"),
    buildVersion: getStringProperty(details, "CFBundleVersion"),
    minimumOSVersion: getStringProperty(details, "MinimumOSVersion"),
    appearance: ["Light", "Dark"].includes(getStringProperty(details, "UIUserInterfaceStyle"))
      ? (getStringProperty(details, "UIUserInterfaceStyle") as "Light" | "Dark")
      : "default",
    renameLocalizedDisplayNames: false,
    pluginState: {
      ...defaultPluginState,
      dylibs: (details.dylibs || []).map(item => ({ ...item, enabled: item.enabled ?? true })),
      frameworks: (details.frameworks || []).map(item => ({ ...item, enabled: item.enabled ?? true })),
      plugins: (details.plugins || []).map(item => ({ ...item, enabled: item.enabled ?? true })),
    },
    capabilityState: {
      ...defaultCapabilityState,
      fileSharing: Boolean(props.UISupportsDocumentBrowser),
      itunesFileSharing: Boolean(props.UIFileSharingEnabled),
      proMotion: Boolean(props.CADisableMinimumFrameDurationOnPhone),
      gameMode: Boolean(props.GCSupportsGameMode),
      ipadFullscreen: Boolean(props.UIRequiresFullScreen),
      statusBarHidden: Boolean(props.UIStatusBarHidden),
      viewControllerBasedStatusBar: Boolean(props.UIViewControllerBasedStatusBarAppearance),
      requiresPersistentWiFi: Boolean(props.UIRequiresPersistentWiFi),
      exitsOnSuspend: Boolean(props.UIApplicationExitsOnSuspend),
      prerenderedIcon: Boolean(props.UIPrerenderedIcon),
      noEncryptionDecl: props.ITSAppUsesNonExemptEncryption === false,
      allowsArbitraryLoads: Boolean(ats.NSAllowsArbitraryLoads),
      orientationPortrait: allOrientations.includes("UIInterfaceOrientationPortrait"),
      orientationLandscapeLeft: allOrientations.includes("UIInterfaceOrientationLandscapeLeft"),
      orientationLandscapeRight: allOrientations.includes("UIInterfaceOrientationLandscapeRight"),
      orientationPortraitUpsideDown: allOrientations.includes("UIInterfaceOrientationPortraitUpsideDown"),
      bgAudio: bgModes.includes("audio"),
      bgLocation: bgModes.includes("location"),
      bgFetch: bgModes.includes("fetch"),
      bgVoip: bgModes.includes("voip"),
    },
    advancedState: {
      ...defaultAdvancedState,
      requiredDeviceCapabilities: Array.isArray(props.UIRequiredDeviceCapabilities)
        ? (props.UIRequiredDeviceCapabilities as string[]).join(",")
        : (typeof props.UIRequiredDeviceCapabilities === "string" ? props.UIRequiredDeviceCapabilities as string : ""),
      bundleLocalizations: Array.isArray(props.CFBundleLocalizations)
        ? (props.CFBundleLocalizations as string[]).join(",")
        : "",
      developmentRegion: getStringProperty(details, "CFBundleDevelopmentRegion"),
      applicationCategoryType: getStringProperty(details, "LSApplicationCategoryType"),
      supportsMultipleScenes: Boolean(props.UIApplicationSupportsMultipleScenes),
    },
    iconPath: "",
    originalIconBase64: details.icon_base64 || "",
  };
};

const countXMLKeys = (xml: string) => (xml.match(/<key>/g) || []).length;

const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) => (
  <button
    type="button"
    aria-pressed={checked}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-primary-600" : "bg-gray-300"}`}
  >
    <span
      className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : "translate-x-1"}`}
    />
  </button>
);

const Field = ({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
    <input
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
    />
  </label>
);

const Section = ({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon: typeof Package;
  children: React.ReactNode;
}) => (
  <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
    <div className="flex items-start gap-4 border-b border-gray-100 bg-gray-50/80 px-6 py-5">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {description && <p className="mt-1 text-sm leading-6 text-gray-500">{description}</p>}
      </div>
    </div>
    <div className="px-6 py-6">{children}</div>
  </section>
);

export default function EditorPage() {
  const { t } = useTranslation();
  const location = useLocation() as { state?: { ipaPath?: string } };
  const navigate = useNavigate();
  const { showToast } = useToastStore();
  const { showError } = useErrorStore();
  const markSigned = useIpaStore(state => state.markSigned);
  const [ipaPath, setIpaPath] = useState<string>(location.state?.ipaPath || "");
  const [details, setDetails] = useState<IPADetails | null>(null);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [originalDraft, setOriginalDraft] = useState<DraftState>(emptyDraft);
  const [activeTab, setActiveTab] = useState<EditorTab>("identity");
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportTaskId, setExportTaskId] = useState<string | undefined>(undefined);
  const [exportResultDialog, setExportResultDialog] = useState<{
    open: boolean;
    outputPath: string;
  }>({ open: false, outputPath: "" });
  const [signDialogPath, setSignDialogPath] = useState<string | null>(null);
  const [signEditorOptions, setSignEditorOptions] = useState<SigningOptions | null>(null);
  const [signIconPath, setSignIconPath] = useState<string | null>(null);

  useEffect(() => {
    if (location.state?.ipaPath) {
      setIpaPath(location.state.ipaPath);
      void loadIpa(location.state.ipaPath);
      history.replaceState({}, document.title);
    }
  }, [location.state?.ipaPath]);

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(originalDraft),
    [draft, originalDraft]
  );

  const pluginCounts = useMemo(() => ({
    dylibs: draft.pluginState.dylibs.filter(item => item.path.startsWith("@rpath") || item.path.startsWith("@executable_path")).length,
    frameworks: draft.pluginState.frameworks.length,
    plugins: draft.pluginState.plugins.length,
    injected: draft.pluginState.injectionFiles.length,
  }), [draft.pluginState]);

  const getExportIconFileName = () => {
    const rawName = draft.displayName || draft.appName || draft.bundleId || "app-icon";
    const sanitizedName = rawName
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    return `${sanitizedName || "app-icon"}.png`;
  };

  const decodeBase64ToBytes = (base64: string): Uint8Array => {
    const normalizedBase64 = base64.includes(",") ? base64.split(",").pop() || "" : base64;
    const binaryString = atob(normalizedBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let index = 0; index < binaryString.length; index += 1) {
      bytes[index] = binaryString.charCodeAt(index);
    }
    return bytes;
  };

  const downloadBytesInBrowser = (bytes: Uint8Array, fileName: string) => {
    const blob = new Blob([bytes], { type: "image/png" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const handleExportIcon = async () => {
    const hasReplacementIcon = Boolean(draft.iconPath);
    const hasOriginalIcon = Boolean(draft.originalIconBase64);
    if (!hasReplacementIcon && !hasOriginalIcon) {
      showToast(t("editor.identity.exportIconEmpty"), "error");
      return;
    }

    const defaultFileName = getExportIconFileName();

    try {
      let iconBytes: Uint8Array;
      if (draft.iconPath) {
        if (isTauriRuntime()) {
          iconBytes = await readFile(draft.iconPath);
        } else if (draft.iconPath.startsWith("data:")) {
          iconBytes = decodeBase64ToBytes(draft.iconPath);
        } else if (/^https?:\/\//i.test(draft.iconPath) || draft.iconPath.startsWith("blob:")) {
          const response = await fetch(draft.iconPath);
          if (!response.ok) {
            throw new Error(`Failed to fetch icon (${response.status})`);
          }
          iconBytes = new Uint8Array(await response.arrayBuffer());
        } else {
          showToast(t("editor.desktopOnly"), "error");
          return;
        }
      } else {
        iconBytes = decodeBase64ToBytes(draft.originalIconBase64);
      }

      if (isTauriRuntime()) {
        const targetPath = await save({
          defaultPath: defaultFileName,
          filters: [{ name: "PNG Image", extensions: ["png"] }],
        });
        if (!targetPath) {
          return;
        }
        await writeFile(targetPath, iconBytes);
      } else {
        downloadBytesInBrowser(iconBytes, defaultFileName);
      }

      showToast(t("editor.identity.exportIconSuccess"), "success");
    } catch (error: any) {
      showError(t("editor.identity.exportIconFailed"), error.message || String(error));
    }
  };

  const changePlan = useMemo(() => {
    const changes: PlanChangeItem[] = [];
    if (!details) return changes;

    const current = createDraftFromDetails(details);
    const emptyValue = t("editor.plan.emptyValue");
    const formatValue = (value: string | number | boolean | null | undefined) => {
      if (value === null || value === undefined || value === "") return emptyValue;
      if (typeof value === "boolean") return value ? t("common.enabled") : t("common.disabled");
      return String(value);
    };
    const pushChange = (id: string, label: string, before?: string | number | boolean | null, after?: string | number | boolean | null) => {
      changes.push({
        id,
        label,
        before: before === undefined ? undefined : formatValue(before),
        after: after === undefined ? undefined : formatValue(after),
      });
    };
    const formatAppearance = (value: DraftState["appearance"]) => {
      if (value === "Light") return t("editor.identity.light");
      if (value === "Dark") return t("editor.identity.dark");
      return t("editor.identity.defaultAppearance");
    };
    const formatOrientation = (state: CapabilityState) => {
      const labels: string[] = [];
      if (state.orientationPortrait) labels.push("Portrait");
      if (state.orientationLandscapeLeft) labels.push("LandscapeLeft");
      if (state.orientationLandscapeRight) labels.push("LandscapeRight");
      if (state.orientationPortraitUpsideDown) labels.push("PortraitUpsideDown");
      return labels.length > 0 ? labels.join(", ") : emptyValue;
    };
    const formatBackgroundModes = (state: CapabilityState) => {
      const labels: string[] = [];
      if (state.bgAudio) labels.push("audio");
      if (state.bgLocation) labels.push("location");
      if (state.bgFetch) labels.push("fetch");
      if (state.bgVoip) labels.push("voip");
      return labels.length > 0 ? labels.join(", ") : emptyValue;
    };
    const disabledDylibs = draft.pluginState.dylibs.filter(item => !item.enabled);
    const disabledFrameworks = draft.pluginState.frameworks.filter(item => !item.enabled);
    const disabledPlugins = draft.pluginState.plugins.filter(item => !item.enabled);
    const privacyOverrideCount = Object.keys(draft.advancedState.privacyOverrides).length;

    if (draft.bundleId && draft.bundleId !== current.bundleId) {
      pushChange("bundleId", t("editor.plan.bundleId"), current.bundleId, draft.bundleId);
    }
    if (draft.displayName && draft.displayName !== current.displayName) {
      pushChange("displayName", t("editor.plan.displayName"), current.displayName, draft.displayName);
    }
    if (draft.appName && draft.appName !== current.appName) {
      pushChange("appName", t("editor.plan.appName"), current.appName, draft.appName);
    }
    if (draft.version && draft.version !== current.version) {
      pushChange("version", t("editor.plan.version"), current.version, draft.version);
    }
    if (draft.buildVersion && draft.buildVersion !== current.buildVersion) {
      pushChange("buildVersion", t("editor.plan.buildVersion"), current.buildVersion, draft.buildVersion);
    }
    if (draft.minimumOSVersion && draft.minimumOSVersion !== current.minimumOSVersion) {
      pushChange("minimumOS", t("editor.plan.minimumOS"), current.minimumOSVersion, draft.minimumOSVersion);
    }
    if (draft.appearance !== current.appearance) {
      pushChange("appearance", t("editor.plan.appearance"), formatAppearance(current.appearance), formatAppearance(draft.appearance));
    }
    if (draft.renameLocalizedDisplayNames) {
      pushChange("localizedNames", t("editor.plan.localizedNames"), current.displayName, draft.displayName || current.displayName);
    }
    if (disabledDylibs.length > 0) {
      pushChange(
        "removeDylibs",
        t("editor.plan.removeDylibs", { count: disabledDylibs.length }),
        disabledDylibs.map(item => item.name || item.path).join(", "),
        emptyValue
      );
    }
    if (disabledFrameworks.length > 0) {
      pushChange(
        "removeFrameworks",
        t("editor.plan.removeFrameworks", { count: disabledFrameworks.length }),
        disabledFrameworks.map(item => item.name || item.path).join(", "),
        emptyValue
      );
    }
    if (disabledPlugins.length > 0) {
      pushChange(
        "removePlugins",
        t("editor.plan.removePlugins", { count: disabledPlugins.length }),
        disabledPlugins.map(item => item.name || item.path).join(", "),
        emptyValue
      );
    }
    if (draft.pluginState.injectionFiles.length > 0) {
      pushChange(
        "injectFiles",
        t("editor.plan.injectFiles", { count: draft.pluginState.injectionFiles.length }),
        emptyValue,
        draft.pluginState.injectionFiles.map(getFileName).join(", ")
      );
    }
    if (draft.pluginState.replaceSubstrateWithEllekit) {
      pushChange("ellekit", t("editor.plan.ellekit"), "CydiaSubstrate", "ElleKit");
    }
    if (draft.capabilityState.fileSharing !== current.capabilityState.fileSharing) {
      pushChange("fileSharing", t("editor.plan.fileSharing"), current.capabilityState.fileSharing, draft.capabilityState.fileSharing);
    }
    if (draft.capabilityState.itunesFileSharing !== current.capabilityState.itunesFileSharing) {
      pushChange("itunesSharing", t("editor.plan.itunesSharing"), current.capabilityState.itunesFileSharing, draft.capabilityState.itunesFileSharing);
    }
    if (draft.capabilityState.proMotion !== current.capabilityState.proMotion) {
      pushChange("proMotion", t("editor.plan.proMotion"), current.capabilityState.proMotion, draft.capabilityState.proMotion);
    }
    if (draft.capabilityState.gameMode !== current.capabilityState.gameMode) {
      pushChange("gameMode", t("editor.plan.gameMode"), current.capabilityState.gameMode, draft.capabilityState.gameMode);
    }
    if (draft.capabilityState.ipadFullscreen !== current.capabilityState.ipadFullscreen) {
      pushChange("ipadFullscreen", t("editor.plan.ipadFullscreen"), current.capabilityState.ipadFullscreen, draft.capabilityState.ipadFullscreen);
    }
    if (draft.capabilityState.removeURLScheme) {
      pushChange("removeURLScheme", t("editor.plan.removeURLScheme"), t("common.enabled"), emptyValue);
    }
    if (draft.capabilityState.removeProvisioning) {
      pushChange("removeProvisioning", t("editor.plan.removeProvisioning"), t("common.enabled"), emptyValue);
    }
    if (draft.capabilityState.statusBarHidden !== current.capabilityState.statusBarHidden) {
      pushChange("statusBarHidden", t("editor.plan.statusBarHidden"), current.capabilityState.statusBarHidden, draft.capabilityState.statusBarHidden);
    }
    if (draft.capabilityState.viewControllerBasedStatusBar !== current.capabilityState.viewControllerBasedStatusBar) {
      pushChange(
        "viewControllerBasedStatusBar",
        t("editor.plan.viewControllerBasedStatusBar"),
        current.capabilityState.viewControllerBasedStatusBar,
        draft.capabilityState.viewControllerBasedStatusBar
      );
    }
    if (draft.capabilityState.requiresPersistentWiFi !== current.capabilityState.requiresPersistentWiFi) {
      pushChange(
        "requiresPersistentWiFi",
        t("editor.plan.requiresPersistentWiFi"),
        current.capabilityState.requiresPersistentWiFi,
        draft.capabilityState.requiresPersistentWiFi
      );
    }
    if (draft.capabilityState.exitsOnSuspend !== current.capabilityState.exitsOnSuspend) {
      pushChange("exitsOnSuspend", t("editor.plan.exitsOnSuspend"), current.capabilityState.exitsOnSuspend, draft.capabilityState.exitsOnSuspend);
    }
    if (draft.capabilityState.prerenderedIcon !== current.capabilityState.prerenderedIcon) {
      pushChange("prerenderedIcon", t("editor.plan.prerenderedIcon"), current.capabilityState.prerenderedIcon, draft.capabilityState.prerenderedIcon);
    }
    if (draft.capabilityState.noEncryptionDecl !== current.capabilityState.noEncryptionDecl) {
      pushChange("noEncryptionDecl", t("editor.plan.noEncryptionDecl"), current.capabilityState.noEncryptionDecl, draft.capabilityState.noEncryptionDecl);
    }
    if (draft.capabilityState.allowsArbitraryLoads !== current.capabilityState.allowsArbitraryLoads) {
      pushChange(
        "allowsArbitraryLoads",
        t("editor.plan.allowsArbitraryLoads"),
        current.capabilityState.allowsArbitraryLoads,
        draft.capabilityState.allowsArbitraryLoads
      );
    }

    const orientationKeys = ["orientationPortrait", "orientationLandscapeLeft", "orientationLandscapeRight", "orientationPortraitUpsideDown"] as const;
    if (orientationKeys.some(key => draft.capabilityState[key] !== current.capabilityState[key])) {
      pushChange("orientation", t("editor.plan.orientation"), formatOrientation(current.capabilityState), formatOrientation(draft.capabilityState));
    }

    const backgroundKeys = ["bgAudio", "bgLocation", "bgFetch", "bgVoip"] as const;
    if (backgroundKeys.some(key => draft.capabilityState[key] !== current.capabilityState[key])) {
      pushChange("backgroundModes", t("editor.plan.backgroundModes"), formatBackgroundModes(current.capabilityState), formatBackgroundModes(draft.capabilityState));
    }

    if (draft.advancedState.requiredDeviceCapabilities !== current.advancedState.requiredDeviceCapabilities) {
      pushChange(
        "requiredDeviceCapabilities",
        t("editor.plan.requiredDeviceCapabilities"),
        current.advancedState.requiredDeviceCapabilities,
        draft.advancedState.requiredDeviceCapabilities
      );
    }
    if (draft.advancedState.removeSupportedDevices) {
      pushChange("removeSupportedDevices", t("editor.plan.removeSupportedDevices"), t("common.enabled"), emptyValue);
    }
    if (draft.advancedState.bundleLocalizations !== current.advancedState.bundleLocalizations) {
      pushChange(
        "bundleLocalizations",
        t("editor.plan.bundleLocalizations"),
        current.advancedState.bundleLocalizations,
        draft.advancedState.bundleLocalizations
      );
    }
    if (draft.advancedState.developmentRegion !== current.advancedState.developmentRegion) {
      pushChange(
        "developmentRegion",
        t("editor.plan.developmentRegion"),
        current.advancedState.developmentRegion,
        draft.advancedState.developmentRegion
      );
    }
    if (draft.advancedState.applicationCategoryType !== current.advancedState.applicationCategoryType) {
      pushChange(
        "applicationCategoryType",
        t("editor.plan.applicationCategoryType"),
        current.advancedState.applicationCategoryType,
        draft.advancedState.applicationCategoryType
      );
    }
    if (draft.advancedState.supportsMultipleScenes !== current.advancedState.supportsMultipleScenes) {
      pushChange(
        "supportsMultipleScenes",
        t("editor.plan.supportsMultipleScenes"),
        current.advancedState.supportsMultipleScenes,
        draft.advancedState.supportsMultipleScenes
      );
    }
    if (draft.advancedState.customURLScheme.trim() !== "") {
      pushChange("customURLScheme", t("editor.plan.customURLScheme"), emptyValue, draft.advancedState.customURLScheme.trim());
    }
    if (draft.advancedState.removeDocumentTypes) {
      pushChange("removeDocumentTypes", t("editor.plan.removeDocumentTypes"), t("common.enabled"), emptyValue);
    }
    if (draft.advancedState.removeExportedTypeDeclarations) {
      pushChange("removeExportedTypeDeclarations", t("editor.plan.removeExportedTypeDeclarations"), t("common.enabled"), emptyValue);
    }
    if (draft.advancedState.removeApplicationQueriesSchemes) {
      pushChange("removeApplicationQueriesSchemes", t("editor.plan.removeApplicationQueriesSchemes"), t("common.enabled"), emptyValue);
    }
    if (privacyOverrideCount > 0) {
      pushChange(
        "privacyOverrides",
        t("editor.plan.privacyOverrides", { count: privacyOverrideCount }),
        emptyValue,
        Object.entries(draft.advancedState.privacyOverrides)
          .map(([key, value]) => `${key}=${value || emptyValue}`)
          .join(", ")
      );
    }
    if (draft.advancedState.removeLaunchScreen) {
      pushChange("removeLaunchScreen", t("editor.plan.removeLaunchScreen"), t("common.enabled"), emptyValue);
    }
    if (draft.advancedState.removeWatchApp) {
      pushChange("removeWatchApp", t("editor.plan.removeWatchApp"), t("common.enabled"), emptyValue);
    }
    if (draft.advancedState.removePlugIns) {
      pushChange("removePlugIns", t("editor.plan.removePlugIns"), t("common.enabled"), emptyValue);
    }
    if (draft.iconPath) {
      pushChange(
        "replaceIcon",
        t("editor.plan.replaceIcon"),
        current.originalIconBase64 ? t("editor.identity.iconCurrent") : emptyValue,
        getFileName(draft.iconPath)
      );
    }
    return changes;
  }, [details, draft, t]);

  const loadIpa = async (path: string) => {
    const trimmedPath = path.trim();
    if (!trimmedPath) return;

    setIsLoading(true);
    try {
      const loadedDetails = await goServiceClient.getIpaDetails(trimmedPath);
      const nextDraft = createDraftFromDetails(loadedDetails);
      setDetails(loadedDetails);
      setDraft(nextDraft);
      setOriginalDraft(JSON.parse(JSON.stringify(nextDraft)));
      showToast(t("editor.ipaLoaded", { name: getFileName(trimmedPath) }), "success");
    } catch (error: any) {
      showError(t("editor.openFailed"), error.message || String(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleBrowse = async () => {
    if (!isTauriRuntime()) {
      showToast(t("editor.desktopOnly"), "error");
      return;
    }

    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "IPA", extensions: ["ipa", "tipa"] }],
      });
      if (selected && typeof selected === "string") {
        setIpaPath(selected);
        await loadIpa(selected);
      }
    } catch (error: any) {
      showError(t("editor.openFailed"), error.message || String(error));
    }
  };

  const addInjectionFile = async () => {
    if (!isTauriRuntime()) {
      showToast(t("editor.desktopOnly"), "error");
      return;
    }

    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Tweaks", extensions: ["dylib", "deb"] }],
      });
      const selectedPaths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (selectedPaths.length === 0) return;
      setDraft(prev => ({
        ...prev,
        pluginState: {
          ...prev.pluginState,
          injectionFiles: Array.from(new Set([...prev.pluginState.injectionFiles, ...selectedPaths])),
        },
      }));
    } catch (error: any) {
      showError(t("editor.openFailed"), error.message || String(error));
    }
  };

  const updatePluginState = (next: Partial<PluginState>) => {
    setDraft(prev => ({ ...prev, pluginState: { ...prev.pluginState, ...next } }));
  };

  const updateCapability = (key: keyof CapabilityState, value: boolean) => {
    setDraft(prev => ({
      ...prev,
      capabilityState: { ...prev.capabilityState, [key]: value },
    }));
  };

  const updateAdvanced = <K extends keyof AdvancedState>(key: K, value: AdvancedState[K]) => {
    setDraft(prev => ({
      ...prev,
      advancedState: { ...prev.advancedState, [key]: value },
    }));
  };

  const toggleDylib = (path: string) => {
    updatePluginState({
      dylibs: draft.pluginState.dylibs.map(item => item.path === path ? { ...item, enabled: !item.enabled } : item),
    });
  };

  const toggleFramework = (path: string) => {
    updatePluginState({
      frameworks: draft.pluginState.frameworks.map(item => item.path === path ? { ...item, enabled: !item.enabled } : item),
    });
  };

  const togglePlugin = (path: string) => {
    updatePluginState({
      plugins: draft.pluginState.plugins.map(item => item.path === path ? { ...item, enabled: !item.enabled } : item),
    });
  };

  const resetDraft = () => {
    setDraft(JSON.parse(JSON.stringify(originalDraft)));
    showToast(t("editor.resetDone"), "info");
  };

  const buildCurrentEditorOptions = (): SigningOptions => {
    return buildSigningOptionsFromDraft(draft, originalDraft);
  };

  const handleExportEdited = async () => {
    if (!details || !ipaPath.trim()) {
      showToast(t("editor.noIpaLoaded"), "error");
      return;
    }
    if (!isDirty) {
      showToast(t("editor.exportNeedsChanges"), "error");
      return;
    }
    if (isExporting) {
      return;
    }

    setIsExporting(true);
    try {
      const result = await goServiceClient.signIPA({
        ipa_path: ipaPath.trim(),
        sign_mode: "adhoc",
        bundle_id: draft.bundleId || undefined,
        editor_options: buildCurrentEditorOptions(),
        icon_path: getEditorIconPath(draft),
      });
      useTaskStore.getState().addTask(result.task_id, "export", {
        file_path: ipaPath.trim(),
        sign_mode: "adhoc",
      });
      setExportTaskId(result.task_id);
    } catch (error: any) {
      setIsExporting(false);
      setExportTaskId(undefined);
      showError(t("editor.exportFailed"), error.message || String(error));
    }
  };

  useTaskSubscription(exportTaskId, {
    onComplete: async (task) => {
      setIsExporting(false);
      setExportTaskId(undefined);
      const outputPath = typeof task.data?.file_path === "string" ? task.data.file_path : "";

      if (outputPath) {
        try {
          const ipaInfo = await goServiceClient.parseIPA(outputPath);
          await markSigned(outputPath, {
            size: Number(ipaInfo.file_size || 0),
            appName: ipaInfo.name,
            bundleId: ipaInfo.bundle_id,
            version: ipaInfo.version,
            iconBase64: ipaInfo.icon_base64,
            minimumOsVersion: ipaInfo.minimum_os_version,
            certificateStatus: ipaInfo.certificate_status,
            signerName: ipaInfo.signer_name,
            signerIdentity: ipaInfo.signer_identity,
            organization: ipaInfo.organization,
            teamId: ipaInfo.team_id,
            isEncrypted: ipaInfo.is_encrypted,
          });
        } catch (error) {
          console.error("Failed to register exported IPA in library:", error);
          await markSigned(outputPath, {
            appName: getFileName(outputPath),
            bundleId: typeof task.data?.bundle_id === "string" ? task.data.bundle_id : undefined,
            version: typeof task.data?.version === "string" ? task.data.version : undefined,
          }).catch(() => undefined);
        }
      }

      setExportResultDialog({
        open: true,
        outputPath,
      });
    },
    onError: (task) => {
      setIsExporting(false);
      setExportTaskId(undefined);
      showError(t("editor.exportFailed"), task.message || "export failed");
    },
  });

  const handleSignWithCertificate = () => {
    if (!details || !ipaPath.trim()) {
      showToast(t("editor.noIpaLoaded"), "error");
      return;
    }
    setSignEditorOptions(isDirty ? buildCurrentEditorOptions() : null);
    setSignIconPath(isDirty ? getEditorIconPath(draft) || null : null);
    setSignDialogPath(ipaPath.trim());
  };

  const visibleDylibs = draft.pluginState.dylibs.filter(
    item => item.path.startsWith("@rpath") || item.path.startsWith("@executable_path")
  );

  const hiddenSystemDylibs = draft.pluginState.dylibs.length - visibleDylibs.length;

  const tabs: { id: EditorTab; label: string; icon: typeof Package }[] = [
    { id: "identity", label: t("editor.tabs.identity"), icon: PencilLine },
    { id: "plugins", label: t("editor.tabs.plugins"), icon: Plug },
    { id: "capabilities", label: t("editor.tabs.capabilities"), icon: ShieldCheck },
    { id: "advanced", label: t("editor.tabs.advanced"), icon: SlidersHorizontal },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-50">
      <div className="border-b border-gray-200 bg-white px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-gray-900">{t("editor.title")}</h1>
            {details ? (
              <p className="mt-0.5 truncate text-xs text-gray-500">
                {draft.displayName || draft.appName || getFileName(ipaPath)}
                {draft.bundleId ? ` · ${draft.bundleId}` : ""}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-gray-500">{t("editor.subtitle")}</p>
            )}
          </div>
          <button
            onClick={handleBrowse}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <FolderOpen size={16} />
            {t("editor.openIpa")}
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 scrollbar-thin lg:grid-cols-[240px_minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[260px_minmax(0,1fr)] 2xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-4 lg:overflow-y-auto lg:scrollbar-thin">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:shrink-0">
            <div className="flex items-center gap-3">
              {draft.iconPath || draft.originalIconBase64 ? (
                <img
                  src={draft.iconPath ? (isTauriRuntime() ? convertFileSrc(draft.iconPath) : draft.iconPath) : `data:image/png;base64,${draft.originalIconBase64}`}
                  alt="app icon"
                  className="h-12 w-12 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-sky-500 text-white">
                  <Package size={24} />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">{draft.displayName || draft.appName || t("editor.noIpa")}</p>
                <p className="truncate text-xs text-gray-500">{draft.bundleId || t("editor.noBundleId")}</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg bg-gray-50 px-2 py-2.5">
                <p className="text-lg font-semibold text-gray-900">{details?.files?.length ?? 0}</p>
                <p className="text-xs text-gray-500">{t("editor.stats.files")}</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-2 py-2.5">
                <p className="text-lg font-semibold text-gray-900">{countXMLKeys(details?.entitlements_xml || "")}</p>
                <p className="text-xs text-gray-500">{t("editor.stats.entitlements")}</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-2 py-2.5">
                <p className="text-lg font-semibold text-gray-900">{pluginCounts.frameworks}</p>
                <p className="text-xs text-gray-500">{t("editor.stats.frameworks")}</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-2 py-2.5">
                <p className="text-lg font-semibold text-gray-900">{pluginCounts.plugins}</p>
                <p className="text-xs text-gray-500">{t("editor.stats.plugins")}</p>
              </div>
            </div>
          </section>

          {/* 窄屏：横向 sticky tab 条；宽屏：垂直 nav */}
          <nav className="sticky top-0 z-10 flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-2 shadow-sm lg:static lg:z-auto lg:flex-col lg:overflow-visible lg:shrink-0">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition lg:w-full lg:gap-3 lg:py-2.5 ${selected ? "bg-primary-50 text-primary-700" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-h-0 lg:overflow-y-auto lg:scrollbar-thin">
          {details && (
            <section className="mb-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold text-gray-900">{t("editor.plan.title")}</h2>
                    {isDirty && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{t("editor.modified")}</span>}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {changePlan.length === 0 ? (
                      <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">{t("editor.plan.empty")}</div>
                    ) : (
                      <Tooltip.Provider delayDuration={150}>
                        {changePlan.map(item => {
                          const hasValueChange = item.before !== undefined || item.after !== undefined;
                          const tooltipText = hasValueChange
                            ? t("editor.plan.valueChange", {
                                before: item.before ?? t("editor.plan.emptyValue"),
                                after: item.after ?? t("editor.plan.emptyValue"),
                              })
                            : item.label;

                          return (
                            <Tooltip.Root key={item.id}>
                              <Tooltip.Trigger asChild>
                                <div className="inline-flex max-w-full cursor-default items-start gap-2 rounded-lg bg-primary-50 px-3 py-2 text-sm text-primary-800">
                                  <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                                  <span>{item.label}</span>
                                </div>
                              </Tooltip.Trigger>
                              <Tooltip.Portal>
                                <Tooltip.Content
                                  side="top"
                                  sideOffset={6}
                                  className="z-50 max-w-sm break-all rounded-md bg-gray-900 px-2.5 py-1.5 text-xs leading-5 text-white shadow-lg"
                                >
                                  {tooltipText}
                                  <Tooltip.Arrow className="fill-gray-900" />
                                </Tooltip.Content>
                              </Tooltip.Portal>
                            </Tooltip.Root>
                          );
                        })}
                      </Tooltip.Provider>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={resetDraft}
                    disabled={!isDirty || isExporting}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("editor.reset")}
                  </button>
                  <button
                    onClick={handleSignWithCertificate}
                    disabled={!details || isExporting}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("editor.signWithCertificate")}
                  </button>
                  <button
                    onClick={() => void handleExportEdited()}
                    disabled={!details || !isDirty || isExporting}
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-primary-600 px-4 text-sm font-medium text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isExporting ? t("editor.loading") : t("editor.exportEdited")}
                  </button>
                </div>
              </div>
            </section>
          )}

          {isLoading ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-gray-200 bg-white">
              <div className="flex flex-col items-center gap-3 text-gray-500">
                <Loader2 className="animate-spin text-primary-600" size={36} />
                <p className="text-sm">{t("editor.loading")}</p>
              </div>
            </div>
          ) : !details ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
              <div className="max-w-sm">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
                  <Upload size={26} />
                </div>
                <h2 className="mt-4 text-base font-semibold text-gray-900">{t("editor.emptyTitle")}</h2>
                <p className="mt-2 text-sm text-gray-500">{t("editor.emptyDesc")}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {activeTab === "identity" && (
                <>
                  <Section icon={PencilLine} title={t("editor.identity.title")} description={t("editor.identity.desc")}>
                    {/* App icon picker */}
                    <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                      <div className="flex shrink-0 items-center gap-3">
                        <div className="h-24 w-24 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
                          {draft.iconPath || draft.originalIconBase64 ? (
                            <img
                              src={draft.iconPath ? (isTauriRuntime() ? convertFileSrc(draft.iconPath) : draft.iconPath) : `data:image/png;base64,${draft.originalIconBase64}`}
                              alt="icon preview"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-gray-300">
                              <ImageIcon size={36} />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("editor.identity.icon")}</p>
                          {draft.iconPath ? (
                            <p className="mt-1 truncate text-xs text-gray-700" title={draft.iconPath}>{getFileName(draft.iconPath)}</p>
                          ) : (
                            <p className="mt-1 text-xs text-gray-500">{t("editor.identity.iconCurrent")}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={async () => {
                            if (!isTauriRuntime()) { showToast(t("editor.desktopOnly"), "error"); return; }
                            try {
                              const sel = await open({ multiple: false, filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg"] }] });
                              if (typeof sel === "string") setDraft(prev => ({ ...prev, iconPath: sel }));
                            } catch (e: any) { showError(t("editor.openFailed"), e.message || String(e)); }
                          }}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                        >
                          <ImageIcon size={16} />
                          {t("editor.identity.pickIcon")}
                        </button>
                        <button
                          onClick={() => void handleExportIcon()}
                          disabled={!draft.iconPath && !draft.originalIconBase64}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Download size={16} />
                          {t("editor.identity.exportIcon")}
                        </button>
                        {draft.iconPath && (
                          <button
                            onClick={() => setDraft(prev => ({ ...prev, iconPath: "" }))}
                            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-500 transition hover:bg-gray-50"
                          >
                            <Trash2 size={16} />
                            {t("editor.identity.resetIcon")}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                      <Field label={t("editor.identity.bundleId")} value={draft.bundleId} onChange={value => setDraft(prev => ({ ...prev, bundleId: value }))} />
                      <Field label={t("editor.identity.displayName")} value={draft.displayName} onChange={value => setDraft(prev => ({ ...prev, displayName: value }))} />
                      <Field label={t("editor.identity.name")} value={draft.appName} onChange={value => setDraft(prev => ({ ...prev, appName: value }))} />
                      <Field label={t("editor.identity.version")} value={draft.version} onChange={value => setDraft(prev => ({ ...prev, version: value }))} />
                      <Field label={t("editor.identity.buildVersion")} value={draft.buildVersion} onChange={value => setDraft(prev => ({ ...prev, buildVersion: value }))} />
                      <Field label={t("editor.identity.minimumOS")} value={draft.minimumOSVersion} onChange={value => setDraft(prev => ({ ...prev, minimumOSVersion: value }))} placeholder="13.0" />
                    </div>
                    <div className="mt-5 grid grid-cols-1 gap-4 2xl:grid-cols-2">
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t("editor.identity.appearance")}</span>
                        <CustomSelect
                          value={draft.appearance}
                          onChange={value => setDraft(prev => ({ ...prev, appearance: value as DraftState["appearance"] }))}
                          options={[
                            { value: "default", label: t("editor.identity.defaultAppearance") },
                            { value: "Light", label: t("editor.identity.light") },
                            { value: "Dark", label: t("editor.identity.dark") },
                          ]}
                        />
                      </label>
                      <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900">{t("editor.identity.localizedNames")}</p>
                          <p className="mt-1 text-xs leading-5 text-gray-500">{t("editor.identity.localizedNamesDesc")}</p>
                        </div>
                        <Toggle checked={draft.renameLocalizedDisplayNames} onChange={checked => setDraft(prev => ({ ...prev, renameLocalizedDisplayNames: checked }))} />
                      </div>
                    </div>
                  </Section>

                  <Section icon={FileCode2} title={t("editor.identity.rawTitle")} description={t("editor.identity.rawDesc")}>
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                      {importantPropertyKeys.map(key => (
                        <div key={key} className="rounded-lg bg-gray-50 p-3">
                          <p className="text-xs font-semibold text-gray-500">{key}</p>
                          <p className="mt-1 break-all text-sm text-gray-900">{String(details.properties?.[key] ?? "-")}</p>
                        </div>
                      ))}
                    </div>
                  </Section>
                </>
              )}

              {activeTab === "plugins" && (
                <>
                  <Section icon={FilePlus2} title={t("editor.plugins.injectTitle")} description={t("editor.plugins.injectDesc")}>
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t("editor.plugins.injectPath")}</span>
                        <select
                          value={draft.pluginState.injectPath}
                          onChange={event => updatePluginState({ injectPath: event.target.value as InjectPath })}
                          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                        >
                          <option value="@executable_path">@executable_path</option>
                          <option value="@rpath">@rpath</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t("editor.plugins.injectFolder")}</span>
                        <select
                          value={draft.pluginState.injectFolder}
                          onChange={event => updatePluginState({ injectFolder: event.target.value as InjectFolder })}
                          className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                        >
                          <option value="/Frameworks/">/Frameworks/</option>
                          <option value="/">/</option>
                        </select>
                      </label>
                      <button
                        onClick={addInjectionFile}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                      >
                        <FilePlus2 size={16} />
                        {t("editor.plugins.addTweak")}
                      </button>
                    </div>
                    <div className="mt-5 flex items-start justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{t("editor.plugins.replaceSubstrate")}</p>
                        <p className="mt-1 text-xs leading-5 text-gray-500">{t("editor.plugins.replaceSubstrateDesc")}</p>
                      </div>
                      <Toggle checked={draft.pluginState.replaceSubstrateWithEllekit} onChange={checked => updatePluginState({ replaceSubstrateWithEllekit: checked })} />
                    </div>
                    {draft.pluginState.injectionFiles.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {draft.pluginState.injectionFiles.map(path => (
                          <div key={path} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                            <span className="truncate text-gray-800">{getFileName(path)}</span>
                            <button
                              onClick={() => updatePluginState({ injectionFiles: draft.pluginState.injectionFiles.filter(item => item !== path) })}
                              className="text-gray-400 transition hover:text-red-600"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </Section>

                  <Section icon={Code2} title={t("editor.plugins.dylibsTitle")} description={t("editor.plugins.dylibsDesc")}>
                    <div className="space-y-2">
                      {visibleDylibs.length === 0 ? (
                        <p className="py-4 text-center text-sm text-gray-500">{t("ipaDetails.plugins.noDylibs")}</p>
                      ) : visibleDylibs.map(item => (
                        <PluginRow key={item.path} name={item.name} path={item.path} enabled={item.enabled} badge={item.is_injected ? t("ipaDetails.plugins.injected") : undefined} onToggle={() => toggleDylib(item.path)} />
                      ))}
                      {hiddenSystemDylibs > 0 && <p className="text-xs text-gray-500">{t("ipaDetails.plugins.hiddenSystemDylibs", { count: hiddenSystemDylibs })}</p>}
                    </div>
                  </Section>

                  <Section icon={Package} title={t("editor.plugins.frameworksTitle")} description={t("editor.plugins.frameworksDesc")}>
                    <div className="space-y-2">
                      {draft.pluginState.frameworks.length === 0 ? (
                        <p className="py-4 text-center text-sm text-gray-500">{t("ipaDetails.plugins.noFrameworks")}</p>
                      ) : draft.pluginState.frameworks.map(item => (
                        <PluginRow key={item.path} name={item.name} path={item.path} enabled={item.enabled} onToggle={() => toggleFramework(item.path)} />
                      ))}
                    </div>
                  </Section>

                  <Section icon={Puzzle} title={t("editor.plugins.pluginsTitle")} description={t("editor.plugins.pluginsDesc")}>
                    <div className="space-y-2">
                      {draft.pluginState.plugins.length === 0 ? (
                        <p className="py-4 text-center text-sm text-gray-500">{t("ipaDetails.plugins.noPlugins")}</p>
                      ) : draft.pluginState.plugins.map(item => (
                        <PluginRow key={item.path} name={item.name} path={item.bundle_id || item.path} enabled={item.enabled} badge={item.is_appex ? ".appex" : undefined} onToggle={() => togglePlugin(item.path)} />
                      ))}
                    </div>
                  </Section>
                </>
              )}

              {activeTab === "capabilities" && (
                <>
                  <Section icon={ShieldCheck} title={t("editor.capabilities.title")} description={t("editor.capabilities.desc")}>
                    <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                      {([
                        ["fileSharing", t("editor.capabilities.fileSharing"), t("editor.capabilities.fileSharingDesc")],
                        ["itunesFileSharing", t("editor.capabilities.itunesSharing"), t("editor.capabilities.itunesSharingDesc")],
                        ["proMotion", t("editor.capabilities.proMotion"), t("editor.capabilities.proMotionDesc")],
                        ["gameMode", t("editor.capabilities.gameMode"), t("editor.capabilities.gameModeDesc")],
                        ["ipadFullscreen", t("editor.capabilities.ipadFullscreen"), t("editor.capabilities.ipadFullscreenDesc")],
                        ["removeURLScheme", t("editor.capabilities.removeURLScheme"), t("editor.capabilities.removeURLSchemeDesc")],
                        ["removeProvisioning", t("editor.capabilities.removeProvisioning"), t("editor.capabilities.removeProvisioningDesc")],
                      ] as [keyof CapabilityState, string, string][]).map(([key, label, desc]) => (
                        <div key={key} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-4">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900">{label}</p>
                            <p className="mt-1 text-xs leading-5 text-gray-500">{desc}</p>
                          </div>
                          <Toggle checked={draft.capabilityState[key]} onChange={checked => updateCapability(key, checked)} />
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section icon={MonitorSpeaker} title={t("editor.capabilities.displayTitle")} description={t("editor.capabilities.displayDesc")}>
                    <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                      {([
                        ["statusBarHidden", t("editor.capabilities.statusBarHidden"), t("editor.capabilities.statusBarHiddenDesc")],
                        ["viewControllerBasedStatusBar", t("editor.capabilities.viewControllerBasedStatusBar"), t("editor.capabilities.viewControllerBasedStatusBarDesc")],
                        ["prerenderedIcon", t("editor.capabilities.prerenderedIcon"), t("editor.capabilities.prerenderedIconDesc")],
                      ] as [keyof CapabilityState, string, string][]).map(([key, label, desc]) => (
                        <div key={key} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-4">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900">{label}</p>
                            <p className="mt-1 text-xs leading-5 text-gray-500">{desc}</p>
                          </div>
                          <Toggle checked={draft.capabilityState[key]} onChange={checked => updateCapability(key, checked)} />
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section icon={Wifi} title={t("editor.capabilities.networkTitle")} description={t("editor.capabilities.networkDesc")}>
                    <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                      {([
                        ["requiresPersistentWiFi", t("editor.capabilities.requiresPersistentWiFi"), t("editor.capabilities.requiresPersistentWiFiDesc")],
                        ["exitsOnSuspend", t("editor.capabilities.exitsOnSuspend"), t("editor.capabilities.exitsOnSuspendDesc")],
                        ["allowsArbitraryLoads", t("editor.capabilities.allowsArbitraryLoads"), t("editor.capabilities.allowsArbitraryLoadsDesc")],
                        ["noEncryptionDecl", t("editor.capabilities.noEncryptionDecl"), t("editor.capabilities.noEncryptionDeclDesc")],
                      ] as [keyof CapabilityState, string, string][]).map(([key, label, desc]) => (
                        <div key={key} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-4">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900">{label}</p>
                            <p className="mt-1 text-xs leading-5 text-gray-500">{desc}</p>
                          </div>
                          <Toggle checked={draft.capabilityState[key]} onChange={checked => updateCapability(key, checked)} />
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section icon={RotateCw} title={t("editor.capabilities.orientationTitle")} description={t("editor.capabilities.orientationDesc")}>
                    <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                      {([
                        ["orientationPortrait", t("editor.capabilities.orientPortrait")],
                        ["orientationLandscapeLeft", t("editor.capabilities.orientLandscapeLeft")],
                        ["orientationLandscapeRight", t("editor.capabilities.orientLandscapeRight")],
                        ["orientationPortraitUpsideDown", t("editor.capabilities.orientPortraitUpsideDown")],
                      ] as [keyof CapabilityState, string][]).map(([key, label]) => (
                        <div key={key} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-4">
                          <p className="text-sm font-medium text-gray-900">{label}</p>
                          <Toggle checked={draft.capabilityState[key]} onChange={checked => updateCapability(key, checked)} />
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section icon={Radio} title={t("editor.capabilities.backgroundTitle")} description={t("editor.capabilities.backgroundDesc")}>
                    <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                      {([
                        ["bgAudio", t("editor.capabilities.bgAudio"), t("editor.capabilities.bgAudioDesc")],
                        ["bgLocation", t("editor.capabilities.bgLocation"), t("editor.capabilities.bgLocationDesc")],
                        ["bgFetch", t("editor.capabilities.bgFetch"), t("editor.capabilities.bgFetchDesc")],
                        ["bgVoip", t("editor.capabilities.bgVoip"), t("editor.capabilities.bgVoipDesc")],
                      ] as [keyof CapabilityState, string, string][]).map(([key, label, desc]) => (
                        <div key={key} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-4">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900">{label}</p>
                            <p className="mt-1 text-xs leading-5 text-gray-500">{desc}</p>
                          </div>
                          <Toggle checked={draft.capabilityState[key]} onChange={checked => updateCapability(key, checked)} />
                        </div>
                      ))}
                    </div>
                  </Section>
                </>
              )}

              {activeTab === "advanced" && (
                <>
                  <Section icon={SlidersHorizontal} title={t("editor.advanced.paramsTitle")} description={t("editor.advanced.paramsDesc")}>
                    <div className="space-y-5">
                      <div>
                        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t("editor.advanced.groupDevice")}</h3>
                        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                          <Field label={t("editor.advanced.requiredDeviceCapabilities")} value={draft.advancedState.requiredDeviceCapabilities} onChange={v => updateAdvanced("requiredDeviceCapabilities", v)} placeholder="arm64,armv7" />
                          <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-4">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900">{t("editor.advanced.removeSupportedDevices")}</p>
                              <p className="mt-1 text-xs leading-5 text-gray-500">{t("editor.advanced.removeSupportedDevicesDesc")}</p>
                            </div>
                            <Toggle checked={draft.advancedState.removeSupportedDevices} onChange={checked => updateAdvanced("removeSupportedDevices", checked)} />
                          </div>
                          <div className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-4">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900">{t("editor.advanced.supportsMultipleScenes")}</p>
                              <p className="mt-1 text-xs leading-5 text-gray-500">{t("editor.advanced.supportsMultipleScenesDesc")}</p>
                            </div>
                            <Toggle checked={draft.advancedState.supportsMultipleScenes} onChange={checked => updateAdvanced("supportsMultipleScenes", checked)} />
                          </div>
                        </div>
                      </div>

                      <div>
                        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t("editor.advanced.groupLocalization")}</h3>
                        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                          <Field label={t("editor.advanced.bundleLocalizations")} value={draft.advancedState.bundleLocalizations} onChange={v => updateAdvanced("bundleLocalizations", v)} placeholder="en,zh-Hans,ja" />
                          <Field label={t("editor.advanced.developmentRegion")} value={draft.advancedState.developmentRegion} onChange={v => updateAdvanced("developmentRegion", v)} placeholder="en" />
                          <Field label={t("editor.advanced.applicationCategoryType")} value={draft.advancedState.applicationCategoryType} onChange={v => updateAdvanced("applicationCategoryType", v)} placeholder="public.app-category.utilities" />
                        </div>
                      </div>

                      <div>
                        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t("editor.advanced.groupURLTypes")}</h3>
                        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                          <Field label={t("editor.advanced.customURLScheme")} value={draft.advancedState.customURLScheme} onChange={v => updateAdvanced("customURLScheme", v)} placeholder="myapp" />
                          {([
                            ["removeDocumentTypes", t("editor.advanced.removeDocumentTypes"), t("editor.advanced.removeDocumentTypesDesc")],
                            ["removeExportedTypeDeclarations", t("editor.advanced.removeExportedTypeDeclarations"), t("editor.advanced.removeExportedTypeDeclarationsDesc")],
                            ["removeApplicationQueriesSchemes", t("editor.advanced.removeApplicationQueriesSchemes"), t("editor.advanced.removeApplicationQueriesSchemesDesc")],
                          ] as [keyof AdvancedState, string, string][]).map(([key, label, desc]) => (
                            <div key={key} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-4">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900">{label}</p>
                                <p className="mt-1 text-xs leading-5 text-gray-500">{desc}</p>
                              </div>
                              <Toggle checked={draft.advancedState[key] as boolean} onChange={checked => updateAdvanced(key, checked as AdvancedState[typeof key])} />
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t("editor.advanced.groupPrivacy")}</h3>
                        <p className="mb-3 text-xs text-gray-500">{t("editor.advanced.privacyHint")}</p>
                        <PrivacyOverridesEditor
                          overrides={draft.advancedState.privacyOverrides}
                          onChange={next => updateAdvanced("privacyOverrides", next)}
                        />
                      </div>

                      <div>
                        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t("editor.advanced.groupRemoval")}</h3>
                        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                          {([
                            ["removeLaunchScreen", t("editor.advanced.removeLaunchScreen"), t("editor.advanced.removeLaunchScreenDesc")],
                            ["removeWatchApp", t("editor.advanced.removeWatchApp"), t("editor.advanced.removeWatchAppDesc")],
                            ["removePlugIns", t("editor.advanced.removePlugIns"), t("editor.advanced.removePlugInsDesc")],
                          ] as [keyof AdvancedState, string, string][]).map(([key, label, desc]) => (
                            <div key={key} className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-4">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900">{label}</p>
                                <p className="mt-1 text-xs leading-5 text-gray-500">{desc}</p>
                              </div>
                              <Toggle checked={draft.advancedState[key] as boolean} onChange={checked => updateAdvanced(key, checked as AdvancedState[typeof key])} />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </Section>

                  <Section icon={ShieldCheck} title={t("editor.advanced.entitlementsTitle")} description={t("editor.advanced.entitlementsDesc")}>
                    {details.entitlements_xml ? (
                      <pre className="max-h-80 overflow-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-100 scrollbar-thin">{details.entitlements_xml}</pre>
                    ) : (
                      <p className="py-4 text-center text-sm text-gray-500">{t("ipaDetails.noEntitlements")}</p>
                    )}
                  </Section>
                  <Section icon={FileCode2} title={t("editor.advanced.propertiesTitle")} description={t("editor.advanced.propertiesDesc")}>
                    <pre className="max-h-96 overflow-auto rounded-lg bg-gray-950 p-4 text-xs text-gray-100 scrollbar-thin">{JSON.stringify(details.properties || {}, null, 2)}</pre>
                  </Section>
                </>
              )}
            </div>
          )}
        </main>
      </div>
      <ConfirmDialog
        isOpen={exportResultDialog.open}
        title={t("editor.exportSuccessTitle")}
        message={
          exportResultDialog.outputPath
            ? t("editor.exportSuccessMessage", { file: getFileName(exportResultDialog.outputPath) })
            : t("editor.exportSuccess")
        }
        confirmText={t("editor.viewInLibrary")}
        cancelText={t("editor.continueEditing")}
        type="info"
        onConfirm={() => {
          setExportResultDialog({ open: false, outputPath: "" });
          navigate("/library");
        }}
        onCancel={() => setExportResultDialog({ open: false, outputPath: "" })}
      />
      <IpaSignDialog
        filePath={signDialogPath}
        onClose={() => {
          setSignDialogPath(null);
          setSignEditorOptions(null);
          setSignIconPath(null);
        }}
        onSigned={async () => {
          setSignDialogPath(null);
          setSignEditorOptions(null);
          setSignIconPath(null);
        }}
        editorOptions={signEditorOptions}
        iconPath={signIconPath}
        applyEditsHint={signEditorOptions ? t("editor.signWithEditsHint") : null}
      />
    </div>
  );
}

function PluginRow({
  name,
  path,
  enabled,
  badge,
  onToggle,
}: {
  name: string;
  path: string;
  enabled: boolean;
  badge?: string;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-gray-900">{name}</p>
          {badge && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">{badge}</span>}
        </div>
        <p className="truncate text-xs text-gray-500">{path}</p>
      </div>
      <button
        onClick={onToggle}
        className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${enabled ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "bg-red-100 text-red-700 hover:bg-red-200"}`}
      >
        {enabled ? t("ipaDetails.plugins.enabled") : t("ipaDetails.plugins.disabled")}
      </button>
    </div>
  );
}

// 隐私权限文案覆盖编辑器 —— 批量改/删 NSxxxUsageDescription
const PRIVACY_USAGE_KEYS = [
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
  "NSPhotoLibraryUsageDescription",
  "NSPhotoLibraryAddUsageDescription",
  "NSLocationWhenInUseUsageDescription",
  "NSLocationAlwaysAndWhenInUseUsageDescription",
  "NSContactsUsageDescription",
  "NSFaceIDUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothWhileInUseUsageDescription",
  "NSCalendarsUsageDescription",
  "NSRemindersUsageDescription",
  "NSMotionUsageDescription",
  "NSHealthShareUsageDescription",
  "NSHealthUpdateUsageDescription",
  "NSHomeKitUsageDescription",
  "NSSiriUsageDescription",
  "NSSpeechRecognitionUsageDescription",
  "NSUserTrackingUsageDescription",
  "NSLocalNetworkUsageDescription",
  "NSAppleMusicUsageDescription",
  "NSVideoSubscriberAccountUsageDescription",
];

function PrivacyOverridesEditor({
  overrides,
  onChange,
}: {
  overrides: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  const [selectedKey, setSelectedKey] = useState<string>(PRIVACY_USAGE_KEYS[0]);
  const entries = Object.entries(overrides);

  const addOverride = () => {
    if (!selectedKey) return;
    onChange({ ...overrides, [selectedKey]: overrides[selectedKey] ?? "" });
  };

  const removeOverride = (key: string) => {
    const next = { ...overrides };
    delete next[key];
    onChange(next);
  };

  const updateValue = (key: string, value: string) => {
    onChange({ ...overrides, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500">{t("editor.advanced.privacySelectKey")}</span>
          <select
            value={selectedKey}
            onChange={e => setSelectedKey(e.target.value)}
            className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
          >
            {PRIVACY_USAGE_KEYS.map(k => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <button
          onClick={addOverride}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          <FilePlus2 size={16} />
          {t("editor.advanced.privacyAdd")}
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="py-3 text-center text-sm text-gray-500">{t("editor.advanced.privacyEmpty")}</p>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, value]) => (
            <div key={key} className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <p className="mb-1.5 text-xs font-semibold text-gray-700">{key}</p>
                <input
                  value={value}
                  onChange={e => updateValue(key, e.target.value)}
                  placeholder={t("editor.advanced.privacyPlaceholder")}
                  className="h-9 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                />
                <p className="mt-1 text-xs text-gray-400">{t("editor.advanced.privacyValueHint")}</p>
              </div>
              <button
                onClick={() => removeOverride(key)}
                className="shrink-0 self-start rounded-lg p-2 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
