"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ViewTransition = ViewTransition;
const react_1 = require("motion/react");
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
function ViewTransition({ viewKey, children, className = '' }) {
    const shouldReduceMotion = (0, react_1.useReducedMotion)();
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
    return (<div className={`grid grid-cols-1 grid-rows-1 isolate w-full min-w-0 ${className}`}>
      <react_1.AnimatePresence initial={false}>
        <react_1.motion.div key={viewKey} initial="initial" animate="animate" exit="exit" variants={variants} transition={{
            duration: shouldReduceMotion ? 0.14 : 0.22,
            ease: [0.16, 1, 0.3, 1], // --pop-ease-editorial cubic bezier
        }} className="col-start-1 row-start-1 w-full min-w-0">
          {children}
        </react_1.motion.div>
      </react_1.AnimatePresence>
    </div>);
}
//# sourceMappingURL=ViewTransition.js.map