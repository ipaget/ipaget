import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAccountStore } from "../store/accountStore";
import { Loader2 } from "lucide-react";
import { goServiceClient } from "../lib/goService";
import { isTauriRuntime } from "../lib/runtime";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [needs2FA, setNeeds2FA] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const hasCompleteTwoFactorCode = /^\d{6}$/.test(twoFactorCode);

  const { addOrUpdateAccount } = useAccountStore();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const result = await goServiceClient.login(email, password);

      if (result.requires_2fa) {
        setNeeds2FA(true);
      } else if (result.success) {
        const accountInfo = await goServiceClient.getAccountInfo(email);
        addOrUpdateAccount({ email: accountInfo.email, country: accountInfo.storefront });
        // Save account to config file
        if (isTauriRuntime()) {
          await invoke("save_account", {
            email: accountInfo.email,
            country: accountInfo.storefront,
          }).catch(console.error);
        }
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError(err.message || err.toString());
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();

		if (!hasCompleteTwoFactorCode) {
			setError("Please enter the 6-digit verification code.");
			return;
		}

    setIsLoading(true);
    setError("");

    try {
      const result = await goServiceClient.verify2FA(email, password, twoFactorCode);

      if (result.success) {
        const accountInfo = await goServiceClient.getAccountInfo(email);
        addOrUpdateAccount({ email: accountInfo.email, country: accountInfo.storefront });
        // Save account to config file
        if (isTauriRuntime()) {
          await invoke("save_account", {
            email: accountInfo.email,
            country: accountInfo.storefront,
          }).catch(console.error);
        }
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      const message = err.message || err.toString();
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 animate-fade-in">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">iPAGet</h1>
          <p className="text-gray-500 mt-2">iOS App Manager</p>
        </div>

        {!needs2FA ? (
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Apple ID
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                placeholder="your@email.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password
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
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
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
                  <span>Logging in...</span>
                </>
              ) : (
                <span>Login</span>
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify2FA} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Two-Factor Authentication Code
              </label>
              <input
                type="text"
                value={twoFactorCode}
                onChange={(e) => {
                  setTwoFactorCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  if (error) {
                    setError("");
                  }
                }}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all text-center text-2xl tracking-widest"
                placeholder="000000"
                maxLength={6}
                required
              />
              <p className="text-sm text-gray-500 mt-2">
                Enter the 6-digit code from your device
              </p>
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
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
                  <span>Verifying...</span>
                </>
              ) : (
                <span>Verify</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setNeeds2FA(false)}
              className="w-full text-gray-600 py-2 text-sm hover:text-gray-900 transition-colors"
            >
              Back to Login
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

