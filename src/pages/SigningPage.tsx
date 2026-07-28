import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { Trash2, Star, Calendar, Key, Shield, Download, Plus } from "lucide-react";
import { useToastStore } from "../store/toastStore";
import { useErrorStore } from "../store/errorStore";
import { useCertificateStore } from "../store/certificateStore";
import { useAccountStore } from "../store/accountStore";
import ConfirmDialog from "../components/ConfirmDialog";
import ImportCertDialog from "../components/ImportCertDialog";
import PageLoading from "../components/PageLoading";

interface DeleteTarget {
  id: string;
  name: string;
}

export default function SigningPage() {
  const { t } = useTranslation();
  const { showToast } = useToastStore();
  const { showError } = useErrorStore();
  const { 
    certificates, 
    isLoading, 
    loadCertificates, 
    deleteCertificate, 
	setDefaultCertificate,
	exportCertificate,
  } = useCertificateStore();
  const { accounts, setShowLoginDialog } = useAccountStore();
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importType, setImportType] = useState<"p12" | "free">("p12");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deletingCertificateId, setDeletingCertificateId] = useState<string | null>(null);

  useEffect(() => {
    loadCertificates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeleteClick = (id: string, name: string) => {
    if (deletingCertificateId) {
      return;
    }

    setDeleteTarget({ id, name });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget || deletingCertificateId) {
      return;
    }

    try {
      setDeletingCertificateId(deleteTarget.id);
      await deleteCertificate(deleteTarget.id);
      showToast(t("signing.deleteSuccess"), "success");
      setDeleteTarget(null);
    } catch (error: any) {
      console.error("Failed to delete certificate:", error);
      showError(t("signing.deleteError"), error.message);
    } finally {
      setDeletingCertificateId(null);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultCertificate(id);
      showToast(t("signing.setDefaultSuccess"), "success");
    } catch (error: any) {
      console.error("Failed to set default certificate:", error);
      showError(t("signing.setDefaultError"), error.message);
    }
  };

  const handleImportSuccess = () => {
    setShowImportDialog(false);
    loadCertificates();
    showToast(t("signing.importSuccess"), "success");
  };

  const handleExport = async (id: string) => {
  try {
    const exported = await exportCertificate(id);
    const fileExtension = exported.fileName.split(".").pop()?.toLowerCase() || "p12";
    const filterName = fileExtension === "zip" ? "Certificate Archive" : "P12 Certificate";
    const target = await save({
    defaultPath: exported.fileName,
    filters: [
      {
      name: filterName,
      extensions: [fileExtension],
      },
    ],
    });
    if (!target) {
    return;
    }

    await writeFile(target, exported.data);
    showToast(t("signing.exportSuccess"), "success");
  } catch (error: any) {
    console.error("Failed to export certificate:", error);
    showError(t("signing.exportError"), error.message);
  }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getExpiryColor = (days: number, isExpired: boolean) => {
    if (isExpired) return "text-red-600";
    if (days <= 7) return "text-orange-600";
    if (days <= 30) return "text-yellow-600";
    return "text-green-600";
  };

  const shouldShowExpiryWarning = (days: number, isExpired: boolean) => {
    return isExpired || days <= 30;
  };

  const getExpiryText = (days: number, isExpired: boolean) => {
    if (isExpired) return t("signing.expired");
    if (days === 0) return t("signing.expiringToday");
    if (days === 1) return t("signing.expiringTomorrow");
    return t("signing.daysLeft", { days });
  };

  const getCertificateTypeText = (cert: (typeof certificates)[number]) => {
    if (cert.type === "free_sign") {
      return t("signing.appleIdCertificate");
    }

    return t("signing.importedP12");
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      {certificates.length > 0 && (
        <div className="mb-4 px-6 pb-0 pt-8 md:px-12 md:pt-12">
          <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-bold text-gray-900 mb-2">
                {t("signing.title")}
              </h2>
              <p className="text-sm text-gray-500 md:text-base">
                {t("signing.subtitle")}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:flex-nowrap lg:justify-end">
              <button
                onClick={() => {
                  setImportType("p12");
                  setShowImportDialog(true);
                }}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition-all hover:border-gray-300 hover:bg-gray-50"
              >
                <Plus className="w-4 h-4" />
                {t("signing.importP12")}
              </button>
              <button
                onClick={() => {
                  if (accounts.length === 0) {
                    setShowLoginDialog(true, undefined, "certificate");
                    return;
                  }
                  setImportType("free");
                  setShowImportDialog(true);
                }}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-medium text-white transition-all hover:bg-primary-700"
              >
                <Key className="w-4 h-4" />
                {accounts.length === 0 ? t("signing.loginAndGenerate") : t("signing.importFree")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-6 md:p-8">
        {isLoading ? (
          <PageLoading message={t("common.loading")} />
        ) : certificates.length === 0 ? (
          <div className="flex items-center justify-center min-h-[calc(100vh-200px)]">
            <div className="text-center">
              <Shield className="mx-auto text-gray-300 mb-4" size={80} />
              <h3 className="text-2xl font-bold text-gray-900 mb-2">
                {t("signing.noCertificates")}
              </h3>
              <p className="text-gray-500 mb-6">
                {t("signing.noCertificatesDesc")}
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => {
                    setImportType("p12");
                    setShowImportDialog(true);
                  }}
                  className="inline-flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-all"
                >
                  {t("signing.importP12")}
                </button>
                <button
                  onClick={() => {
                    setImportType("free");
                    setShowImportDialog(true);
                  }}
                  className="inline-flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg transition-all"
                >
                  {t("signing.importFree")}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {certificates.map((cert) => (
              <div
                key={cert.id}
                className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="border-b border-gray-100 bg-gray-50/80 px-5 py-5 md:px-6">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold tracking-wide text-white">
                          {getCertificateTypeText(cert)}
                        </span>
                        {cert.is_default && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
                            <Star className="h-3.5 w-3.5 fill-current" />
                            {t("signing.default")}
                          </span>
                        )}
                      </div>
                      <h3 className="break-words text-xl font-semibold leading-tight text-gray-950">
                        {cert.name}
                      </h3>
                      <p className="mt-2 break-words text-sm leading-6 text-gray-600">
                        {cert.common_name}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 self-start">
                      <button
                        onClick={() => handleExport(cert.id)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-600"
                        title={t("signing.export")}
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      {!cert.is_default && (
                        <button
                          onClick={() => handleSetDefault(cert.id)}
                          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
                          title={t("signing.setAsDefault")}
                        >
                          <Star className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteClick(cert.id, cert.name)}
                        disabled={deletingCertificateId === cert.id}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                        title={t("common.delete")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="px-5 py-5 md:px-6">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-gray-100 bg-white p-4">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                        <Key className="h-4 w-4" />
                        {t("signing.teamId")}
                      </div>
                      <div className="break-all font-mono text-sm text-gray-900">
                        {cert.team_id}
                      </div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-white p-4">
                      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                        <Calendar className="h-4 w-4" />
                        {t("signing.expires")}
                      </div>
                      <div className={`text-sm font-medium ${shouldShowExpiryWarning(cert.days_until_expiry, cert.is_expired) ? getExpiryColor(cert.days_until_expiry, cert.is_expired) : "text-gray-900"}`}>
                        {formatDate(cert.expires_at)}
                        {shouldShowExpiryWarning(cert.days_until_expiry, cert.is_expired) ? ` (${getExpiryText(cert.days_until_expiry, cert.is_expired)})` : ""}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 border-t border-gray-100 pt-4 text-xs text-gray-500">
                    {t("signing.imported")}: {formatDate(cert.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Import Dialog */}
      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title={t("signing.deleteConfirmTitle")}
        message={deleteTarget ? t("signing.deleteConfirm", { name: deleteTarget.name }) : ""}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          if (!deletingCertificateId) {
            setDeleteTarget(null);
          }
        }}
        type="danger"
      />

      {showImportDialog && (
        <ImportCertDialog
          type={importType}
          onClose={() => setShowImportDialog(false)}
          onSuccess={handleImportSuccess}
        />
      )}
    </div>
  );
}

