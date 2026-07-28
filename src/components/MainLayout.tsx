import { ReactNode, useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Search, Smartphone, Settings, LogIn, User, ChevronDown, Trash2, Plus, Apple, Check, Library, PenSquare, FileEdit, FileCode2 } from "lucide-react";
import { useAccountStore, Account } from "../store/accountStore";
import { useErrorStore } from "../store/errorStore";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { goServiceClient, Certificate } from "../lib/goService";
import { isTauriRuntime } from "../lib/runtime";

interface MainLayoutProps {
  children: ReactNode;
}

const getCountryName = (countryCode: string, i18n: any): string => {
  const key = `countries.${countryCode.toUpperCase()}`;
  const translated = i18n.t(key);
  // If translation not found, return the code itself
  return translated !== key ? translated : countryCode;
};

const shouldShowCertificateWarning = (certificate: Certificate) => {
  return certificate.is_expired || certificate.days_until_expiry <= 30;
};

const getCertificateWarningColor = (certificate: Certificate) => {
  if (certificate.is_expired || certificate.days_until_expiry < 2) {
    return "text-red-600";
  }
  if (certificate.days_until_expiry < 4) {
    return "text-yellow-600";
  }
  return "text-yellow-600";
};

export default function MainLayout({ children }: MainLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { isAuthenticated, selectedAccount, setShowLoginDialog, addOrUpdateAccount, accounts, loadAccounts, removeAccount } = useAccountStore();
  const { showError } = useErrorStore();
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [titleClicks, setTitleClicks] = useState(0);
  const titleClickTimer = useRef<number | null>(null);
  const [certificate, setCertificate] = useState<Certificate | null | undefined>(undefined);
  const [confirmingDeleteEmail, setConfirmingDeleteEmail] = useState<string | null>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadAccounts();
  }, [isAuthenticated, selectedAccount?.email, loadAccounts]);

  useEffect(() => {
    if (isAuthenticated && selectedAccount?.email) {
      // Delay certificate loading to not block initial render
      const timer = setTimeout(() => {
        void loadCertificate();
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setCertificate(undefined);
    }
  }, [isAuthenticated, selectedAccount?.email]);

  useEffect(() => {
    if (!selectedAccount?.email) {
      return;
    }

    const handleCertificatesUpdated = () => {
      void loadCertificate();
    };

    window.addEventListener("certificates:updated", handleCertificatesUpdated);
    return () => window.removeEventListener("certificates:updated", handleCertificatesUpdated);
  }, [selectedAccount?.email]);

  // Click outside to close menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setShowAccountMenu(false);
      }
    };

    if (showAccountMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showAccountMenu]);

  // Reset confirming delete state when menu closes
  useEffect(() => {
    if (!showAccountMenu) {
      setConfirmingDeleteEmail(null);
    }
  }, [showAccountMenu]);

  const loadCertificate = async () => {
    if (!selectedAccount?.email) return;
    try {
      const cert = await goServiceClient.getCertificateForAppleID(selectedAccount.email);
      setCertificate(cert);
    } catch (error: any) {
      console.error("Failed to load certificate:", error);
      setCertificate(null);
    }
  };

  const handleSwitchAccount = async (account: Account) => {
    setShowAccountMenu(false);
    if (account.email === selectedAccount?.email) {
      return;
    }
    try {
      const authed = await goServiceClient.checkAuth(account.email);
      if (authed) {
        addOrUpdateAccount({ email: account.email, country: account.country });
      } else {
        setShowLoginDialog(true);
      }
    } catch (e) {
      setShowLoginDialog(true);
    }
  };

  const handleRemoveAccountClick = (email: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmingDeleteEmail(email);
  };

  const handleConfirmRemove = async (email: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("remove_saved_account", { email });
      removeAccount(email);
      setConfirmingDeleteEmail(null);
      await loadAccounts();
    } catch (error: any) {
      showError(t('auth.removeAccountFailed'), error.toString());
    }
  };

  const handleCancelRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmingDeleteEmail(null);
  };

  const handleAddAccount = () => {
    setShowAccountMenu(false);
    setShowLoginDialog(true);
  };

  const navItems = [
    { path: "/", icon: Search, label: t('nav.search') },
    { path: "/library", icon: Library, label: t('nav.appLibrary') },
    { path: "/devices", icon: Smartphone, label: t('nav.devices') },
    { path: "/certificates", icon: PenSquare, label: t('nav.certificate') },
    { path: "/editor", icon: FileEdit, label: t('nav.editor') },
    { path: "/plist", icon: FileCode2, label: t('nav.plist') },
    { path: "/settings", icon: Settings, label: t('nav.settings') },
  ];

  return (
    <div className="flex w-full h-full overflow-hidden">
      <aside className="w-60 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 h-full">
        <div className="p-4 border-b border-gray-200">
          <h1
            className="text-xl font-bold text-primary-600 select-none"
            onClick={async () => {
              const next = titleClicks + 1;
              setTitleClicks(next);
              if (titleClickTimer.current) {
                clearTimeout(titleClickTimer.current);
              }
              if (next >= 10) {
                setTitleClicks(0);
                if (isTauriRuntime()) {
                  invoke("open_debug_window").catch(console.error);
                } else {
                  window.open(
                    `${window.location.origin}/debug`,
                    "ipaget-debug",
                    "width=1200,height=800,menubar=no,toolbar=no,location=no,status=no"
                  );
                }
              } else {
                titleClickTimer.current = window.setTimeout(() => setTitleClicks(0), 2000);
              }
            }}
          >
            {t('app.title')}
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">{t('app.subtitle')}</p>
        </div>
        
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg transition-all ${
                  isActive
                    ? "bg-primary-500 text-white shadow-sm"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <Icon size={18} />
                <span className="text-sm font-medium">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-gray-200 space-y-2">
          <div className="relative">
            {isAuthenticated ? (
              <>
                <button
                  onClick={() => setShowAccountMenu(!showAccountMenu)}
                  className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-lg transition-all"
                >
                  <div className="flex items-center space-x-3">
                    <User className="text-gray-600 flex-shrink-0" size={20} />
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm text-gray-900 font-medium truncate">{selectedAccount?.email}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {selectedAccount?.country && (
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                            {getCountryName(selectedAccount.country, { t })}
                          </span>
                        )}
                        {certificate !== undefined && certificate !== null && shouldShowCertificateWarning(certificate) && (
                          <div className={`flex items-center gap-1 ${getCertificateWarningColor(certificate)}`}>
                            <Apple size={12} />
                            <span className="text-xs">{certificate.is_expired ? t('signing.expired') : t('cert.selfSignDays', { days: certificate.days_until_expiry })}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <ChevronDown className={`text-gray-600 transition-transform flex-shrink-0 ${showAccountMenu ? 'rotate-180' : ''}`} size={16} />
                  </div>
                </button>

                {showAccountMenu && (
                  <div ref={accountMenuRef} className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto z-50">
                    <div className="p-2">
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">{t('auth.appleAccounts')}</div>
                      
                      {accounts.length > 0 ? (
                        <div className="space-y-1">
                          {accounts.map((account) => (
                            <div
                              key={account.email}
                              className={`relative px-3 py-2 rounded-lg transition-colors group ${
                                account.email === selectedAccount?.email ? 'bg-blue-50' : 'hover:bg-gray-50'
                              }`}
                            >
                              <div className="flex items-center space-x-2">
                                <div
                                  onClick={() => confirmingDeleteEmail !== account.email && handleSwitchAccount(account)}
                                  className={`flex-1 min-w-0 ${confirmingDeleteEmail !== account.email ? 'cursor-pointer' : ''}`}
                                >
                                  <p className="text-sm text-gray-900 truncate">{account.email}</p>
                                  {account.country && (
                                    <span className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full mt-1">
                                      {getCountryName(account.country, { t })}
                                    </span>
                                  )}
                                </div>
                                {account.email === selectedAccount?.email ? (
                                  <Check className="text-blue-600 flex-shrink-0 group-hover:hidden" size={16} />
                                ) : null}
                                <button
                                  onClick={(e) => handleRemoveAccountClick(account.email, e)}
                                  className={`p-1 hover:bg-red-100 rounded flex-shrink-0 ${
                                    account.email === selectedAccount?.email 
                                      ? 'hidden group-hover:block' 
                                      : 'opacity-0 group-hover:opacity-100'
                                  }`}
                                >
                                  <Trash2 className="text-red-600" size={14} />
                                </button>
                              </div>

                              {confirmingDeleteEmail === account.email && (
                                <div className="absolute inset-0 bg-red-50 bg-opacity-95 rounded-lg flex items-center justify-center space-x-2 px-3">
                                  <span className="text-sm text-red-700 font-medium">{t('auth.confirmDelete')}</span>
                                  <button
                                    onClick={(e) => handleConfirmRemove(account.email, e)}
                                    className="px-3 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 transition-colors"
                                  >
                                    {t('common.yes')}
                                  </button>
                                  <button
                                    onClick={handleCancelRemove}
                                    className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300 transition-colors"
                                  >
                                    {t('common.cancel')}
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500 text-center py-4">{t('auth.noSavedAccounts')}</p>
                      )}

                      <div className="border-t border-gray-200 mt-2 pt-2 space-y-1">
                        <button
                          onClick={handleAddAccount}
                          className="w-full px-3 py-2 bg-primary-50 hover:bg-primary-100 text-primary-600 rounded-lg transition-colors flex items-center space-x-2 justify-center"
                        >
                          <Plus size={14} />
                          <span className="text-sm font-medium">{t('auth.addAccount')}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <button
                onClick={() => setShowLoginDialog(true)}
                className="w-full px-3 py-2.5 bg-yellow-50 hover:bg-yellow-100 border border-yellow-200 rounded-lg transition-all"
              >
                <div className="flex items-center space-x-2">
                  <User className="text-yellow-600 flex-shrink-0" size={16} />
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-xs text-yellow-800 font-semibold">{t('auth.notLoggedIn')}</p>
                    <p className="text-[11px] text-yellow-600">{t('auth.clickToLogin')}</p>
                  </div>
                  <LogIn className="text-yellow-600 flex-shrink-0" size={16} />
                </div>
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden bg-gray-50 h-full">
        {children}
      </main>
    </div>
  );
}
