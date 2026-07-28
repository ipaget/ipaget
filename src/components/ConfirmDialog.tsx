import { Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { AlertTriangle } from "lucide-react";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  type?: "danger" | "warning" | "info";
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  type = "warning",
}: ConfirmDialogProps) {
  const getColorClasses = () => {
    switch (type) {
      case "danger":
        return {
          icon: "text-red-600",
          iconBg: "bg-red-100",
          button: "bg-red-600 hover:bg-red-700 focus:ring-red-500",
        };
      case "warning":
        return {
          icon: "text-orange-600",
          iconBg: "bg-orange-100",
          button: "bg-orange-600 hover:bg-orange-700 focus:ring-orange-500",
        };
      case "info":
        return {
          icon: "text-blue-600",
          iconBg: "bg-blue-100",
          button: "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500",
        };
    }
  };

  const colors = getColorClasses();

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[50]" onClose={onCancel}>
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
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white shadow-xl transition-all">
                <div className="p-6">
                  {/* Icon and Title */}
                  <div className="flex items-start space-x-4">
                    <div className={`flex-shrink-0 w-12 h-12 rounded-full ${colors.iconBg} flex items-center justify-center`}>
                      <AlertTriangle className={colors.icon} size={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900 mb-2">
                        {title}
                      </Dialog.Title>
                      <Dialog.Description className="text-sm text-gray-600">
                        {message}
                      </Dialog.Description>
                    </div>
                  </div>

                  {/* Buttons */}
                  <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end space-y-3 space-y-reverse sm:space-y-0 sm:space-x-3">
                    <button
                      type="button"
                      onClick={onCancel}
                      className="w-full sm:w-auto px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                    >
                      {cancelText}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onConfirm();
                        onCancel(); // Close dialog after confirm
                      }}
                      className={`w-full sm:w-auto px-4 py-2.5 text-white rounded-lg transition-colors font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 ${colors.button}`}
                    >
                      {confirmText}
                    </button>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

