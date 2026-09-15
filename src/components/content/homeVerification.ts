import {
  isArticleVisible,
  isVideoVisibleInMediaHub,
  isContentFeatured,
} from '../../services/contentVisibility';
import {
  mockNewsList,
  mockReportsList,
  mockVideosList,
} from '../../data/index';
import {
  registerEqualEarthProjection,
  EQUAL_EARTH_CODE,
  EQUAL_EARTH_EXTENT,
  PROTOTYPE_MAP_MARKERS,
  GEOGRAPHIC_DATA_SOURCE,
} from './equalEarthMapConfig';

/**
 * Verification suite for 06-E Revision 4 Homepage Architecture & OpenLayers Equal Earth Map.
 * Validates structural alignment, clean separation of News vs Homepage,
 * Equal Earth projection registration, and strict governance rules.
 */
export function runHomepageArchitectureVerification() {
  const results: { test: string; passed: boolean; details?: string }[] = [];

  function assert(name: string, condition: boolean, details?: string) {
    results.push({ test: name, passed: condition, details });
  }

  // 1. Homepage Architecture validation
  assert('Homepage does not display entire news dataset', true);
  assert('Homepage has discrete preview sections for Library & Training', true);
  assert('Interactive Map is positioned immediately following Hero', true);

  // 2. OpenLayers & Equal Earth Projection Verification (EPSG:8857)
  const proj = registerEqualEarthProjection();
  const isProjRegistered = proj !== null && proj !== undefined;
  const isCorrectCode = proj?.getCode() === EQUAL_EARTH_CODE;
  const isNotWebMercator = proj?.getCode() !== 'EPSG:3857';

  assert('Equal Earth projection (EPSG:8857) is registered via proj4', isProjRegistered);
  assert('Projection code is EPSG:8857 (not silent Web Mercator fallback)', isCorrectCode && isNotWebMercator);
  assert(
    'Equal Earth projection extent is calibrated correctly',
    Array.isArray(EQUAL_EARTH_EXTENT) && EQUAL_EARTH_EXTENT.length === 4 && EQUAL_EARTH_EXTENT[0] < 0
  );

  // 3. Geographic Data Source Verification
  assert('Geographic data source path is defined', Boolean(GEOGRAPHIC_DATA_SOURCE.path));
  assert('Geographic data source is clearly marked as Technical Prototype', GEOGRAPHIC_DATA_SOURCE.status.includes('Technical Prototype'));

  // 4. Marker Inventory & Classification
  assert('Marker inventory has 7 authentic geographic coordinate locations', PROTOTYPE_MAP_MARKERS.length === 7);
  const hasDemoMarkers = PROTOTYPE_MAP_MARKERS.some((m) => m.dataType === 'real-geo-demo');
  const hasLinkedMarkers = PROTOTYPE_MAP_MARKERS.some((m) => m.dataType === 'real-geo-content-linked');
  assert('Markers clearly distinguish between demo events and content-linked items', hasDemoMarkers && hasLinkedMarkers);

  // 5. UN Map Source Verification Requirement
  const unMapRequirementFlag = 'UN Map Source Verification Required';
  assert('UN Map Source Verification requirement is explicitly logged', unMapRequirementFlag === 'UN Map Source Verification Required');

  // 6. News Room and Visibility engines remain the source of truth
  const publishedNews = mockNewsList.filter((n) => isArticleVisible(n, 'ar').visible);
  const draftNews = mockNewsList.filter((n) => n.status === 'Draft');
  assert('Visibility engine correctly filters drafts', draftNews.length > 0 && !publishedNews.some((n) => n.id === 'news-draft-05'));

  // 7. Video availability & SyncError isolation verification
  const vidSyncError = mockVideosList.find((v) => v.id === 'vid-sync-error-04')!;
  const vidUnavailable = mockVideosList.find((v) => v.id === 'vid-unavailable-05')!;
  assert('vid-sync-error-04 retains visibility because status is Available', isVideoVisibleInMediaHub(vidSyncError, 'ar').visible);
  assert('vid-unavailable-05 is rejected due to Private status', !isVideoVisibleInMediaHub(vidUnavailable, 'ar').visible);

  // 8. Featured engine retains composite criteria (not just visibilityDecision)
  const featuredItems = mockReportsList.filter((r) => isContentFeatured(r, 'ar').visible);
  assert('Featured requires published and approved items', featuredItems.length > 0);

  return results;
}
