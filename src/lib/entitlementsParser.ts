/**
 * Entitlements Parser
 * Parses iOS app entitlements XML and extracts common entitlements information
 * Reference: https://developer.apple.com/documentation/bundleresources/entitlements
 */

export interface ParsedEntitlement {
  key: string;
  value: any;
  displayName: string;
  description: string;
  icon?: string;
}

export interface EntitlementsInfo {
  // Core identifiers
  applicationIdentifier?: string;
  teamIdentifier?: string;
  
  // Push notifications
  apsEnvironment?: 'production' | 'development';
  
  // Apple services
  appleSignIn?: string[];
  associatedDomains?: string[];
  inAppPayments?: string[];
  
  // App groups and keychain
  applicationGroups?: string[];
  keychainAccessGroups?: string[];
  
  // Capabilities
  carPlayMaps?: boolean;
  healthKit?: boolean;
  healthKitAccess?: string[];
  siri?: boolean;
  
  // Notifications
  communicationNotifications?: boolean;
  timeSensitiveNotifications?: boolean;
  
  // Other capabilities
  nfc?: boolean;
  networkExtensions?: boolean;
  personalVPN?: boolean;
  hotspotConfiguration?: boolean;
  multipath?: boolean;
  
  // All raw entitlements
  raw: Record<string, any>;
}

/**
 * Entitlement metadata for display purposes
 */
const ENTITLEMENT_METADATA: Record<string, { name: string; description: string; icon?: string }> = {
  'application-identifier': {
    name: 'Application Identifier',
    description: 'The unique identifier for the application',
    icon: '🆔',
  },
  'com.apple.developer.team-identifier': {
    name: 'Team Identifier',
    description: 'The developer team identifier',
    icon: '👥',
  },
  'aps-environment': {
    name: 'Push Notifications',
    description: 'Apple Push Notification service environment',
    icon: '🔔',
  },
  'com.apple.developer.applesignin': {
    name: 'Sign in with Apple',
    description: 'Enables Sign in with Apple capability',
    icon: '🍎',
  },
  'com.apple.developer.associated-domains': {
    name: 'Associated Domains',
    description: 'Universal links and web credentials',
    icon: '🌐',
  },
  'com.apple.developer.in-app-payments': {
    name: 'Apple Pay',
    description: 'In-app payment merchant identifiers',
    icon: '💳',
  },
  'com.apple.security.application-groups': {
    name: 'App Groups',
    description: 'Shared containers between apps',
    icon: '📦',
  },
  'keychain-access-groups': {
    name: 'Keychain Access Groups',
    description: 'Shared keychain access between apps',
    icon: '🔑',
  },
  'com.apple.developer.carplay-maps': {
    name: 'CarPlay Maps',
    description: 'CarPlay maps support',
    icon: '🚗',
  },
  'com.apple.developer.healthkit': {
    name: 'HealthKit',
    description: 'Access to health and fitness data',
    icon: '❤️',
  },
  'com.apple.developer.healthkit.access': {
    name: 'HealthKit Access',
    description: 'Types of health data access',
    icon: '🏥',
  },
  'com.apple.developer.siri': {
    name: 'Siri',
    description: 'Siri integration',
    icon: '🎙️',
  },
  'com.apple.developer.usernotifications.communication': {
    name: 'Communication Notifications',
    description: 'Communication notifications capability',
    icon: '💬',
  },
  'com.apple.developer.usernotifications.time-sensitive': {
    name: 'Time Sensitive Notifications',
    description: 'Time-sensitive notifications',
    icon: '⏰',
  },
  'com.apple.developer.nfc.readersession.formats': {
    name: 'NFC',
    description: 'Near Field Communication',
    icon: '📡',
  },
  'com.apple.developer.networking.networkextension': {
    name: 'Network Extensions',
    description: 'Custom networking protocols',
    icon: '🌐',
  },
  'com.apple.developer.networking.vpn.api': {
    name: 'Personal VPN',
    description: 'Personal VPN configuration',
    icon: '🔒',
  },
  'com.apple.developer.networking.HotspotConfiguration': {
    name: 'Hotspot Configuration',
    description: 'Wi-Fi hotspot configuration',
    icon: '📶',
  },
  'com.apple.developer.networking.multipath': {
    name: 'Multipath',
    description: 'Multipath TCP',
    icon: '🔀',
  },
  'com.apple.developer.ClassKit-environment': {
    name: 'ClassKit',
    description: 'ClassKit framework support',
    icon: '🎓',
  },
  'com.apple.developer.default-data-protection': {
    name: 'Data Protection',
    description: 'Default file protection level',
    icon: '🛡️',
  },
  'com.apple.developer.homekit': {
    name: 'HomeKit',
    description: 'HomeKit accessories control',
    icon: '🏠',
  },
  'com.apple.developer.icloud-container-identifiers': {
    name: 'iCloud Containers',
    description: 'iCloud container identifiers',
    icon: '☁️',
  },
  'com.apple.developer.icloud-services': {
    name: 'iCloud Services',
    description: 'iCloud services (CloudKit, CloudDocuments, etc.)',
    icon: '☁️',
  },
  'com.apple.developer.ubiquity-kvstore-identifier': {
    name: 'iCloud Key-Value Store',
    description: 'iCloud key-value storage',
    icon: '🗄️',
  },
  'com.apple.external-accessory.wireless-configuration': {
    name: 'External Accessory',
    description: 'Wireless accessory configuration',
    icon: '🎧',
  },
  'inter-app-audio': {
    name: 'Inter-App Audio',
    description: 'Audio routing between apps',
    icon: '🔊',
  },
  'com.apple.developer.pass-type-identifiers': {
    name: 'Wallet Pass Types',
    description: 'Apple Wallet pass type identifiers',
    icon: '💼',
  },
  'com.apple.developer.game-center': {
    name: 'Game Center',
    description: 'Game Center integration',
    icon: '🎮',
  },
  'com.apple.developer.maps': {
    name: 'MapKit',
    description: 'MapKit JS and MapKit Server',
    icon: '🗺️',
  },
  'com.apple.developer.devicecheck.appattest-environment': {
    name: 'App Attest',
    description: 'App attestation environment',
    icon: '🔐',
  },
  'com.apple.developer.usernotifications.filtering': {
    name: 'Notification Filtering',
    description: 'Notification content app extension',
    icon: '🔔',
  },
  'com.apple.developer.contacts.notes': {
    name: 'Contacts Notes',
    description: 'Access to contacts notes',
    icon: '📝',
  },
  'com.apple.developer.payment-pass-provisioning': {
    name: 'Payment Pass Provisioning',
    description: 'Add payment passes to Wallet',
    icon: '💳',
  },
  'com.apple.developer.kernel.extended-virtual-addressing': {
    name: 'Extended Virtual Addressing',
    description: 'Extended virtual memory addressing',
    icon: '💾',
  },
  'com.apple.developer.kernel.increased-memory-limit': {
    name: 'Increased Memory Limit',
    description: 'Increased app memory limit',
    icon: '📈',
  },
  'com.apple.developer.driverkit': {
    name: 'DriverKit',
    description: 'DriverKit entitlements',
    icon: '🚗',
  },
  'com.apple.developer.group-session': {
    name: 'Group Activities',
    description: 'SharePlay group activities',
    icon: '👥',
  },
  'com.apple.developer.weatherkit': {
    name: 'WeatherKit',
    description: 'Weather data access',
    icon: '⛅',
  },
  'com.apple.developer.camera.exposure-bracketing': {
    name: 'Camera Exposure Bracketing',
    description: 'Advanced camera exposure control',
    icon: '📷',
  },
  'com.apple.developer.media-device-discovery-extension': {
    name: 'Media Device Discovery',
    description: 'Discover media devices',
    icon: '📺',
  },
  'com.apple.developer.devicecheck': {
    name: 'DeviceCheck',
    description: 'Device validation and fraud prevention',
    icon: '✅',
  },
  'com.apple.developer.exposure-notification': {
    name: 'Exposure Notification',
    description: 'COVID-19 exposure notification',
    icon: '🦠',
  },
  'com.apple.developer.associated-appclip-app-identifiers': {
    name: 'App Clip Identifiers',
    description: 'Associated App Clip identifiers',
    icon: '📎',
  },
  'com.apple.developer.on-demand-install-capable': {
    name: 'On-Demand Resources',
    description: 'On-demand resource installation',
    icon: '📦',
  },
  'com.apple.developer.shared-with-you': {
    name: 'Shared with You',
    description: 'Shared with You framework',
    icon: '🔗',
  },
  'com.apple.developer.usernotifications.critical-alerts': {
    name: 'Critical Alerts',
    description: 'Critical notification alerts',
    icon: '🚨',
  },
  'com.apple.developer.matter.allow-setup-payload': {
    name: 'Matter Setup Payload',
    description: 'Matter smart home setup',
    icon: '🏠',
  },
  'com.apple.developer.coremedia.hls.low-latency': {
    name: 'Low-Latency HLS',
    description: 'Low-latency HLS streaming',
    icon: '📹',
  },
  'com.apple.developer.appletv.channel': {
    name: 'Apple TV Channel',
    description: 'Apple TV channel integration',
    icon: '📺',
  },
  'com.apple.developer.associated-domains.applinks': {
    name: 'Universal Links',
    description: 'Universal Links domains',
    icon: '🔗',
  },
  'com.apple.developer.associated-domains.webcredentials': {
    name: 'Web Credentials',
    description: 'Web authentication credentials',
    icon: '🌐',
  },
  'com.apple.developer.authentication-services.autofill-credential-provider': {
    name: 'AutoFill Credential Provider',
    description: 'Password AutoFill extension',
    icon: '🔑',
  },
  'com.apple.developer.fileprovider.testing-mode': {
    name: 'File Provider Testing',
    description: 'File Provider extension testing',
    icon: '📁',
  },
  'com.apple.developer.contacts.notes-access': {
    name: 'Contacts Notes Access',
    description: 'Read/write access to contact notes',
    icon: '📇',
  },
  'get-task-allow': {
    name: 'Debug Mode',
    description: 'Allows debugging and task inspection',
    icon: '🐛',
  },
  'com.apple.security.app-sandbox': {
    name: 'App Sandbox',
    description: 'macOS App Sandbox',
    icon: '📦',
  },
  'com.apple.security.network.client': {
    name: 'Network Client',
    description: 'Outgoing network connections',
    icon: '📡',
  },
  'com.apple.security.network.server': {
    name: 'Network Server',
    description: 'Incoming network connections',
    icon: '🖥️',
  },
  'com.apple.security.files.user-selected.read-only': {
    name: 'User Selected Files (Read)',
    description: 'Read user-selected files',
    icon: '📄',
  },
  'com.apple.security.files.user-selected.read-write': {
    name: 'User Selected Files (Read/Write)',
    description: 'Read and write user-selected files',
    icon: '📝',
  },
  'com.apple.security.files.downloads.read-only': {
    name: 'Downloads Folder (Read)',
    description: 'Read access to Downloads folder',
    icon: '⬇️',
  },
  'com.apple.security.files.downloads.read-write': {
    name: 'Downloads Folder (Read/Write)',
    description: 'Read/write access to Downloads folder',
    icon: '📂',
  },
};

/**
 * Parse entitlements XML string
 */
export function parseEntitlementsXML(xml: string): EntitlementsInfo {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  
  // Check for parsing errors
  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    console.error('XML parsing error:', parserError.textContent);
    return { raw: {} };
  }
  
  const dict = doc.querySelector('plist > dict');
  if (!dict) {
    return { raw: {} };
  }
  
  const raw = parsePlistDict(dict);
  
  return {
    applicationIdentifier: raw['application-identifier'],
    teamIdentifier: raw['com.apple.developer.team-identifier'],
    apsEnvironment: raw['aps-environment'],
    appleSignIn: raw['com.apple.developer.applesignin'],
    associatedDomains: raw['com.apple.developer.associated-domains'],
    inAppPayments: raw['com.apple.developer.in-app-payments'],
    applicationGroups: raw['com.apple.security.application-groups'],
    keychainAccessGroups: raw['keychain-access-groups'],
    carPlayMaps: raw['com.apple.developer.carplay-maps'],
    healthKit: raw['com.apple.developer.healthkit'],
    healthKitAccess: raw['com.apple.developer.healthkit.access'],
    siri: raw['com.apple.developer.siri'],
    communicationNotifications: raw['com.apple.developer.usernotifications.communication'],
    timeSensitiveNotifications: raw['com.apple.developer.usernotifications.time-sensitive'],
    nfc: !!raw['com.apple.developer.nfc.readersession.formats'],
    networkExtensions: !!raw['com.apple.developer.networking.networkextension'],
    personalVPN: !!raw['com.apple.developer.networking.vpn.api'],
    hotspotConfiguration: !!raw['com.apple.developer.networking.HotspotConfiguration'],
    multipath: !!raw['com.apple.developer.networking.multipath'],
    raw,
  };
}

/**
 * Parse a plist dict element
 */
function parsePlistDict(dict: Element): Record<string, any> {
  const result: Record<string, any> = {};
  const children = Array.from(dict.children);
  
  for (let i = 0; i < children.length; i += 2) {
    const keyElement = children[i];
    const valueElement = children[i + 1];
    
    if (keyElement.tagName !== 'key' || !valueElement) {
      continue;
    }
    
    const key = keyElement.textContent || '';
    const value = parsePlistValue(valueElement);
    result[key] = value;
  }
  
  return result;
}

/**
 * Parse a plist value element
 */
function parsePlistValue(element: Element): any {
  switch (element.tagName) {
    case 'string':
      return element.textContent || '';
    case 'true':
      return true;
    case 'false':
      return false;
    case 'integer':
      return parseInt(element.textContent || '0', 10);
    case 'real':
      return parseFloat(element.textContent || '0');
    case 'array':
      return Array.from(element.children).map(parsePlistValue);
    case 'dict':
      return parsePlistDict(element);
    case 'data':
      return element.textContent || '';
    default:
      return null;
  }
}

/**
 * Get parsed entitlements as an array for display
 */
export function getEntitlementsArray(info: EntitlementsInfo): ParsedEntitlement[] {
  const entitlements: ParsedEntitlement[] = [];
  
  for (const [key, value] of Object.entries(info.raw)) {
    const metadata = ENTITLEMENT_METADATA[key] || {
      name: key,
      description: '',
      icon: '📋',
    };
    
    entitlements.push({
      key,
      value,
      displayName: metadata.name,
      description: metadata.description,
      icon: metadata.icon,
    });
  }
  
  return entitlements.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Format entitlement value for display
 */
export function formatEntitlementValue(value: any): string {
  if (value === true) return 'Enabled';
  if (value === false) return 'Disabled';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Empty';
    return value.join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

