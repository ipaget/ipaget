import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Package, Code, Puzzle, Eye, EyeOff } from "lucide-react";
import { DylibItem, FrameworkItem, PluginItem } from "../lib/goService";

interface PluginsViewProps {
  dylibs: DylibItem[];
  frameworks: FrameworkItem[];
  plugins: PluginItem[];
  onModified: () => void;
}

export default function PluginsView({
  dylibs: initialDylibs,
  frameworks: initialFrameworks,
  plugins: initialPlugins,
  onModified,
}: PluginsViewProps) {
  const { t } = useTranslation();
  const [dylibs, setDylibs] = useState(initialDylibs);
  const [frameworks, setFrameworks] = useState(initialFrameworks);
  const [plugins, setPlugins] = useState(initialPlugins);

  // Filter Dylibs: only show @rpath and @executable_path, hide system dylibs
  const { visibleDylibs, hiddenDylibCount } = useMemo(() => {
    const visible = dylibs.filter(
      (d) => d.path.startsWith("@rpath") || d.path.startsWith("@executable_path")
    );
    const hidden = dylibs.length - visible.length;
    return { visibleDylibs: visible, hiddenDylibCount: hidden };
  }, [dylibs]);

  const toggleDylib = (index: number) => {
    const actualIndex = dylibs.findIndex((d) => d === visibleDylibs[index]);
    if (actualIndex === -1) return;

    const newDylibs = [...dylibs];
    newDylibs[actualIndex] = { 
      ...newDylibs[actualIndex], 
      enabled: !newDylibs[actualIndex].enabled 
    };
    setDylibs(newDylibs);
    onModified();
  };

  const toggleFramework = (index: number) => {
    const newFrameworks = [...frameworks];
    newFrameworks[index] = { 
      ...newFrameworks[index], 
      enabled: !newFrameworks[index].enabled 
    };
    setFrameworks(newFrameworks);
    onModified();
  };

  const togglePlugin = (index: number) => {
    const newPlugins = [...plugins];
    newPlugins[index] = { 
      ...newPlugins[index], 
      enabled: !newPlugins[index].enabled 
    };
    setPlugins(newPlugins);
    onModified();
  };

  const hasAnyContent = visibleDylibs.length > 0 || frameworks.length > 0 || plugins.length > 0;

  return (
    <div className="h-full flex flex-col overflow-y-auto p-1">
      {!hasAnyContent ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4">
          <p className="text-sm text-gray-500 text-center">
            {t("ipaDetails.plugins.noDylibs")}
          </p>
          {hiddenDylibCount > 0 && (
            <p className="text-xs text-gray-400 text-center">
              {t("ipaDetails.plugins.hiddenSystemDylibs", {
                count: hiddenDylibCount,
                defaultValue: "{{count}} system dylibs are hidden",
              })}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Dylibs Section */}
          {visibleDylibs.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 px-2 flex items-center">
                <Code size={14} className="inline-block mr-2" />
                {t("ipaDetails.plugins.nativeDylibs")}
              </h3>
              <div className="space-y-2 border border-gray-200 rounded-lg p-2">
                {visibleDylibs.map((dylib, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-2 border border-gray-100 rounded hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0 mr-3">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {dylib.name}
                        </p>
                        {dylib.is_injected && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                            {t("ipaDetails.plugins.injected")}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate font-mono">
                        {dylib.path}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleDylib(index)}
                      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                        dylib.enabled
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-red-100 text-red-700 hover:bg-red-200"
                      }`}
                    >
                      {dylib.enabled ? (
                        <>
                          <Eye size={12} />
                          {t("ipaDetails.plugins.enabled")}
                        </>
                      ) : (
                        <>
                          <EyeOff size={12} />
                          {t("ipaDetails.plugins.disabled")}
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
              {/* Show count of hidden system dylibs */}
              {hiddenDylibCount > 0 && (
                <p className="text-xs text-gray-500 mt-2 px-2">
                  {t("ipaDetails.plugins.hiddenSystemDylibs", { count: hiddenDylibCount })}
                </p>
              )}
            </div>
          )}

          {/* Frameworks Section */}
          {frameworks.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 px-2 flex items-center">
                <Package size={14} className="inline-block mr-2" />
                {t("ipaDetails.plugins.frameworks")}
              </h3>
              <div className="space-y-2 border border-gray-200 rounded-lg p-2">
                {frameworks.map((framework, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-2 border border-gray-100 rounded hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0 mr-3">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {framework.name}
                      </p>
                      <p className="text-xs text-gray-500 truncate">{framework.path}</p>
                    </div>
                    <button
                      onClick={() => toggleFramework(index)}
                      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                        framework.enabled
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-red-100 text-red-700 hover:bg-red-200"
                      }`}
                    >
                      {framework.enabled ? (
                        <>
                          <Eye size={12} />
                          {t("ipaDetails.plugins.enabled")}
                        </>
                      ) : (
                        <>
                          <EyeOff size={12} />
                          {t("ipaDetails.plugins.disabled")}
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PlugIns Section */}
          {plugins.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 px-2 flex items-center">
                <Puzzle size={14} className="inline-block mr-2" />
                {t("ipaDetails.plugins.pluginsSection")}
              </h3>
              <div className="space-y-2 border border-gray-200 rounded-lg p-2">
                {plugins.map((plugin, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-2 border border-gray-100 rounded hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0 mr-3">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {plugin.name}
                        </p>
                        {plugin.is_appex && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                            .appex
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">{plugin.path}</p>
                      {plugin.bundle_id && (
                        <p className="text-xs text-gray-400 truncate mt-0.5 font-mono">
                          {plugin.bundle_id}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => togglePlugin(index)}
                      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                        plugin.enabled
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-red-100 text-red-700 hover:bg-red-200"
                      }`}
                    >
                      {plugin.enabled ? (
                        <>
                          <Eye size={12} />
                          {t("ipaDetails.plugins.enabled")}
                        </>
                      ) : (
                        <>
                          <EyeOff size={12} />
                          {t("ipaDetails.plugins.disabled")}
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
