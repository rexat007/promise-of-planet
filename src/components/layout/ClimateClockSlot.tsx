import { useEffect, useRef, useState } from 'react';
import { GlobalSettingsService } from '../../services/globalSettingsService';

export function ClimateClockSlot() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isEnabled, setIsEnabled] = useState(() => GlobalSettingsService.getSettings().climateClockEnabled);

  // Subscribe to settings changes for reactive presentation
  useEffect(() => {
    return GlobalSettingsService.subscribe((settings) => {
      setIsEnabled(settings.climateClockEnabled);
    });
  }, []);

  useEffect(() => {
    if (!isEnabled) return;
    const scriptSrc = 'https://climateclock.world/widget-v2.js';
    const existing = document.querySelector(`script[src="${scriptSrc}"]`);
    if (!existing) {
      const script = document.createElement('script');
      script.src = scriptSrc;
      script.async = true;
      document.body.appendChild(script);
    }
  }, [isEnabled]);



  if (!isEnabled) {
    return null;
  }

  return (
    <div className="w-full max-w-full bg-transparent overflow-hidden" ref={containerRef}>
      <div className="w-full px-4 py-3 flex items-center max-w-full overflow-hidden">
        <climate-clock className="block w-full max-w-full" />
      </div>
    </div>
  );
}
