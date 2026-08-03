import { useTranslation } from "react-i18next";

interface PropertiesViewProps {
  properties: Record<string, any>;
}

export default function PropertiesView({ properties }: PropertiesViewProps) {
  const { t } = useTranslation();

  const renderValue = (value: any): string => {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "object") {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  };

  const importantKeys = [
    "CFBundleIdentifier",
    "CFBundleVersion",
    "CFBundleShortVersionString",
    "CFBundleName",
    "CFBundleDisplayName",
    "CFBundleExecutable",
    "MinimumOSVersion",
  ];

  const keyTranslations: Record<string, string> = {
    CFBundleIdentifier: t("ipaDetails.properties.bundleId"),
    CFBundleVersion: t("ipaDetails.properties.version") + " (Build)",
    CFBundleShortVersionString: t("ipaDetails.properties.version"),
    CFBundleName: t("ipaDetails.properties.name"),
    CFBundleDisplayName: t("ipaDetails.properties.name") + " (Display)",
    CFBundleExecutable: t("ipaDetails.properties.executable"),
    MinimumOSVersion: t("ipaDetails.properties.minOSVersion"),
  };

  if (!properties || Object.keys(properties).length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">{t("ipaDetails.properties.noProperties")}</p>
      </div>
    );
  }

  const importantEntries = importantKeys
    .filter((key) => key in properties)
    .map((key) => [key, properties[key]]);

  const otherEntries = Object.entries(properties).filter(
    ([key]) => !importantKeys.includes(key)
  );

  const allEntries = [...importantEntries, ...otherEntries];

  return (
    <div className="space-y-1 max-h-[400px] overflow-y-auto scrollbar-thin">
      {allEntries.map(([key, value]) => (
        <div
          key={key}
          className="grid grid-cols-[200px_1fr] gap-4 py-2 border-b border-gray-100 last:border-0 min-w-0"
        >
          <div className="text-sm font-medium text-gray-700 break-words">
            {keyTranslations[key] || key}
          </div>
          <div className="text-sm text-gray-900 break-all min-w-0">
            {typeof value === "object" ? (
              <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto">
                {renderValue(value)}
              </pre>
            ) : (
              renderValue(value)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

