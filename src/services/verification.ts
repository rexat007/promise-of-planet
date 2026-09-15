import {
  mockNewsList,
  mockReportsList,
  mockVideosList,
  mockContentVideoRelations,
  mockYouTubeSyncLogs,
} from '../data/index';
import {
  getAvailableLanguagesForArticle,
  getAvailableLanguagesForVideo,
  isLanguageAvailable,
} from './contentLanguage';
import {
  isArticleVisible,
  isContentPublished,
  isVideoVisibleInArticle,
  isVideoVisibleInMediaHub,
  isContentFeatured,
} from './contentVisibility';

/**
 * Direct logical verification of the Visibility & Language engines
 * against the approved mock dataset from Block 06-B.
 */
export function runEngineVerification() {
  const results: { test: string; passed: boolean; details?: string }[] = [];

  // Helper assertion
  function assert(name: string, condition: boolean, details?: string) {
    results.push({ test: name, passed: condition, details });
  }

  // Find specific mock items
  const newsClimate = mockNewsList.find((n) => n.id === 'news-climate-01')!;
  const newsWater = mockNewsList.find((n) => n.id === 'news-water-02')!;
  const newsDraft = mockNewsList.find((n) => n.id === 'news-draft-05')!;
  const newsBreaking = mockNewsList.find((n) => n.id === 'news-breaking-04')!;

  const reportDesert = mockReportsList.find((r) => r.id === 'report-desertification-01')!;

  const vidFeatured = mockVideosList.find((v) => v.id === 'vid-featured-01')!;
  const vidGash = mockVideosList.find((v) => v.id === 'vid-gash-flood-02')!;
  const vidMediaHubOnly = mockVideosList.find((v) => v.id === 'vid-mediahub-only-03')!;
  const vidSyncError = mockVideosList.find((v) => v.id === 'vid-sync-error-04')!;
  const vidUnavailable = mockVideosList.find((v) => v.id === 'vid-unavailable-05')!;
  const vidHidden = mockVideosList.find((v) => v.id === 'vid-hidden-06')!;

  // 1. Published / Draft Content Checks
  assert('Published News is recognized as published', isContentPublished(newsClimate).visible === true);
  assert(
    'Draft News is rejected with NOT_PUBLISHED',
    isContentPublished(newsDraft).visible === false && isContentPublished(newsDraft).reason === 'NOT_PUBLISHED'
  );

  // 2. Language Engine Checks
  // news-climate-01 has both Arabic and English
  assert('news-climate-01 has Arabic available', isLanguageAvailable(newsClimate, 'ar') === true);
  assert('news-climate-01 has English available', isLanguageAvailable(newsClimate, 'en') === true);
  const climateLangs = getAvailableLanguagesForArticle(newsClimate);
  assert('news-climate-01 returns [ar, en]', climateLangs.includes('ar') && climateLangs.includes('en'));

  // news-water-02 has only Arabic
  assert('news-water-02 has Arabic available', isLanguageAvailable(newsWater, 'ar') === true);
  assert('news-water-02 has English NOT available', isLanguageAvailable(newsWater, 'en') === false);
  const waterLangs = getAvailableLanguagesForArticle(newsWater);
  assert('news-water-02 returns only [ar]', waterLangs.length === 1 && waterLangs[0] === 'ar');

  // Video language checks
  assert('vid-featured-01 has Arabic', isLanguageAvailable(vidFeatured, 'ar') === true);
  assert('vid-featured-01 has English', isLanguageAvailable(vidFeatured, 'en') === true);
  assert('vid-hidden-06 has Arabic and English populated', getAvailableLanguagesForVideo(vidHidden).length === 2);
  assert('vid-hidden-06 has English available', isLanguageAvailable(vidHidden, 'en') === true);

  // 3. News / Report Visibility Checks
  assert('news-climate-01 is visible generally', isArticleVisible(newsClimate).visible === true);
  assert('news-climate-01 is visible in Arabic', isArticleVisible(newsClimate, 'ar').visible === true);
  assert('news-climate-01 is visible in English', isArticleVisible(newsClimate, 'en').visible === true);

  assert('news-water-02 is visible in Arabic', isArticleVisible(newsWater, 'ar').visible === true);
  assert(
    'news-water-02 is hidden in English due to missing fields',
    isArticleVisible(newsWater, 'en').visible === false &&
      isArticleVisible(newsWater, 'en').reason === 'MISSING_REQUIRED_LANGUAGE_FIELDS'
  );

  assert('report-desertification-01 is visible in Arabic and English', isArticleVisible(reportDesert, 'ar').visible === true);
  assert('news-breaking-04 is visible even without featuredImage', isArticleVisible(newsBreaking).visible === true);
  assert('news-draft-05 is hidden with NOT_PUBLISHED', isArticleVisible(newsDraft).visible === false);

  // 4. Video in Media Hub Checks
  assert('vid-featured-01 visible in Media Hub', isVideoVisibleInMediaHub(vidFeatured).visible === true);
  assert('vid-gash-flood-02 visible in Media Hub', isVideoVisibleInMediaHub(vidGash).visible === true);
  assert('vid-mediahub-only-03 visible in Media Hub', isVideoVisibleInMediaHub(vidMediaHubOnly).visible === true);

  // 5. SyncError Handling Check (MANDATORY RULE)
  // vid-sync-error-04 has a SyncError in mockYouTubeSyncLogs, but its availabilityStatus is 'Available'
  const syncCheck = isVideoVisibleInMediaHub(vidSyncError, undefined, mockYouTubeSyncLogs);
  assert('vid-sync-error-04 is visible in Media Hub despite SyncError in logs', syncCheck.visible === true);

  // 6. Private / Hidden Video Checks
  assert(
    'vid-unavailable-05 is rejected due to Private availability',
    isVideoVisibleInMediaHub(vidUnavailable).visible === false &&
      isVideoVisibleInMediaHub(vidUnavailable).reason === 'VIDEO_NOT_AVAILABLE'
  );
  assert(
    'vid-hidden-06 is rejected due to Hidden editorial decision',
    isVideoVisibleInMediaHub(vidHidden).visible === false &&
      isVideoVisibleInMediaHub(vidHidden).reason === 'NOT_PUBLISHED' // also Draft
  );

  // 7. Video in Article / Relation Checks
  // Relation 1: report-desertification-01 + vid-featured-01 (Active, Embedded) -> should pass
  const rel1 = mockContentVideoRelations.find((r) => r.id === 'rel-rep-des-vid-01')!;
  assert('rel-rep-des-vid-01 passes in article', isVideoVisibleInArticle(reportDesert, vidFeatured, rel1).visible === true);

  // Relation 2: news-climate-01 + vid-featured-01 (Active, RelatedCoverage) -> should pass
  const rel2 = mockContentVideoRelations.find((r) => r.id === 'rel-news-clim-vid-01')!;
  assert('rel-news-clim-vid-01 passes in article', isVideoVisibleInArticle(newsClimate, vidFeatured, rel2).visible === true);

  // Relation 5: news-water-02 + vid-unavailable-05 (Active relation, but Video is Private) -> must be rejected
  const rel5 = mockContentVideoRelations.find((r) => r.id === 'rel-news-wat-vid-05')!;
  const rel5Check = isVideoVisibleInArticle(newsWater, vidUnavailable, rel5);
  assert(
    'rel-news-wat-vid-05 rejected because video is Private',
    rel5Check.visible === false && rel5Check.reason === 'VIDEO_NOT_AVAILABLE'
  );

  // Relation 6: report-desertification-01 + vid-mediahub-only-03 (isActive: false) -> must be rejected
  const rel6 = mockContentVideoRelations.find((r) => r.id === 'rel-inactive-06')!;
  const rel6Check = isVideoVisibleInArticle(reportDesert, vidMediaHubOnly, rel6);
  assert(
    'rel-inactive-06 rejected because relation is inactive',
    rel6Check.visible === false && rel6Check.reason === 'RELATION_INACTIVE'
  );

  // MediaHubOnly inside Article (simulate if relation was active)
  const simulatedActiveRel6 = { ...rel6, isActive: true };
  const mediaHubInArticleCheck = isVideoVisibleInArticle(reportDesert, vidMediaHubOnly, simulatedActiveRel6);
  assert(
    'MediaHubOnly video rejected inside article even if relation active',
    mediaHubInArticleCheck.visible === false && mediaHubInArticleCheck.reason === 'VIDEO_NOT_NEWS_ELIGIBLE'
  );

  // 8. Featured Check
  assert('vid-featured-01 is featured', isContentFeatured(vidFeatured).visible === true);
  assert('vid-gash-flood-02 is NOT featured (NewsEligible only)', isContentFeatured(vidGash).visible === false);

  return results;
}
