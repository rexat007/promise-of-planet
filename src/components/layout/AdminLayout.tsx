import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminPermission, AdminDomain, isTabAuthorized } from '../../types/admin';
import type { AdminUser, NavigationItem } from '../../types/admin';
import { AdminAccessService } from '../../services/adminAccess';
import { AdminAuditService } from '../../services/adminAuditService';
import { AccountService } from '../../services/accountService';
import { AuditAction, AuditTargetType } from '../../types/audit';
import type { AuditChange } from '../../types/audit';
import { AdminOverview } from '../content/AdminOverview';
import { AdminNewsManagement } from '../news/AdminNewsManagement';
import { AdminLibraryManagement } from '../library/AdminLibraryManagement';
import { AdminTrainingManagement } from '../training/AdminTrainingManagement';
import { AdminPlaceholderView } from '../content/AdminPlaceholderView';
import { AdminCommunityManagement } from '../community/AdminCommunityManagement';
import { AdminAIReviewManagement } from '../aiReview/AdminAIReviewManagement';
import { AdminUsersManagement } from '../users/AdminUsersManagement';
import { AdminAuditLogManagement } from '../audit/AdminAuditLogManagement';
import { AdminReportsManagement } from '../reports/AdminReportsManagement';
import { AdminGlobalSettings } from '../settings/AdminGlobalSettings';
import { AdminMediaManagement } from '../media/AdminMediaManagement';
import { ViewTransition } from '../common/ViewTransition';
import { 
  LayoutDashboard, 
  Newspaper, 
  BookOpen, 
  GraduationCap, 
  Users, 
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
  Shield,
  Film
} from 'lucide-react';

interface AdminLayoutProps {
  currentUser: AdminUser;
  onExitAdmin: () => void;
  onSignOut?: () => void;
}

export const CANONICAL_NAVIGATION_ITEMS: NavigationItem[] = [
  { id: 'overview', domain: AdminDomain.Overview, labelAr: 'لوحة التحكم والمؤشرات', labelEn: 'Overview Dashboard', iconName: 'LayoutDashboard', requiredPermission: AdminPermission.View },
  { id: 'news', domain: AdminDomain.News, labelAr: 'إدارة الأخبار البيئية', labelEn: 'Environmental News', iconName: 'Newspaper', requiredPermission: AdminPermission.Create },
  { id: 'library', domain: AdminDomain.Library, labelAr: 'المكتبة البيئية والمعرفية', labelEn: 'Knowledge Library', iconName: 'BookOpen', requiredPermission: AdminPermission.Create },
  { id: 'media', domain: AdminDomain.Media, labelAr: 'إدارة الوسائط والتشغيل', labelEn: 'Media & Videos', iconName: 'Film', requiredPermission: AdminPermission.View },
  { id: 'training', domain: AdminDomain.Training, labelAr: 'البرامج والمسارات التدريبية', labelEn: 'Training & Courses', iconName: 'GraduationCap', requiredPermission: AdminPermission.Edit },
  { id: 'community', domain: AdminDomain.Community, labelAr: 'صحافة المواطن والمجتمع', labelEn: 'Community & Moderator', iconName: 'Users', requiredPermission: AdminPermission.Review },
  { id: 'aiReviews', domain: AdminDomain.AIReviews, labelAr: 'مراجعة الذكاء الاصطناعي (AI)', labelEn: 'AI Content Auditor', iconName: 'Cpu', requiredPermission: AdminPermission.Review },
  { id: 'users', domain: AdminDomain.Users, labelAr: 'المستخدمون والصلاحيات', labelEn: 'Users & Permissions', iconName: 'ShieldAlert', requiredPermission: AdminPermission.ManageUsers },
  { id: 'auditLog', domain: AdminDomain.AuditLog, labelAr: 'سجل تدقيق الأنشطة', labelEn: 'Audit Log & History', iconName: 'History', requiredPermission: AdminPermission.ManageSettings },
  { id: 'reports', domain: AdminDomain.Reports, labelAr: 'التقارير والتحليلات البيئية', labelEn: 'System Reports', iconName: 'BarChart3', requiredPermission: AdminPermission.ViewReports },
  { id: 'settings', domain: AdminDomain.Settings, labelAr: 'الإعدادات العامة', labelEn: 'Global Settings', iconName: 'Settings', requiredPermission: AdminPermission.ManageSettings },
];

/**
 * Resolves the authorized tab to render for a given user and target tab ID.
 * Returns requestedTabId if authorized, or the first authorized fallback tab ID.
 * Returns null if the user is inactive/unauthenticated or has zero authorized tabs.
 */
export function resolveAuthorizedTab(
  user: AdminUser | null | undefined,
  requestedTabId: string,
  items: NavigationItem[] = CANONICAL_NAVIGATION_ITEMS
): string | null {
  if (!user || !user.isActive) {
    return null;
  }
  const authorizedItems = items.filter(item =>
    isTabAuthorized(user, item.domain, item.requiredPermission)
  );
  if (authorizedItems.length === 0) {
    return null;
  }

  const requestedItem = items.find(item => item.id === requestedTabId);
  if (requestedItem && isTabAuthorized(user, requestedItem.domain, requestedItem.requiredPermission)) {
    return requestedItem.id;
  }

  // Fallback to first authorized navigation item
  return authorizedItems[0].id;
}

/**
 * Attempts to navigate to a target tab ID.
 * Returns { success: true, targetTabId } if allowed, or { success: false, targetTabId: null } if unknown or unauthorized.
 */
export function attemptTabNavigation(
  user: AdminUser | null | undefined,
  requestedTabId: string,
  items: NavigationItem[] = CANONICAL_NAVIGATION_ITEMS
): { success: boolean; targetTabId: string | null } {
  if (!user || !user.isActive) {
    return { success: false, targetTabId: null };
  }
  const requestedItem = items.find(item => item.id === requestedTabId);
  if (!requestedItem) {
    return { success: false, targetTabId: null };
  }
  if (!isTabAuthorized(user, requestedItem.domain, requestedItem.requiredPermission)) {
    return { success: false, targetTabId: null };
  }
  return { success: true, targetTabId: requestedItem.id };
}

export function AdminLayout({ currentUser, onExitAdmin, onSignOut }: AdminLayoutProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  // Demo user management state for Users Management tab simulation
  const [managedUsers, setManagedUsers] = useState<AdminUser[]>(() => {
    const mocks = AdminAccessService.getMockUsers();
    const exists = mocks.some(u => u.id === currentUser.id);
    return exists ? mocks : [currentUser, ...mocks];
  });

  const [activeTab, setActiveTab] = useState<string>(() => {
    try {
      const persisted = sessionStorage.getItem('pop_admin_session');
      if (persisted) {
        const parsed = JSON.parse(persisted);
        if (parsed.tab && typeof parsed.tab === 'string') {
          return parsed.tab;
        }
      }
    } catch (e) {
      console.error('Failed to parse admin active tab:', e);
    }
    return 'overview';
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

  // Derive effectiveTab using canonical resolution boundary (returns null if zero authorized tabs or inactive user)
  const effectiveTab = useMemo(() => {
    return resolveAuthorizedTab(currentUser, activeTab, CANONICAL_NAVIGATION_ITEMS);
  }, [activeTab, currentUser]);

  // Keep activeTab normalized to effectiveTab and write normalized effectiveTab to sessionStorage
  useEffect(() => {
    if (effectiveTab && activeTab !== effectiveTab) {
      setActiveTab(effectiveTab);
    }
  }, [effectiveTab, activeTab]);

  useEffect(() => {
    if (!effectiveTab) return;
    try {
      const persisted = sessionStorage.getItem('pop_admin_session');
      const parsed = persisted ? JSON.parse(persisted) : {};
      const nextSession = { ...parsed, open: true, tab: effectiveTab };
      sessionStorage.setItem('pop_admin_session', JSON.stringify(nextSession));
    } catch (e) {
      console.error('Failed to save admin active tab:', e);
    }
  }, [effectiveTab]);

  // Handle user identity updates in Users Management demo tab
  const handleUpdateUser = (updatedUser: AdminUser) => {
    const prevUser = managedUsers.find(u => u.id === updatedUser.id);
    setManagedUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));

    if (prevUser) {
      const changes: AuditChange[] = [];
      let action: (typeof AuditAction)[keyof typeof AuditAction] = AuditAction.Updated;

      if (prevUser.role !== updatedUser.role) {
        action = AuditAction.RoleChanged;
        changes.push({ field: 'role', previousValue: prevUser.role, newValue: updatedUser.role });
      }
      if (prevUser.isActive !== updatedUser.isActive) {
        action = AuditAction.StatusChanged;
        changes.push({ field: 'isActive', previousValue: prevUser.isActive, newValue: updatedUser.isActive });
      }
      if (prevUser.name !== updatedUser.name) {
        changes.push({ field: 'name', previousValue: prevUser.name, newValue: updatedUser.name });
      }
      if (prevUser.email !== updatedUser.email) {
        changes.push({ field: 'email', previousValue: prevUser.email, newValue: updatedUser.email });
      }

      if (changes.length > 0) {
        AdminAuditService.recordEvent({
          actorUserId: currentUser.id,
          actorName: currentUser.name,
          actorRole: currentUser.role,
          action,
          targetType: AuditTargetType.AdminUser,
          targetId: updatedUser.id,
          targetTitle: `${updatedUser.name} (${updatedUser.email})`,
          changes,
        });
      }
    }
  };

  // Handle user creation in Users Management demo tab
  const handleCreateUser = (newUser: AdminUser) => {
    setManagedUsers(prev => [newUser, ...prev]);

    AdminAuditService.recordEvent({
      actorUserId: currentUser.id,
      actorName: currentUser.name,
      actorRole: currentUser.role,
      action: AuditAction.Created,
      targetType: AuditTargetType.AdminUser,
      targetId: newUser.id,
      targetTitle: `${newUser.name} (${newUser.email})`,
      changes: [
        { field: 'role', previousValue: null, newValue: newUser.role },
        { field: 'isActive', previousValue: null, newValue: newUser.isActive },
      ],
    });
  };

  // Filter visible navigation items using domain responsibility + action permission
  const visibleNavItems = useMemo(() => {
    return CANONICAL_NAVIGATION_ITEMS.filter(item => {
      return isTabAuthorized(currentUser, item.domain, item.requiredPermission);
    });
  }, [currentUser]);

  // Single canonical navigation handler
  const navigateToAuthorizedTab = (tabId: string): boolean => {
    const navResult = attemptTabNavigation(currentUser, tabId, CANONICAL_NAVIGATION_ITEMS);
    if (navResult.success && navResult.targetTabId) {
      setActiveTab(navResult.targetTabId);
      setIsSidebarOpen(false);
      return true;
    }
    return false;
  };

  const handleLanguageToggle = () => {
    const nextLang = i18n.language === 'ar' ? 'en' : 'ar';
    i18n.changeLanguage(nextLang);
  };

  const handleSignOutClick = async () => {
    if (onSignOut) {
      onSignOut();
    } else {
      await AccountService.signOut();
    }
  };

  // Helper to resolve icon by string name
  const renderIcon = (iconName: string, className: string) => {
    switch (iconName) {
      case 'LayoutDashboard': return <LayoutDashboard className={className} />;
      case 'Newspaper': return <Newspaper className={className} />;
      case 'BookOpen': return <BookOpen className={className} />;
      case 'GraduationCap': return <GraduationCap className={className} />;
      case 'Users': return <Users className={className} />;
      case 'Cpu': return <Cpu className={className} />;
      case 'ShieldAlert': return <ShieldAlert className={className} />;
      case 'History': return <History className={className} />;
      case 'BarChart3': return <BarChart3 className={className} />;
      case 'Settings': return <Settings className={className} />;
      case 'Film': return <Film className={className} />;
      default: return <Settings className={className} />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50/50 dark:bg-gray-950 flex flex-col text-gray-900 dark:text-gray-100 transition-colors pop-page-fade w-full max-w-full min-w-0" dir={isAr ? 'rtl' : 'ltr'} data-responsive-guard>
      
      {/* A. ADMIN HEAD-BAR */}
      <header className="h-16 border-b border-gray-200/80 dark:border-gray-800/80 bg-white dark:bg-gray-900/90 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between px-2 sm:px-6 shadow-xs max-w-full w-full min-w-0" id="admin-top-header" dir="ltr">
        
        {/* Left / Start Branding and Hamburger */}
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 shrink" dir={isAr ? 'rtl' : 'ltr'}>
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg lg:hidden cursor-pointer focus:outline-hidden shrink-0 pop-motion-micro"
            aria-label="Toggle Navigation Sidebar"
          >
            {isSidebarOpen ? <X className="w-5 h-5 text-gray-700 dark:text-gray-200" /> : <Menu className="w-5 h-5 text-gray-700 dark:text-gray-200" />}
          </button>
          
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <span className="h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full bg-emerald-600 animate-pulse shrink-0" />
            <span className="text-xs sm:text-base md:text-lg font-extrabold text-emerald-800 dark:text-emerald-400 truncate max-w-[110px] min-[400px]:max-w-[180px] sm:max-w-none min-w-0">
              {isAr ? 'لوحة التحكم الإدارية' : 'Promise of Planet Back-Office'}
            </span>
          </div>
        </div>

        {/* Right / End Controls (Authenticated Identity Info, Language Toggle, Sign Out, Exit) */}
        <div className="flex items-center gap-1 sm:gap-2.5 shrink-0 min-w-0" dir="ltr" id="admin-fixed-control-zone">
          
          {/* Authenticated Admin Identity Badge */}
          <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-900/40 rounded-lg shrink-0" dir={isAr ? 'rtl' : 'ltr'}>
            <Shield className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="text-xs font-bold text-gray-800 dark:text-gray-200 truncate max-w-[100px] sm:max-w-[150px]">
              {currentUser.name}
            </span>
            <span className="px-1.5 py-0.2 text-[10px] font-extrabold rounded bg-emerald-600 text-white shrink-0">
              {currentUser.role}
            </span>
          </div>

          {/* i18n Language toggle button */}
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
            className="px-2 sm:px-2.5 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer pop-motion-micro shrink-0"
            id="exit-admin-btn"
            dir={isAr ? 'rtl' : 'ltr'}
          >
            <span className="hidden sm:inline">{isAr ? 'موقع المنصة' : 'Exit Portal'}</span>
            <span className="sm:hidden">{isAr ? 'خروج' : 'Exit'}</span>
          </button>

          {/* SIGN OUT button */}
          <button
            onClick={handleSignOutClick}
            className="px-2 sm:px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer shadow-xs pop-motion-micro shrink-0"
            id="signout-admin-btn"
            dir={isAr ? 'rtl' : 'ltr'}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">{isAr ? 'تسجيل الخروج' : 'Sign Out'}</span>
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

        {/* B. ADMIN SIDE-BAR NAVIGATION */}
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
                    onClick={() => navigateToAuthorizedTab(item.id)}
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

          {/* Sidebar Footer: Current authenticated admin identity info */}
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
          <ViewTransition viewKey={effectiveTab || 'none'}>
            {!effectiveTab ? (
              <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 max-w-md mx-auto text-center space-y-4 shadow-lg my-12" dir={isAr ? 'rtl' : 'ltr'}>
                <div className="h-12 w-12 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
                  <Shield className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-gray-100">
                    {isAr ? 'وصول مقيد - لا توجد أقسام مصرح بها' : 'Access Restricted - No Authorized Sections'}
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {isAr
                      ? `حسابك الحالي (${currentUser.role}) غير نشط أو لا يملك أي صلاحيات للوصول إلى أقسام لوحة التحكم.`
                      : `Your current account (${currentUser.role}) is inactive or lacks permissions to access any admin workspace section.`}
                  </p>
                </div>
                <button
                  onClick={handleSignOutClick}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shadow-xs"
                >
                  {isAr ? 'تسجيل الخروج' : 'Sign Out'}
                </button>
              </div>
            ) : effectiveTab === 'overview' ? (
              <AdminOverview currentUser={currentUser} />
            ) : effectiveTab === 'news' ? (
              <AdminNewsManagement currentUser={currentUser} />
            ) : effectiveTab === 'library' ? (
              <AdminLibraryManagement currentUser={currentUser} />
            ) : effectiveTab === 'media' ? (
              <AdminMediaManagement currentUser={currentUser} />
            ) : effectiveTab === 'training' ? (
              <AdminTrainingManagement currentUser={currentUser} />
            ) : effectiveTab === 'community' ? (
              <AdminCommunityManagement currentUser={currentUser} />
            ) : effectiveTab === 'aiReviews' ? (
              <AdminAIReviewManagement currentUser={currentUser} />
            ) : effectiveTab === 'users' ? (
              <AdminUsersManagement
                currentUser={currentUser}
                users={managedUsers}
                onUpdateUser={handleUpdateUser}
                onCreateUser={handleCreateUser}
              />
            ) : effectiveTab === 'auditLog' ? (
              <AdminAuditLogManagement currentUser={currentUser} />
            ) : effectiveTab === 'reports' ? (
              <AdminReportsManagement
                currentUser={currentUser}
                onNavigate={(tabId: string) => navigateToAuthorizedTab(tabId)}
              />
            ) : effectiveTab === 'settings' ? (
              <AdminGlobalSettings currentUser={currentUser} />
            ) : (
              <AdminPlaceholderView id={effectiveTab} currentUser={currentUser} />
            )}
          </ViewTransition>
        </main>

      </div>
    </div>
  );
}
