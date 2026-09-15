import {
  mockNewsList,
  mockReportsList,
  mockVideosList,
  mockContentVideoRelations,
} from '../../data/index';
import {
  isVideoVisibleInArticle,
  isVideoVisibleInMediaHub,
} from '../../services/contentVisibility';
import {
  getCategoryLabel,
  getContentTypeLabel,
  getUrgencyLabel,
  getRelationTypeLabel,
  getSourceTypeLabel,
} from './contentFormatters';

/**
 * Verification test suite for Content UI Foundation.
 * Tests components logical contracts and mappings without requiring a full browser runner.
 */
export function runContentUiVerification() {
  const results: { test: string; passed: boolean; details?: string }[] = [];

  function assert(name: string, condition: boolean, details?: string) {
    results.push({ test: name, passed: condition, details });
  }

  // 1. Formatters mapping verification
  assert('Category label Arabic climate', getCategoryLabel('Climate', true) === 'المناخ والطقس');
  assert('Category label English climate', getCategoryLabel('Climate', false) === 'Climate & Weather');
  assert('Content type label News', getContentTypeLabel('News', true) === 'خبر صحفي');
  assert('Urgency label Breaking', getUrgencyLabel('Breaking', true) === 'عاجل');
  assert('Relation label Embedded', getRelationTypeLabel('Embedded', true) === 'فيديو مدمج');
  assert('Source type label OfficialGovernment', getSourceTypeLabel('OfficialGovernment', true) === 'جهة حكومية رسمية');

  // 2. News data presentation readiness
  const newsClimate = mockNewsList.find((n) => n.id === 'news-climate-01')!;
  const newsBreaking = mockNewsList.find((n) => n.id === 'news-breaking-04')!;
  assert('news-climate-01 has featured image', Boolean(newsClimate.featuredImage?.url));
  assert('news-breaking-04 has no featured image (valid breaking exception)', newsBreaking.featuredImage === undefined);

  // 3. Report presentation readiness
  const reportDesert = mockReportsList.find((r) => r.id === 'report-desertification-01')!;
  assert('report-desertification-01 has mandatory featured image', Boolean(reportDesert.featuredImage.url));
  assert('report-desertification-01 has sections', (reportDesert.sections?.length || 0) > 0);
  assert('report-desertification-01 has sources', reportDesert.sources.length > 0);

  // 4. Video presentation readiness
  const vidFeatured = mockVideosList.find((v) => v.id === 'vid-featured-01')!;
  const vidSyncError = mockVideosList.find((v) => v.id === 'vid-sync-error-04')!;
  const vidUnavailable = mockVideosList.find((v) => v.id === 'vid-unavailable-05')!;
  assert('vid-featured-01 has editorial title distinct from original', vidFeatured.titleAr.length > 0);
  assert('vid-sync-error-04 is Available despite sync log error', vidSyncError.youtubeSource.availabilityStatus === 'Available');
  assert('vid-unavailable-05 is Private', vidUnavailable.youtubeSource.availabilityStatus === 'Private');

  // 5. VideoRelationList filter verification
  // For report-desertification-01:
  // rel-rep-des-vid-01: with vid-featured-01 (Active, Available) -> eligible
  // rel-inactive-06: with vid-mediahub-only-03 (isActive: false) -> filtered out
  const reportRels = mockContentVideoRelations.filter((r) => r.contentId === reportDesert.id);
  const activeEligibleVideos = reportRels.filter((rel) => {
    const v = mockVideosList.find((vid) => vid.id === rel.videoId);
    if (!v) return false;
    return isVideoVisibleInArticle(reportDesert, v, rel, 'ar').visible;
  });
  assert('reportDesert has exactly 1 eligible visible video relation', activeEligibleVideos.length === 1);
  assert('the eligible relation is rel-rep-des-vid-01', activeEligibleVideos[0].id === 'rel-rep-des-vid-01');

  // For news-water-02:
  // rel-news-wat-vid-05: with vid-unavailable-05 (isActive: true, but Video is Private) -> filtered out
  const newsWater = mockNewsList.find((n) => n.id === 'news-water-02')!;
  const waterRels = mockContentVideoRelations.filter((r) => r.contentId === newsWater.id);
  const visibleWaterVideos = waterRels.filter((rel) => {
    const v = mockVideosList.find((vid) => vid.id === rel.videoId);
    if (!v) return false;
    return isVideoVisibleInArticle(newsWater, v, rel, 'ar').visible;
  });
  assert('newsWater has 0 visible videos because related video is Private', visibleWaterVideos.length === 0);

  // 6. Media Hub visibility check
  assert('vid-featured-01 visible in Media Hub', isVideoVisibleInMediaHub(vidFeatured, 'ar').visible);
  assert('vid-sync-error-04 visible in Media Hub (available)', isVideoVisibleInMediaHub(vidSyncError, 'ar').visible);
  assert('vid-unavailable-05 hidden from Media Hub (Private)', !isVideoVisibleInMediaHub(vidUnavailable, 'ar').visible);

  return results;
}
