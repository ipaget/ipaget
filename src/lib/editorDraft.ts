import type { SigningOptions, InjectPath, InjectFolder } from "./goService";

/** Minimal draft shape needed to build backend signing/export options. */
export interface EditorDraftLike {
  appName: string;
  displayName: string;
  bundleId: string;
  version: string;
  buildVersion: string;
  minimumOSVersion: string;
  appearance: "default" | "Light" | "Dark";
  pluginState: {
    dylibs: Array<{ path: string; enabled?: boolean }>;
    frameworks: Array<{ path: string; enabled?: boolean }>;
    plugins: Array<{ path: string; enabled?: boolean }>;
    injectionFiles: string[];
    injectPath: InjectPath;
    injectFolder: InjectFolder;
  };
  capabilityState: {
    fileSharing: boolean;
    itunesFileSharing: boolean;
    removeURLScheme: boolean;
    removeProvisioning: boolean;
    statusBarHidden: boolean;
    viewControllerBasedStatusBar: boolean;
    requiresPersistentWiFi: boolean;
    exitsOnSuspend: boolean;
    prerenderedIcon: boolean;
    noEncryptionDecl: boolean;
    allowsArbitraryLoads: boolean;
    orientationPortrait: boolean;
    orientationLandscapeLeft: boolean;
    orientationLandscapeRight: boolean;
    orientationPortraitUpsideDown: boolean;
    bgAudio: boolean;
    bgLocation: boolean;
    bgFetch: boolean;
    bgVoip: boolean;
  };
  advancedState: {
    requiredDeviceCapabilities: string;
    removeSupportedDevices: boolean;
    bundleLocalizations: string;
    developmentRegion: string;
    applicationCategoryType: string;
    supportsMultipleScenes: boolean;
    customURLScheme: string;
    removeDocumentTypes: boolean;
    removeExportedTypeDeclarations: boolean;
    removeApplicationQueriesSchemes: boolean;
    privacyOverrides: Record<string, string>;
    removeLaunchScreen: boolean;
    removeWatchApp: boolean;
    removePlugIns: boolean;
  };
  iconPath: string;
}

function optionalChangedString(
  current: string,
  baseline: string | undefined
): string | undefined {
  const trimmed = current.trim();
  if (!trimmed) return undefined;
  if (baseline !== undefined && trimmed === baseline.trim()) return undefined;
  return trimmed;
}

/**
 * Build SigningOptions from the editor draft.
 * Identity fields are only included when they differ from the baseline snapshot.
 * Capability/advanced flags are sent from the current draft so the export applies the UI state.
 */
export function buildSigningOptionsFromDraft(
  draft: EditorDraftLike,
  baseline?: EditorDraftLike | null
): SigningOptions {
  const options: SigningOptions = {
    inject_path: draft.pluginState.injectPath,
    inject_folder: draft.pluginState.injectFolder,
    injection_files: [...draft.pluginState.injectionFiles],
    dis_injection_files: draft.pluginState.dylibs
      .filter((item) => item.enabled === false)
      .map((item) => item.path),
    remove_files: [
      ...draft.pluginState.frameworks
        .filter((item) => item.enabled === false)
        .map((item) => item.path),
      ...draft.pluginState.plugins
        .filter((item) => item.enabled === false)
        .map((item) => item.path),
    ],
    file_sharing: draft.capabilityState.fileSharing,
    itunes_file_sharing: draft.capabilityState.itunesFileSharing,
    remove_url_scheme: draft.capabilityState.removeURLScheme,
    remove_provisioning: draft.capabilityState.removeProvisioning,
    status_bar_hidden: draft.capabilityState.statusBarHidden,
    view_controller_based_status_bar: draft.capabilityState.viewControllerBasedStatusBar,
    prerendered_icon: draft.capabilityState.prerenderedIcon,
    requires_persistent_wifi: draft.capabilityState.requiresPersistentWiFi,
    exits_on_suspend: draft.capabilityState.exitsOnSuspend,
    allows_arbitrary_loads: draft.capabilityState.allowsArbitraryLoads,
    no_encryption_decl: draft.capabilityState.noEncryptionDecl,
    orientation_portrait: draft.capabilityState.orientationPortrait,
    orientation_landscape_left: draft.capabilityState.orientationLandscapeLeft,
    orientation_landscape_right: draft.capabilityState.orientationLandscapeRight,
    orientation_portrait_upside_down: draft.capabilityState.orientationPortraitUpsideDown,
    bg_audio: draft.capabilityState.bgAudio,
    bg_location: draft.capabilityState.bgLocation,
    bg_fetch: draft.capabilityState.bgFetch,
    bg_voip: draft.capabilityState.bgVoip,
    required_device_capabilities: draft.advancedState.requiredDeviceCapabilities.trim() || undefined,
    remove_supported_devices: draft.advancedState.removeSupportedDevices,
    bundle_localizations: draft.advancedState.bundleLocalizations.trim() || undefined,
    development_region: draft.advancedState.developmentRegion.trim() || undefined,
    application_category_type: draft.advancedState.applicationCategoryType.trim() || undefined,
    supports_multiple_scenes: draft.advancedState.supportsMultipleScenes,
    custom_url_scheme: draft.advancedState.customURLScheme.trim() || undefined,
    remove_document_types: draft.advancedState.removeDocumentTypes,
    remove_exported_type_declarations: draft.advancedState.removeExportedTypeDeclarations,
    remove_application_queries_schemes: draft.advancedState.removeApplicationQueriesSchemes,
    privacy_overrides:
      Object.keys(draft.advancedState.privacyOverrides).length > 0
        ? { ...draft.advancedState.privacyOverrides }
        : undefined,
    remove_launch_screen: draft.advancedState.removeLaunchScreen,
    remove_watch_app: draft.advancedState.removeWatchApp,
    remove_plug_ins: draft.advancedState.removePlugIns,
  };

  const displayName = optionalChangedString(draft.displayName, baseline?.displayName);
  if (displayName) {
    options.app_name = displayName;
  }

  const version = optionalChangedString(draft.version, baseline?.version);
  if (version) {
    options.app_version = version;
  }

  const bundleId = optionalChangedString(draft.bundleId, baseline?.bundleId);
  if (bundleId) {
    options.app_identifier = bundleId;
  }

  const buildVersion = optionalChangedString(draft.buildVersion, baseline?.buildVersion);
  if (buildVersion) {
    options.app_build_version = buildVersion;
  }

  const minimumOS = optionalChangedString(draft.minimumOSVersion, baseline?.minimumOSVersion);
  if (minimumOS) {
    options.minimum_os_version = minimumOS;
  }

  if (!baseline || draft.appearance !== baseline.appearance) {
    options.appearance = draft.appearance;
  }

  return options;
}

export function getEditorIconPath(draft: EditorDraftLike): string | undefined {
  const iconPath = draft.iconPath.trim();
  return iconPath || undefined;
}
