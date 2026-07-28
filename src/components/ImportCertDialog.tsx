import { useState, useRef, Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, Transition } from "@headlessui/react";
import { X, Upload, Key, FileKey } from "lucide-react";
import { useErrorStore } from "../store/errorStore";
import { useCertificateStore } from "../store/certificateStore";
import { useAccountStore } from "../store/accountStore";
import { goServiceClient } from "../lib/goService";
import CustomSelect from "./CustomSelect";

interface ImportCertDialogProps {
  type: "p12" | "free";
  onClose: () => void;
  onSuccess: () => void;
}

export default function ImportCertDialog({
  type,
  onClose,
  onSuccess,
}: ImportCertDialogProps) {
  const { t } = useTranslation();
  const { showError } = useErrorStore();
  const { importP12Certificate } = useCertificateStore();
  const [loading, setLoading] = useState(false);

  // P12 import state
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [p12File, setP12File] = useState<File | null>(null);
  const [provisionFile, setProvisionFile] = useState<File | null>(null);
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Free signing state
  const [selectedAccountEmail, setSelectedAccountEmail] = useState<string>("");
  const { accounts, setShowLoginDialog } = useAccountStore();

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix
        const base64 = result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleP12Submit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Handle ZIP file separately
    if (zipFile) {
      // If password input is not shown yet, show it now
      if (!showPasswordInput) {
        setShowPasswordInput(true);
        return;
      }

      try {
        setLoading(true);
        const zipData = await readFileAsBase64(zipFile);

        await importP12Certificate({
          name: name || zipFile.name.replace(/\.zip$/i, ""),
          zipData,
          password,
          isDefault,
        });

        onSuccess();
      } catch (error: any) {
        console.error("Failed to import certificate from ZIP:", error);
        // Check if error message indicates missing files
        const errMsg = error.message || error.toString();
        if (errMsg.includes("missing") || errMsg.includes("not found")) {
          showError(t("signing.import.error"), errMsg);
        } else {
          showError(t("signing.import.error"), errMsg);
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    // Validate separate P12 and provision files
    if (!p12File && !provisionFile) {
      showError(t("signing.import.error"), t("signing.import.selectFiles"));
      return;
    }

    if (!p12File) {
      showError(t("signing.import.error"), t("signing.import.needP12"));
      return;
    }

    if (!provisionFile) {
      showError(t("signing.import.error"), t("signing.import.needProvision"));
      return;
    }

    // If password input is not shown yet, show it now
    if (!showPasswordInput) {
      setShowPasswordInput(true);
      return;
    }

    if (!password) {
      showError(t("signing.import.error"), t("signing.import.passwordRequired"));
      return;
    }

    try {
      setLoading(true);

      // Read files as base64
      const p12Data = await readFileAsBase64(p12File);
      const provisionData = await readFileAsBase64(provisionFile);

      await importP12Certificate({
        name: name || p12File.name.replace(/\.(p12|pfx)$/i, ""),
        p12Data,
        provisionData,
        password,
        isDefault,
      });

      onSuccess();
    } catch (error: any) {
      console.error("Failed to import P12 certificate:", error);
      showError(t("signing.import.error"), error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFreeSignSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    // If using an existing account
    const accountEmail = selectedAccountEmail || (accounts.length > 0 ? accounts[0].email : "");
    
    if (!accountEmail) {
      showError(t("signing.import.error"), t("signing.import.noAccountSelected"));
      return;
    }

    try {
      setLoading(true);

      // Auto-generate certificate name from email
      const certName = `Free Sign (${accountEmail})`;

      await goServiceClient.importFreeSignCertificate({
        name: certName,
        apple_id: accountEmail,
        password: "", // Not needed for existing account
        is_default: true, // Always set as default for free sign
      });

      onSuccess();
    } catch (error: any) {
      console.error("Failed to import free signing certificate:", error);
      showError(t("signing.import.error"), error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Transition appear show={true} as={Fragment}>
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
          <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm" />
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
              <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-3xl bg-white shadow-2xl transition-all relative border border-gray-100">
                <button
                  onClick={onClose}
                  className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X size={24} />
                </button>

                {/* Content */}
                <div className="p-8 max-h-[90vh] overflow-y-auto">
                  <div className="text-center mb-8">
                    <Dialog.Title as="h2" className="text-2xl font-bold text-gray-900 flex items-center justify-center gap-2">
                      {type === "p12" ? (
                        <>
                          <FileKey className="w-6 h-6" />
                          {t("signing.import.p12Title")}
                        </>
                      ) : (
                        <>
                          <Key className="w-6 h-6" />
                          {t("signing.import.freeTitle")}
                        </>
                      )}
                    </Dialog.Title>
                  </div>
          {type === "p12" ? (
            <form onSubmit={handleP12Submit} className="space-y-6">
              {/* File Drop Zone */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".p12,.pfx,.mobileprovision,.zip"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const ext = file.name.toLowerCase();
                      if (ext.endsWith('.zip')) {
                        setZipFile(file);
                        // Clear other files when zip is selected
                        setP12File(null);
                        setProvisionFile(null);
                      } else if (ext.endsWith('.p12') || ext.endsWith('.pfx')) {
                        setP12File(file);
                        // Clear zip when individual files are selected
                        setZipFile(null);
                      } else if (ext.endsWith('.mobileprovision')) {
                        setProvisionFile(file);
                        // Clear zip when individual files are selected
                        setZipFile(null);
                      }
                    }
                    // Reset input to allow selecting the same file again
                    e.target.value = '';
                  }}
                  className="hidden"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full min-h-[200px] px-6 py-8 border-2 border-dashed border-gray-300 rounded-lg hover:border-primary-500 hover:bg-primary-50 transition-all flex flex-col items-center justify-center gap-3 text-gray-600"
                  disabled={loading}
                >
                  <Upload className="w-12 h-12 text-gray-400" />
                  <div className="text-center">
                    <p className="text-base font-medium text-gray-700 mb-1">
                      {zipFile ? t("signing.import.zipSelected") :
                       !p12File && !provisionFile ? t("signing.import.selectFiles") :
                       p12File && !provisionFile ? t("signing.import.needProvision") :
                       !p12File && provisionFile ? t("signing.import.needP12") :
                       t("signing.import.filesReady")}
                    </p>
                    <p className="text-sm text-gray-500">
                      {t("signing.import.supportedFormats")}
                    </p>
                  </div>
                  {(zipFile || p12File || provisionFile) && (
                    <div className="mt-2 space-y-1 text-sm">
                      {zipFile && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-800 rounded">
                          <FileKey className="w-4 h-4" />
                          {zipFile.name}
                        </div>
                      )}
                      {p12File && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-green-100 text-green-800 rounded">
                          <FileKey className="w-4 h-4" />
                          {p12File.name}
                        </div>
                      )}
                      {provisionFile && (
                        <div className="flex items-center gap-2 px-3 py-1 bg-green-100 text-green-800 rounded">
                          <FileKey className="w-4 h-4" />
                          {provisionFile.name}
                        </div>
                      )}
                    </div>
                  )}
                </button>
              </div>

              {/* Password Input - Only show when needed */}
              {showPasswordInput && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t("signing.import.password")} *
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                    placeholder={t("signing.import.passwordPlaceholder")}
                    disabled={loading}
                    autoFocus
                  />
                </div>
              )}

              {/* Certificate Name - Optional, at bottom */}
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-2">
                  {t("signing.import.name")} ({t("common.optional")})
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                  placeholder={t("signing.import.namePlaceholder")}
                  disabled={loading}
                />
              </div>

              {/* Set as default */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  disabled={loading}
                />
                <label htmlFor="isDefault" className="text-sm text-gray-700">
                  {t("signing.import.setAsDefault")}
                </label>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                  disabled={loading}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={loading}
                >
                  {loading ? t("common.importing") : t("common.import")}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-6">
              {/* Option A: Use Existing Account */}
              {accounts.length > 0 && (
                <div>
                  <h3 className="text-base font-medium text-gray-900 mb-3">
                    {t("signing.import.useExistingAccount")}
                  </h3>
                  <div className="flex gap-3">
                    <CustomSelect
                      options={accounts.map((account) => ({
                        value: account.email,
                        label: account.email,
                      }))}
                      value={selectedAccountEmail || accounts[0].email}
                      onChange={(value) => setSelectedAccountEmail(value)}
                      disabled={loading}
                      className="flex-1"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        if (!selectedAccountEmail) {
                          setSelectedAccountEmail(accounts[0].email);
                        }
                        handleFreeSignSubmit(e as any);
                      }}
                      className="px-6 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      disabled={loading}
                    >
                      {loading ? t("common.importing") : t("signing.import.generateCert")}
                    </button>
                  </div>
                </div>
              )}

              {/* Divider with "OR" */}
              {accounts.length > 0 && (
                <div className="relative flex items-center">
                  <div className="flex-grow border-t border-gray-300"></div>
                  <span className="flex-shrink mx-4 text-gray-500 font-medium">{t("common.or")}</span>
                  <div className="flex-grow border-t border-gray-300"></div>
                </div>
              )}

              {/* Option B: Login to New Account */}
              <div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    setShowLoginDialog(true, undefined, "certificate");
                  }}
                  className="w-full px-6 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
                  disabled={loading}
                >
                  {t("signing.import.loginNewAccountDesc")}
                </button>
              </div>

              {/* Cancel button */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                  disabled={loading}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
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

