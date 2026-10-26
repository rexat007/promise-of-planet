import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClimateClockSlot } from './ClimateClockSlot';
import { Header, type PublicPageKey } from './Header';
import { Footer } from './Footer';
import { GlobalMemberAccountDialog } from '../auth/GlobalMemberAccountDialog';

interface AppShellProps {
  children: React.ReactNode;
  onEnterAdmin?: () => void;
  activePage?: PublicPageKey;
  onNavigate?: (page: PublicPageKey) => void;
  isMemberAccountOpen?: boolean;
  onOpenMemberAccount?: () => void;
  onCloseMemberAccount?: () => void;
}

export function AppShell({
  children,
  onEnterAdmin,
  activePage,
  onNavigate,
  isMemberAccountOpen,
  onOpenMemberAccount,
  onCloseMemberAccount,
}: AppShellProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';
  const [internalAccountOpen, setInternalAccountOpen] = useState(false);

  const isDialogOpen =
    isMemberAccountOpen !== undefined ? isMemberAccountOpen : internalAccountOpen;
  const handleOpenAccount =
    onOpenMemberAccount ?? (() => setInternalAccountOpen(true));
  const handleCloseAccount =
    onCloseMemberAccount ?? (() => setInternalAccountOpen(false));

  return (
    <div 
      data-responsive-guard 
      className="min-h-screen flex flex-col w-full max-w-full min-w-0 bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors"
    >
      {/* 1. Climate Clock in independent space before Header */}
      <ClimateClockSlot />

      {/* 2. Header */}
      <Header
        onEnterAdmin={onEnterAdmin}
        activePage={activePage}
        onNavigate={onNavigate}
        onOpenMemberAccount={handleOpenAccount}
        isMemberAccountOpen={isDialogOpen}
      />

      {/* Global Member Account Dialog */}
      <GlobalMemberAccountDialog
        isOpen={isDialogOpen}
        onClose={handleCloseAccount}
        onEnterAdmin={onEnterAdmin}
        isAr={isAr}
      />

      {/* 3. Main Content with full-width structural safety */}
      <main className="flex-grow pop-page-fade w-full max-w-full min-w-0">
        {children}
      </main>

      {/* 4. Footer */}
      <Footer onNavigate={onNavigate} />
    </div>
  );
}
