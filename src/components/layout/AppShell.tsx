import React from 'react';
import { ClimateClockSlot } from './ClimateClockSlot';
import { Header } from './Header';
import { Footer } from './Footer';

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors">
      {/* 1. Climate Clock in independent space before Header */}
      <ClimateClockSlot />

      {/* 2. Header */}
      <Header />

      {/* 3. Main Content */}
      <main className="flex-grow">
        {children}
      </main>

      {/* 4. Footer */}
      <Footer />
    </div>
  );
}
