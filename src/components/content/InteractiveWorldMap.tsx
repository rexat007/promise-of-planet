import React, { useEffect, useRef, useState, useCallback } from 'react';
import { getCategoryLabel } from './contentFormatters';
import {
  EQUAL_EARTH_CODE,
  EQUAL_EARTH_EXTENT,
  registerEqualEarthProjection,
  GEOGRAPHIC_DATA_SOURCE,
  PROTOTYPE_MAP_MARKERS,
} from './equalEarthMapConfig';
import type { MapEventMarker } from './equalEarthMapConfig';

export type { MapEventMarker };
export {
  EQUAL_EARTH_CODE,
  EQUAL_EARTH_EXTENT,
  registerEqualEarthProjection,
  GEOGRAPHIC_DATA_SOURCE,
  PROTOTYPE_MAP_MARKERS,
};

import 'ol/ol.css';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style.js';
import { defaults as defaultControls } from 'ol/control.js';
import { fromLonLat } from 'ol/proj.js';

export interface InteractiveWorldMapProps {
  currentLanguage: 'ar' | 'en';
  onMarkerSelect?: (marker: MapEventMarker) => void;
  className?: string;
}

export const InteractiveWorldMap: React.FC<InteractiveWorldMapProps> = ({
  currentLanguage,
  onMarkerSelect,
  className = '',
}) => {
  const isArabic = currentLanguage === 'ar';
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const countrySourceRef = useRef<VectorSource | null>(null);
  const markerSourceRef = useRef<VectorSource | null>(null);

  const [activeScope, setActiveScope] = useState<'All' | 'Sudan' | 'Africa' | 'Global'>('All');
  const [selectedMarker, setSelectedMarker] = useState<MapEventMarker | null>(PROTOTYPE_MAP_MARKERS[1]);
  const [loadingState, setLoadingState] = useState<'loading' | 'success' | 'error' | 'empty'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeProjectionCode, setActiveProjectionCode] = useState<string>('');

  // Initial geographic focus coordinates for Sudan in Equal Earth (approx longitude 30° E, latitude 15° N)
  const getSudanCenterInEqualEarth = useCallback((): [number, number] => {
    registerEqualEarthProjection();
    const pt = fromLonLat([30, 15], EQUAL_EARTH_CODE);
    return [pt[0], pt[1]];
  }, []);

  // Update marker features based on active scope filter
  const refreshMarkerFeatures = useCallback((scope: 'All' | 'Sudan' | 'Africa' | 'Global', currentSelectedId?: string) => {
    if (!markerSourceRef.current) return;
    markerSourceRef.current.clear();

    const filtered = PROTOTYPE_MAP_MARKERS.filter((m) => {
      if (scope === 'All') return true;
      return m.scope === scope;
    });

    filtered.forEach((marker) => {
      const coord = fromLonLat(marker.coordinates, EQUAL_EARTH_CODE);
      const feature = new Feature({
        geometry: new Point(coord),
        markerData: marker,
        markerId: marker.id,
      });

      const isSelected = marker.id === currentSelectedId;

      const markerStyle = new Style({
        image: new CircleStyle({
          radius: isSelected ? 8 : 6,
          fill: new Fill({
            color: isSelected ? '#10b981' : '#059669',
          }),
          stroke: new Stroke({
            color: isSelected ? '#ffffff' : '#064e3b',
            width: isSelected ? 2.5 : 1.5,
          }),
        }),
      });

      feature.setStyle(markerStyle);
      markerSourceRef.current?.addFeature(feature);
    });
  }, []);

  // Load GeoJSON data into VectorSource with explicit loading/error/empty handling
  const loadGeographicData = useCallback(async () => {
    setLoadingState('loading');
    setErrorMessage(null);

    try {
      registerEqualEarthProjection();
      const response = await fetch(GEOGRAPHIC_DATA_SOURCE.path);

      if (!response.ok) {
        throw new Error(
          isArabic
            ? `فشل تحميل البيانات الجغرافية: رمز الخطأ ${response.status}`
            : `Failed to load geographic data: HTTP status ${response.status}`
        );
      }

      const geojsonData = await response.json();

      if (!geojsonData || !geojsonData.features || geojsonData.features.length === 0) {
        setLoadingState('empty');
        return;
      }

      const format = new GeoJSON();
      const features = format.readFeatures(geojsonData, {
        dataProjection: 'EPSG:4326',
        featureProjection: EQUAL_EARTH_CODE,
      });

      if (!features || features.length === 0) {
        setLoadingState('empty');
        return;
      }

      countrySourceRef.current?.clear();
      countrySourceRef.current?.addFeatures(features);
      setLoadingState('success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setLoadingState('error');
    }
  }, [isArabic]);

  // Initialize OpenLayers Map with Equal Earth projection
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const proj = registerEqualEarthProjection();
    if (!proj) {
      setErrorMessage('Failed to initialize Equal Earth projection (EPSG:8857).');
      setLoadingState('error');
      return;
    }

    setActiveProjectionCode(proj.getCode());

    const sudanCenter = getSudanCenterInEqualEarth();

    const view = new View({
      projection: proj,
      center: sudanCenter,
      zoom: 3.2,
      minZoom: 1.2,
      maxZoom: 7,
      extent: EQUAL_EARTH_EXTENT,
    });

    const countrySource = new VectorSource();
    countrySourceRef.current = countrySource;

    const countryLayer = new VectorLayer({
      source: countrySource,
      style: (feature) => {
        const name = (feature.get('NAME') || feature.get('ADMIN') || '').toString().toLowerCase();
        const isSudan = name.includes('sudan') && !name.includes('south');

        if (isSudan) {
          return new Style({
            fill: new Fill({ color: 'rgba(5, 150, 105, 0.45)' }),
            stroke: new Stroke({ color: '#10b981', width: 2 }),
          });
        }

        return new Style({
          fill: new Fill({ color: 'rgba(31, 41, 55, 0.75)' }),
          stroke: new Stroke({ color: '#374151', width: 0.8 }),
        });
      },
    });

    const markerSource = new VectorSource();
    markerSourceRef.current = markerSource;

    const markerLayer = new VectorLayer({
      source: markerSource,
      zIndex: 10,
    });

    const map = new Map({
      target: mapContainerRef.current,
      layers: [countryLayer, markerLayer],
      view: view,
      controls: defaultControls({
        zoom: false,
        rotate: false,
        attribution: false,
      }),
    });

    mapInstanceRef.current = map;

    // Handle map click on marker features
    map.on('click', (event) => {
      const feature = map.forEachFeatureAtPixel(event.pixel, (f, layer) => {
        if (layer === markerLayer) return f;
        return null;
      });

      if (feature) {
        const marker = feature.get('markerData') as MapEventMarker | undefined;
        if (marker) {
          setSelectedMarker(marker);
          onMarkerSelect?.(marker);
        }
      }
    });

    // Pointer cursor when hovering markers
    map.on('pointermove', (event) => {
      const hit = map.hasFeatureAtPixel(event.pixel, {
        layerFilter: (layer) => layer === markerLayer,
      });
      map.getTargetElement().style.cursor = hit ? 'pointer' : '';
    });

    // Load GeoJSON data
    loadGeographicData();

    // Initial markers populate
    refreshMarkerFeatures('All', PROTOTYPE_MAP_MARKERS[1]?.id);

    // Resize handling via ResizeObserver
    const resizeObserver = new ResizeObserver(() => {
      map.updateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.setTarget(undefined);
      mapInstanceRef.current = null;
    };
  }, [getSudanCenterInEqualEarth, loadGeographicData, onMarkerSelect, refreshMarkerFeatures]);

  // Update marker styles when selected marker or scope changes
  useEffect(() => {
    refreshMarkerFeatures(activeScope, selectedMarker?.id);
  }, [activeScope, selectedMarker, refreshMarkerFeatures]);

  // Map Navigation Actions
  const handleZoomIn = () => {
    const view = mapInstanceRef.current?.getView();
    if (view) {
      const cur = view.getZoom() ?? 3;
      view.animate({ zoom: Math.min(cur + 0.8, 7), duration: 250 });
    }
  };

  const handleZoomOut = () => {
    const view = mapInstanceRef.current?.getView();
    if (view) {
      const cur = view.getZoom() ?? 3;
      view.animate({ zoom: Math.max(cur - 0.8, 1.2), duration: 250 });
    }
  };

  const handleFocusSudan = () => {
    const view = mapInstanceRef.current?.getView();
    if (view) {
      view.animate({
        center: getSudanCenterInEqualEarth(),
        zoom: 3.2,
        duration: 350,
      });
    }
  };

  const handleWorldView = () => {
    const view = mapInstanceRef.current?.getView();
    if (view) {
      view.animate({
        center: [0, 0],
        zoom: 1.5,
        duration: 350,
      });
    }
  };

  const handleMarkerClick = (marker: MapEventMarker) => {
    setSelectedMarker(marker);
    onMarkerSelect?.(marker);

    const view = mapInstanceRef.current?.getView();
    if (view) {
      const targetCoord = fromLonLat(marker.coordinates, EQUAL_EARTH_CODE);
      view.animate({
        center: targetCoord,
        zoom: Math.max(view.getZoom() ?? 3.2, 3.5),
        duration: 300,
      });
    }
  };

  return (
    <div
      className={`rounded-2xl bg-gray-950 text-white border border-gray-800 shadow-xl overflow-hidden ${className}`}
      aria-label={isArabic ? 'خريطة الرصد البيئي التفاعلية (نموذج إيكوال إيرث التجريبي)' : 'Interactive Environmental Monitoring Map (Equal Earth Prototype)'}
    >
      {/* Top Header & Scope Bar */}
      <div className="px-5 py-4 bg-gray-900/90 border-b border-gray-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h3 className="text-base sm:text-lg font-bold text-white">
              {isArabic
                ? 'خريطة الرصد البيئي والمناخي — نموذج إيكوال إيرث (OpenLayers)'
                : 'Environmental & Climate Map — Equal Earth Prototype (OpenLayers)'}
            </h3>
            {/* Projection indicator badge proving non-Mercator usage */}
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800">
              {activeProjectionCode || EQUAL_EARTH_CODE} (Equal Earth)
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {isArabic
              ? 'نموذج تقني تفاعلي مبني على إسقاط Equal Earth لحماية التناسب المساحي العادل لقارة أفريقيا وحوض النيل'
              : 'Technical prototype built on the Equal Earth projection to preserve true area proportionality for Africa and the Nile Basin'}
          </p>
        </div>

        {/* Scope Tabs & View Preset Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-gray-950/80 p-1 rounded-lg border border-gray-800 text-xs">
            {(['All', 'Sudan', 'Africa', 'Global'] as const).map((scope) => {
              const labels = {
                All: isArabic ? 'الكل' : 'All',
                Sudan: isArabic ? 'السودان (المحور)' : 'Sudan (Core)',
                Africa: isArabic ? 'أفريقيا' : 'Africa',
                Global: isArabic ? 'عالمي' : 'Global',
              };
              const isActive = activeScope === scope;

              return (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setActiveScope(scope)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
                  }`}
                >
                  {labels[scope]}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 bg-gray-950/80 p-1 rounded-lg border border-gray-800 text-xs">
            <button
              type="button"
              onClick={handleFocusSudan}
              title={isArabic ? 'تركيز العرض على السودان' : 'Focus on Sudan'}
              className="px-2 py-1 text-emerald-400 hover:text-white hover:bg-emerald-900/40 rounded transition-colors"
            >
              {isArabic ? 'تركيز السودان' : 'Focus Sudan'}
            </button>
            <button
              type="button"
              onClick={handleWorldView}
              title={isArabic ? 'عرض الخريطة العالمية' : 'World View'}
              className="px-2 py-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
            >
              {isArabic ? 'خريطة العالم' : 'World'}
            </button>
          </div>
        </div>
      </div>

      {/* Main Map Stage & Detail Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[500px] relative">
        {/* OpenLayers Map Canvas Container */}
        <div className="lg:col-span-8 relative bg-[#040914] min-h-[420px] flex flex-col">
          {/* Map Viewport DOM Element */}
          <div
            ref={mapContainerRef}
            className="w-full h-full flex-1 outline-hidden"
            tabIndex={0}
            role="region"
            aria-label={isArabic ? 'مساحة عرض خريطة إيكوال إيرث التفاعلية' : 'Equal Earth Interactive Map Viewport'}
          />

          {/* Loading State Overlay */}
          {loadingState === 'loading' && (
            <div className="absolute inset-0 bg-gray-950/80 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center z-20">
              <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm font-medium text-gray-200">
                {isArabic ? 'جاري تحميل طبقات الخريطة الجغرافية...' : 'Loading Equal Earth geospatial data...'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {isArabic ? 'إسقاط Equal Earth (EPSG:8857)' : 'Equal Earth Projection (EPSG:8857)'}
              </p>
            </div>
          )}

          {/* Error State Overlay */}
          {loadingState === 'error' && (
            <div className="absolute inset-0 bg-gray-950/90 flex flex-col items-center justify-center p-6 text-center z-20">
              <div className="w-10 h-10 rounded-full bg-red-900/50 text-red-400 flex items-center justify-center mb-3 border border-red-800">
                <span className="text-lg font-bold">!</span>
              </div>
              <p className="text-sm font-semibold text-white mb-1">
                {isArabic ? 'تعذر تحميل بيانات الخريطة الجغرافية' : 'Failed to load geographic map data'}
              </p>
              <p className="text-xs text-gray-400 max-w-sm mb-4">
                {errorMessage || (isArabic ? 'حدث خطأ أثناء قراءة ملف GeoJSON التجريبي.' : 'Error loading prototype GeoJSON file.')}
              </p>
              <button
                type="button"
                onClick={loadGeographicData}
                className="px-4 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium transition-colors"
              >
                {isArabic ? 'إعادة المحاولة' : 'Retry'}
              </button>
            </div>
          )}

          {/* Empty State Overlay */}
          {loadingState === 'empty' && (
            <div className="absolute inset-0 bg-gray-950/85 flex flex-col items-center justify-center p-6 text-center z-20">
              <p className="text-sm font-semibold text-gray-300 mb-1">
                {isArabic ? 'لا توجد معالم جغرافية معروضة' : 'No geographic features available'}
              </p>
              <p className="text-xs text-gray-500 max-w-xs mb-3">
                {isArabic ? 'ملف البيانات الجغرافية فارغ أو تعذر تفسيره.' : 'The dataset contains no valid country polygons.'}
              </p>
              <button
                type="button"
                onClick={loadGeographicData}
                className="px-3 py-1 bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 rounded"
              >
                {isArabic ? 'إعادة التحديث' : 'Reload'}
              </button>
            </div>
          )}

          {/* Map Controls: Zoom + Info Overlay */}
          <div className="absolute top-4 end-4 flex flex-col gap-1.5 z-10">
            <button
              type="button"
              onClick={handleZoomIn}
              aria-label={isArabic ? 'تكبير الخريطة' : 'Zoom in'}
              className="w-8 h-8 rounded-md bg-gray-900/90 hover:bg-gray-800 border border-gray-700 text-white font-bold flex items-center justify-center text-sm shadow-md transition-colors"
            >
              +
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              aria-label={isArabic ? 'تصغير الخريطة' : 'Zoom out'}
              className="w-8 h-8 rounded-md bg-gray-900/90 hover:bg-gray-800 border border-gray-700 text-white font-bold flex items-center justify-center text-sm shadow-md transition-colors"
            >
              −
            </button>
          </div>

          {/* Bottom Projection Notice Bar */}
          <div className="p-2.5 bg-gray-950/90 border-t border-gray-800 text-[11px] text-gray-400 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 font-semibold">OpenLayers 10.10.0</span>
              <span className="text-gray-600">•</span>
              <span>{isArabic ? 'إسقاط Equal Earth (EPSG:8857)' : 'Equal Earth Projection (EPSG:8857)'}</span>
            </div>
            <div className="text-[10px] text-gray-500">
              {isArabic ? 'بيانات اختبار أولية: Natural Earth (Public Domain)' : 'Prototype Data: Natural Earth (Public Domain)'}
            </div>
          </div>
        </div>

        {/* Selected Marker Detail Drawer (Editorial Context Panel) */}
        <div className="lg:col-span-4 bg-gray-900/90 border-t lg:border-t-0 lg:border-s border-gray-800 p-6 flex flex-col justify-between">
          {selectedMarker ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                  {getCategoryLabel(selectedMarker.category, isArabic)}
                </span>
                <span className="text-xs text-gray-400 font-mono">
                  {selectedMarker.date}
                </span>
              </div>

              <div>
                <h4 className="text-lg font-bold text-white leading-snug">
                  {isArabic ? selectedMarker.titleAr : selectedMarker.titleEn}
                </h4>
                <div className="flex items-center gap-1.5 text-xs text-emerald-400 mt-1 font-medium">
                  <svg className="w-3.5 h-3.5 fill-current shrink-0" viewBox="0 0 20 20" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>{isArabic ? selectedMarker.locationAr : selectedMarker.locationEn}</span>
                </div>
                <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                  {`[${selectedMarker.coordinates[0].toFixed(4)}°E, ${selectedMarker.coordinates[1].toFixed(4)}°N]`}
                </div>
              </div>

              {/* Data Type Distinction Badge */}
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-gray-400">{isArabic ? 'طبيعة المؤشر:' : 'Marker Type:'}</span>
                {selectedMarker.dataType === 'real-geo-content-linked' ? (
                  <span className="px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800">
                    {isArabic ? 'إحداثيات حقيقية — مرتبط بمحتوى تجريبي' : 'Authentic Geo Coordinates — Content-Linked Prototype'}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-800">
                    {isArabic ? 'إحداثيات حقيقية — حدث تجريبي' : 'Authentic Geo Coordinates — Demo Event'}
                  </span>
                )}
              </div>

              <p className="text-xs sm:text-sm text-gray-300 leading-relaxed bg-gray-950/60 p-3.5 rounded-lg border border-gray-800/80">
                {isArabic ? selectedMarker.summaryAr : selectedMarker.summaryEn}
              </p>

              {/* Scalable Linkage Indicator */}
              {selectedMarker.relatedContentId && (
                <div className="pt-2 border-t border-gray-800/80">
                  <span className="text-xs text-sky-400 font-medium inline-flex items-center gap-1">
                    <span>{isArabic ? 'مرتبط بمحتوى تجريبي (Mock ID):' : 'Linked Prototype Mock Item:'}</span>
                    <code className="font-mono text-xs text-gray-300 bg-gray-950 px-1 py-0.5 rounded">{selectedMarker.relatedContentId}</code>
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-center text-xs text-gray-500 py-8">
              {isArabic ? 'اضغط على أي مؤشر على الخريطة لعرض تفاصيل الحدث البيئي' : 'Select any pin on the map to inspect the environmental event'}
            </div>
          )}

          {/* Quick Marker Selector List */}
          <div className="mt-4 pt-3 border-t border-gray-800/80">
            <span className="text-xs font-semibold text-gray-400 block mb-2">
              {isArabic ? 'المؤشرات البيئية المتاحة على الخريطة:' : 'Available Environmental Pins:'}
            </span>
            <div className="flex flex-col gap-1 max-h-36 overflow-y-auto pr-1">
              {PROTOTYPE_MAP_MARKERS.map((marker) => {
                const isSelected = selectedMarker?.id === marker.id;
                return (
                  <button
                    key={marker.id}
                    type="button"
                    onClick={() => handleMarkerClick(marker)}
                    className={`text-start px-2.5 py-1.5 rounded text-xs transition-colors flex items-center justify-between ${
                      isSelected
                        ? 'bg-emerald-900/60 text-emerald-200 border border-emerald-700'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                    }`}
                  >
                    <span className="truncate">{isArabic ? marker.titleAr : marker.titleEn}</span>
                    <span className="text-[10px] text-gray-500 shrink-0 ms-2">{marker.scope}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Strict Cartographic Governance Footnote */}
          <div className="mt-4 pt-3 border-t border-gray-800/80 text-[11px] text-gray-400 leading-normal">
            <div className="flex items-start gap-1.5">
              <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <strong className="text-gray-300 font-semibold block">
                  {isArabic ? 'إشعار الحوكمة الكارتوغرافية:' : 'Cartographic Governance Notice:'}
                </strong>
                <span>
                  {isArabic
                    ? 'هذا النموذج التقني يعتمد محرك OpenLayers مع إسقاط Equal Earth وبيانات Natural Earth للاختبار المعماري فقط. الحدود السيادية الرسمية المعتمدة للمنصة لا تزال قيد الانتظار: UN Map Source Verification Required.'
                    : 'This technical prototype employs OpenLayers with Equal Earth projection and Natural Earth testing data. Final authoritative sovereignty boundaries remain pending: UN Map Source Verification Required.'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
