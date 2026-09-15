import React from 'react';

export function Section({ children, className = '', id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`py-8 sm:py-12 ${className}`}>
      {children}
    </section>
  );
}
