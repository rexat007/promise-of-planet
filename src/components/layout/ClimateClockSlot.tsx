import { useEffect, useRef } from 'react';

// Patch document.getElementById safely once to catch unmounted climate-clock widgets from widget-v2.js
if (typeof window !== 'undefined') {
  const originalGetElementById = document.getElementById.bind(document);
  document.getElementById = function (id: string) {
    const el = originalGetElementById(id);
    if (!el && typeof id === 'string' && id.startsWith('ccw-container-')) {
      return {
        clientWidth: 0,
        clientHeight: 0,
        style: {},
        getAttribute: () => null,
        setAttribute: () => {},
      } as unknown as HTMLElement;
    }
    return el;
  };
}

export function ClimateClockSlot() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scriptSrc = 'https://climateclock.world/widget-v2.js';
    const existing = document.querySelector(`script[src="${scriptSrc}"]`);
    if (!existing) {
      const script = document.createElement('script');
      script.src = scriptSrc;
      script.async = true;
      document.body.appendChild(script);
    }
  }, []);

  // Recalculate climate-clock layout on mount & container resize (e.g. returning from Admin Portal on mobile)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let rafId: number;
    let lastWidth = 0;

    const triggerClockResize = () => {
      if (containerRef.current && document.body.contains(containerRef.current)) {
        window.dispatchEvent(new Event('resize'));
      }
    };

    // Refresh layout after animation frame when DOM layout settles upon returning from Admin
    rafId = requestAnimationFrame(() => {
      triggerClockResize();
    });

    // Observe container dimension changes (e.g. navigation return, layout shifts, or orientation changes)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width > 0 && width !== lastWidth) {
          lastWidth = width;
          triggerClockResize();
        }
      }
    });

    observer.observe(container);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="w-full max-w-full bg-transparent overflow-hidden" ref={containerRef}>
      <div className="w-full px-4 py-3 flex items-center max-w-full overflow-hidden">
        <climate-clock className="block w-full max-w-full" />
      </div>
    </div>
  );
}
