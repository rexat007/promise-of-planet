import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MediaService, isVideoPubliclyEligible } from '../../services/mediaService';
import { AdminAccessService } from '../../services/adminAccess';
import { AdminPermission } from '../../types/admin';
import type { AdminUser } from '../../types/admin';
import { mockNewsList } from '../../data/mockContent';
import { VideoEmbed } from '../content/VideoEmbed';
import type { 
  Video, 
  RightsStatus, 
  VisibilityDecision, 
  Category
} from '../../types';
import { 
  Plus, 
  Search, 
  Film, 
  CheckCircle2, 
  AlertTriangle, 
  Eye, 
  Link as LinkIcon, 
  Unlink, 
  Edit, 
  ShieldCheck, 
  EyeOff, 
  Lock, 
  Globe, 
  ExternalLink, 
  AlertCircle, 
  RefreshCw,
  X,
  FileText
} from 'lucide-react';

interface AdminMediaManagementProps {
  currentUser: AdminUser;
}

export function AdminMediaManagement({ currentUser }: AdminMediaManagementProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  // Helper for inline translations
  const tText = (ar: string, en: string) => isAr ? ar : en;

  // State
  const [videos, setVideos] = useState<Video[]>(() => MediaService.listAll());
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedRights, setSelectedRights] = useState<string>('All');
  const [selectedVisibility, setSelectedVisibility] = useState<string>('All');

  // Modals state
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [isEditMetadataOpen, setIsEditMetadataOpen] = useState(false);
  
  // Feedback states
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // New Video Registration Form State
  const [regTitleAr, setRegTitleAr] = useState('');
  const [regTitleEn, setRegTitleEn] = useState('');
  const [regYoutubeId, setRegYoutubeId] = useState('');
  const [regChannelName, setRegChannelName] = useState('');
  const [regCategory, setRegCategory] = useState<Category>('Climate');
  const [regExcerptAr, setRegExcerptAr] = useState('');
  const [regExcerptEn, setRegExcerptEn] = useState('');
  const [regDescAr, setRegDescAr] = useState('');
  const [regDescEn, setRegDescEn] = useState('');
  const [regDuration, setRegDuration] = useState('PT5M');
  const [regThumbnailUrl, setRegThumbnailUrl] = useState('');
  const [regTags, setRegTags] = useState('');

  // Metadata Edit Form State
  const [editDescAr, setEditDescAr] = useState('');
  const [editDescEn, setEditDescEn] = useState('');
  const [editThumbnailUrl, setEditThumbnailUrl] = useState('');
  const [editTags, setEditTags] = useState('');

  // Rights Form State
  const [rightsNotes, setRightsNotes] = useState('');

  // Relation Form State
  const [selectedNewsId, setSelectedNewsId] = useState('');
  const [relationType, setRelationType] = useState<'Embedded' | 'RelatedCoverage' | 'SupportingMaterial'>('Embedded');
  const [placement, setPlacement] = useState<'Top' | 'Inline' | 'Bottom' | 'Sidebar'>('Inline');

  // Refresh lists
  const refreshData = () => {
    const list = MediaService.listAll();
    setVideos(list);
    if (selectedVideo) {
      const updated = list.find(v => v.id === selectedVideo.id);
      setSelectedVideo(updated || null);
    }
  };

  // Auto clear success message
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  // Derived authorization checks
  const canCreate = useMemo(() => AdminAccessService.hasPermission(currentUser, AdminPermission.Create), [currentUser]);
  const canEdit = useMemo(() => AdminAccessService.hasPermission(currentUser, AdminPermission.Edit), [currentUser]);
  const canReview = useMemo(() => AdminAccessService.hasPermission(currentUser, AdminPermission.Review), [currentUser]);
  const canManageRights = useMemo(() => AdminAccessService.hasPermission(currentUser, AdminPermission.ManageRights), [currentUser]);

  // Filtered videos
  const filteredVideos = useMemo(() => {
    return videos.filter(video => {
      const matchesSearch = searchQuery === '' || 
        video.titleAr.toLowerCase().includes(searchQuery.toLowerCase()) || 
        (video.titleEn && video.titleEn.toLowerCase().includes(searchQuery.toLowerCase())) ||
        video.youtubeSource.youtubeVideoId.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesCategory = selectedCategory === 'All' || video.category === selectedCategory;
      const matchesRights = selectedRights === 'All' || video.rightsStatus === selectedRights;
      const matchesVisibility = selectedVisibility === 'All' || video.visibilityDecision === selectedVisibility;

      return matchesSearch && matchesCategory && matchesRights && matchesVisibility;
    });
  }, [videos, searchQuery, selectedCategory, selectedRights, selectedVisibility]);

  // Handle video registration
  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!regYoutubeId.trim()) {
      setErrorMsg(tText('يرجى إدخال معرف فيديو يوتيوب صحيح', 'Please enter a valid YouTube Video ID'));
      return;
    }
    if (!regTitleAr.trim()) {
      setErrorMsg(tText('العنوان بالعربية مطلوب', 'Arabic Title is required'));
      return;
    }

    try {
      const data: Omit<Video, 'id' | 'createdAt' | 'updatedAt'> = {
        contentType: 'Video',
        category: regCategory,
        titleAr: regTitleAr,
        titleEn: regTitleEn || undefined,
        excerptAr: regExcerptAr || regTitleAr,
        excerptEn: regExcerptEn || undefined,
        originalLanguage: 'ar',
        availableLanguages: regTitleEn ? ['ar', 'en'] : ['ar'],
        translationStatus: regTitleEn ? 'Completed' : 'NotRequired',
        editor: currentUser.name,
        producer: regChannelName || tText('جهة خارجية', 'External Source'),
        status: 'Draft',
        approvalStatus: 'Pending',
        visibilityDecision: 'Hidden',
        rightsStatus: 'NotStarted',
        editorialDescriptionAr: regDescAr,
        editorialDescriptionEn: regDescEn || undefined,
        tags: regTags ? regTags.split(',').map(t => t.trim()).filter(Boolean) : [],
        editorialThumbnail: regThumbnailUrl ? { url: regThumbnailUrl, altAr: regTitleAr } : undefined,
        youtubeSource: {
          youtubeVideoId: regYoutubeId.trim(),
          youtubeUrl: `https://www.youtube.com/watch?v=${regYoutubeId.trim()}`,
          channelId: 'UC-external',
          channelName: regChannelName || 'External YouTube Creator',
          channelUrl: 'https://youtube.com',
          originalTitle: regTitleEn || regTitleAr,
          originalDescription: regDescEn || regDescAr,
          youtubePublishedAt: new Date().toISOString(),
          duration: regDuration,
          availabilityStatus: 'Available',
          thumbnails: regThumbnailUrl ? { medium: regThumbnailUrl } : {}
        }
      };

      const newVideo = MediaService.register(data, currentUser);
      setSuccessMsg(tText('تم تسجيل الفيديو بنجاح كمسودة غير منشورة', 'Video successfully registered as draft'));
      setIsRegisterOpen(false);
      setSelectedVideo(newVideo);
      refreshData();
      
      // Reset form
      setRegTitleAr('');
      setRegTitleEn('');
      setRegYoutubeId('');
      setRegChannelName('');
      setRegExcerptAr('');
      setRegExcerptEn('');
      setRegDescAr('');
      setRegDescEn('');
      setRegThumbnailUrl('');
      setRegTags('');
    } catch (e: any) {
      setErrorMsg(e.message || tText('حدث خطأ أثناء التسجيل', 'Registration failed'));
    }
  };

  // Open Edit Metadata Form
  const openEditMetadata = () => {
    if (!selectedVideo) return;
    setEditDescAr(selectedVideo.editorialDescriptionAr || '');
    setEditDescEn(selectedVideo.editorialDescriptionEn || '');
    setEditThumbnailUrl(selectedVideo.editorialThumbnail?.url || '');
    setEditTags(selectedVideo.tags?.join(', ') || '');
    setIsEditMetadataOpen(true);
  };

  // Handle Edit Metadata Submit
  const handleEditMetadata = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVideo) return;
    setErrorMsg(null);

    try {
      const updates = {
        editorialDescriptionAr: editDescAr,
        editorialDescriptionEn: editDescEn || undefined,
        editorialThumbnail: editThumbnailUrl ? { url: editThumbnailUrl, altAr: selectedVideo.titleAr } : undefined,
        tags: editTags ? editTags.split(',').map(t => t.trim()).filter(Boolean) : []
      };

      MediaService.updateMetadata(selectedVideo.id, updates, currentUser);
      setSuccessMsg(tText('تم تحديث البيانات الوصفية التحريرية بنجاح', 'Editorial metadata successfully updated'));
      setIsEditMetadataOpen(false);
      refreshData();
    } catch (e: any) {
      setErrorMsg(e.message || tText('فشل تحديث البيانات الوصفية', 'Metadata update failed'));
    }
  };

  // Handle Rights Change
  const handleUpdateRights = (status: RightsStatus) => {
    if (!selectedVideo) return;
    setErrorMsg(null);

    try {
      MediaService.updateRightsStatus(selectedVideo.id, status, rightsNotes || undefined, currentUser);
      setSuccessMsg(tText(`تم تحديث حالة حقوق النشر إلى: ${status}`, `Rights status updated to: ${status}`));
      refreshData();
    } catch (e: any) {
      setErrorMsg(e.message || tText('فشل تحديث حقوق النشر', 'Rights update failed'));
    }
  };

  // Handle Visibility Change
  const handleUpdateVisibility = (decision: VisibilityDecision) => {
    if (!selectedVideo) return;
    setErrorMsg(null);

    try {
      MediaService.updateVisibilityDecision(selectedVideo.id, decision, currentUser);
      setSuccessMsg(tText(`تم تحديث قرار الظهور إلى: ${decision}`, `Visibility decision updated to: ${decision}`));
      refreshData();
    } catch (e: any) {
      setErrorMsg(e.message || tText('فشل تحديث قرار الظهور', 'Visibility update failed'));
    }
  };

  // Handle linking News content
  const handleLinkNews = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVideo || !selectedNewsId) return;
    setErrorMsg(null);

    try {
      MediaService.linkVideoToContent(
        selectedVideo.id, 
        selectedNewsId, 
        'News', 
        relationType, 
        placement, 
        currentUser
      );
      setSuccessMsg(tText('تم ربط الفيديو بالخبر بنجاح', 'Successfully linked video to news item'));
      setSelectedNewsId('');
      refreshData();
    } catch (e: any) {
      setErrorMsg(e.message || tText('فشل ربط الفيديو بالخبر', 'Linking failed'));
    }
  };

  // Handle unlinking News
  const handleUnlinkNews = (newsId: string) => {
    if (!selectedVideo) return;
    setErrorMsg(null);

    try {
      MediaService.unlinkVideoFromContent(selectedVideo.id, newsId, currentUser);
      setSuccessMsg(tText('تم إلغاء ربط الفيديو بنجاح', 'Successfully unlinked video'));
      refreshData();
    } catch (e: any) {
      setErrorMsg(e.message || tText('فشل إلغاء الربط', 'Unlinking failed'));
    }
  };

  // Helper to get linked news relations for selected video
  const linkedRelations = useMemo(() => {
    if (!selectedVideo) return [];
    return MediaService.getRelationsForVideo(selectedVideo.id);
  }, [selectedVideo, videos]);

  // Helper to find the News entity based on relationship
  const getNewsTitle = (newsId: string) => {
    const item = mockNewsList.find(n => n.id === newsId);
    if (!item) return newsId;
    return isAr ? item.titleAr : (item.titleEn || item.titleAr);
  };

  // Get eligible news items for linking (not already linked to the current video)
  const linkableNews = useMemo(() => {
    if (!selectedVideo) return [];
    const linkedIds = linkedRelations.map(r => r.contentId);
    return mockNewsList.filter(news => !linkedIds.includes(news.id));
  }, [selectedVideo, linkedRelations]);

  return (
    <div className="space-y-6 w-full max-w-full min-w-0" id="admin-media-workspace" dir={isAr ? 'rtl' : 'ltr'}>
      
      {/* 1. PERSISTENCE DISCLOSURE BANNER */}
      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 p-4 rounded-2xl flex items-start gap-3 shadow-xs" id="persistence-disclosure-banner">
        <AlertCircle className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs sm:text-sm text-amber-900 dark:text-amber-300">
          <p className="font-extrabold">
            {tText(
              'تنبيه الحفظ في الذاكرة التحريرية (جلسة العمل الحالية)', 
              'In-Memory Session Persistence Disclosure'
            )}
          </p>
          <p className="font-medium text-amber-800 dark:text-amber-400/90 leading-relaxed">
            {tText(
              'يتم حفظ جميع التعديلات والتسجيلات وربط المواد الإخبارية في ذاكرة الجلسة الحالية فقط. لن تظهر التغييرات محليًا في خوادم قاعدة البيانات المستقلة أو يتم إرسالها إلى YouTube المباشر.',
              'All registrations, metadata changes, and news link associations are maintained locally in session memory. No changes will persist to permanent cloud databases or synchronize back to active YouTube channels.'
            )}
          </p>
        </div>
      </div>

      {/* 2. SUCCESS / ERROR ALERT CHIP */}
      {successMsg && (
        <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 p-3.5 rounded-xl text-sm text-emerald-800 dark:text-emerald-400 flex items-center gap-2 font-bold animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 p-3.5 rounded-xl text-sm text-rose-800 dark:text-rose-400 flex items-center gap-2 font-bold animate-fadeIn">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* 3. WORKSPACE HEADER WITH METRICS & REGISTER INITIATION */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 dark:border-gray-800 pb-5">
        <div>
          <h1 className="text-2xl font-black text-gray-950 dark:text-white flex items-center gap-2.5">
            <Film className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            <span>{tText('إدارة المواد المرئية والوسائط', 'Media & Video Registry')}</span>
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1.5 font-medium">
            {tText(
              'تسجيل وفحص ومعايرة الفيديوهات البيئية المعتمدة وربطها بالأخبار والتقارير الاستقصائية وتدقيق تراخيص النشر.',
              'Register, inspect, and preview environment-focused video references, manage news linkages, and audits.'
            )}
          </p>
        </div>

        {canCreate ? (
          <button
            onClick={() => setIsRegisterOpen(true)}
            className="w-full sm:w-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 cursor-pointer shadow-md pop-hover-lift pop-motion-micro"
            id="register-video-btn"
          >
            <Plus className="w-4 h-4" />
            <span>{tText('تسجيل فيديو جديد', 'Register New Video')}</span>
          </button>
        ) : (
          <div className="text-xs bg-gray-100 dark:bg-gray-900 px-3 py-2 rounded-xl text-gray-400 border border-gray-200 dark:border-gray-800 font-bold flex items-center gap-1.5 cursor-not-allowed">
            <Lock className="w-3.5 h-3.5" />
            <span>{tText('غير مصرح لك بالتسجيل (مطلوب صلاحية إنشاء)', 'Registration Disabled (Requires Create)')}</span>
          </div>
        )}
      </div>

      {/* 4. STATS METRIC GRID */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" id="media-stats-grid">
        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200/80 dark:border-gray-800 flex items-center gap-3 shadow-xs">
          <div className="h-10 w-10 bg-blue-50 dark:bg-blue-950/30 rounded-xl flex items-center justify-center text-blue-600 shrink-0">
            <Film className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-gray-400 dark:text-gray-500 truncate uppercase">{tText('إجمالي الفيديوهات', 'Total Videos')}</p>
            <p className="text-lg font-black text-gray-900 dark:text-white mt-0.5">{videos.length}</p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200/80 dark:border-gray-800 flex items-center gap-3 shadow-xs">
          <div className="h-10 w-10 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl flex items-center justify-center text-emerald-600 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-gray-400 dark:text-gray-500 truncate uppercase">{tText('حقوق معتمدة', 'Cleared Rights')}</p>
            <p className="text-lg font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
              {videos.filter(v => v.rightsStatus === 'Cleared').length}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200/80 dark:border-gray-800 flex items-center gap-3 shadow-xs">
          <div className="h-10 w-10 bg-amber-50 dark:bg-amber-950/30 rounded-xl flex items-center justify-center text-amber-600 shrink-0">
            <Globe className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-gray-400 dark:text-gray-500 truncate uppercase">{tText('عام ومؤهل', 'Public Eligible')}</p>
            <p className="text-lg font-black text-amber-600 mt-0.5">
              {videos.filter(v => isVideoPubliclyEligible(v)).length}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200/80 dark:border-gray-800 flex items-center gap-3 shadow-xs">
          <div className="h-10 w-10 bg-rose-50 dark:bg-rose-950/30 rounded-xl flex items-center justify-center text-rose-600 shrink-0">
            <EyeOff className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-gray-400 dark:text-gray-500 truncate uppercase">{tText('مخفي تحريريًا', 'Hidden Editorial')}</p>
            <p className="text-lg font-black text-rose-600 dark:text-rose-400 mt-0.5">
              {videos.filter(v => v.visibilityDecision === 'Hidden').length}
            </p>
          </div>
        </div>
      </div>

      {/* 5. SEARCH & FILTER CONTROLS */}
      <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl border border-gray-200/80 dark:border-gray-800 space-y-4 shadow-2xs">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute start-3.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder={tText('البحث بالاسم التحريري، أو المعرف يوتيوب...', 'Search video title, tag, or YouTube ID...')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full ps-10 pe-4 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-sm focus:outline-hidden focus:border-emerald-600 font-medium"
              id="media-search-input"
            />
          </div>

          <div className="grid grid-cols-3 gap-2 md:w-auto shrink-0">
            {/* Category Filter */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-2 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-bold text-gray-700 dark:text-gray-300 cursor-pointer focus:outline-hidden focus:border-emerald-600"
              title="Category Filter"
            >
              <option value="All">{tText('كل التصنيفات', 'All Categories')}</option>
              <option value="Climate">{tText('المناخ', 'Climate')}</option>
              <option value="Water">{tText('المياه', 'Water')}</option>
              <option value="Biodiversity">{tText('التنوع الحيوي', 'Biodiversity')}</option>
              <option value="Pollution">{tText('التلوث', 'Pollution')}</option>
              <option value="Energy">{tText('الطاقة', 'Energy')}</option>
              <option value="Agriculture">{tText('الزراعة', 'Agriculture')}</option>
              <option value="EnvironmentalPolicy">{tText('السياسات البيئية', 'Environmental Policy')}</option>
            </select>

            {/* Rights Filter */}
            <select
              value={selectedRights}
              onChange={(e) => setSelectedRights(e.target.value)}
              className="px-2 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-bold text-gray-700 dark:text-gray-300 cursor-pointer focus:outline-hidden focus:border-emerald-600"
              title="Rights Status Filter"
            >
              <option value="All">{tText('كل الحقوق', 'All Rights')}</option>
              <option value="NotStarted">{tText('لم تبدأ', 'Not Started')}</option>
              <option value="InReview">{tText('قيد المراجعة', 'In Review')}</option>
              <option value="Cleared">{tText('مرخص ومبرأ', 'Cleared')}</option>
              <option value="NeedsChanges">{tText('يتطلب تعديل', 'Needs Changes')}</option>
              <option value="Rejected">{tText('مرفوض', 'Rejected')}</option>
            </select>

            {/* Visibility Filter */}
            <select
              value={selectedVisibility}
              onChange={(e) => setSelectedVisibility(e.target.value)}
              className="px-2 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-bold text-gray-700 dark:text-gray-300 cursor-pointer focus:outline-hidden focus:border-emerald-600"
              title="Visibility Filter"
            >
              <option value="All">{tText('كل مستويات الظهور', 'All Visibility')}</option>
              <option value="Hidden">{tText('مخفي', 'Hidden')}</option>
              <option value="MediaHubOnly">{tText('مركز الوسائط فقط', 'Media Hub Only')}</option>
              <option value="NewsEligible">{tText('متاح للربط الإخباري', 'News Eligible')}</option>
              <option value="Featured">{tText('متميز ومثبت', 'Featured')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* 6. MAIN SPLIT INTERVIEW & INSPECTION WORKSPACE */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start" id="split-media-grid">
        
        {/* INVENTORY PANEL (7 Cols) */}
        <div className="xl:col-span-7 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-900/50">
            <span className="text-xs font-extrabold text-gray-500 uppercase tracking-wide">
              {tText(`قائمة الفيديوهات المطابقة (${filteredVideos.length})`, `Matching Videos (${filteredVideos.length})`)}
            </span>
            <button 
              onClick={refreshData}
              className="p-1.5 text-gray-500 hover:text-emerald-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer transition-colors"
              title={tText('تحديث البيانات', 'Refresh Lists')}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {filteredVideos.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <Film className="w-12 h-12 mx-auto mb-3 opacity-30 text-gray-400" />
              <p className="text-sm font-bold">{tText('لم يتم العثور على أي فيديو مطابق للمرشحات', 'No matching videos found')}</p>
            </div>
          ) : (
            <>
              {/* DESKTOP VIEW (>=1280px) Dense Table */}
              <div className="hidden xl:block overflow-x-auto">
                <table className="w-full text-start text-xs font-semibold text-gray-700 dark:text-gray-300">
                  <thead className="bg-gray-100/50 dark:bg-gray-800/40 text-gray-500 text-[10px] uppercase tracking-wider text-start">
                    <tr>
                      <th className="px-4 py-3 text-start">{tText('تفاصيل المادة المرئية', 'Video Details')}</th>
                      <th className="px-4 py-3 text-start">{tText('التصنيف', 'Category')}</th>
                      <th className="px-4 py-3 text-start">{tText('الحقوق', 'Rights')}</th>
                      <th className="px-4 py-3 text-start">{tText('الظهور التحريري', 'Visibility')}</th>
                      <th className="px-4 py-3 text-start">{tText('الأخبار المرتبطة', 'Relations')}</th>
                      <th className="px-3 py-3 text-center">{tText('فحص', 'Inspect')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filteredVideos.map((v) => {
                      const isSelected = selectedVideo?.id === v.id;
                      const hasRelations = MediaService.getRelationsForVideo(v.id).length;
                      return (
                        <tr 
                          key={v.id} 
                          className={`hover:bg-gray-50/70 dark:hover:bg-gray-850/40 cursor-pointer transition-colors ${isSelected ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-s-4 border-emerald-500' : ''}`}
                          onClick={() => setSelectedVideo(v)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-16 bg-gray-100 dark:bg-gray-850 rounded-lg overflow-hidden border border-gray-200/50 dark:border-gray-850 shrink-0 relative">
                                {v.editorialThumbnail?.url ? (
                                  <img 
                                    src={v.editorialThumbnail.url} 
                                    alt="" 
                                    referrerPolicy="no-referrer"
                                    className="h-full w-full object-cover" 
                                  />
                                ) : (
                                  <div className="h-full w-full flex items-center justify-center text-gray-400">
                                    <Film className="w-4 h-4" />
                                  </div>
                                )}
                                <span className="absolute bottom-0.5 right-0.5 text-[8px] bg-black/75 text-white px-1 py-0.2 rounded-xs font-bold font-mono">
                                  {v.youtubeSource.duration.replace('PT', '').replace('M', ':').replace('S', '')}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <h3 className="font-extrabold text-gray-900 dark:text-white truncate max-w-[180px]">{isAr ? v.titleAr : (v.titleEn || v.titleAr)}</h3>
                                <p className="text-[10px] font-mono text-gray-400 dark:text-gray-500 truncate max-w-[180px] mt-0.5">{v.youtubeSource.youtubeVideoId}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full font-bold">
                              {v.category}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-black ${
                              v.rightsStatus === 'Cleared' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400' :
                              v.rightsStatus === 'InReview' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400' :
                              v.rightsStatus === 'Rejected' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-400' :
                              'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                            }`}>
                              {v.rightsStatus === 'Cleared' ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : null}
                              <span>{v.rightsStatus}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-extrabold ${
                              v.visibilityDecision === 'Featured' ? 'text-blue-600 dark:text-blue-400 font-black' :
                              v.visibilityDecision === 'NewsEligible' ? 'text-emerald-600 dark:text-emerald-400 font-bold' :
                              v.visibilityDecision === 'MediaHubOnly' ? 'text-amber-600 dark:text-amber-400' :
                              'text-gray-400 dark:text-gray-500 font-medium'
                            }`}>
                              {v.visibilityDecision}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${hasRelations ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400' : 'text-gray-400'}`}>
                              {hasRelations ? `${hasRelations} News` : tText('غير مرتبط', 'Unlinked')}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedVideo(v);
                              }}
                              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-850 rounded-md text-gray-400 hover:text-emerald-600 cursor-pointer"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* MOBILE & TABLET COMPACT CARD VIEW (<1280px) */}
              <div className="xl:hidden divide-y divide-gray-100 dark:divide-gray-800" id="mobile-cards-list">
                {filteredVideos.map((v) => {
                  const isSelected = selectedVideo?.id === v.id;
                  const hasRelations = MediaService.getRelationsForVideo(v.id).length;
                  return (
                    <div 
                      key={v.id}
                      onClick={() => setSelectedVideo(v)}
                      className={`p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors ${isSelected ? 'bg-emerald-50/40 dark:bg-emerald-950/10 border-s-4 border-emerald-500' : ''}`}
                    >
                      <div className="flex gap-3">
                        <div className="h-14 w-20 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-800 shrink-0 relative">
                          {v.editorialThumbnail?.url ? (
                            <img 
                              src={v.editorialThumbnail.url} 
                              alt="" 
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover" 
                            />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-gray-400">
                              <Film className="w-5 h-5" />
                            </div>
                          )}
                          <span className="absolute bottom-0.5 right-0.5 text-[8px] bg-black/75 text-white px-1.5 py-0.2 rounded-xs font-bold font-mono">
                            {v.youtubeSource.duration.replace('PT', '').replace('M', ':').replace('S', '')}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1 space-y-1">
                          <h3 className="font-extrabold text-xs sm:text-sm text-gray-950 dark:text-white truncate">{isAr ? v.titleAr : (v.titleEn || v.titleAr)}</h3>
                          <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-bold text-gray-500">
                            <span className="text-[10px] font-mono font-medium text-gray-400 shrink-0">{v.youtubeSource.youtubeVideoId}</span>
                            <span className="text-gray-300">•</span>
                            <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-1.5 py-0.2 rounded-full">{v.category}</span>
                            <span className="text-gray-300">•</span>
                            <span className={v.rightsStatus === 'Cleared' ? 'text-emerald-600 font-extrabold' : 'text-gray-500'}>{v.rightsStatus}</span>
                            <span className="text-gray-300">•</span>
                            <span className={v.visibilityDecision === 'Featured' ? 'text-blue-600 font-black' : 'text-gray-500'}>{v.visibilityDecision}</span>
                          </div>
                          {hasRelations ? (
                            <div className="inline-flex items-center gap-1 text-[9px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400 px-1.5 py-0.5 rounded-md font-bold mt-1">
                              <LinkIcon className="w-2.5 h-2.5" />
                              <span>{hasRelations} News linked</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* DETAILS INSPECTOR PANEL (5 Cols) */}
        <div className="xl:col-span-5 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200/80 dark:border-gray-800 p-5 shadow-xs shrink-0 max-w-full w-full min-w-0" id="media-inspector-panel">
          {!selectedVideo ? (
            <div className="py-20 text-center text-gray-400 flex flex-col items-center justify-center space-y-3">
              <div className="h-14 w-14 rounded-full bg-gray-50 dark:bg-gray-950 flex items-center justify-center border border-gray-100 dark:border-gray-900 text-gray-300 shadow-2xs">
                <Film className="w-6 h-6" />
              </div>
              <p className="text-sm font-extrabold text-gray-500 dark:text-gray-400">
                {tText('يرجى تحديد فيديو من القائمة لفحص هويته وتراخيصه', 'Select a video from the list to inspect details')}
              </p>
              <p className="text-xs text-gray-400 max-w-xs leading-relaxed font-medium">
                {tText(
                  'يتيح لك المفتش تعديل البيانات الوصفية، والتحكم بحقوق النشر وقرار الظهور التحريري، وربط المادة بالأخبار البيئية الحالية.',
                  'Use the inspector to edit metadata, verify copyrights, update visibility decisions, and link with environmental news.'
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              
              {/* Header inside Inspector */}
              <div className="flex justify-between items-start border-b border-gray-100 dark:border-gray-800 pb-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400 px-2 py-0.5 rounded-full font-bold">
                      {selectedVideo.category}
                    </span>
                    {isVideoPubliclyEligible(selectedVideo) && (
                      <span className="text-[10px] bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400 px-2 py-0.5 rounded-full font-black flex items-center gap-0.5">
                        <Globe className="w-2.5 h-2.5" />
                        <span>{tText('مؤهل للجمهور العام', 'Public Eligible')}</span>
                      </span>
                    )}
                  </div>
                  <h2 className="text-lg font-black text-gray-950 dark:text-white mt-1.5 leading-snug break-words">
                    {isAr ? selectedVideo.titleAr : (selectedVideo.titleEn || selectedVideo.titleAr)}
                  </h2>
                </div>
                <button 
                  onClick={() => setSelectedVideo(null)}
                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-850 rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer shrink-0"
                  title="Close Inspector"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* SAFE VIDEO PREVIEW EMBED */}
              <div className="space-y-2">
                <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wide block">
                  {tText('معاينة آمنة للمشغل (دون ملفات تعريف الارتباط)', 'Privacy-Safe Video Preview')}
                </span>
                
                <VideoEmbed 
                  youtubeSource={selectedVideo.youtubeSource} 
                  title={isAr ? selectedVideo.titleAr : (selectedVideo.titleEn || selectedVideo.titleAr)}
                  isArabic={isAr}
                />
              </div>

              {/* TECHNICAL IDENTITY & METADATA SECTION */}
              <div className="bg-gray-50 dark:bg-gray-950 p-4 rounded-xl border border-gray-200/50 dark:border-gray-900/60 text-xs font-semibold text-gray-700 dark:text-gray-300 space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-400 font-bold">{tText('معرف الفيديو الكنسي', 'Canonical ID')}:</span>
                  <span className="font-mono font-bold text-gray-900 dark:text-white select-all break-all text-right max-w-[180px]">{selectedVideo.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 font-bold">{tText('رابط يوتيوب الخارجي', 'External YouTube Link')}:</span>
                  <a 
                    href={selectedVideo.youtubeSource.youtubeUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1"
                  >
                    <span className="font-mono">{selectedVideo.youtubeSource.youtubeVideoId}</span>
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  </a>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 font-bold">{tText('القناة الناشرة', 'Publishing Channel')}:</span>
                  <span className="text-gray-900 dark:text-white font-bold">{selectedVideo.youtubeSource.channelName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400 font-bold">{tText('الحالة الفنية يوتيوب', 'YouTube Availability')}:</span>
                  <span className={`px-2 py-0.2 rounded-md font-bold ${selectedVideo.youtubeSource.availabilityStatus === 'Available' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                    {selectedVideo.youtubeSource.availabilityStatus}
                  </span>
                </div>
                {selectedVideo.producer && (
                  <div className="flex justify-between">
                    <span className="text-gray-400 font-bold">{tText('المنتج التحريري', 'Editorial Producer')}:</span>
                    <span className="text-gray-900 dark:text-white font-bold">{selectedVideo.producer}</span>
                  </div>
                )}
                {selectedVideo.editor && (
                  <div className="flex justify-between">
                    <span className="text-gray-400 font-bold">{tText('المحرر المسؤول', 'Responsible Editor')}:</span>
                    <span className="text-gray-950 dark:text-white font-bold">{selectedVideo.editor}</span>
                  </div>
                )}
              </div>

              {/* EDITORIAL DESCRIPTION */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wide">
                    {tText('البيانات الوصفية والوسوم التحريرية', 'Editorial Description & Tags')}
                  </span>
                  {canEdit && (
                    <button
                      onClick={openEditMetadata}
                      className="text-xs text-emerald-600 hover:text-emerald-700 font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <Edit className="w-3.5 h-3.5" />
                      <span>{tText('تعديل البيانات الوصفية', 'Edit Metadata')}</span>
                    </button>
                  )}
                </div>

                <div className="space-y-3 bg-white dark:bg-gray-950 p-4 border border-gray-100 dark:border-gray-800 rounded-xl">
                  {/* Descs */}
                  {selectedVideo.editorialDescriptionAr && (
                    <div className="space-y-1">
                      <span className="text-[10px] text-gray-400 font-bold">{tText('الوصف بالعربية', 'Arabic Description')}</span>
                      <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 leading-relaxed">{selectedVideo.editorialDescriptionAr}</p>
                    </div>
                  )}
                  {selectedVideo.editorialDescriptionEn && (
                    <div className="space-y-1 border-t border-gray-100 dark:border-gray-900 pt-2 mt-2">
                      <span className="text-[10px] text-gray-400 font-bold">{tText('الوصف بالإنجليزية', 'English Description')}</span>
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 leading-relaxed">{selectedVideo.editorialDescriptionEn}</p>
                    </div>
                  )}

                  {/* Tags */}
                  {selectedVideo.tags && selectedVideo.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2 border-t border-gray-100 dark:border-gray-900 mt-2">
                      {selectedVideo.tags.map((tag, idx) => (
                        <span key={idx} className="text-[10px] bg-gray-50 dark:bg-gray-850 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-md font-bold">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHTS GOVERNANCE WORKFLOW (Strict ManageRights Enforced) */}
              <div className="space-y-3 bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-xl p-4">
                <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wide block">
                  {tText('تدقيق حقوق النشر وبراءة النشر (محمي بـ ManageRights)', 'Copyright Clearance & Audits (ManageRights Protected)')}
                </span>

                <div className="space-y-2.5">
                  <div className="flex gap-2">
                    <span className="text-xs text-gray-400 font-bold mt-1">{tText('الحالة الحالية', 'Current Status')}:</span>
                    <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-black ${
                      selectedVideo.rightsStatus === 'Cleared' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-400' :
                      selectedVideo.rightsStatus === 'InReview' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400' :
                      selectedVideo.rightsStatus === 'Rejected' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-400' :
                      'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                    }`}>
                      {selectedVideo.rightsStatus === 'Cleared' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : null}
                      <span>{selectedVideo.rightsStatus}</span>
                    </span>
                  </div>

                  {selectedVideo.rightsNotes && (
                    <div className="bg-gray-50 dark:bg-gray-950 p-2.5 rounded-lg border border-gray-100 dark:border-gray-850 text-[11px] font-semibold text-gray-600 dark:text-gray-400">
                      <span className="font-extrabold text-gray-400 block mb-1">{tText('ملاحظات التدقيق القانوني', 'Legal Audit Notes')}:</span>
                      {selectedVideo.rightsNotes}
                    </div>
                  )}

                  {canManageRights ? (
                    <div className="space-y-2 border-t border-gray-100 dark:border-gray-800 pt-3 mt-1">
                      <label className="text-[10px] text-gray-400 font-extrabold block">{tText('ملاحظات أو مسوغات القرار', 'Decision Notes / Justifications')}</label>
                      <input 
                        type="text"
                        placeholder={tText('اكتب ملاحظات ترخيص البث أو التنازل...', 'Write broadcasting consent details or reason...')}
                        value={rightsNotes}
                        onChange={(e) => setRightsNotes(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg focus:outline-hidden"
                      />
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <button
                          onClick={() => { handleUpdateRights('Cleared'); setRightsNotes(''); }}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-black cursor-pointer shadow-xs"
                        >
                          {tText('اعتماد وبراءة نشر (Cleared)', 'Clear Rights (Cleared)')}
                        </button>
                        <button
                          onClick={() => { handleUpdateRights('InReview'); setRightsNotes(''); }}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[10px] font-black cursor-pointer shadow-xs"
                        >
                          {tText('تحويل للمراجعة الفنية', 'Set to In Review')}
                        </button>
                        <button
                          onClick={() => { handleUpdateRights('NeedsChanges'); setRightsNotes(''); }}
                          className="px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white rounded-lg text-[10px] font-black cursor-pointer shadow-xs"
                        >
                          {tText('طلب تعديلات (NeedsChanges)', 'Request Changes')}
                        </button>
                        <button
                          onClick={() => { handleUpdateRights('Rejected'); setRightsNotes(''); }}
                          className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-black cursor-pointer shadow-xs"
                        >
                          {tText('رفض وحظر (Rejected)', 'Reject Rights')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] font-bold text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 p-2 rounded-lg flex items-center gap-1.5 border border-rose-100/30">
                      <Lock className="w-3.5 h-3.5" />
                      <span>{tText('يتطلب صلاحية تدقيق الحقوق (ManageRights)', 'Requires ManageRights permission to alter copyright status')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* VISIBILITY GOVERNANCE WORKFLOW (Strict Review/Approve Enforced) */}
              <div className="space-y-3 bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-xl p-4">
                <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wide block">
                  {tText('إدارة الظهور التحريري ونشر المنصة (محمي بـ Review)', 'Editorial Visibility Scope & Publishing (Review Protected)')}
                </span>

                <div className="space-y-2.5">
                  <div className="flex gap-2">
                    <span className="text-xs text-gray-400 font-bold mt-0.5">{tText('القرار الحالي', 'Current Decision')}:</span>
                    <span className={`text-xs font-black ${
                      selectedVideo.visibilityDecision === 'Featured' ? 'text-blue-600 dark:text-blue-400' :
                      selectedVideo.visibilityDecision === 'NewsEligible' ? 'text-emerald-600 dark:text-emerald-400' :
                      selectedVideo.visibilityDecision === 'MediaHubOnly' ? 'text-amber-600 dark:text-amber-400' :
                      'text-gray-400 dark:text-gray-500'
                    }`}>
                      {selectedVideo.visibilityDecision}
                    </span>
                  </div>

                  {canReview ? (
                    <div className="flex flex-wrap gap-1.5 border-t border-gray-100 dark:border-gray-800 pt-3 mt-1">
                      <button
                        onClick={() => handleUpdateVisibility('Hidden')}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black cursor-pointer ${
                          selectedVideo.visibilityDecision === 'Hidden'
                            ? 'bg-gray-200 dark:bg-gray-800 text-gray-800'
                            : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-950 text-gray-600'
                        }`}
                      >
                        {tText('مخفي (Hidden)', 'Hidden')}
                      </button>
                      <button
                        onClick={() => handleUpdateVisibility('MediaHubOnly')}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black cursor-pointer ${
                          selectedVideo.visibilityDecision === 'MediaHubOnly'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-950 text-gray-600'
                        }`}
                      >
                        {tText('مركز الوسائط فقط (MediaHubOnly)', 'Media Hub Only')}
                      </button>
                      <button
                        onClick={() => handleUpdateVisibility('NewsEligible')}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black cursor-pointer ${
                          selectedVideo.visibilityDecision === 'NewsEligible'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-950 text-gray-600'
                        }`}
                      >
                        {tText('مؤهل للربط الإخباري', 'News Eligible')}
                      </button>
                      <button
                        onClick={() => handleUpdateVisibility('Featured')}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black cursor-pointer ${
                          selectedVideo.visibilityDecision === 'Featured'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-950 text-gray-600'
                        }`}
                      >
                        {tText('متميز ومثبت (Featured)', 'Featured')}
                      </button>
                    </div>
                  ) : (
                    <div className="text-[11px] font-bold text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 p-2 rounded-lg flex items-center gap-1.5 border border-rose-100/30">
                      <Lock className="w-3.5 h-3.5" />
                      <span>{tText('يتطلب صلاحية المراجعة والتنظيم (Review)', 'Requires Review permission to alter visibility scope')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* NEWS RELATIONSHIP SECTION (Strict Edit Enforced) */}
              <div className="space-y-4 bg-white dark:bg-gray-900 border border-gray-150 dark:border-gray-800 rounded-xl p-4">
                <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wide block">
                  {tText('الروابط الإخبارية والمواد الصحفية المرتبطة (News ↔ Video)', 'News Relations & Links (News ↔ Video)')}
                </span>

                {/* List current relations */}
                <div className="space-y-2">
                  {linkedRelations.length === 0 ? (
                    <p className="text-xs text-gray-400 font-medium italic">
                      {tText('لا توجد روابط نشطة لهذا الفيديو حاليًا.', 'No active news associations for this video.')}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {linkedRelations.map((rel) => (
                        <div 
                          key={rel.id} 
                          className="flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-950 rounded-lg border border-gray-100 dark:border-gray-850 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                            <div className="min-w-0">
                              <p className="font-extrabold text-gray-900 dark:text-white truncate max-w-[200px] sm:max-w-xs">{getNewsTitle(rel.contentId)}</p>
                              <div className="flex gap-2 text-[9px] font-bold text-gray-400 mt-0.5">
                                <span>{rel.relationType}</span>
                                <span>•</span>
                                <span>{rel.placement}</span>
                              </div>
                            </div>
                          </div>

                          {canEdit ? (
                            <button
                              onClick={() => handleUnlinkNews(rel.contentId)}
                              className="p-1.5 text-gray-400 hover:text-rose-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-900 cursor-pointer"
                              title={tText('إلغاء الارتباط التحريري', 'Unlink Related News')}
                            >
                              <Unlink className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <Lock className="w-3 h-3 text-gray-300" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Link a news item form */}
                {canEdit ? (
                  linkableNews.length > 0 ? (
                    <form onSubmit={handleLinkNews} className="space-y-2.5 border-t border-gray-150 dark:border-gray-800 pt-3 mt-1">
                      <span className="text-[10px] font-extrabold text-gray-400 uppercase tracking-wide block">{tText('ربط خبر بيئي جديد', 'Link New Environmental News')}</span>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] text-gray-400 font-bold block">{tText('اختر الخبر المستهدف', 'Select News Item')}</label>
                          <select
                            value={selectedNewsId}
                            onChange={(e) => setSelectedNewsId(e.target.value)}
                            required
                            className="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg cursor-pointer"
                          >
                            <option value="">{tText('-- اختر الخبر --', '-- Select News --')}</option>
                            {linkableNews.map((news) => (
                              <option key={news.id} value={news.id}>
                                {isAr ? news.titleAr : (news.titleEn || news.titleAr)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] text-gray-400 font-bold block">{tText('نوع طبيعة العلاقة', 'Relation Type')}</label>
                          <select
                            value={relationType}
                            onChange={(e) => setRelationType(e.target.value as any)}
                            className="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg cursor-pointer"
                          >
                            <option value="Embedded">{tText('مشغل مدمج (Embedded)', 'Embedded Player')}</option>
                            <option value="RelatedCoverage">{tText('تغطية بيئية مصاحبة', 'Related Coverage')}</option>
                            <option value="SupportingMaterial">{tText('مادة علمية مدعمة', 'Supporting Material')}</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex justify-between items-center gap-2 pt-1">
                        <div className="space-y-1 flex-1">
                          <label className="text-[10px] text-gray-400 font-bold block">{tText('الموقع والتموضع البصري', 'Visual Placement')}</label>
                          <select
                            value={placement}
                            onChange={(e) => setPlacement(e.target.value as any)}
                            className="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-lg cursor-pointer"
                          >
                            <option value="Inline">{tText('ضمن النص (Inline)', 'Inline inside Body')}</option>
                            <option value="Top">{tText('أعلى التحرير (Top)', 'Top of Article')}</option>
                            <option value="Bottom">{tText('أسفل المادة (Bottom)', 'Bottom of Article')}</option>
                            <option value="Sidebar">{tText('الشريط الجانبي (Sidebar)', 'Sidebar Section')}</option>
                          </select>
                        </div>

                        <button
                          type="submit"
                          className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-black cursor-pointer shadow-xs self-end h-[32px] flex items-center gap-1"
                        >
                          <LinkIcon className="w-3.5 h-3.5" />
                          <span>{tText('إنشاء الرابط', 'Create Link')}</span>
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="text-[10px] text-gray-400 italic">
                      {tText('تم ربط جميع الأخبار المتاحة بالفعل بهذا الفيديو.', 'All existing news articles are already associated.')}
                    </p>
                  )
                ) : (
                  <div className="text-[11px] font-bold text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 p-2 rounded-lg flex items-center gap-1.5 border border-rose-100/30">
                    <Lock className="w-3.5 h-3.5" />
                    <span>{tText('يتطلب صلاحية التحرير لربط الأخبار (Edit)', 'Requires Edit permission to alter news associations')}</span>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

      </div>

      {/* 7. REGISTER CANONICAL VIDEO MODAL */}
      {isRegisterOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-40 overflow-y-auto" id="register-video-modal" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl animate-scaleUp">
            
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center sticky top-0 bg-white dark:bg-gray-900 z-10">
              <h2 className="text-base sm:text-lg font-black text-gray-900 dark:text-white flex items-center gap-2">
                <Film className="w-5 h-5 text-emerald-600" />
                <span>{tText('تسجيل مرجع فيديو كنسي جديد', 'Register Canonical Video Reference')}</span>
              </h2>
              <button 
                onClick={() => setIsRegisterOpen(false)}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleRegister} className="p-5 space-y-4">
              
              <div className="bg-blue-50 dark:bg-blue-950/20 p-3 rounded-xl border border-blue-100 text-xs text-blue-900 dark:text-blue-300 font-medium">
                {tText(
                  'ملاحظة: التسجيل الكنسي يتطلب توفر معرف فيديو يوتيوب حقيقي ومقاسات تشغيل سليمة. سيتم التحقق من تكرار المعرف فوريًا.',
                  'Note: Canonical registration requires a valid YouTube Video ID. Duplicate IDs are rejected to preserve data integrity.'
                )}
              </div>

              {/* Grid 1: Youtube ID & Category */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">
                    {tText('معرف فيديو يوتيوب (YouTube Video ID) *', 'YouTube Video ID *')}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. dQw4w9WgXcQ"
                    value={regYoutubeId}
                    onChange={(e) => setRegYoutubeId(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-sm font-semibold focus:outline-hidden focus:border-emerald-600 font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">
                    {tText('التصنيف البيئي الأساسي *', 'Primary Category *')}
                  </label>
                  <select
                    value={regCategory}
                    onChange={(e) => setRegCategory(e.target.value as Category)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-sm font-bold cursor-pointer"
                  >
                    <option value="Climate">{tText('المناخ', 'Climate')}</option>
                    <option value="Water">{tText('المياه', 'Water')}</option>
                    <option value="Biodiversity">{tText('التنوع الحيوي', 'Biodiversity')}</option>
                    <option value="Pollution">{tText('التلوث', 'Pollution')}</option>
                    <option value="Energy">{tText('الطاقة', 'Energy')}</option>
                    <option value="Agriculture">{tText('الزراعة', 'Agriculture')}</option>
                    <option value="EnvironmentalPolicy">{tText('السياسات البيئية', 'Environmental Policy')}</option>
                  </select>
                </div>
              </div>

              {/* Grid 2: Titles */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">
                    {tText('العنوان التحريري بالعربية *', 'Editorial Title (Arabic) *')}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={tText('اكتب عنوانًا بيئيًا مشوقًا بالعربية...', 'Enter a descriptive Arabic title...')}
                    value={regTitleAr}
                    onChange={(e) => setRegTitleAr(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-sm font-bold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">
                    {tText('العنوان التحريري بالإنجليزية', 'Editorial Title (English)')}
                  </label>
                  <input
                    type="text"
                    placeholder="Enter English translation title..."
                    value={regTitleEn}
                    onChange={(e) => setRegTitleEn(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-sm font-bold"
                  />
                </div>
              </div>

              {/* Grid 3: Excerpts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">
                    {tText('مقتطف قصير بالعربية', 'Arabic Excerpt')}
                  </label>
                  <input
                    type="text"
                    placeholder={tText('ملخص الخبر لبطاقات العرض التحريرية...', 'Brief summary...')}
                    value={regExcerptAr}
                    onChange={(e) => setRegExcerptAr(e.target.value)}
                    className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-semibold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">
                    {tText('مقتطف قصير بالإنجليزية', 'English Excerpt')}
                  </label>
                  <input
                    type="text"
                    placeholder="Brief summary in English..."
                    value={regExcerptEn}
                    onChange={(e) => setRegExcerptEn(e.target.value)}
                    className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-semibold"
                  />
                </div>
              </div>

              {/* Descriptions */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">
                    {tText('الوصف والتعليق التحريري بالعربية *', 'Editorial Description (Arabic) *')}
                  </label>
                  <textarea
                    required
                    rows={3}
                    placeholder={tText('اكتب تفاصيل القصة، ومصادر اللقطات والترجمة...', 'Write detailed editorial context...')}
                    value={regDescAr}
                    onChange={(e) => setRegDescAr(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-semibold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">
                    {tText('الوصف والتعليق التحريري بالإنجليزية', 'Editorial Description (English)')}
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Write English description context..."
                    value={regDescEn}
                    onChange={(e) => setRegDescEn(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-semibold"
                  />
                </div>
              </div>

              {/* Metadata details */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">
                    {tText('اسم القناة / المنتج التحريري', 'Channel Name / Publisher')}
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Promise of Planet"
                    value={regChannelName}
                    onChange={(e) => setRegChannelName(e.target.value)}
                    className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">
                    {tText('المدة الزمنية (ISO 8601)', 'Duration (ISO 8601)')}
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. PT12M45S"
                    value={regDuration}
                    onChange={(e) => setRegDuration(e.target.value)}
                    className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">
                    {tText('الوسوم (مفصولة بفاصلة)', 'Tags (Comma separated)')}
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. مناخ, مياه, دندر"
                    value={regTags}
                    onChange={(e) => setRegTags(e.target.value)}
                    className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs"
                  />
                </div>
              </div>

              {/* Thumbnail URL */}
              <div className="space-y-1">
                <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">
                  {tText('رابط غلاف الصورة المصغرة (Thumbnail URL)', 'Thumbnail Image URL')}
                </label>
                <input
                  type="url"
                  placeholder="https://images.unsplash.com/..."
                  value={regThumbnailUrl}
                  onChange={(e) => setRegThumbnailUrl(e.target.value)}
                  className="w-full px-3 py-1.5 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-mono"
                />
              </div>

              {/* Modal Buttons */}
              <div className="pt-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsRegisterOpen(false)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-850 dark:text-gray-200 rounded-xl text-xs font-black cursor-pointer"
                >
                  {tText('إلغاء', 'Cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black cursor-pointer shadow-md"
                >
                  {tText('تسجيل وحفظ', 'Register & Save')}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* 8. EDIT METADATA MODAL */}
      {isEditMetadataOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-40" id="edit-metadata-modal" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl animate-scaleUp">
            
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-900/50 rounded-t-2xl">
              <h2 className="text-base font-black text-gray-900 dark:text-white flex items-center gap-1.5">
                <Edit className="w-4 h-4 text-emerald-600" />
                <span>{tText('تعديل البيانات الوصفية التحريرية', 'Edit Editorial Metadata')}</span>
              </h2>
              <button 
                onClick={() => setIsEditMetadataOpen(false)}
                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditMetadata} className="p-5 space-y-4">
              
              <div className="space-y-1">
                <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">{tText('الوصف بالعربية *', 'Arabic Description *')}</label>
                <textarea
                  required
                  rows={4}
                  value={editDescAr}
                  onChange={(e) => setEditDescAr(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">{tText('الوصف بالإنجليزية', 'English Description')}</label>
                <textarea
                  rows={3}
                  value={editDescEn}
                  onChange={(e) => setEditDescEn(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-semibold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">{tText('رابط غلاف الصورة المصغرة', 'Thumbnail URL')}</label>
                <input
                  type="url"
                  value={editThumbnailUrl}
                  onChange={(e) => setEditThumbnailUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-700 dark:text-gray-300 font-black block">{tText('الوسوم (مفصولة بفاصلة)', 'Tags (Comma separated)')}</label>
                <input
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded-xl text-xs font-semibold"
                />
              </div>

              <div className="pt-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditMetadataOpen(false)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-850 dark:text-gray-200 rounded-xl text-xs font-black cursor-pointer"
                >
                  {tText('إلغاء', 'Cancel')}
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black cursor-pointer shadow-md"
                >
                  {tText('حفظ التعديلات', 'Save Updates')}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

    </div>
  );
}
