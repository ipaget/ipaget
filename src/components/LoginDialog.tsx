import { useState, useEffect, useRef } from "react";
import { useAccountStore } from "../store/accountStore";
import { useCertificateStore } from "../store/certificateStore";
import { useErrorStore } from "../store/errorStore";
import { Loader2, X, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import CodeInput from "./CodeInput";
import { goServiceClient, getAuthErrorKey } from "../lib/goService";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/runtime";

const CERTIFICATE_SYNC_TIMEOUT_MS = 15000;
const CERTIFICATE_SYNC_INTERVAL_MS = 1000;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export default function LoginDialog() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [needs2FA, setNeeds2FA] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const authRunIdRef = useRef(0);

  const { showLoginDialog, setShowLoginDialog, addOrUpdateAccount, loginDialogPrefillEmail, loginDialogContext } = useAccountStore();
  const { showError } = useErrorStore();

  const hasCompleteTwoFactorCode = /^\d{6}$/.test(twoFactorCode);

  const dialogTitle = loginDialogContext === "certificate"
    ? t("auth.certificateLoginRequired")
    : t("auth.loginRequired");

  const syncCertificatesAfterLogin = async (accountEmail: string) => {
    if (loginDialogContext !== "certificate") {
      return;
    }

    const deadline = Date.now() + CERTIFICATE_SYNC_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const cert = await goServiceClient.getCertificateForAppleID(accountEmail);
        if (cert) {
          break;
        }
      } catch {
      }

      await delay(CERTIFICATE_SYNC_INTERVAL_MS);
    }

    try {
      const { loadCertificates } = useCertificateStore.getState();
      await loadCertificates();
    } catch (syncError) {
      console.error("Failed to refresh certificates after login:", syncError);
    }
  };

  const resetForm = (nextEmail = "") => {
    setEmail(nextEmail);
    setPassword("");
    setTwoFactorCode("");
    setNeeds2FA(false);
    setError("");
    setIsLoading(false);
  };

  const finalizeAuthenticatedLogin = async (accountEmail: string, runId: number) => {
    let accountInfo = { email: accountEmail, storefront: "us" };
    try {
      accountInfo = await goServiceClient.getAccountInfo(accountEmail);
    } catch (accountInfoError) {
      console.warn("Failed to load account info after login; using login email", accountInfoError);
    }

    if (authRunIdRef.current !== runId) {
      return;
    }

    addOrUpdateAccount({ email: accountInfo.email, country: accountInfo.storefront });
    if (isTauriRuntime()) {
      await invoke("save_account", {
        email: accountInfo.email,
        country: accountInfo.storefront,
      });
    }
    setShowLoginDialog(false);
    void syncCertificatesAfterLogin(accountInfo.email);
  };

  useEffect(() => {
    authRunIdRef.current += 1;

    if (!showLoginDialog) {
      resetForm();
      return;
    }

    resetForm(loginDialogPrefillEmail || "");
  }, [showLoginDialog, loginDialogPrefillEmail]);

  const handleClose = () => {
    setShowLoginDialog(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const runId = authRunIdRef.current + 1;
    authRunIdRef.current = runId;
    setIsLoading(true);
    setError("");

    try {
      const result = await goServiceClient.login(email, password);

      if (authRunIdRef.current !== runId) {
        return;
      }

      if (result.requires_2fa) {
        setNeeds2FA(true);
      } else if (result.success) {
        await finalizeAuthenticatedLogin(email, runId);
      } else {
        showError(t('auth.loginFailed'), result.message);
      }
    } catch (err: any) {
      if (authRunIdRef.current !== runId) {
        return;
      }

      const errorKey = getAuthErrorKey(err.message || err.toString());
      const errorMessage = errorKey ? t(errorKey) : (err.message || err.toString());
      showError(t('auth.loginFailed'), errorMessage);
    } finally {
      if (authRunIdRef.current === runId) {
        setIsLoading(false);
      }
    }
  };

  const submitTwoFactorCode = async (code: string) => {
    if (!/^\d{6}$/.test(code)) {
      setError(t('auth.errors.invalidOrExpiredCode'));
      return;
    }

    setIsLoading(true);
    setError("");
    const runId = authRunIdRef.current + 1;
    authRunIdRef.current = runId;

    try {
      const result = await goServiceClient.verify2FA(email, password, code);

      if (authRunIdRef.current !== runId) {
        return;
      }

      if (result.success) {
        await finalizeAuthenticatedLogin(email, runId);
      } else {
        const errorKey = getAuthErrorKey(result.message || "");
        setError(errorKey ? t(errorKey) : result.message);
      }
    } catch (err: any) {
      if (authRunIdRef.current !== runId) {
        return;
      }

      const errorKey = getAuthErrorKey(err.message || err.toString());
      const errorMessage = errorKey ? t(errorKey) : (err.message || err.toString());
      setError(errorMessage);
    } finally {
      if (authRunIdRef.current === runId) {
        setIsLoading(false);
      }
    }
  };

  const handleBackToLogin = () => {
    authRunIdRef.current += 1;
    setNeeds2FA(false);
    setTwoFactorCode("");
    setError("");
    setIsLoading(false);
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitTwoFactorCode(twoFactorCode);
  };

  if (!showLoginDialog) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 backdrop-blur-sm flex items-center justify-center p-4 z-[50] animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 animate-slide-up relative border border-gray-100">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={24} />
        </button>

        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900 whitespace-pre-line">{dialogTitle}</h2>
          <p className="text-gray-500 mt-2">
            {loginDialogPrefillEmail ? t('auth.sessionExpiredPrompt') : t('auth.signInPrompt')}
          </p>
        </div>

        {!needs2FA ? (
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('auth.appleId')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                placeholder="your@email.com"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('auth.password')}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2">
                <AlertCircle className="text-red-600 mt-0.5 flex-shrink-0" size={20} />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  <span>{t('auth.loggingIn')}</span>
                </>
              ) : (
                <span>{t('auth.login')}</span>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify2FA} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-4 text-center">
                {error ? t('auth.twoFactorFailed') : t('auth.enterCode')}
              </label>
              <div className={`${error ? 'animate-[shake_0.3s_ease-in-out]' : ''}`}>
                <CodeInput
                  length={6}
                  value={twoFactorCode}
                  onChange={(code) => {
                    setTwoFactorCode(code);
                    if (error) {
                      setError("");
                    }
                    if (!isLoading && /^\d{6}$/.test(code)) {
                      // Auto submit when complete
                      void (async () => {
                        await submitTwoFactorCode(code);
                      })();
                    }
                  }}
                  error={!!error}
                  disabled={isLoading}
                />
              </div>
              <p className={`text-sm mt-4 text-center ${error ? 'text-red-600' : 'text-gray-700'}`}>
                {t('auth.enterCode')}
              </p>
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2">
                <AlertCircle className="text-red-600 mt-0.5 flex-shrink-0" size={20} />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !hasCompleteTwoFactorCode}
              className="w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  <span>{t('auth.verifying')}</span>
                </>
              ) : (
                <span>{t('auth.verify')}</span>
              )}
            </button>

            <button
              type="button"
              onClick={handleBackToLogin}
              className="w-full text-gray-600 py-2 text-sm hover:text-gray-900 transition-colors"
            >
              {t('auth.backToLogin')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

