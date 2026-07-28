import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  FileCode2,
  FolderOpen,
  Loader2,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import PlistTreeEditor from "../components/plist/PlistTreeEditor";
import { goServiceClient } from "../lib/goService";
import {
  PlistNode,
  clonePlistNode,
  createDefaultPlistNode,
} from "../lib/plistTypes";
import { isTauriRuntime } from "../lib/runtime";
import { useErrorStore } from "../store/errorStore";
import { useToastStore } from "../store/toastStore";

const getFileName = (path: string) => path.split(/[\\/]/).pop() || path;

export default function PlistEditorPage() {
  const { t } = useTranslation();
  const location = useLocation() as { state?: { plistPath?: string } };
  const { showToast } = useToastStore();
  const { showError } = useErrorStore();

  const [filePath, setFilePath] = useState("");
  const [sourceFormat, setSourceFormat] = useState("xml");
  const [root, setRoot] = useState<PlistNode | null>(null);
  const [baselineRoot, setBaselineRoot] = useState<PlistNode | null>(null);
  const [xmlText, setXmlText] = useState("");
  const [syncedTreeXml, setSyncedTreeXml] = useState("");
  const [viewMode, setViewMode] = useState<"tree" | "xml">("tree");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSwitchingView, setIsSwitchingView] = useState(false);
  const [xmlParseError, setXmlParseError] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    const treeDirty =
      Boolean(root && baselineRoot) &&
      JSON.stringify(root) !== JSON.stringify(baselineRoot);
    const xmlDirty = xmlText !== syncedTreeXml;
    return treeDirty || xmlDirty;
  }, [root, baselineRoot, xmlText, syncedTreeXml]);

  const loadPlistFromPath = async (targetPath: string) => {
    const normalizedPath = targetPath.trim();
    if (!normalizedPath) {
      showToast(t("plist.pathRequired"), "error");
      return;
    }

    setIsLoading(true);
    try {
      const parsed = await goServiceClient.parsePlist({ path: normalizedPath });
      const nextRoot = clonePlistNode(parsed.root);
      const nextXml = parsed.xml_preview || "";
      setFilePath(normalizedPath);
      setSourceFormat(parsed.format || "xml");
      setRoot(nextRoot);
      setBaselineRoot(clonePlistNode(nextRoot));
      setXmlText(nextXml);
      setSyncedTreeXml(nextXml);
      setXmlParseError(null);
      setViewMode("tree");
      showToast(t("plist.openSuccess"), "success");
    } catch (error: any) {
      showError(t("plist.openFailed"), error.message || String(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (location.state?.plistPath) {
      void loadPlistFromPath(location.state.plistPath);
      history.replaceState({}, document.title);
    }
  }, [location.state?.plistPath]);

  const handleOpen = async () => {
    if (!isTauriRuntime()) {
      showToast(t("plist.desktopOnly"), "error");
      return;
    }
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Property List", extensions: ["plist"] }],
      });
      if (typeof selected === "string" && selected) {
        await loadPlistFromPath(selected);
      }
    } catch (error: any) {
      showError(t("plist.openFailed"), error.message || String(error));
    }
  };

  const handleCreate = () => {
    const nextRoot = createDefaultPlistNode("dict");
    setFilePath("");
    setSourceFormat("xml");
    setRoot(nextRoot);
    setBaselineRoot(clonePlistNode(nextRoot));
    setXmlText("");
    setSyncedTreeXml("");
    setXmlParseError(null);
    setViewMode("tree");
  };

  const handleReset = () => {
    if (!baselineRoot) return;
    setRoot(clonePlistNode(baselineRoot));
    setXmlText(syncedTreeXml);
    setXmlParseError(null);
    showToast(t("plist.resetDone"), "info");
  };

  const renderTreeToXml = async (treeRoot: PlistNode) => {
    const rendered = await goServiceClient.renderPlistXML(treeRoot);
    setXmlText(rendered);
    setSyncedTreeXml(rendered);
    setXmlParseError(null);
    return rendered;
  };

  const applyXmlToTree = async (xmlContent: string) => {
    const parsed = await goServiceClient.parsePlistXml(xmlContent);
    const nextRoot = clonePlistNode(parsed.root);
    const nextXml = parsed.xml_preview || xmlContent;
    setRoot(nextRoot);
    setXmlText(nextXml);
    setSyncedTreeXml(nextXml);
    if (parsed.format) {
      setSourceFormat(parsed.format);
    }
    setXmlParseError(null);
    return nextRoot;
  };

  const handleSwitchToXmlView = async () => {
    if (!root) {
      return;
    }

    setIsSwitchingView(true);
    try {
      await renderTreeToXml(root);
      setViewMode("xml");
    } catch (error: any) {
      showError(t("plist.renderXmlFailed"), error.message || String(error));
    } finally {
      setIsSwitchingView(false);
    }
  };

  const handleSwitchToTreeView = async () => {
    if (viewMode !== "xml") {
      return;
    }

    // XML matches the last tree snapshot, so no re-parse is needed.
    if (xmlText === syncedTreeXml && root) {
      setXmlParseError(null);
      setViewMode("tree");
      return;
    }

    setIsSwitchingView(true);
    try {
      await applyXmlToTree(xmlText);
      setViewMode("tree");
    } catch (error: any) {
      setXmlParseError(error.message || String(error));
      setViewMode("xml");
    } finally {
      setIsSwitchingView(false);
    }
  };

  const ensureTreeFromCurrentView = async (): Promise<PlistNode | null> => {
    if (viewMode === "xml") {
      try {
        return await applyXmlToTree(xmlText);
      } catch (error: any) {
        setXmlParseError(error.message || String(error));
        setViewMode("xml");
        return null;
      }
    }
    return root;
  };

  const writeCurrentTree = async (targetPath: string) => {
    setIsSaving(true);
    try {
      const treeRoot = await ensureTreeFromCurrentView();
      if (!treeRoot) {
        showToast(t("plist.xmlInvalidToast"), "error");
        return;
      }

      await goServiceClient.writePlist({
        path: targetPath,
        root: treeRoot,
        format: "preserve",
      });
      const reloaded = await goServiceClient.parsePlist({ path: targetPath });
      const nextRoot = clonePlistNode(reloaded.root);
      const nextXml = reloaded.xml_preview || "";
      setFilePath(targetPath);
      setSourceFormat(reloaded.format || sourceFormat);
      setRoot(nextRoot);
      setBaselineRoot(clonePlistNode(nextRoot));
      setXmlText(nextXml);
      setSyncedTreeXml(nextXml);
      setXmlParseError(null);
      showToast(t("plist.saveSuccess"), "success");
    } catch (error: any) {
      showError(t("plist.saveFailed"), error.message || String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (!root && !xmlText.trim()) return;
    if (!filePath) {
      await handleSaveAs();
      return;
    }
    await writeCurrentTree(filePath);
  };

  const handleSaveAs = async () => {
    if (!root && !xmlText.trim()) return;
    if (!isTauriRuntime()) {
      showToast(t("plist.desktopOnly"), "error");
      return;
    }
    try {
      const defaultName = filePath ? getFileName(filePath) : "Untitled.plist";
      const target = await save({
        defaultPath: defaultName,
        filters: [{ name: "Property List", extensions: ["plist"] }],
      });
      if (!target) return;
      await writeCurrentTree(target);
    } catch (error: any) {
      showError(t("plist.saveFailed"), error.message || String(error));
    }
  };

  const formatBadgeLabel = (formatName: string) => {
    const key = `plist.formats.${formatName}`;
    const translated = t(key);
    return translated === key ? formatName.toUpperCase() : translated;
  };

  const hasContent = Boolean(root) || Boolean(xmlText.trim());

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-5">
      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold text-gray-900">{t("plist.title")}</h1>
              {isDirty && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                  {t("plist.modified")}
                </span>
              )}
              {hasContent && (
                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                  {formatBadgeLabel(sourceFormat)}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">{t("plist.subtitle")}</p>
            <p className="mt-2 truncate text-xs text-gray-500" title={filePath || undefined}>
              {filePath || t("plist.noFile")}
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
            <button
              type="button"
              onClick={() => void handleOpen()}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              <FolderOpen size={16} />
              {t("plist.open")}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              <FileCode2 size={16} />
              {t("plist.new")}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={!isDirty || isSaving}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw size={16} />
              {t("plist.reset")}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!hasContent || isSaving}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-3 text-sm font-medium text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {t("plist.save")}
            </button>
            <button
              type="button"
              onClick={() => void handleSaveAs()}
              disabled={!hasContent || isSaving}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("plist.saveAs")}
            </button>

            <div className="ml-auto flex h-10 items-center rounded-lg border border-gray-300 p-1">
              <button
                type="button"
                onClick={() => void handleSwitchToTreeView()}
                disabled={!hasContent || isSwitchingView}
                className={`inline-flex h-8 items-center justify-center rounded-md px-3 text-sm leading-none disabled:cursor-not-allowed disabled:opacity-40 ${
                  viewMode === "tree" ? "bg-primary-50 text-primary-700" : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {t("plist.view.tree")}
              </button>
              <button
                type="button"
                onClick={() => void handleSwitchToXmlView()}
                disabled={!root || isSwitchingView}
                className={`inline-flex h-8 items-center justify-center rounded-md px-3 text-sm leading-none disabled:cursor-not-allowed disabled:opacity-40 ${
                  viewMode === "xml" ? "bg-primary-50 text-primary-700" : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {isSwitchingView && viewMode === "tree" ? t("plist.loading") : t("plist.view.xml")}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-gray-200 bg-white">
            <div className="flex flex-col items-center gap-3 text-gray-500">
              <Loader2 className="animate-spin text-primary-600" size={32} />
              <p className="text-sm">{t("plist.loading")}</p>
            </div>
          </div>
        ) : !hasContent ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
            <div className="max-w-md">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
                <FileCode2 size={26} />
              </div>
              <h2 className="mt-4 text-base font-semibold text-gray-900">{t("plist.emptyTitle")}</h2>
              <p className="mt-2 text-sm text-gray-500">{t("plist.emptyDesc")}</p>
              <div className="mt-5 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleOpen()}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white transition hover:bg-primary-700"
                >
                  <FolderOpen size={16} />
                  {t("plist.open")}
                </button>
                <button
                  type="button"
                  onClick={handleCreate}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  {t("plist.new")}
                </button>
              </div>
            </div>
          </div>
        ) : viewMode === "xml" ? (
          <div className="relative h-full overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
              <p className="text-sm font-medium text-gray-800">{t("plist.xmlEditorTitle")}</p>
              <p className="text-xs text-gray-500">{t("plist.xmlEditorHint")}</p>
            </div>
            <textarea
              value={xmlText}
              onChange={(event) => {
                setXmlText(event.target.value);
                if (xmlParseError) {
                  setXmlParseError(null);
                }
              }}
              spellCheck={false}
              className="h-[calc(100%-58px)] w-full resize-none border-0 bg-white p-4 font-mono text-xs leading-5 text-gray-800 outline-none focus:ring-0"
              placeholder={t("plist.xmlPreviewEmpty")}
            />

            {xmlParseError && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/75 p-6 backdrop-blur-[1px]">
                <div className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-5 shadow-xl">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-full bg-red-50 p-2 text-red-600">
                      <AlertCircle size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-gray-900">{t("plist.xmlParseErrorTitle")}</p>
                      <p className="mt-1 text-sm text-gray-600">{t("plist.xmlParseErrorDesc")}</p>
                      <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-red-50 p-3 font-mono text-xs leading-5 text-red-700 whitespace-pre-wrap break-words">
                        {xmlParseError}
                      </pre>
                      <button
                        type="button"
                        onClick={() => setXmlParseError(null)}
                        className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                      >
                        <X size={14} />
                        {t("plist.dismissError")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {isSwitchingView && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/50">
                <Loader2 className="animate-spin text-primary-600" size={28} />
              </div>
            )}
          </div>
        ) : root ? (
          <PlistTreeEditor root={root} onChange={setRoot} />
        ) : null}
      </div>
    </div>
  );
}
