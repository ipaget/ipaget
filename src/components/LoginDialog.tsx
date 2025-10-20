import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../store/authStore";
import { useErrorStore } from "../store/errorStore";
import { Loader2, X, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import CodeInput from "./CodeInput";

interface AccountInfo {
  email: string;
  country: string;
  is_authenticated: boolean;
}

export default function LoginDialog() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [needs2FA, setNeeds2FA] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const { showLoginDialog, setShowLoginDialog, setAccountInfo } = useAuthStore();
  const { showError } = useErrorStore();

  useEffect(() => {
    if (!showLoginDialog) {
      setEmail("");
      setPassword("");
      setTwoFactorCode("");
      setNeeds2FA(false);
      setError("");
      setIsLoading(false);
    }
  }, [showLoginDialog]);

  const handleClose = () => {
    if (!isLoading) {
      setShowLoginDialog(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const result = await invoke<string>("login_apple", {
        email,
        password,
      });

      if (result === "2FA_REQUIRED") {
        setNeeds2FA(true);
      } else if (result === "SUCCESS") {
        const accountInfo = await invoke<AccountInfo>("get_account_info");
        setAccountInfo(accountInfo.email, accountInfo.country);
        setShowLoginDialog(false);
      }
    } catch (err: any) {
      showError(t('auth.loginFailed'), err.toString());
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const result = await invoke<string>("verify_2fa", {
        email,
        password,
        code: twoFactorCode,
      });

      if (result === "SUCCESS") {
        const accountInfo = await invoke<AccountInfo>("get_account_info");
        setAccountInfo(accountInfo.email, accountInfo.country);
        setShowLoginDialog(false);
      }
    } catch (err: any) {
      showError(t('auth.twoFactorFailed'), err.toString());
    } finally {
      setIsLoading(false);
    }
  };

  if (!showLoginDialog) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 animate-slide-up relative border border-gray-100">
        <button
          onClick={handleClose}
          disabled={isLoading}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
        >
          <X size={24} />
        </button>

        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900 whitespace-pre-line">{t('auth.loginRequired')}</h2>
          <p className="text-gray-500 mt-2">{t('auth.signInPrompt')}</p>
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
                {t('auth.twoFactorCode')}
              </label>
              <CodeInput
                length={6}
                value={twoFactorCode}
                onChange={setTwoFactorCode}
                onComplete={(code) => {
                  if (code.length === 6) {
                    setTwoFactorCode(code);
                  }
                }}
                disabled={isLoading}
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-4 text-center">
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
              disabled={isLoading}
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
              onClick={() => {
                setNeeds2FA(false);
                setError("");
              }}
              disabled={isLoading}
              className="w-full text-gray-600 py-2 text-sm hover:text-gray-900 transition-colors disabled:opacity-50"
            >
              {t('auth.backToLogin')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

