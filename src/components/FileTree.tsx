import { useState, useCallback } from "react";
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, Download, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import FilePreviewDialog from "./FilePreviewDialog";
import { goServiceClient } from "../lib/goService";
import { isTauriRuntime } from "../lib/runtime";
import { useErrorStore } from "../store/errorStore";

interface FileItem {
  path: string;
  size: number;
  is_directory: boolean;
}

interface FileNode {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  children: FileNode[];
  expanded?: boolean;
}

interface FileTreeProps {
  files: FileItem[];
  ipaPath: string;
}

function buildFileTree(files: FileItem[]): FileNode[] {
  const root: FileNode = {
    name: "",
    path: "",
    is_directory: true,
    size: 0,
    children: [],
  };

  files.forEach((file) => {
    const parts = file.path.split("/").filter(Boolean);
    let currentNode = root;

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      let child = currentNode.children.find((c) => c.name === part);

      if (!child) {
        child = {
          name: part,
          path: parts.slice(0, index + 1).join("/"),
          is_directory: isLast ? file.is_directory : true,
          size: isLast && !file.is_directory ? file.size : 0,
          children: [],
        };
        currentNode.children.push(child);
      }

      if (!isLast || file.is_directory) {
        currentNode = child;
      }
    });
  });

  const sortNodes = (nodes: FileNode[]) => {
    nodes.sort((a, b) => {
      if (a.is_directory && !b.is_directory) return -1;
      if (!a.is_directory && b.is_directory) return 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((node) => {
      if (node.children.length > 0) {
        sortNodes(node.children);
      }
    });
  };

  sortNodes(root.children);

  return root.children;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(2)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

interface FileNodeItemProps {
  node: FileNode;
  level: number;
  onToggle: (path: string) => void;
  expandedPaths: Set<string>;
  selectedPaths: Set<string>;
  onSelect: (path: string, ctrlKey: boolean) => void;
  onDoubleClick: (node: FileNode) => void;
}

function FileNodeItem({ 
  node, 
  level, 
  onToggle, 
  expandedPaths,
  selectedPaths,
  onSelect,
  onDoubleClick,
}: FileNodeItemProps) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = selectedPaths.has(node.path);
  const hasChildren = node.children.length > 0;
  const [clickTimeout, setClickTimeout] = useState<number | null>(null);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (clickTimeout) {
      clearTimeout(clickTimeout);
      setClickTimeout(null);
      if (!node.is_directory) {
        onDoubleClick(node);
      }
      return;
    }

    const timeout = window.setTimeout(() => {
      setClickTimeout(null);
      if (node.is_directory && hasChildren) {
        if (!e.ctrlKey && !e.metaKey) {
          onToggle(node.path);
        }
      }
      onSelect(node.path, e.ctrlKey || e.metaKey);
    }, 200);

    setClickTimeout(timeout);
  };

  return (
    <div>
      <div
        className={`flex items-center px-3 py-1.5 cursor-pointer transition-colors ${
          isSelected 
            ? 'bg-primary-100 hover:bg-primary-200' 
            : 'hover:bg-gray-50'
        }`}
        style={{ paddingLeft: `${level * 20 + 12}px` }}
        onClick={handleClick}
      >
        <div className="flex items-center flex-1 min-w-0">
          {node.is_directory ? (
            <>
              {hasChildren ? (
                <div className="mr-1 flex-shrink-0">
                  {isExpanded ? (
                    <ChevronDown size={16} className="text-gray-500" />
                  ) : (
                    <ChevronRight size={16} className="text-gray-500" />
                  )}
                </div>
              ) : (
                <div className="mr-1 w-4 flex-shrink-0" />
              )}
              <div className="mr-2 flex-shrink-0">
                {isExpanded ? (
                  <FolderOpen size={16} className="text-blue-500" />
                ) : (
                  <Folder size={16} className="text-blue-500" />
                )}
              </div>
            </>
          ) : (
            <>
              <div className="mr-1 w-4 flex-shrink-0" />
              <File size={16} className="text-gray-400 mr-2 flex-shrink-0" />
            </>
          )}
          <span className="text-sm text-gray-900 truncate font-mono">{node.name}</span>
        </div>
        {!node.is_directory && (
          <span className="text-xs text-gray-500 ml-4 flex-shrink-0">
            {formatSize(node.size)}
          </span>
        )}
      </div>
      {node.is_directory && isExpanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <FileNodeItem
              key={child.path}
              node={child}
              level={level + 1}
              onToggle={onToggle}
              expandedPaths={expandedPaths}
              selectedPaths={selectedPaths}
              onSelect={onSelect}
              onDoubleClick={onDoubleClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FileTree({ files, ipaPath }: FileTreeProps) {
  const { t } = useTranslation();
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<{ name: string; content: string; type: "text" | "plist" | "xml" } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const { showError } = useErrorStore();
  const fileTree = buildFileTree(files);

  const handleToggle = (path: string) => {
    setExpandedPaths((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const handleSelect = (path: string, ctrlKey: boolean) => {
    setSelectedPaths((prev) => {
      const newSet = new Set(prev);
      if (ctrlKey) {
        if (newSet.has(path)) {
          newSet.delete(path);
        } else {
          newSet.add(path);
        }
      } else {
        newSet.clear();
        newSet.add(path);
      }
      return newSet;
    });
  };

  const downloadFile = useCallback(async (filePath: string) => {
    try {
      if (!isTauriRuntime()) {
        showError("file_download_failed", "Extracting files is available in the desktop app.");
        return;
      }
      const downloadDir = await invoke<string>("get_download_dir");
      const outputDir = `${downloadDir}\\iPAGetExtracted`;
      
      console.log('[FileTree] Download dir:', downloadDir);
      console.log('[FileTree] Output dir:', outputDir);
      
      const extractedFiles = await goServiceClient.extractFilesFromIpa(ipaPath, [filePath], outputDir);
      
      console.log('[FileTree] Extracted files:', extractedFiles);
      
      if (extractedFiles.length > 0) {
        console.log('[FileTree] Opening file:', extractedFiles[0]);
        // For single file, open and select the file
        await invoke("show_in_folder", { path: extractedFiles[0] });
      }
    } catch (error: any) {
      const message = error.message || "Failed to download file";
      showError("file_download_failed", message);
    }
  }, [ipaPath, showError]);

  const handleDoubleClick = useCallback(async (node: FileNode) => {
    if (node.is_directory) return;

    const ext = node.name.split('.').pop()?.toLowerCase();
    const textExtensions = ['txt', 'md', 'json', 'log', 'xml', 'plist', 'html', 'css', 'js', 'ts', 'jsx', 'tsx', 'sh', 'py', 'go', 'c', 'cpp', 'h', 'hpp', 'swift', 'kt', 'java'];
    
    if (ext && textExtensions.includes(ext)) {
      setIsLoadingPreview(true);
      setPreviewFile({ name: node.name, content: "", type: ext === 'plist' || ext === 'xml' ? ext : 'text' });
      
      try {
        const content = await goServiceClient.extractFileFromIpa(ipaPath, node.path);
        setPreviewFile({ name: node.name, content, type: ext === 'plist' || ext === 'xml' ? ext : 'text' });
      } catch (error: any) {
        console.error("Failed to extract file:", error);
        const message = error.message || "Failed to extract file";
        showError("file_extraction_failed", message);
        setPreviewFile(null);
      } finally {
        setIsLoadingPreview(false);
      }
    } else {
      await downloadFile(node.path);
    }
  }, [ipaPath, downloadFile, showError]);

  const handleDownloadSelected = useCallback(async () => {
    if (selectedPaths.size === 0) return;
    
    const pathsToExtract = Array.from(selectedPaths);
    
    setIsExtracting(true);
    try {
      if (!isTauriRuntime()) {
        showError("file_download_failed", "Extracting files is available in the desktop app.");
        return;
      }
      const downloadDir = await invoke<string>("get_download_dir");
      const outputDir = `${downloadDir}\\iPAGetExtracted`;
      
      console.log('[FileTree] Batch download dir:', downloadDir);
      console.log('[FileTree] Batch output dir:', outputDir);
      console.log('[FileTree] Paths to extract:', pathsToExtract);
      
      const extractedFiles = await goServiceClient.extractFilesFromIpa(ipaPath, pathsToExtract, outputDir);
      
      console.log('[FileTree] Batch extracted files:', extractedFiles);
      
      if (extractedFiles.length > 0) {
        // Always select the first file to show where files are extracted
        console.log('[FileTree] Opening file:', extractedFiles[0]);
        await invoke("show_in_folder", { path: extractedFiles[0] });
      }
    } catch (error: any) {
      console.error('[FileTree] Batch download error:', error);
      const message = error.message || "Failed to extract files";
      showError("files_extraction_failed", message);
    } finally {
      setIsExtracting(false);
    }
  }, [selectedPaths, ipaPath, showError]);

  const handleExpandAll = () => {
    const allPaths = new Set<string>();
    const collectPaths = (nodes: FileNode[]) => {
      nodes.forEach((node) => {
        if (node.is_directory && node.children.length > 0) {
          allPaths.add(node.path);
          collectPaths(node.children);
        }
      });
    };
    collectPaths(fileTree);
    setExpandedPaths(allPaths);
  };

  const handleCollapseAll = () => {
    setExpandedPaths(new Set());
  };

  const totalFiles = files.filter((f) => !f.is_directory).length;
  const totalDirs = files.filter((f) => f.is_directory).length;
  const selectedCount = selectedPaths.size;

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="sticky top-0 bg-white border-b border-gray-200 pb-2 mb-2 px-3 pt-1">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-600">
              {totalDirs} {t("ipaDetails.fileTree.folders")}, {totalFiles} {t("ipaDetails.fileTree.files")}
              {selectedPaths.size > 0 && (
                <span className="ml-2 text-primary-600">
                  ({selectedPaths.size} {t("ipaDetails.fileTree.selected")})
                </span>
              )}
            </p>
            <div className="flex space-x-2">
              {selectedPaths.size > 0 && (
                <button
                  onClick={handleDownloadSelected}
                  disabled={isExtracting}
                  className="flex items-center space-x-1 text-xs text-white bg-primary-600 hover:bg-primary-700 px-3 py-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExtracting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>{t("ipaDetails.fileTree.extracting")}</span>
                    </>
                  ) : (
                    <>
                      <Download size={14} />
                      <span>{t("ipaDetails.fileTree.download")} ({selectedCount})</span>
                    </>
                  )}
                </button>
              )}
              <button
                onClick={handleExpandAll}
                className="text-xs text-primary-600 hover:text-primary-700 px-2 py-1 rounded hover:bg-primary-50 transition-colors"
              >
                {t("ipaDetails.fileTree.expandAll")}
              </button>
              <button
                onClick={handleCollapseAll}
                className="text-xs text-primary-600 hover:text-primary-700 px-2 py-1 rounded hover:bg-primary-50 transition-colors"
              >
                {t("ipaDetails.fileTree.collapseAll")}
              </button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {fileTree.map((node) => (
            <FileNodeItem
              key={node.path}
              node={node}
              level={0}
              onToggle={handleToggle}
              expandedPaths={expandedPaths}
              selectedPaths={selectedPaths}
              onSelect={handleSelect}
              onDoubleClick={handleDoubleClick}
            />
          ))}
        </div>
      </div>

      {previewFile && (
        <FilePreviewDialog
          isOpen={true}
          onClose={() => setPreviewFile(null)}
          fileName={previewFile.name}
          fileContent={previewFile.content}
          fileType={previewFile.type}
          isLoading={isLoadingPreview}
          onDownload={() => {
            const selectedFile = files.find(f => f.path.endsWith(previewFile.name));
            if (selectedFile) {
              downloadFile(selectedFile.path);
            }
          }}
        />
      )}
    </>
  );
}

