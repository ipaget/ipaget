import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Upload, Trash2, Settings } from "lucide-react";
import { SigningOptions, InjectPath, InjectFolder } from "../lib/goService";

interface TweaksConfigViewProps {
  options: SigningOptions;
  onOptionsChange: (options: SigningOptions) => void;
}

/**
 * Tweaks Configuration Component
 * Similar to Feather's SigningTweaksView
 * 
 * Features:
 * - Injection Path selection (@executable_path / @rpath)
 * - Injection Folder selection (Root / Frameworks)
 * - Import dylib/deb files for injection
 * - Manage injection file list
 */
export default function TweaksConfigView({
  options,
  onOptionsChange,
}: TweaksConfigViewProps) {
  const { t } = useTranslation();
  const [isImporting, setIsImporting] = useState(false);

  const handleInjectPathChange = (path: InjectPath) => {
    onOptionsChange({
      ...options,
      inject_path: path,
    });
  };

  const handleInjectFolderChange = (folder: InjectFolder) => {
    onOptionsChange({
      ...options,
      inject_folder: folder,
    });
  };

  const handleImportFiles = async () => {
    setIsImporting(true);
    try {
      // const selected = await open({
      //   multiple: true,
      //   filters: [{ name: 'Tweaks', extensions: ['dylib', 'deb'] }]
      // });
      // if (selected) {
      //   onOptionsChange({
      //     ...options,
      //     injection_files: [...options.injection_files, ...selected]
      //   });
      // }
    } finally {
      setIsImporting(false);
    }
  };

  const injectionFiles = options.injection_files ?? [];

  const handleRemoveFile = (index: number) => {
    const newFiles = injectionFiles.filter((_, i) => i !== index);
    onOptionsChange({
      ...options,
      injection_files: newFiles,
    });
  };

  return (
    <div className="space-y-6 p-4">
      {/* Injection Options Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Settings size={16} />
          <span>{t("ipaDetails.plugins.injectPath")}</span>
        </div>

        {/* Injection Path Selector */}
        <div className="space-y-2">
          <label className="text-xs text-gray-600">
            {t("ipaDetails.plugins.injectPath")}
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => handleInjectPathChange("@executable_path")}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                options.inject_path === "@executable_path"
                  ? "bg-primary-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {t("ipaDetails.plugins.executablePath")}
            </button>
            <button
              onClick={() => handleInjectPathChange("@rpath")}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                options.inject_path === "@rpath"
                  ? "bg-primary-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {t("ipaDetails.plugins.rpath")}
            </button>
          </div>
        </div>

        {/* Injection Folder Selector */}
        <div className="space-y-2">
          <label className="text-xs text-gray-600">
            {t("ipaDetails.plugins.injectFolder")}
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => handleInjectFolderChange("/")}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                options.inject_folder === "/"
                  ? "bg-primary-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {t("ipaDetails.plugins.root")}
            </button>
            <button
              onClick={() => handleInjectFolderChange("/Frameworks/")}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                options.inject_folder === "/Frameworks/"
                  ? "bg-primary-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {t("ipaDetails.plugins.frameworksFolder")}
            </button>
          </div>
        </div>
      </div>

      {/* Injection Files Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Upload size={16} />
            <span>{t("ipaDetails.plugins.tweaks")}</span>
          </div>
          <button
            onClick={handleImportFiles}
            disabled={isImporting}
            className="flex items-center gap-2 px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50"
          >
            <Upload size={14} />
            {t("ipaDetails.plugins.import")}
          </button>
        </div>

        {/* Files List */}
        {injectionFiles.length > 0 ? (
          <div className="space-y-2 border border-gray-200 rounded-lg p-2">
            {injectionFiles.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 border border-gray-100 rounded hover:bg-gray-50"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {file.split("/").pop() || file}
                  </p>
                  <p className="text-xs text-gray-500 truncate font-mono">
                    {file}
                  </p>
                </div>
                <button
                  onClick={() => handleRemoveFile(index)}
                  className="ml-2 p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 border border-dashed border-gray-300 rounded-lg">
            <p className="text-sm text-gray-500">
              {t("ipaDetails.plugins.noTweaks")}
            </p>
          </div>
        )}
      </div>

      {/* Info Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
        <p className="text-xs text-blue-700">
          💡 {t("ipaDetails.plugins.dylibsDesc")}
        </p>
      </div>
    </div>
  );
}

