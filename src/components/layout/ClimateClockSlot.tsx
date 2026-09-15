import { useEffect } from 'react';

export function ClimateClockSlot() {
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

  return (
    <div className="w-full bg-transparent">
      <div className="w-full px-4 py-3 flex items-center">
        <climate-clock className="block w-full" />
      </div>
    </div>
  );
}
