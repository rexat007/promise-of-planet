import React from 'react';

export function Section({ children, className = '', id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`py-6 sm:py-10 lg:py-12 w-full min-w-0 ${className}`}>
      {children}
    </section>
  );
}
