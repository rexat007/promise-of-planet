import React from 'react';
import { ClimateClockSlot } from './ClimateClockSlot';
import { Header } from './Header';
import { Footer } from './Footer';

interface AppShellProps {
  children: React.ReactNode;
  onEnterAdmin?: () => void;
  activePage?: 'home' | 'training-center';
  onNavigate?: (page: 'home' | 'training-center') => void;
}

export function AppShell({ children, onEnterAdmin, activePage, onNavigate }: AppShellProps) {
  return (
    <div 
      data-responsive-guard 
      className="min-h-screen flex flex-col w-full max-w-full min-w-0 bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors"
    >
      {/* 1. Climate Clock in independent space before Header */}
      <ClimateClockSlot />

      {/* 2. Header */}
      <Header onEnterAdmin={onEnterAdmin} activePage={activePage} onNavigate={onNavigate} />

      {/* 3. Main Content with full-width structural safety */}
      <main className="flex-grow pop-page-fade w-full max-w-full min-w-0">
        {children}
      </main>

      {/* 4. Footer */}
      <Footer />
    </div>
  );
}


