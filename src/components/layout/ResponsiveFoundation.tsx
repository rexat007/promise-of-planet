import React from 'react';

/**
 * Promise of Planet — Global Responsive Foundation Component Primitives
 * 
 * Thin semantic composition wrappers over canonical .pop-* CSS utilities in src/index.css:
 * - ResponsiveContainer → .pop-container-responsive
 * - ResponsiveGrid → .pop-grid-auto / .pop-grid-2col / .pop-grid-4col
 * - ResponsiveToolbar → .pop-toolbar-responsive
 * - ResponsiveText → .pop-text-safe
 * - ResponsiveMedia → .pop-media-responsive
 * - ResponsiveStack → Semantic flex layout wrapper with min-w-0 safety
 * 
 * NOTE ON LEGACY BODY OVERFLOW SUPPRESSION:
 * body { overflow-x: hidden; } (if present) is retained as a 
 * TEMPORARY LEGACY SAFETY RULE pending controlled removal during 
 * Responsive Guard activation. No new global overflow suppression was introduced.
 */

interface ResponsiveContainerProps {
  children: React.ReactNode;
  className?: string;
  as?: React.ElementType;
  id?: string;
}

export function ResponsiveContainer({
  children,
  className = '',
  as: Component = 'div',
  id
}: ResponsiveContainerProps) {
  return (
    <Component
      id={id}
      className={`pop-container-responsive ${className}`}
    >
      {children}
    </Component>
  );
}

interface ResponsiveGridProps {
  children: React.ReactNode;
  cols?: 1 | 2 | 3 | 4 | 'auto';
  gap?: 'sm' | 'md' | 'lg';
  className?: string;
  id?: string;
}

export function ResponsiveGrid({
  children,
  cols = 'auto',
  gap = 'md',
  className = '',
  id
}: ResponsiveGridProps) {
  const gapClass = gap === 'sm' ? 'gap-3 sm:gap-4' : gap === 'lg' ? 'gap-6 sm:gap-8' : 'gap-4 sm:gap-6';

  let gridClass = 'pop-grid-auto';
  if (cols === 2) gridClass = 'pop-grid-2col';
  else if (cols === 4) gridClass = 'pop-grid-4col';
  else if (cols === 1) gridClass = 'grid grid-cols-1 w-full min-w-0';

  return (
    <div id={id} className={`${gridClass} ${gapClass} ${className}`}>
      {children}
    </div>
  );
}

interface ResponsiveStackProps {
  children: React.ReactNode;
  direction?: 'vertical' | 'responsive';
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between';
  gap?: 'sm' | 'md' | 'lg';
  className?: string;
  id?: string;
}

export function ResponsiveStack({
  children,
  direction = 'responsive',
  align = 'stretch',
  justify = 'between',
  gap = 'md',
  className = '',
  id
}: ResponsiveStackProps) {
  const dirClass = direction === 'vertical' ? 'flex-col' : 'flex-col sm:flex-row';
  const alignClass = align === 'start' ? 'items-start' : align === 'center' ? 'items-center' : align === 'end' ? 'items-end' : 'items-stretch';
  const justifyClass = justify === 'start' ? 'justify-start' : justify === 'center' ? 'justify-center' : justify === 'end' ? 'justify-end' : 'justify-between';
  const gapClass = gap === 'sm' ? 'gap-2 sm:gap-3' : gap === 'lg' ? 'gap-5 sm:gap-6' : 'gap-3 sm:gap-4';

  return (
    <div id={id} className={`flex ${dirClass} ${alignClass} ${justifyClass} ${gapClass} w-full min-w-0 ${className}`}>
      {children}
    </div>
  );
}

interface ResponsiveToolbarProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export function ResponsiveToolbar({ children, className = '', id }: ResponsiveToolbarProps) {
  return (
    <div
      id={id}
      className={`pop-toolbar-responsive ${className}`}
    >
      {children}
    </div>
  );
}

interface ResponsiveTextProps {
  children: React.ReactNode;
  className?: string;
  as?: React.ElementType;
  id?: string;
}

export function ResponsiveText({
  children,
  className = '',
  as: Component = 'p',
  id
}: ResponsiveTextProps) {
  return (
    <Component
      id={id}
      className={`pop-text-safe ${className}`}
    >
      {children}
    </Component>
  );
}

interface ResponsiveMediaProps {
  src: string;
  alt: string;
  className?: string;
  aspectRatio?: 'auto' | 'video' | 'square' | 'wide';
}

export function ResponsiveMedia({
  src,
  alt,
  className = '',
  aspectRatio = 'auto'
}: ResponsiveMediaProps) {
  const aspectClass = aspectRatio === 'video' ? 'aspect-video' : aspectRatio === 'square' ? 'aspect-square' : aspectRatio === 'wide' ? 'aspect-[21/9]' : '';

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={`pop-media-responsive rounded-xl ${aspectClass} ${className}`}
    />
  );
}

