import React from 'react';

export function Section({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`py-8 sm:py-12 ${className}`}>
      {children}
    </section>
  );
}
