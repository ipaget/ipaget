import { Fragment, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { X, Shield, Loader2, CheckCircle2, Lock, ChevronDown, ChevronUp, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUpdateEffect } from "react-use";

interface TrustDeviceDialogProps {
  isOpen: boolean;
  status: "pairing" | "device_locked" | "waiting_trust" | "success" | "timeout";
  onClose: () => void;
}

export default function TrustDeviceDialog({
  isOpen,
  status,
  onClose,
}: TrustDeviceDialogProps) {
  const { t, i18n } = useTranslation();
  // Extract base language code (e.g., 'zh' from 'zh-CN')
  const baseLang = i18n.language.split('-')[0];
  const [imageSrc, setImageSrc] = useState(`/images/trust/${baseLang}.png`);
  const [showSteps, setShowSteps] = useState(false);

  // Update image source when language changes using useUpdateEffect
  useUpdateEffect(() => {
    const newBaseLang = i18n.language.split('-')[0];
    setImageSrc(`/images/trust/${newBaseLang}.png`);
  }, [i18n.language]);

  const getStatusContent = () => {
    switch (status) {
      case "pairing":
        return {
          icon: <Loader2 className="animate-spin text-blue-600" size={48} />,
          title: t("devices.trust.initiating"),
          message: t("devices.trust.initiatingMessage"),
        };
      case "device_locked":
        return {
          icon: <Lock className="text-yellow-600 animate-pulse" size={48} />,
          title: t("devices.trust.deviceLocked"),
          message: t("devices.trust.deviceLockedMessage"),
        };
      case "waiting_trust":
        return {
          icon: <Shield className="text-orange-600 animate-pulse" size={48} />,
          title: t("devices.trust.waitingTrust"),
          message: t("devices.trust.waitingTrustMessage"),
        };
      case "success":
        return {
          icon: <CheckCircle2 className="text-green-600" size={48} />,
          title: t("devices.trust.success"),
          message: t("devices.trust.successMessage"),
        };
      case "timeout":
        return {
          icon: <AlertCircle className="text-red-600" size={48} />,
          title: t("devices.trust.timeout"),
          message: t("devices.trust.timeoutMessage"),
        };
    }
  };

  const content = getStatusContent();

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-[50]" onClose={() => {}}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black bg-opacity-40" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-center align-middle shadow-xl transition-all">
                {/* Always allow close button */}
                <button
                  type="button"
                  className="absolute top-4 right-4 inline-flex justify-center rounded-md border border-transparent bg-white text-sm font-medium text-gray-400 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                  onClick={onClose}
                >
                  <X size={20} />
                </button>

                <div className="flex flex-col items-center space-y-4">
                  {content.icon}
                  <Dialog.Title
                    as="h3"
                    className="text-xl font-semibold text-gray-900"
                  >
                    {content.title}
                  </Dialog.Title>
                  <p className="text-gray-600">{content.message}</p>

                  {(status === "device_locked" || status === "waiting_trust") && (
                    <>
                      {/* Tutorial Image */}
                      <div className="mt-4 w-full flex justify-center">
                        <img
                          src={imageSrc}
                          alt={t("devices.trust.tutorialImageAlt")}
                          className={`transition-all duration-500 ease-in-out ${showSteps ? 'max-w-[60%]' : 'max-w-[85%]'}`}
                          onError={(e) => {
                            // Fallback to English if current language image fails to load
                            if (imageSrc !== '/images/trust/en.png') {
                              setImageSrc('/images/trust/en.png');
                            } else {
                              // Hide image if even English version fails
                              e.currentTarget.style.display = 'none';
                            }
                          }}
                        />
                      </div>
                      
                      <div className="mt-4 w-full">
                        {/* Toggle Button */}
                        <button
                          onClick={() => setShowSteps(!showSteps)}
                          className="w-full flex items-center justify-center space-x-2 py-2 px-4 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                        >
                          <span className="text-base text-gray-700 font-semibold">
                            {t("devices.trust.steps")}
                          </span>
                          {showSteps ? (
                            <ChevronUp size={18} className="text-gray-600" />
                          ) : (
                            <ChevronDown size={18} className="text-gray-600" />
                          )}
                        </button>
                        
                        {/* Collapsible Steps */}
                        <div className={`overflow-hidden transition-all duration-500 ease-in-out ${showSteps ? 'max-h-64 opacity-100 mt-2' : 'max-h-0 opacity-0 mt-0'}`}>
                          <div className="space-y-1.5">
                            {/* Step 1 */}
                            <div className="flex items-center space-x-2 py-2 px-3 bg-blue-50 rounded-md transform transition-all duration-300" style={{ transitionDelay: showSteps ? '50ms' : '0ms' }}>
                              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary-600 text-white flex items-center justify-center text-[10px] font-semibold">
                                1
                              </div>
                              <span className="text-xs text-gray-800 font-semibold">{t("devices.trust.step1")}</span>
                            </div>
                            
                            {/* Step 2 */}
                            <div className="flex items-center space-x-2 py-2 px-3 bg-blue-50 rounded-md transform transition-all duration-300" style={{ transitionDelay: showSteps ? '100ms' : '0ms' }}>
                              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary-600 text-white flex items-center justify-center text-[10px] font-semibold">
                                2
                              </div>
                              <span className="text-xs text-gray-800 font-semibold">{t("devices.trust.step2")}</span>
                            </div>
                            
                            {/* Step 3 */}
                            <div className="flex items-center space-x-2 py-2 px-3 bg-blue-50 rounded-md transform transition-all duration-300" style={{ transitionDelay: showSteps ? '150ms' : '0ms' }}>
                              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary-600 text-white flex items-center justify-center text-[10px] font-semibold">
                                3
                              </div>
                              <span className="text-xs text-gray-800 font-semibold">{t("devices.trust.step3")}</span>
                            </div>
                            
                            {/* Step 4 */}
                            <div className="flex items-center space-x-2 py-2 px-3 bg-blue-50 rounded-md transform transition-all duration-300" style={{ transitionDelay: showSteps ? '200ms' : '0ms' }}>
                              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary-600 text-white flex items-center justify-center text-[10px] font-semibold">
                                4
                              </div>
                              <span className="text-xs text-gray-800 font-semibold">{t("devices.trust.step4")}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {(status === "success" || status === "timeout") && (
                    <button
                      onClick={onClose}
                      className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                    >
                      {t("common.confirm")}
                    </button>
                  )}
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
}

