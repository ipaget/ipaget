import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import CopyButton from "./CopyButton";
import EntitlementGroup from "./EntitlementGroup";
import {
  parseEntitlementsXML,
  getEntitlementsArray,
  type ParsedEntitlement,
} from "../lib/entitlementsParser";

const CATEGORY_KEYS = {
  identity: {
    icon: '🆔',
    keys: ['application-identifier', 'com.apple.developer.team-identifier'],
  },
  services: {
    icon: '🍎',
    keys: [
      'com.apple.developer.applesignin',
      'com.apple.developer.in-app-payments',
      'com.apple.developer.game-center',
      'com.apple.developer.weatherkit',
    ],
  },
  notifications: {
    icon: '🔔',
    keys: [
      'aps-environment',
      'com.apple.developer.usernotifications.communication',
      'com.apple.developer.usernotifications.time-sensitive',
      'com.apple.developer.usernotifications.critical-alerts',
      'com.apple.developer.usernotifications.filtering',
    ],
  },
  domains: {
    icon: '🌐',
    keys: [
      'com.apple.developer.associated-domains',
      'com.apple.developer.associated-domains.applinks',
      'com.apple.developer.associated-domains.webcredentials',
    ],
  },
  storage: {
    icon: '🔑',
    keys: [
      'keychain-access-groups',
      'com.apple.security.application-groups',
      'com.apple.developer.icloud-container-identifiers',
      'com.apple.developer.icloud-services',
      'com.apple.developer.ubiquity-kvstore-identifier',
    ],
  },
  health: {
    icon: '❤️',
    keys: [
      'com.apple.developer.healthkit',
      'com.apple.developer.healthkit.access',
    ],
  },
  connectivity: {
    icon: '📡',
    keys: [
      'com.apple.developer.nfc.readersession.formats',
      'com.apple.developer.networking.networkextension',
      'com.apple.developer.networking.vpn.api',
      'com.apple.developer.networking.HotspotConfiguration',
      'com.apple.developer.networking.multipath',
    ],
  },
  capabilities: {
    icon: '⚡',
    keys: [
      'com.apple.developer.carplay-maps',
      'com.apple.developer.siri',
      'com.apple.developer.homekit',
      'com.apple.developer.maps',
      'com.apple.developer.group-session',
    ],
  },
};

interface EntitlementsViewProps {
  entitlementsXml: string;
}

export default function EntitlementsView({ entitlementsXml }: EntitlementsViewProps) {
  const { t } = useTranslation();
  const [showRawXml, setShowRawXml] = useState(false);

  const parsedEntitlements = parseEntitlementsXML(entitlementsXml);
  const entitlementsArray = getEntitlementsArray(parsedEntitlements);

  const groupedEntitlements = () => {
    const categorized: Record<string, ParsedEntitlement[]> = {};
    const uncategorized: ParsedEntitlement[] = [];

    Object.keys(CATEGORY_KEYS).forEach(key => {
      categorized[key] = [];
    });

    entitlementsArray.forEach(entitlement => {
      let found = false;
      for (const [categoryKey, category] of Object.entries(CATEGORY_KEYS)) {
        if (category.keys.includes(entitlement.key)) {
          categorized[categoryKey].push(entitlement);
          found = true;
          break;
        }
      }
      if (!found) {
        uncategorized.push(entitlement);
      }
    });

    return { categorized, uncategorized };
  };

  const { categorized, uncategorized } = groupedEntitlements();

  return (
    <div className="space-y-6">
      {/* Removed top highlight cards for entitlements like App Groups */}

      <div className="space-y-3">
        {Object.entries(categorized).map(([categoryKey, items]) => {
          const category = CATEGORY_KEYS[categoryKey as keyof typeof CATEGORY_KEYS];
          return (
            <EntitlementGroup
              key={categoryKey}
              title={t(`devices.entitlement.categories.${categoryKey}`)}
              icon={category.icon}
              items={items.map(item => ({
                key: item.key,
                value: item.value,
                type: Array.isArray(item.value) ? 'array' : typeof item.value,
              }))}
              defaultExpanded={items.length > 0}
            />
          );
        })}

        {uncategorized.length > 0 && (
          <EntitlementGroup
            title={t('devices.entitlement.categories.other')}
            icon="📦"
            items={uncategorized.map(item => ({
              key: item.key,
              value: item.value,
              type: Array.isArray(item.value) ? 'array' : typeof item.value,
            }))}
            defaultExpanded={true}
          />
        )}
      </div>

      <div className="border-t border-gray-200 pt-6">
        <button
          onClick={() => setShowRawXml(!showRawXml)}
          className="text-sm font-semibold text-gray-700 hover:text-primary-600 transition-colors mb-3 inline-flex items-center space-x-2"
        >
          <ChevronRight size={14} className={`transition-transform duration-200 ${showRawXml ? 'rotate-90' : 'rotate-0'}`} />
          <span>{showRawXml ? t('devices.entitlement.hideRawXml') : t('devices.entitlement.showRawXml')}</span>
        </button>

        {showRawXml && (
          <div className="relative">
            <pre className="bg-gray-50 p-4 rounded-lg overflow-x-auto text-xs font-mono text-gray-800 border border-gray-200">
              {entitlementsXml}
            </pre>
            <div className="absolute top-2 right-2">
              <CopyButton text={entitlementsXml} size={16} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
