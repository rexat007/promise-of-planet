import { useEffect, useState } from 'react';

/**
 * Promise of Planet — Development-Only Diagnostic Responsive Guard
 * 
 * Observes document root and element geometry to detect horizontal layout violations
 * during real browser sessions in development mode.
 * 
 * CONSTRAINTS:
 * - DEV ONLY (import.meta.env.DEV)
 * - OBSERVATION ONLY (Never hides, clips, mutates, or repairs layout)
 * - RTL / LTR Aware
 * - Off-canvas exclusion via data-responsive-guard-ignore
 * - Critical container inspection via data-responsive-guard
 */

interface ViolationRecord {
  type: 'root' | 'element' | 'container';
  tag: string;
  id?: string;
  className?: string;
  viewportWidth: number;
  scrollWidth: number;
  clientWidth: number;
  overflowAmount: number;
  side: 'LEFT' | 'RIGHT' | 'BOTH';
  lang: string;
  dir: string;
}

export function ResponsiveGuard() {
  const [violations, setViolations] = useState<ViolationRecord[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    // Only active in development mode
    if (!import.meta.env.DEV) return;

    const TOLERANCE = 1.5; // sub-pixel tolerance in pixels

    const runDiagnosticScan = () => {
      const docEl = document.documentElement;
      const bodyEl = document.body;
      const viewportWidth = window.innerWidth;
      const lang = docEl.lang || 'ar';
      const dir = docEl.dir || 'ltr';

      const foundViolations: ViolationRecord[] = [];

      // 1. Root Overflow Check
      const rootScrollW = docEl.scrollWidth;
      const rootClientW = docEl.clientWidth;
      const bodyScrollW = bodyEl.scrollWidth;

      if (rootScrollW - rootClientW > TOLERANCE || bodyScrollW - viewportWidth > TOLERANCE) {
        const overflow = Math.max(rootScrollW - rootClientW, bodyScrollW - viewportWidth);
        foundViolations.push({
          type: 'root',
          tag: 'HTML/BODY',
          viewportWidth,
          scrollWidth: rootScrollW,
          clientWidth: rootClientW,
          overflowAmount: Math.round(overflow * 10) / 10,
          side: 'BOTH',
          lang,
          dir,
        });
      }

      // 2. Critical Container Check ([data-responsive-guard])
      const containers = document.querySelectorAll('[data-responsive-guard]');
      containers.forEach((container, idx) => {
        const el = container as HTMLElement;
        const cScrollW = el.scrollWidth;
        const cClientW = el.clientWidth;
        if (cScrollW - cClientW > TOLERANCE) {
          foundViolations.push({
            type: 'container',
            tag: el.tagName,
            id: el.id || `container-${idx}`,
            className: el.className,
            viewportWidth,
            scrollWidth: cScrollW,
            clientWidth: cClientW,
            overflowAmount: Math.round((cScrollW - cClientW) * 10) / 10,
            side: 'BOTH',
            lang,
            dir,
          });
        }
      });

      // 3. Element Geometry Check across all visible elements
      const allElements = document.querySelectorAll('body *');
      allElements.forEach((node) => {
        const el = node as HTMLElement;

        // Skip ignored elements or invisible elements
        if (
          el.hasAttribute('data-responsive-guard-ignore') ||
          el.closest('[data-responsive-guard-ignore]') ||
          el.offsetParent === null ||
          el.tagName === 'SCRIPT' ||
          el.tagName === 'STYLE' ||
          el.tagName === 'NOSCRIPT'
        ) {
          return;
        }

        const rect = el.getBoundingClientRect();
        // Skip zero-size elements
        if (rect.width === 0 || rect.height === 0) return;

        let side: 'LEFT' | 'RIGHT' | 'BOTH' | null = null;
        let escapeAmount = 0;

        const escapesLeft = rect.left < -TOLERANCE;
        const escapesRight = rect.right > viewportWidth + TOLERANCE;

        if (escapesLeft && escapesRight) {
          side = 'BOTH';
          escapeAmount = Math.max(Math.abs(rect.left), rect.right - viewportWidth);
        } else if (escapesLeft) {
          side = 'LEFT';
          escapeAmount = Math.abs(rect.left);
        } else if (escapesRight) {
          side = 'RIGHT';
          escapeAmount = rect.right - viewportWidth;
        }

        if (side && escapeAmount > TOLERANCE) {
          foundViolations.push({
            type: 'element',
            tag: el.tagName,
            id: el.id || undefined,
            className: typeof el.className === 'string' ? el.className.slice(0, 80) : undefined,
            viewportWidth,
            scrollWidth: Math.round(rect.width),
            clientWidth: viewportWidth,
            overflowAmount: Math.round(escapeAmount * 10) / 10,
            side,
            lang,
            dir,
          });
        }
      });

      // Deduplicate violations by signature
      const uniqueMap = new Map<string, ViolationRecord>();
      foundViolations.forEach((v) => {
        const key = `${v.type}-${v.tag}-${v.id || ''}-${v.side}-${Math.round(v.overflowAmount)}`;
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, v);
        }
      });

      const uniqueViolations = Array.from(uniqueMap.values());
      setViolations(uniqueViolations);

      // Structured console warning if violations exist (deduplicated per cycle)
      if (uniqueViolations.length > 0) {
        console.groupCollapsed(
          `🛡️ [ResponsiveGuard] Layout Violation Detected: ${uniqueViolations.length} issue(s) [Viewport: ${viewportWidth}px, Dir: ${dir}]`
        );
        uniqueViolations.forEach((v) => {
          console.warn(
            `[${v.type.toUpperCase()}] <${v.tag}>${v.id ? `#${v.id}` : ''} escapes ${v.side} by ${v.overflowAmount}px (Viewport: ${v.viewportWidth}px, Lang: ${v.lang}, Dir: ${v.dir})`,
            v
          );
        });
        console.groupEnd();
      }
    };

    // Trigger initial scan and listen to resize / mutation events
    let timeoutId: number;
    const debouncedScan = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(runDiagnosticScan, 250);
    };

    runDiagnosticScan();

    window.addEventListener('resize', debouncedScan);
    const observer = new MutationObserver(debouncedScan);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('resize', debouncedScan);
      observer.disconnect();
    };
  }, []);

  // Do not render anything in production
  if (!import.meta.env.DEV) return null;

  return (
    <div className="fixed bottom-3 left-3 z-[99999] font-sans text-xs select-none pointer-events-auto">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className={`px-3 py-1.5 rounded-lg shadow-lg cursor-pointer flex items-center gap-2 transition-all ${
          violations.length > 0
            ? 'bg-amber-600 text-white animate-pulse'
            : 'bg-emerald-900/90 text-emerald-100 hover:bg-emerald-900 backdrop-blur-sm border border-emerald-700/50'
        }`}
      >
        <span className="text-sm">🛡️</span>
        <span className="font-semibold">
          {violations.length > 0 ? `Responsive Guard: ${violations.length} overflow(s)` : 'Responsive Guard: OK'}
        </span>
        <span className="text-[10px] opacity-80">({window.innerWidth}px)</span>
      </div>

      {isExpanded && violations.length > 0 && (
        <div className="mt-2 w-80 max-h-72 overflow-y-auto bg-gray-900 text-gray-100 p-3 rounded-xl shadow-2xl border border-gray-700 text-[11px] space-y-2">
          <div className="flex justify-between items-center border-b border-gray-800 pb-1 font-bold text-amber-400">
            <span>Layout Violations ({violations.length})</span>
            <button onClick={() => setViolations([])} className="text-gray-400 hover:text-white text-[10px]">
              Clear
            </button>
          </div>
          <div className="space-y-1.5">
            {violations.map((v, i) => (
              <div key={i} className="bg-gray-800/80 p-2 rounded border border-gray-700/60 space-y-0.5">
                <div className="flex justify-between font-mono text-amber-300">
                  <span>
                    &lt;{v.tag}&gt; {v.id ? `#${v.id}` : ''}
                  </span>
                  <span>+{v.overflowAmount}px ({v.side})</span>
                </div>
                {v.className && <div className="text-gray-400 truncate font-mono text-[10px]">{v.className}</div>}
                <div className="text-[10px] text-gray-400 flex justify-between">
                  <span>Viewport: {v.viewportWidth}px</span>
                  <span>Dir: {v.dir.toUpperCase()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
