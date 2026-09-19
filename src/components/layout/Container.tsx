import React from 'react';

export function Container({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`w-full max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 min-w-0 ${className}`}>
      {children}
    </div>
  );
}
