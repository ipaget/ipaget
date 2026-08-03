import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useToastStore } from "../store/toastStore";
import CodeMirror from "@uiw/react-codemirror";
import { xml } from "@codemirror/lang-xml";

export default function EditorPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const { showToast } = useToastStore();
  const [content, setContent] = useState("");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (location.pathname !== "/editor") return;

      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "o") {
        e.preventDefault();
        handleOpen();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filePath, content, location.pathname]);

  const handleOpen = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Supported Files",
            extensions: ["strings", "plist", "xml"]
          },
          {
            name: "All Files",
            extensions: ["*"]
          }
        ]
      });

      if (selected && typeof selected === "string") {
        setIsLoading(true);
        const fileContent = await readTextFile(selected);
        setContent(fileContent);
        setFilePath(selected);
        
        const name = selected.split(/[\\/]/).pop() || "Untitled";
        setFileName(name);
        setIsDirty(false);
        setIsLoading(false);
        
        showToast(t("editor.fileOpened", { name }), "success");
      }
    } catch (error) {
      console.error("Failed to open file:", error);
      showToast(t("editor.openFailed"), "error");
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      let pathToSave = filePath;

      if (!pathToSave) {
        const selected = await save({
          filters: [
            {
              name: "Supported Files",
              extensions: ["strings", "plist", "xml"]
            },
            {
              name: "All Files",
              extensions: ["*"]
            }
          ]
        });

        if (!selected) return;
        pathToSave = selected;
      }

      setIsLoading(true);
      await writeTextFile(pathToSave, content);
      setFilePath(pathToSave);
      
      const name = pathToSave.split(/[\\/]/).pop() || "Untitled";
      setFileName(name);
      setIsDirty(false);
      setIsLoading(false);
      
      showToast(t("editor.fileSaved", { name }), "success");
    } catch (error) {
      console.error("Failed to save file:", error);
      showToast(t("editor.saveFailed"), "error");
      setIsLoading(false);
    }
  };

  const handleContentChange = (value: string) => {
    setContent(value);
    setIsDirty(true);
  };

  const formatXML = () => {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(content, "text/xml");
      
      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) {
        showToast(t("editor.invalidXML"), "error");
        return;
      }

      const serializer = new XMLSerializer();
      let formatted = serializer.serializeToString(xmlDoc);

      formatted = formatted.replace(/></g, ">\n<");

      const lines = formatted.split("\n");
      let indentLevel = 0;
      const indentedLines = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) {
          return "";
        }

        const isXmlDeclaration = trimmed.startsWith("<?xml");
        const isDocType = trimmed.startsWith("<!DOCTYPE");
        const isClosingTag = trimmed.startsWith("</");
        const isOpeningTag =
          trimmed.startsWith("<") &&
          !isClosingTag &&
          !trimmed.endsWith("/>") &&
          !trimmed.includes("</") &&
          !isXmlDeclaration &&
          !isDocType;

        if (isClosingTag) {
          indentLevel = Math.max(0, indentLevel - 1);
        }

        const indented = "  ".repeat(indentLevel) + trimmed;

        if (isOpeningTag) {
          indentLevel++;
        }

        return indented;
      });

      setContent(indentedLines.join("\n"));
      setIsDirty(true);
      showToast(t("editor.formatted"), "success");
    } catch (error) {
      console.error("Failed to format XML:", error);
      showToast(t("editor.formatFailed"), "error");
    }
  };

  const handleNewFile = () => {
    if (isDirty) {
      const confirmed = window.confirm(t("editor.unsavedChanges"));
      if (!confirmed) return;
    }
    
    setContent("");
    setFilePath(null);
    setFileName("");
    setIsDirty(false);
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-gray-50">
        <button
          onClick={handleNewFile}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
        >
          {t("editor.new")}
        </button>
        <button
          onClick={handleOpen}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
        >
          {t("editor.open")}
        </button>
        <button
          onClick={handleSave}
          disabled={!content && !filePath}
          className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {t("editor.save")}
        </button>
        <div className="w-px h-6 bg-gray-300 mx-1"></div>
        <button
          onClick={formatXML}
          disabled={!content}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {t("editor.format")}
        </button>
        
        {/* File info */}
        <div className="flex-1 flex items-center justify-center text-sm text-gray-600">
          {fileName && (
            <span>
              {fileName}
              {isDirty && <span className="ml-1 text-orange-600">●</span>}
            </span>
          )}
          {!fileName && (
            <span className="text-gray-400">{t("editor.noFileOpen")}</span>
          )}
        </div>

        {/* Line count */}
        {content && (
          <div className="text-sm text-gray-500">
            {t("editor.lines", { count: content.split("\n").length })}
          </div>
        )}
      </div>

      {/* Editor area */}
      <div className="flex-1 relative overflow-hidden">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-75">
            <div className="text-gray-500">{t("editor.loading")}</div>
          </div>
        ) : (
          <div className="w-full h-full p-4 bg-white">
            <CodeMirror
              value={content}
              height="100%"
              extensions={[xml()]}
              onChange={handleContentChange}
              className="w-full h-full text-sm"
            />
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-600">
        <div className="flex items-center gap-4">
          <span>{t("editor.encoding")}: UTF-8</span>
          {filePath && <span>{t("editor.path")}: {filePath}</span>}
        </div>
        <div className="text-gray-400">
          {t("editor.shortcuts")}
        </div>
      </div>
    </div>
  );
}
