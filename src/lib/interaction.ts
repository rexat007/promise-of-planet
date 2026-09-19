/**
 * PROMISE OF PLANET — GLOBAL INTERACTION & MOTION SYSTEM ARCHITECTURE
 * 
 * INTERACTION RULES MANIFEST:
 * 
 * RULE A: Navigation movement should communicate destination (smooth scroll + intentional section focus arrival).
 * RULE B: Contextual panels originate from their controlling context (header mega-panel drops down from nav item).
 * RULE C: Content discovery uses motion to reveal hierarchy (progressive disclosure, subtle card elevation).
 * RULE D: State confirmation uses restrained feedback (e.g. single modal overlay state swap without page shifts).
 * RULE E: Repeated controls share a recognizable interaction behavior across the platform.
 * RULE F: Motion must never compete with environmental journalism / knowledge content.
 * RULE G: No component should invent its own unrelated animation language.
 * RULE H: All future pages/components must reuse these patterns.
 * RULE I: RTL/LTR changes content direction, NOT the physical identity or anchor position of global controls.
 * RULE J: Respect prefers-reduced-motion globally.
 * RULE K: Contextual Header panels are overlays and must not alter document flow or push page content downward.
 * RULE L: Global navigation infrastructure (including vertical scrollbar placement) must remain physically stable when language direction changes.
 * RULE M: Page/state transitions may use restrained fade-based spatial continuity when moving between views.
 */

export const MOTION_TOKENS = {
  MICRO: 'var(--pop-duration-micro)',       // 150ms: buttons, active presses, micro-feedback
  STANDARD: 'var(--pop-duration-standard)', // 220ms: card elevations, state shifts
  SECTION: 'var(--pop-duration-section)',   // 400ms: editorial section focus & smooth scroll
  PANEL: 'var(--pop-duration-panel)',       // 250ms: contextual header dropdowns, mega-panels
  MODAL: 'var(--pop-duration-modal)',       // 280ms: spatial origin-aware dialogs & overlays
} as const;

export const MOTION_EASINGS = {
  OUT: 'var(--pop-ease-out)',
  IN_OUT: 'var(--pop-ease-in-out)',
  EDITORIAL: 'var(--pop-ease-editorial)',
} as const;

/**
 * Smoothly scrolls to a section on the page with a sticky-header-aware offset
 * and applies a subtle destination highlight/focus animation.
 */
export function smoothScrollToSection(sectionId: string) {
  const targetElement = document.getElementById(sectionId);
  if (!targetElement) return;

  const headerOffset = 90; // Header height + padding buffer
  const elementPosition = targetElement.getBoundingClientRect().top;
  const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

  window.scrollTo({
    top: offsetPosition,
    behavior: 'smooth',
  });

  // Apply subtle editorial focus animation to target section
  targetElement.classList.remove('pop-section-highlight');
  // Trigger reflow for re-animation
  void targetElement.offsetWidth;
  targetElement.classList.add('pop-section-highlight');

  // Remove focus class after animation finishes
  setTimeout(() => {
    targetElement.classList.remove('pop-section-highlight');
  }, 1400);
}
