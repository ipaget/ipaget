import { ReactNode, useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Search, Download, Smartphone, LogOut, LogIn, User, Globe, ChevronDown, Trash2, Plus } from "lucide-react";
import { useAuthStore } from "../store/authStore";
import { useErrorStore } from "../store/errorStore";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

interface MainLayoutProps {
  children: ReactNode;
}

interface SavedAccount {
  email: string;
  country: string;
  last_login: string;
}

const countryFlags: { [key: string]: string } = {
  US: "🇺🇸", CN: "🇨🇳", JP: "🇯🇵", GB: "🇬🇧", FR: "🇫🇷", DE: "🇩🇪", 
  AU: "🇦🇺", CA: "🇨🇦", KR: "🇰🇷", IT: "🇮🇹", ES: "🇪🇸", BR: "🇧🇷",
  IN: "🇮🇳", RU: "🇷🇺", MX: "🇲🇽", TW: "🇹🇼", HK: "🇭🇰", SG: "🇸🇬",
};

const countryNames: { [key: string]: string } = {
  US: "United States", CN: "China", JP: "Japan", GB: "United Kingdom", 
  FR: "France", DE: "Germany", AU: "Australia", CA: "Canada", 
  KR: "South Korea", IT: "Italy", ES: "Spain", BR: "Brazil",
  IN: "India", RU: "Russia", MX: "Mexico", TW: "Taiwan", 
  HK: "Hong Kong", SG: "Singapore",
};

export default function MainLayout({ children }: MainLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { isAuthenticated, userEmail, country, setShowLoginDialog, setAuthenticated } = useAuthStore();
  const { showError } = useErrorStore();
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadSavedAccounts();
  }, [isAuthenticated]);

  const loadSavedAccounts = async () => {
    try {
      const accounts = await invoke<SavedAccount[]>("get_saved_accounts");
      setSavedAccounts(accounts);
    } catch (error: any) {
      showError(t('auth.loadAccountsFailed'), error.toString());
    }
  };

  const handleLogout = async () => {
    setIsLoading(true);
    try {
      await invoke("logout_apple");
      setAuthenticated(false);
      setShowAccountMenu(false);
    } catch (error: any) {
      showError(t('auth.logoutFailed'), error.toString());
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwitchAccount = async (account: SavedAccount) => {
    setShowAccountMenu(false);
    if (isAuthenticated && account.email === userEmail) {
      return;
    }
    setShowLoginDialog(true);
  };

  const handleRemoveAccount = async (email: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(t('auth.removeAccountConfirm', { email }))) {
      try {
        await invoke("remove_saved_account", { email });
        await loadSavedAccounts();
      } catch (error: any) {
        showError(t('auth.removeAccountFailed'), error.toString());
      }
    }
  };

  const handleAddAccount = () => {
    setShowAccountMenu(false);
    setShowLoginDialog(true);
  };

  const navItems = [
    { path: "/", icon: Search, label: t('nav.search') },
    { path: "/downloads", icon: Download, label: t('nav.downloads') },
    { path: "/devices", icon: Smartphone, label: t('nav.devices') },
  ];

  return (
    <div className="flex w-full h-full overflow-hidden">
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 h-full">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-2xl font-bold text-primary-600">{t('app.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('app.subtitle')}</p>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-all ${
                  isActive
                    ? "bg-primary-500 text-white shadow-sm"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <Icon size={20} />
                <span className="font-medium">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-200 space-y-3">
          <div className="relative">
            {isAuthenticated ? (
              <>
                <button
                  onClick={() => setShowAccountMenu(!showAccountMenu)}
                  className="w-full px-4 py-3 bg-green-50 hover:bg-green-100 rounded-lg transition-all border border-green-200"
                >
                  <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center flex-shrink-0">
                      {country && countryFlags[country] ? (
                        <span className="text-lg">{countryFlags[country]}</span>
                      ) : (
                        <Globe className="text-white" size={16} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-xs text-green-700 font-medium truncate">
                        {country && countryNames[country] ? countryNames[country] : country || t('common.unknownRegion')}
                      </p>
                      <p className="text-xs text-green-600 truncate">{userEmail}</p>
                    </div>
                    <ChevronDown className={`text-green-600 transition-transform flex-shrink-0 ${showAccountMenu ? 'rotate-180' : ''}`} size={16} />
                  </div>
                </button>

                {showAccountMenu && (
                  <div className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto z-50">
                    <div className="p-2">
                      <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase">{t('auth.appleAccounts')}</div>
                      
                      {savedAccounts.length > 0 ? (
                        <div className="space-y-1">
                          {savedAccounts.map((account) => (
                            <button
                              key={account.email}
                              onClick={() => handleSwitchAccount(account)}
                              className={`w-full px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left group ${
                                account.email === userEmail ? 'bg-green-50' : ''
                              }`}
                            >
                              <div className="flex items-center space-x-2">
                                <div className="w-6 h-6 bg-gray-100 rounded-md flex items-center justify-center flex-shrink-0">
                                  {account.country && countryFlags[account.country] ? (
                                    <span className="text-sm">{countryFlags[account.country]}</span>
                                  ) : (
                                    <Globe className="text-gray-400" size={12} />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-gray-900 truncate">{account.email}</p>
                                  <p className="text-xs text-gray-500 truncate">
                                    {account.country && countryNames[account.country] ? countryNames[account.country] : account.country}
                                  </p>
                                </div>
                                {account.email === userEmail && (
                                  <span className="text-xs text-green-600 font-medium flex-shrink-0">{t('auth.active')}</span>
                                )}
                                <button
                                  onClick={(e) => handleRemoveAccount(account.email, e)}
                                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 rounded transition-opacity flex-shrink-0"
                                >
                                  <Trash2 className="text-red-600" size={12} />
                                </button>
                              </div>
                            </button>
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
                        
                        <button
                          onClick={handleLogout}
                          disabled={isLoading}
                          className="w-full px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors flex items-center space-x-2 justify-center disabled:opacity-50"
                        >
                          <LogOut size={14} />
                          <span className="text-sm font-medium">{t('auth.logout')}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <button
                onClick={() => setShowLoginDialog(true)}
                className="w-full px-4 py-3 bg-yellow-50 hover:bg-yellow-100 border-2 border-yellow-200 rounded-lg transition-all"
              >
                <div className="flex items-center space-x-2">
                  <User className="text-yellow-600 flex-shrink-0" size={18} />
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-sm text-yellow-800 font-semibold">{t('auth.notLoggedIn')}</p>
                    <p className="text-xs text-yellow-600">{t('auth.clickToLogin')}</p>
                  </div>
                  <LogIn className="text-yellow-600 flex-shrink-0" size={16} />
                </div>
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-scroll bg-gray-50 scrollbar-thin h-full">
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

