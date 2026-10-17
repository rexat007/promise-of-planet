"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicMediaHub = PublicMediaHub;
const react_1 = require("react");
const react_i18next_1 = require("react-i18next");
const Container_1 = require("../layout/Container");
const lucide_react_1 = require("lucide-react");
const content_1 = require("../content");
const publicMediaClient_1 = require("../../services/publicMediaClient");
function PublicMediaHub() {
    const { i18n } = (0, react_i18next_1.useTranslation)();
    const currentLang = (i18n.language === 'en' ? 'en' : 'ar');
    const isAr = currentLang === 'ar';
    const [videos, setVideos] = (0, react_1.useState)([]);
    const [playlists, setPlaylists] = (0, react_1.useState)([]);
    const [loading, setLoading] = (0, react_1.useState)(true);
    const [error, setError] = (0, react_1.useState)(null);
    // Active featured video state
    const [featuredVideo, setFeaturedVideo] = (0, react_1.useState)(null);
    const [isDescExpanded, setIsDescExpanded] = (0, react_1.useState)(false);
    // Reference for smooth scrolling to video player
    const playerRef = (0, react_1.useRef)(null);
    const loadMultimedia = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await publicMediaClient_1.PublicMediaClient.fetchPublicMultimedia(currentLang);
            setVideos(data.videos);
            setPlaylists(data.playlists);
            // Select initial featured video: preferred 'Featured' visibility, else first video
            if (data.videos.length > 0) {
                const designatedFeatured = data.videos.find(v => v.visibilityDecision === 'Featured') || data.videos[0];
                setFeaturedVideo(designatedFeatured);
            }
            else {
                setFeaturedVideo(null);
            }
        }
        catch (err) {
            console.error('Failed to load multimedia:', err);
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg || (isAr ? 'فشل تحميل مواد الوسائط المتعددة' : 'Failed to load multimedia materials'));
        }
        finally {
            setLoading(false);
        }
    };
    (0, react_1.useEffect)(() => {
        loadMultimedia();
    }, [currentLang]);
    (0, react_1.useEffect)(() => {
        setIsDescExpanded(false);
    }, [featuredVideo?.id]);
    const handleSelectVideo = (video) => {
        setFeaturedVideo(video);
        playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const formatDate = (dateString) => {
        if (!dateString)
            return '';
        try {
            const date = new Date(dateString);
            return new Intl.DateTimeFormat(isAr ? 'ar-SD' : 'en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            }).format(date);
        }
        catch {
            return dateString;
        }
    };
    // Group videos by playlist
    const playlistGroupings = playlists.map(pl => {
        const plVideos = videos.filter(v => pl.videoIds.includes(v.id));
        return {
            playlist: pl,
            videos: plVideos,
        };
    }).filter(group => group.videos.length > 0);
    // Find standalone videos not belonging to any displayed playlist
    const allGroupedVideoIds = new Set(playlistGroupings.flatMap(g => g.videos.map(v => v.id)));
    const standaloneVideos = videos.filter(v => !allGroupedVideoIds.has(v.id));
    const YouTubeIcon = (props) => (<svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>);
    return (<div className="min-h-screen bg-gray-50 dark:bg-gray-950 py-8 sm:py-12" dir={isAr ? 'rtl' : 'ltr'}>
      <Container_1.Container className="space-y-12">
        {/* Editorial Intro with Mandatory Naming */}
        <section className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            {isAr ? 'الوسائط المتعددة' : 'Multimedia'}
          </h1>
          <p className="text-gray-600 dark:text-gray-300 max-w-3xl leading-relaxed text-sm sm:text-base">
            {isAr
            ? 'مكتبة مرئية شاملة توثق التحقيقات، والتغطيات الميدانية، والتقارير المتعلقة بالبيئة والمناخ في السودان.'
            : 'A comprehensive visual library documenting investigations, field coverage, and reports on environment and climate in Sudan.'}
          </p>
        </section>

        {/* Loading State */}
        {loading && (<div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800">
            <lucide_react_1.Loader2 className="w-10 h-10 text-emerald-600 animate-spin mb-4"/>
            <p className="text-gray-500 font-medium text-sm">
              {isAr ? 'جاري تحميل مواد الوسائط المتعددة...' : 'Loading multimedia materials...'}
            </p>
          </div>)}

        {/* Error State */}
        {!loading && error && (<div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-2xl p-8 flex flex-col items-center justify-center text-center space-y-4">
            <lucide_react_1.AlertCircle className="w-10 h-10 text-red-500"/>
            <h3 className="font-bold text-red-900 dark:text-red-200">
              {isAr ? 'حدث خطأ أثناء تحميل الوسائط' : 'An error occurred while loading multimedia'}
            </h3>
            <p className="text-sm text-red-700 dark:text-red-300 max-w-md">{error}</p>
            <button onClick={() => loadMultimedia()} className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer">
              <lucide_react_1.RefreshCw className="w-4 h-4"/>
              <span>{isAr ? 'إعادة المحاولة' : 'Retry'}</span>
            </button>
          </div>)}

        {/* Empty State */}
        {!loading && !error && videos.length === 0 && (<div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-12 flex flex-col items-center justify-center text-center space-y-4">
            <lucide_react_1.Archive className="w-12 h-12 text-gray-300 dark:text-gray-700"/>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              {isAr ? 'أرشيف الوسائط في طور الإعداد' : 'Multimedia archive in preparation'}
            </h3>
            <p className="text-sm text-gray-500 max-w-md leading-relaxed">
              {isAr
                ? 'يجري حالياً تجهيز أرشيف التغطيات المعتمدة للعرض، مع الحفاظ الكامل على توثيق المصدر والتاريخ الأصلي وبراءة الحقوق.'
                : 'We are currently preparing the archive of verified coverage for display, maintaining full source documentation, original dates, and cleared rights.'}
            </p>
            <div className="pt-2">
              <a href="https://www.youtube.com/@PromiseOfPlanet" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-sm shadow-sm transition-colors">
                <YouTubeIcon className="w-4 h-4"/>
                <span>{isAr ? 'تابعنا على يوتيوب' : 'Follow on YouTube'}</span>
              </a>
            </div>
          </div>)}

        {/* Content Display: Featured Player + Playlist Gallery */}
        {!loading && !error && videos.length > 0 && (<>
            {/* Featured Video Player Region with Scroll Anchor */}
            {featuredVideo && (<section ref={playerRef} className="scroll-mt-28 space-y-4 pop-motion-section">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <lucide_react_1.Play className="w-4 h-4 text-emerald-600"/>
                    <span>{isAr ? 'المحتوى المميز المشغل' : 'Featured Video Player'}</span>
                  </h2>
                  {featuredVideo.youtubeSource.youtubePublishedAt && (<div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
                      <lucide_react_1.Calendar className="w-3.5 h-3.5"/>
                      <span>{formatDate(featuredVideo.youtubeSource.youtubePublishedAt)}</span>
                    </div>)}
                </div>

                <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden shadow-lg p-6 sm:p-8 space-y-6">
                  <div className="rounded-xl overflow-hidden shadow-inner bg-black">
                    <content_1.VideoEmbed youtubeSource={featuredVideo.youtubeSource} title={isAr ? featuredVideo.titleAr : (featuredVideo.titleEn || featuredVideo.titleAr)}/>
                  </div>

                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300">
                        {featuredVideo.category}
                      </span>
                      {featuredVideo.visibilityDecision === 'Featured' && (<span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300">
                          {isAr ? 'مختار ومميز' : 'Featured Selection'}
                        </span>)}
                    </div>

                    <h2 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white leading-tight">
                      {isAr ? featuredVideo.titleAr : (featuredVideo.titleEn || featuredVideo.titleAr)}
                    </h2>

                    {/* Expandable Editorial Description */}
                    {(() => {
                    const desc = isAr
                        ? (featuredVideo.editorialDescriptionAr || featuredVideo.excerptAr)
                        : (featuredVideo.editorialDescriptionEn || featuredVideo.excerptEn || featuredVideo.editorialDescriptionAr);
                    if (!desc)
                        return null;
                    const isLong = desc.length > 250;
                    return (<div className="border-t border-gray-100 dark:border-gray-800 pt-3">
                          <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed whitespace-pre-line">
                            {isDescExpanded || !isLong ? desc : `${desc.substring(0, 250)}...`}
                          </p>
                          {isLong && (<button onClick={() => setIsDescExpanded(!isDescExpanded)} className="mt-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs hover:underline cursor-pointer">
                              {isDescExpanded
                                ? (isAr ? 'عرض أقل' : 'Show Less')
                                : (isAr ? 'قراءة المزيد' : 'Read More')}
                            </button>)}
                        </div>);
                })()}

                    {/* Action Bar: YouTube Watch Link & Provenance */}
                    <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                      <a href={featuredVideo.youtubeSource.youtubeUrl || `https://www.youtube.com/watch?v=${featuredVideo.youtubeSource.youtubeVideoId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-xs sm:text-sm shadow-xs transition-colors">
                        <YouTubeIcon className="w-4 h-4"/>
                        <span>{isAr ? 'مشاهدة على يوتيوب' : 'Watch on YouTube'}</span>
                        <lucide_react_1.ExternalLink className="w-3.5 h-3.5 ms-1 opacity-70"/>
                      </a>

                      {featuredVideo.sources && featuredVideo.sources.length > 0 && (<div className="w-full sm:w-auto">
                          <content_1.ContentSourceList sources={featuredVideo.sources}/>
                        </div>)}
                    </div>
                  </div>
                </div>
              </section>)}

            {/* Playlists-Grouped Gallery */}
            {playlistGroupings.length > 0 && (<div className="space-y-12">
                {playlistGroupings.map(({ playlist, videos: plVideos }) => (<section key={playlist.id} className="space-y-4 pop-motion-section">
                    <div className="border-b border-gray-200 dark:border-gray-800 pb-3">
                      <h2 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                          <lucide_react_1.Layers className="w-4 h-4"/>
                        </span>
                        <span>{isAr ? playlist.titleAr : (playlist.titleEn || playlist.titleAr)}</span>
                      </h2>
                      {(playlist.descriptionAr || playlist.descriptionEn) && (<p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-3xl leading-relaxed">
                          {isAr ? playlist.descriptionAr : (playlist.descriptionEn || playlist.descriptionAr)}
                        </p>)}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {plVideos.map(video => (<div key={video.id} className={`relative transition-all rounded-2xl ${featuredVideo?.id === video.id
                            ? 'ring-2 ring-emerald-600 ring-offset-2 dark:ring-offset-gray-950'
                            : ''}`}>
                          <content_1.VideoCard video={video} currentLanguage={currentLang} onClick={() => handleSelectVideo(video)}/>
                        </div>))}
                    </div>
                  </section>))}
              </div>)}

            {/* Standalone / Latest Coverage Gallery */}
            {standaloneVideos.length > 0 && (<section className="space-y-4 pop-motion-section">
                <div className="border-b border-gray-200 dark:border-gray-800 pb-3">
                  <h2 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                      <lucide_react_1.Play className="w-4 h-4"/>
                    </span>
                    <span>{isAr ? 'أحدث التغطيات والمواد المرئية' : 'Latest Coverage & Videos'}</span>
                  </h2>
                  <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {isAr
                    ? 'مواد مرئية واستقصائية فردية معتمدة من وحدة الرصد والتوثيق البيئي.'
                    : 'Verified individual visual and investigative materials from environmental documentation unit.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {standaloneVideos.map(video => (<div key={video.id} className={`relative transition-all rounded-2xl ${featuredVideo?.id === video.id
                        ? 'ring-2 ring-emerald-600 ring-offset-2 dark:ring-offset-gray-950'
                        : ''}`}>
                      <content_1.VideoCard video={video} currentLanguage={currentLang} onClick={() => handleSelectVideo(video)}/>
                    </div>))}
                </div>
              </section>)}
          </>)}

        {/* Provenance and Integrity Note */}
        <div className="text-xs text-gray-500 dark:text-gray-400 pt-8 border-t border-gray-200 dark:border-gray-800 text-center">
          <p>
            {isAr
            ? 'تلتزم منصة وعد الكوكب بنشر المواد التي تمت إجازتها تحريرياً وبراءة حقوقها الفكرية والمصدرية فقط.'
            : 'Promise of Planet is committed to publishing only editorially cleared materials with verified rights and provenance.'}
          </p>
        </div>
      </Container_1.Container>
    </div>);
}
//# sourceMappingURL=PublicMediaHub.js.map