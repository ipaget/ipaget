import { Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface VersionHistoryProgressDialogProps {
  appName: string;
  isOpen: boolean;
  progress: number;
  message: string;
  onClose?: () => void;
}

export default function VersionHistoryProgressDialog({
  appName,
  isOpen,
  progress,
  message,
  onClose,
}: VersionHistoryProgressDialogProps) {
  const { t } = useTranslation();

  // Calculate stroke dash offset based on progress
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress / 100);

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose || (() => {})}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-8 text-center align-middle shadow-xl transition-all">
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <Dialog.Title as="h3" className="text-lg font-semibold text-gray-900 flex-1">
                      {t('search.loadingVersionHistory')}
                    </Dialog.Title>
                    {onClose && (
                      <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <X size={20} />
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">{appName}</p>
                </div>

                {/* Circular Progress */}
                <div className="relative mx-auto mb-6" style={{ width: 160, height: 160 }}>
                  {/* Background Circle */}
                  <svg className="transform -rotate-90" width="160" height="160">
                    <circle
                      cx="80"
                      cy="80"
                      r="70"
                      stroke="#e5e7eb"
                      strokeWidth="8"
                      fill="none"
                    />
                    {/* Progress Circle */}
                    <circle
                      cx="80"
                      cy="80"
                      r="70"
                      stroke="#3b82f6"
                      strokeWidth="8"
                      fill="none"
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                      strokeLinecap="round"
                      className="transition-all duration-500 ease-out"
                    />
                  </svg>
                  
                  {/* Center Content */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <Loader2 className="animate-spin text-blue-600" size={48} />
                  </div>
                </div>

                {/* Stage Message */}
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">
                    {message || t('search.pleaseWait')}
                  </p>
                  <p className="text-xs text-gray-500">
                    {t('search.pleaseWait')}
                  </p>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}
