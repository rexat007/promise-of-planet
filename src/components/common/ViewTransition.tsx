import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

interface ViewTransitionProps {
  viewKey: string;
  children: ReactNode;
  className?: string;
}

/**
 * Promise of Planet Editorial View Transition System
 * 
 * Architecture:
 * - Concurrent CSS Grid Layer Stacking (grid-area: 1/1): Both outgoing and incoming views
 *   occupy the exact same layout cell during the transition.
 * - Zero Layout Shift / Zero Flash: The page background is never exposed because the incoming
 *   view smoothly dissolves directly on top of the outgoing view.
 * - Editorial Depth Signature: Combines subtle micro-scale alignment with soft focus settling
 *   (2px blur refinement) over an editorial easing curve (220ms).
 * - Full Reduced Motion Compliance: Automatically falls back to a clean, instant opacity crossfade
 *   when prefers-reduced-motion is enabled.
 */
export function ViewTransition({ viewKey, children, className = '' }: ViewTransitionProps) {
  const shouldReduceMotion = useReducedMotion();

  const variants = shouldReduceMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        initial: { opacity: 0, scale: 0.996, filter: 'blur(2px)' },
        animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
        exit: { opacity: 0, scale: 1.003, filter: 'blur(2px)' },
      };

  return (
    <div className={`grid grid-cols-1 grid-rows-1 isolate w-full min-w-0 ${className}`}>
      <AnimatePresence initial={false}>
        <motion.div
          key={viewKey}
          initial="initial"
          animate="animate"
          exit="exit"
          variants={variants}
          transition={{
            duration: shouldReduceMotion ? 0.14 : 0.22,
            ease: [0.16, 1, 0.3, 1], // --pop-ease-editorial cubic bezier
          }}
          className="col-start-1 row-start-1 w-full min-w-0"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

