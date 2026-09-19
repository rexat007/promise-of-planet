import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminPermission } from '../../types/admin';
import type { AdminUser, NavigationItem } from '../../types/admin';
import { AdminAccessService } from '../../services/adminAccess';
import { AdminOverview } from '../content/AdminOverview';
import { AdminNewsManagement } from '../news/AdminNewsManagement';
import { AdminLibraryManagement } from '../library/AdminLibraryManagement';
import { AdminPlaceholderView } from '../content/AdminPlaceholderView';
import { ViewTransition } from '../common/ViewTransition';
import { 
  LayoutDashboard, 
  Newspaper, 
  BookOpen, 
  GraduationCap, 
  Users, 
  CreditCard, 
  Cpu, 
  ShieldAlert, 
  History, 
  BarChart3, 
  Settings,
  ChevronRight,
  ChevronLeft,
  Menu,
  X,
  LogOut,
  Globe,
  Shield
} from 'lucide-react';

interface AdminLayoutProps {
  onExitAdmin: () => void;
}

export function AdminLayout({ onExitAdmin }: AdminLayoutProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const mockUsers = AdminAccessService.getMockUsers();
  const [currentUser, setCurrentUser] = useState<AdminUser>(mockUsers[0]); // Default to Owner for full visibility first
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

  // Set up the full 11 admin navigation sections mapped to existing required permissions
  const navigationItems: NavigationItem[] = [
    { id: 'overview', labelAr: 'لوحة التحكم والمؤشرات', labelEn: 'Overview Dashboard', iconName: 'LayoutDashboard', requiredPermission: AdminPermission.View },
    { id: 'news', labelAr: 'إدارة الأخبار البيئية', labelEn: 'Environmental News', iconName: 'Newspaper', requiredPermission: AdminPermission.Create },
    { id: 'library', labelAr: 'المكتبة البيئية والمعرفية', labelEn: 'Knowledge Library', iconName: 'BookOpen', requiredPermission: AdminPermission.Create },
    { id: 'training', labelAr: 'البرامج والمسارات التدريبية', labelEn: 'Training & Courses', iconName: 'GraduationCap', requiredPermission: AdminPermission.Edit },
    { id: 'community', labelAr: 'صحافة المواطن والمجتمع', labelEn: 'Community & Moderator', iconName: 'Users', requiredPermission: AdminPermission.Review },
    { id: 'subscriptions', labelAr: 'الاشتراكات والتبرعات', labelEn: 'Subscriptions & Sponsors', iconName: 'CreditCard', requiredPermission: AdminPermission.ViewReports },
    { id: 'aiReviews', labelAr: 'مراجعة الذكاء الاصطناعي (AI)', labelEn: 'AI Content Auditor', iconName: 'Cpu', requiredPermission: AdminPermission.Review },
    { id: 'users', labelAr: 'المستخدمون والصلاحيات', labelEn: 'Users & Permissions', iconName: 'ShieldAlert', requiredPermission: AdminPermission.ManageUsers },
    { id: 'auditLog', labelAr: 'سجل تدقيق الأنشطة', labelEn: 'Audit Log & History', iconName: 'History', requiredPermission: AdminPermission.ManageSettings },
    { id: 'reports', labelAr: 'التقارير والتحليلات البيئية', labelEn: 'System Reports', iconName: 'BarChart3', requiredPermission: AdminPermission.ViewReports },
    { id: 'settings', labelAr: 'الإعدادات العامة للـ API', labelEn: 'Global Settings', iconName: 'Settings', requiredPermission: AdminPermission.ManageSettings },
  ];

  // Derive visible admin sections from active role permissions
  const visibleNavItems = useMemo(() => {
    return navigationItems.filter(item => {
      if (!item.requiredPermission) return true;
      return AdminAccessService.hasPermission(currentUser, item.requiredPermission);
    });
  }, [currentUser]);

  // Handle mock user role changes, resetting activeTab if current section becomes unauthorized
  const handleUserChange = (userId: string) => {
    const selected = mockUsers.find(u => u.id === userId);
    if (selected) {
      setCurrentUser(selected);
      // Check if activeTab is authorized under the new user's permissions
      const isTabAllowed = navigationItems.some(item => {
        if (item.id !== activeTab) return false;
        return !item.requiredPermission || AdminAccessService.hasPermission(selected, item.requiredPermission);
      });
      if (!isTabAllowed) {
        setActiveTab('overview');
      }
    }
  };

  const handleLanguageToggle = () => {
    const nextLang = i18n.language === 'ar' ? 'en' : 'ar';
    i18n.changeLanguage(nextLang);
  };

  // Guard active Tab to prevent direct navigation to hidden/unauthorized sections
  const effectiveTab = useMemo(() => {
    const targetItem = navigationItems.find(item => item.id === activeTab);
    if (!targetItem) return 'overview';
    const isAllowed = !targetItem.requiredPermission || AdminAccessService.hasPermission(currentUser, targetItem.requiredPermission);
    return isAllowed ? activeTab : 'overview';
  }, [activeTab, currentUser]);

  // Helper to resolve icon by string name
  const renderIcon = (iconName: string, className: string) => {
    switch (iconName) {
      case 'LayoutDashboard': return <LayoutDashboard className={className} />;
      case 'Newspaper': return <Newspaper className={className} />;
      case 'BookOpen': return <BookOpen className={className} />;
      case 'GraduationCap': return <GraduationCap className={className} />;
      case 'Users': return <Users className={className} />;
      case 'CreditCard': return <CreditCard className={className} />;
      case 'Cpu': return <Cpu className={className} />;
      case 'ShieldAlert': return <ShieldAlert className={className} />;
      case 'History': return <History className={className} />;
      case 'BarChart3': return <BarChart3 className={className} />;
      case 'Settings': return <Settings className={className} />;
      default: return <Settings className={className} />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50/50 dark:bg-gray-950 flex flex-col text-gray-900 dark:text-gray-100 transition-colors pop-page-fade w-full max-w-full min-w-0" dir={isAr ? 'rtl' : 'ltr'} data-responsive-guard>
      
      {/* A. ADMIN HEAD-BAR - Optimized for narrow mobile screens */}
      <header className="h-16 border-b border-gray-200/80 dark:border-gray-800/80 bg-white dark:bg-gray-900/90 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between px-2.5 sm:px-6 shadow-xs max-w-full overflow-hidden w-full min-w-0" id="admin-top-header" dir="ltr">
        
        {/* Left / Start Branding and Hamburger */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink" dir={isAr ? 'rtl' : 'ltr'}>
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg lg:hidden cursor-pointer focus:outline-hidden shrink-0 pop-motion-micro"
            aria-label="Toggle Navigation Sidebar"
          >
            {isSidebarOpen ? <X className="w-5 h-5 text-gray-700 dark:text-gray-200" /> : <Menu className="w-5 h-5 text-gray-700 dark:text-gray-200" />}
          </button>
          
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <span className="h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full bg-emerald-600 animate-pulse shrink-0" />
            <span className="text-xs sm:text-base md:text-lg font-extrabold text-emerald-800 dark:text-emerald-400 truncate max-w-[110px] min-[380px]:max-w-[160px] min-[480px]:max-w-[220px] sm:max-w-none">
              {isAr ? 'لوحة التحكم الإدارية' : 'Promise of Planet Back-Office'}
            </span>
          </div>
        </div>

        {/* Right / End Controls (Role Switcher, Language Toggle, Exit Button) — Fixed Physical Control Zone */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0" dir="ltr" id="admin-fixed-control-zone">
          
          {/* Role selector dropdown */}
          <div className="flex items-center gap-1" id="role-selector-container" dir={isAr ? 'rtl' : 'ltr'}>
            <span className="hidden xl:inline-flex items-center gap-1 text-xs text-gray-400 font-medium">
              <Shield className="w-3.5 h-3.5 text-emerald-600" />
              <span>{isAr ? 'اختبار الدور:' : 'Simulation Role:'}</span>
            </span>
            <select
              value={currentUser.id}
              onChange={(e) => handleUserChange(e.target.value)}
              className="max-w-[105px] min-[380px]:max-w-[140px] sm:max-w-xs px-2 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-750 border border-gray-200/80 dark:border-gray-700/80 rounded-lg text-xs font-bold text-gray-800 dark:text-gray-200 cursor-pointer focus:outline-hidden focus:border-emerald-600 pop-motion-micro truncate"
              id="rbac-user-select"
              title={isAr ? 'تغيير المستخدم والدور الفني' : 'Switch Active User Role'}
            >
              {mockUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.role})
                </option>
              ))}
            </select>
          </div>

          {/* i18n Language toggle button — Physically Anchored */}
          <button
            onClick={handleLanguageToggle}
            className="p-1.5 sm:px-2.5 sm:py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer shrink-0 pop-motion-micro pop-hover-lift"
            title={isAr ? 'Switch to English' : 'التحويل للعربية'}
            id="admin-lang-toggle-btn"
            dir={isAr ? 'rtl' : 'ltr'}
          >
            <Globe className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="hidden sm:inline">{isAr ? 'English' : 'العربية'}</span>
          </button>

          {/* EXIT GATEWAY button */}
          <button
            onClick={onExitAdmin}
            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer shadow-xs pop-motion-micro pop-hover-lift shrink-0"
            id="exit-admin-btn"
            dir={isAr ? 'rtl' : 'ltr'}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">{isAr ? 'موقع المنصة' : 'Exit Portal'}</span>
          </button>
        </div>
      </header>

      {/* BODY WORKSPACE */}
      <div className="flex-1 flex relative w-full max-w-full min-w-0" id="admin-workspace-body">
        
        {/* Mobile Backdrop Overlay */}
        {isSidebarOpen && (
          <div 
            className="fixed inset-0 top-16 bg-black/50 backdrop-blur-xs z-15 lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* B. ADMIN SIDE-BAR NAVIGATION (Responsive slide-out drawer using RTL/LTR start anchoring) */}
        <aside 
          data-responsive-guard-ignore
          className={`w-64 max-w-[80vw] border-r border-l border-gray-200/80 dark:border-gray-800/80 bg-white dark:bg-gray-900 shrink-0 flex flex-col justify-between py-4 transition-all duration-300 z-20 
          lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:flex lg:translate-x-0
          ${isSidebarOpen 
            ? 'fixed top-16 bottom-0 start-0 lg:relative lg:top-auto lg:bottom-auto shadow-2xl' 
            : 'hidden lg:flex'}`}
          id="admin-sidebar"
        >
          {/* Sidebar Menu Items */}
          <div className="space-y-1.5 px-3 overflow-y-auto">
            <span className="px-3 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider block mb-2">
              {isAr ? `الأقسام المتاحة لدور (${currentUser.role})` : `Sections for (${currentUser.role})`}
            </span>
            <nav className="space-y-1">
              {visibleNavItems.map((item) => {
                const isActive = effectiveTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab(item.id);
                      setIsSidebarOpen(false); // close mobile sidebar on navigation
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                      isActive 
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 shadow-xs' 
                        : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900/50 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-3 truncate">
                      {renderIcon(item.iconName, `w-4 h-4 shrink-0 ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`)}
                      <span className="truncate">{isAr ? item.labelAr : item.labelEn}</span>
                    </div>
                    <div>
                      {isActive && (isAr ? <ChevronLeft className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />)}
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Sidebar Footer: Current simulation user info */}
          <div className="border-t border-gray-100 dark:border-gray-800 pt-3 px-3 mx-1">
            <div className="bg-gray-50 dark:bg-gray-950/60 p-2.5 rounded-xl border border-gray-100 dark:border-gray-900/60 flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-400 flex items-center justify-center shrink-0 font-extrabold text-sm border border-emerald-200/50 dark:border-emerald-900/50">
                <span className="uppercase">{currentUser.name.charAt(0)}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-gray-800 dark:text-gray-100 truncate">{currentUser.name}</p>
                <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 tracking-wide truncate">{currentUser.role}</p>
              </div>
            </div>
          </div>
        </aside>

        {/* C. MAIN WORKSPACE CONTENT AREA */}
        <main className="flex-1 p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full max-w-full min-w-0" id="admin-main-content">
          <ViewTransition viewKey={effectiveTab}>
            {effectiveTab === 'overview' ? (
              <AdminOverview currentUser={currentUser} />
            ) : effectiveTab === 'news' ? (
              <AdminNewsManagement currentUser={currentUser} />
            ) : effectiveTab === 'library' ? (
              <AdminLibraryManagement currentUser={currentUser} />
            ) : (
              <AdminPlaceholderView id={effectiveTab} currentUser={currentUser} />
            )}
          </ViewTransition>
        </main>

      </div>
    </div>
  );
}
