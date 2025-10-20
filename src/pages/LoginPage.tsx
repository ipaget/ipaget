import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../store/authStore";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { listen } from "@tauri-apps/api/event";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [needs2FA, setNeeds2FA] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [downloadStatus, setDownloadStatus] = useState<{
    isDownloading: boolean;
    message: string;
    status: string;
  }>({ isDownloading: false, message: "", status: "" });

  const { setAuthenticated, setUserEmail } = useAuthStore();

  useEffect(() => {
    checkIpatool();
    
    const unlisten = listen("download-progress", (event: any) => {
      const data = event.payload;
      setDownloadStatus({
        isDownloading: data.status === "downloading",
        message: data.message,
        status: data.status,
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const checkIpatool = async () => {
    try {
      const hasIpatool = await invoke<boolean>("check_ipatool");
      if (!hasIpatool) {
        setDownloadStatus({
          isDownloading: false,
          message: "ipatool not found. Click to download.",
          status: "not_found",
        });
      }
    } catch (error) {
      console.error("Error checking ipatool:", error);
    }
  };

  const handleDownloadIpatool = async () => {
    try {
      setDownloadStatus({
        isDownloading: true,
        message: "Downloading ipatool...",
        status: "downloading",
      });
      await invoke("download_ipatool");
    } catch (error: any) {
      setDownloadStatus({
        isDownloading: false,
        message: error.toString(),
        status: "error",
      });
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
        setUserEmail(email);
        setAuthenticated(true);
      }
    } catch (err: any) {
      setError(err.toString());
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
        setUserEmail(email);
        setAuthenticated(true);
      }
    } catch (err: any) {
      setError(err.toString());
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

        {downloadStatus.status === "not_found" && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-start space-x-3">
              <AlertCircle className="text-yellow-600 mt-0.5" size={20} />
              <div className="flex-1">
                <p className="text-sm text-yellow-800 mb-2">
                  {downloadStatus.message}
                </p>
                <button
                  onClick={handleDownloadIpatool}
                  className="text-sm bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors"
                >
                  Download ipatool
                </button>
              </div>
            </div>
          </div>
        )}

        {downloadStatus.isDownloading && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center space-x-3">
              <Loader2 className="animate-spin text-blue-600" size={20} />
              <p className="text-sm text-blue-800">{downloadStatus.message}</p>
            </div>
          </div>
        )}

        {downloadStatus.status === "completed" && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center space-x-3">
              <CheckCircle className="text-green-600" size={20} />
              <p className="text-sm text-green-800">{downloadStatus.message}</p>
            </div>
          </div>
        )}

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
              disabled={isLoading || downloadStatus.isDownloading}
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
                onChange={(e) => setTwoFactorCode(e.target.value)}
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
              disabled={isLoading}
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

