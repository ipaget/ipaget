import { Fragment } from "react";
import { X, Download, Loader2 } from "lucide-react";
import { Dialog, Transition } from "@headlessui/react";
import { useTranslation } from "react-i18next";

interface FilePreviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  fileContent: string;
  fileType: "text" | "plist" | "xml";
  isLoading?: boolean;
  onDownload?: () => void;
}

export default function FilePreviewDialog({
  isOpen,
  onClose,
  fileName,
  fileContent,
  fileType,
  isLoading = false,
  onDownload,
}: FilePreviewDialogProps) {
  const { t } = useTranslation();

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-primary-600" size={40} />
        </div>
      );
    }

    if (fileType === "plist" || fileType === "xml") {
      return (
        <pre className="text-xs font-mono bg-gray-50 p-4 rounded-lg overflow-auto max-h-[60vh] whitespace-pre-wrap break-words">
          {fileContent}
        </pre>
      );
    }

    return (
      <pre className="text-sm font-mono bg-gray-50 p-4 rounded-lg overflow-auto max-h-[60vh] whitespace-pre-wrap break-words">
        {fileContent}
      </pre>
    );
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-40" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-25" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-4xl transform overflow-hidden rounded-2xl bg-white text-left align-middle shadow-xl transition-all">
                <div className="flex items-center justify-between p-6 pb-4 border-b border-gray-200">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-medium leading-6 text-gray-900 truncate flex-1 mr-4"
                  >
                    {fileName}
                  </Dialog.Title>
                  <div className="flex items-center space-x-2">
                    {onDownload && (
                      <button
                        onClick={onDownload}
                        className="text-gray-600 hover:text-primary-600 p-2 rounded-lg hover:bg-gray-100 transition-colors"
                        title={t("common.download")}
                      >
                        <Download size={20} />
                      </button>
                    )}
                    <button
                      onClick={onClose}
                      className="text-gray-400 hover:text-gray-500"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>

                <div className="p-6">{renderContent()}</div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

