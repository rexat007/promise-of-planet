import { useState, useEffect, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { NewsItem } from '../../types/news';
import { CANONICAL_CATEGORY_DEFINITIONS, isCanonicalCategory } from '../../types';
import type { JournalisticType, Video } from '../../types';
import { WorkflowState, WorkflowAction } from '../../types/workflow';
import { MAX_WORKFLOW_COMMENT_LENGTH } from '../../../functions/src/shared/workflowContract';
import type { WorkflowTransitionConfig } from '../../types/workflow';
import type { AdminUser } from '../../types/admin';
import { WorkflowEngine } from '../../services/workflowEngine';
import { AdminAccessService } from '../../services/adminAccess';
import { AdminPermission } from '../../types/admin';
import { MediaAdminClient } from '../../services/mediaAdminClient';
import {
  MAX_RELATED_VIDEOS_PER_NEWS_ARTICLE,
  NewsAdminClient,
  NewsEditorImageSessionController,
  isArbitraryUrlOrInvalidVideoId,
  validateRelatedVideoIdsForClient,
  type HaltedAmbiguousImageUpload,
  type NewsImageBinaryFileLike,
  type NewsImageMetadataFormInput,
  type RetainedCompletedImageUpload,
} from '../../services/newsAdminClient';
import {
  RichTextEditor,
  type EditorialImageInsertionRequest,
} from './editor/RichTextEditor';
import {
  EditorialInlineImageModal,
  type PreparedEditorialImage,
} from './editor/EditorialInlineImageModal';
import type { EditorialImageNodeAttrsV2 } from '../../types/richNewsDocument';
import { convertPlainTextToRichDocument } from '../../services/richNewsDocumentContract';
import {
  createEditorialDraftPreviewSessionController,
  mergePersistedAndStagedPreviewUrlMaps,
  type EditorialDraftPreviewSessionController,
} from '../../services/editorialImagePreviewService';
import { EditorialImageRightsReviewPanel } from './EditorialImageRightsReviewPanel';
import { 
  Newspaper, 
  Search, 
  Filter, 
  Plus, 
  Edit3, 
  Eye, 
  X, 
  Save, 
  FileEdit, 
  FileSearch, 
  CheckCircle2, 
  Globe, 
  RotateCcw, 
  Clock, 
  Tag, 
  Link as LinkIcon, 
  MessageSquare, 
  ShieldAlert, 
  Check, 
  History,
  AlertCircle,
  Image as ImageIcon,
  Trash2,
  Crop,
  Video as VideoIcon
} from 'lucide-react';

export { MAX_RELATED_VIDEOS_PER_NEWS_ARTICLE };
export const MAX_NEWS_TRANSITION_COMMENT_LENGTH = MAX_WORKFLOW_COMMENT_LENGTH;

export interface VideoEditorialAttachmentEvaluation {
  readonly isPubliclyPlayable: boolean;
  readonly publicationStatus: string;
  readonly approvalStatus: string;
  readonly rightsStatus: string;
  readonly editorialAssociationLabelAr: string;
  readonly editorialAssociationLabelEn: string;
  readonly publicEligibilityLabelAr: string;
  readonly publicEligibilityLabelEn: string;
}

/**
 * Evaluates a canonical Media Library video's status for editorial draft attachment,
 * clearly distinguishing between editorial association with the draft and public playback eligibility.
 */
export function evaluateVideoEditorialAttachmentStatus(
  video: Pick<Video, 'status' | 'approvalStatus' | 'rightsStatus'>
): VideoEditorialAttachmentEvaluation {
  const publicationStatus = video.status || 'Draft';
  const approvalStatus = video.approvalStatus || 'Draft';
  const rightsStatus = video.rightsStatus || 'NotStarted';

  const isPubliclyPlayable =
    publicationStatus === 'Published' &&
    approvalStatus === 'Approved' &&
    (rightsStatus === 'Cleared' || (rightsStatus as string) === 'Approved');

  return {
    isPubliclyPlayable,
    publicationStatus,
    approvalStatus,
    rightsStatus,
    editorialAssociationLabelAr: 'مرتبط تحريرياً بالمسودة',
    editorialAssociationLabelEn: 'Editorially attached to draft',
    publicEligibilityLabelAr: isPubliclyPlayable
      ? 'مؤهل للعرض العام (منشور ومعتمد الحقوق)'
      : 'محجوب عن العرض العام حتى استكمال النشر واعتماد الحقوق',
    publicEligibilityLabelEn: isPubliclyPlayable
      ? 'Eligible for public playback (Published & Rights Approved)'
      : 'Withheld from public playback until published and rights-approved',
  };
}

export type AttachCanonicalVideoResult =
  | {
      readonly ok: true;
      readonly relatedVideoIds: string[];
    }
  | {
      readonly ok: false;
      readonly reasonCode:
        | 'INVALID_VIDEO_ID_OR_URL'
        | 'DUPLICATE_VIDEO'
        | 'MAX_LIMIT_EXCEEDED'
        | 'VIDEO_NOT_IN_MEDIA_LIBRARY';
      readonly errorMessage: string;
    };

/**
 * Attaches a canonical video from the Media Library to a draft's `relatedVideoIds` list.
 * Rejects arbitrary YouTube URLs, malformed IDs, duplicates, > 5 videos, and IDs missing from the Media Library.
 */
export function attachCanonicalVideoToDraftList(
  currentIds: readonly string[] | undefined,
  candidateInput: string | Pick<Video, 'id'>,
  availableVideos?: readonly Pick<Video, 'id'>[],
  isAr: boolean = true
): AttachCanonicalVideoResult {
  const baseList = Array.isArray(currentIds) ? [...currentIds] : [];
  const rawCandidateId =
    typeof candidateInput === 'string'
      ? candidateInput
      : candidateInput && typeof candidateInput.id === 'string'
        ? candidateInput.id
        : '';

  if (isArbitraryUrlOrInvalidVideoId(rawCandidateId)) {
    return {
      ok: false,
      reasonCode: 'INVALID_VIDEO_ID_OR_URL',
      errorMessage: isAr
        ? 'لا يُسمح بإدخال روابط يوتيوب مباشرة في محرر الأخبار؛ يرجى اختيار فيديو موجود من مكتبة الوسائط.'
        : 'Pasting arbitrary YouTube URLs is not allowed in the news editor; please select an existing video from the Media Library.',
    };
  }

  const candidateId = rawCandidateId.trim();

  if (baseList.includes(candidateId)) {
    return {
      ok: false,
      reasonCode: 'DUPLICATE_VIDEO',
      errorMessage: isAr
        ? 'هذا الفيديو مرتبط بمسودة الخبر بالفعل.'
        : 'This video is already attached to the draft article.',
    };
  }

  if (baseList.length >= MAX_RELATED_VIDEOS_PER_NEWS_ARTICLE) {
    return {
      ok: false,
      reasonCode: 'MAX_LIMIT_EXCEEDED',
      errorMessage: isAr
        ? `لا يمكن ربط أكثر من ${MAX_RELATED_VIDEOS_PER_NEWS_ARTICLE} فيديوهات بالخبر الواحد.`
        : `Cannot attach more than ${MAX_RELATED_VIDEOS_PER_NEWS_ARTICLE} videos to a single news article.`,
    };
  }

  if (
    Array.isArray(availableVideos) &&
    !availableVideos.some((video) => video.id === candidateId)
  ) {
    return {
      ok: false,
      reasonCode: 'VIDEO_NOT_IN_MEDIA_LIBRARY',
      errorMessage: isAr
        ? 'الفيديو المختار غير موجود في مكتبة الوسائط المعتمدة.'
        : 'Selected video does not exist in the canonical Media Library.',
    };
  }

  const nextList = [...baseList, candidateId];
  const check = validateRelatedVideoIdsForClient(nextList, isAr);
  if (!check.valid) {
    return {
      ok: false,
      reasonCode: 'INVALID_VIDEO_ID_OR_URL',
      errorMessage:
        check.errorMessage ||
        (isAr ? 'معرّف الفيديو غير صالح.' : 'Invalid canonical video ID.'),
    };
  }

  return {
    ok: true,
    relatedVideoIds: check.normalizedIds,
  };
}

/**
 * Removes an attached video ID from a draft's `relatedVideoIds` list.
 */
export function removeCanonicalVideoFromDraftList(
  currentIds: readonly string[] | undefined,
  videoIdToRemove: string
): string[] {
  if (!Array.isArray(currentIds)) {
    return [];
  }
  const target = typeof videoIdToRemove === 'string' ? videoIdToRemove.trim() : '';
  return currentIds.filter((id) => id !== target);
}

const JOURNALISTIC_TYPE_OPTIONS: readonly { value: JournalisticType; labelAr: string; labelEn: string }[] = [
  { value: 'News', labelAr: 'خبر', labelEn: 'News' },
  { value: 'Report', labelAr: 'تقرير', labelEn: 'Report' },
  { value: 'Article', labelAr: 'مقال', labelEn: 'Article' },
  { value: 'Investigation', labelAr: 'تحقيق استقصائي', labelEn: 'Investigation' },
  { value: 'Interview', labelAr: 'مقابلة', labelEn: 'Interview' },
  { value: 'Analysis', labelAr: 'تحليل', labelEn: 'Analysis' },
  { value: 'Opinion', labelAr: 'مقال رأي', labelEn: 'Opinion' },
  { value: 'Explainer', labelAr: 'مادة تفسيرية', labelEn: 'Explainer' },
  { value: 'Feature', labelAr: 'قصة معمقة', labelEn: 'Feature' },
];

function getCategoryDisplayLabel(category: string, isAr: boolean): string {
  if (isCanonicalCategory(category)) {
    const def = CANONICAL_CATEGORY_DEFINITIONS.find(c => c.value === category);
    if (def) {
      return isAr ? def.labelAr : def.labelEn;
    }
  }
  return category;
}

/**
 * Mirrors the server's canonical `transitionWorkflow` permission rule in `newsAdminHandlers.ts`:
 * - `AdminPermission.Approve` for `WorkflowState.Approved`
 * - `AdminPermission.Publish` for `WorkflowState.Published` and `Published -> Draft` withdrawal
 * - `AdminPermission.Edit` for every other target workflow state
 */
export function getServerRequiredNewsTransitionPermission(
  targetState: WorkflowState,
  currentState?: WorkflowState
): AdminPermission {
  if (currentState === WorkflowState.Published && targetState === WorkflowState.Draft) {
    return AdminPermission.Publish;
  }
  if (targetState === WorkflowState.Approved) {
    return AdminPermission.Approve;
  }
  if (targetState === WorkflowState.Published) {
    return AdminPermission.Publish;
  }
  return AdminPermission.Edit;
}

/**
 * Evaluates whether an article workflow transition from `currentState` to `targetState`
 * is authorized for `user` under BOTH:
 * 1. `WorkflowEngine.getAuthorizedTransitions` for the current article state and user, AND
 * 2. The server-equivalent required permission (`Edit`, `Approve`, or `Publish`) and Owner-only rule for `Published -> Draft`.
 */
export function isNewsArticleTransitionAuthorized(
  currentState: WorkflowState,
  targetState: WorkflowState,
  user: AdminUser | null | undefined
): boolean {
  if (!user || !user.isActive) {
    return false;
  }
  if (currentState === WorkflowState.Published && targetState === WorkflowState.Draft) {
    if (user.role !== 'Owner') {
      return false;
    }
  }
  const serverRequiredPermission = getServerRequiredNewsTransitionPermission(
    targetState,
    currentState
  );
  if (!AdminAccessService.hasPermission(user, serverRequiredPermission)) {
    return false;
  }
  return WorkflowEngine.getAuthorizedTransitions(currentState, user).some(
    (t) => t.toState === targetState
  );
}

/**
 * Returns the subset of `WorkflowEngine.getAuthorizedTransitions(currentState, user)`
 * that also satisfies the server-equivalent `transitionWorkflow` permission requirement.
 */
export function getAuthorizedNewsArticleTransitions(
  currentState: WorkflowState,
  user: AdminUser | null | undefined
): WorkflowTransitionConfig[] {
  if (!user || !user.isActive) {
    return [];
  }
  return WorkflowEngine.getAuthorizedTransitions(currentState, user).filter((config) =>
    isNewsArticleTransitionAuthorized(currentState, config.toState, user)
  );
}

/**
 * Validates whether a transition configuration can be selected or executed from `currentState` by `user`.
 */
export function canSelectNewsTransition(
  currentState: WorkflowState | null | undefined,
  config: WorkflowTransitionConfig | null | undefined,
  user: AdminUser | null | undefined
): boolean {
  if (!currentState || !config || config.fromState !== currentState) {
    return false;
  }
  return isNewsArticleTransitionAuthorized(currentState, config.toState, user);
}

/**
 * Validates whether a pending comment-required transition can be confirmed from `currentState` by `user`.
 */
export function canConfirmNewsTransitionComment(
  currentState: WorkflowState | null | undefined,
  pendingTransition: WorkflowTransitionConfig | null | undefined,
  comment: string | null | undefined,
  user: AdminUser | null | undefined
): boolean {
  if (!canSelectNewsTransition(currentState, pendingTransition, user)) {
    return false;
  }
  if (pendingTransition?.requiresComment) {
    if (typeof comment !== 'string' || !comment.trim()) {
      return false;
    }
    if (
      comment.length > MAX_NEWS_TRANSITION_COMMENT_LENGTH ||
      comment.trim().length > MAX_NEWS_TRANSITION_COMMENT_LENGTH
    ) {
      return false;
    }
  }
  return true;
}

interface AdminNewsManagementProps {
  currentUser: AdminUser;
  initialActiveItem?: NewsItem | null;
  initialIsCreating?: boolean;
  initialActiveTab?: 'content' | 'workflow';
  initialPendingTransition?: WorkflowTransitionConfig | null;
  initialMediaVideos?: Video[];
}

const INITIAL_IMAGE_METADATA: NewsImageMetadataFormInput = {
  altAr: '',
  altEn: '',
  captionAr: '',
  captionEn: '',
  photographerCredit: '',
  licensingInfo: '',
};

export function AdminNewsManagement({
  currentUser,
  initialActiveItem = null,
  initialIsCreating = false,
  initialActiveTab = 'content',
  initialPendingTransition = null,
  initialMediaVideos = [],
}: AdminNewsManagementProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  // State
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('All');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // Media Library videos state for editorial video attachment (NEWS-VIDEO-01A)
  const [mediaVideos, setMediaVideos] = useState<Video[]>(initialMediaVideos);
  const [isLoadingMediaVideos, setIsLoadingMediaVideos] = useState(false);
  const [mediaVideosLoadError, setMediaVideosLoadError] = useState<string | null>(null);
  const [videoSearchQuery, setVideoSearchQuery] = useState('');
  const [videoAttachmentFeedback, setVideoAttachmentFeedback] = useState<string | null>(null);

  // Featured image session controller & UI state
  const imageSessionRef = useRef<NewsEditorImageSessionController>(
    new NewsEditorImageSessionController()
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedImageFile, setSelectedImageFile] = useState<NewsImageBinaryFileLike | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [imageMetadata, setImageMetadata] = useState<NewsImageMetadataFormInput>(INITIAL_IMAGE_METADATA);
  const [retainedUpload, setRetainedUpload] = useState<RetainedCompletedImageUpload | null>(null);
  const [haltedUpload, setHaltedUpload] = useState<HaltedAmbiguousImageUpload | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Active inline image insertion request & preparation modal state (IMG-F3-09/D2-D2B3A)
  const [activeInsertionRequest, setActiveInsertionRequest] = useState<{
    targetEditor: 'ar' | 'en';
    request: EditorialImageInsertionRequest;
  } | null>(null);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [inlinePreviewUrls, setInlinePreviewUrls] = useState<Readonly<Record<string, string>>>({});
  const persistedPreviewSessionRef = useRef<EditorialDraftPreviewSessionController>(
    createEditorialDraftPreviewSessionController()
  );
  const [persistedPreviewUrls, setPersistedPreviewUrls] = useState<Readonly<Record<string, string>>>({});

  const triggerPersistedPreviewsForArticle = (
    richBodyAr: unknown,
    richBodyEn: unknown
  ) => {
    void persistedPreviewSessionRef.current
      .loadPersistedPreviewsForDraft({
        richBodyAr,
        richBodyEn,
        getStagedSessionPreviewMap: () =>
          imageSessionRef.current.getInlinePreviewUrlMap(),
        onPreviewMapUpdated: (nextMap) => {
          setPersistedPreviewUrls(nextMap);
        },
      })
      .catch(() => {
        // Fail closed without unhandled promise rejection
      });
  };

  const resetImageEditorSession = () => {
    persistedPreviewSessionRef.current.resetAndRevokeAll();
    imageSessionRef.current.resetSession();
    setSelectedImageFile(null);
    setLocalPreviewUrl(null);
    setImageMetadata(INITIAL_IMAGE_METADATA);
    setRetainedUpload(null);
    setHaltedUpload(null);
    setInlinePreviewUrls({});
    setPersistedPreviewUrls({});
    setIsImageModalOpen(false);
    setActiveInsertionRequest(null);
    setIsSaving(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Ensure temporary object URLs and pending preview requests are always released on unmount
  useEffect(() => {
    const sessionController = imageSessionRef.current;
    const persistedPreviewController = persistedPreviewSessionRef.current;
    return () => {
      persistedPreviewController.resetAndRevokeAll();
      sessionController.resetSession();
    };
  }, []);

  // Load persisted image previews if opened directly with an initialActiveItem draft
  useEffect(() => {
    if (initialActiveItem && !initialIsCreating) {
      triggerPersistedPreviewsForArticle(
        initialActiveItem.richBodyAr,
        initialActiveItem.richBodyEn
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load articles from backend on mount
  useEffect(() => {
    let isMounted = true;
    async function loadStoredNews() {
      try {
        setErrorMessage(null);
        const stored = await NewsAdminClient.listAll();
        if (isMounted) setNewsList(stored || []);
      } catch (e: any) {
        console.error('Failed to load news from backend:', e);
        if (isMounted) {
          setErrorMessage(isAr ? 'فشل تحميل الأخبار من الخادم.' : 'Failed to load news from server.');
          setNewsList([]);
        }
      }
    }
    loadStoredNews();
    return () => { isMounted = false; };
  }, [isAr]);
  
  // Check user permission to create/edit before initializing create state
  const canCreate = AdminAccessService.hasPermission(currentUser, AdminPermission.Create);
  const canEdit = AdminAccessService.hasPermission(currentUser, AdminPermission.Edit) || canCreate;
  const effectiveInitialIsCreating = Boolean(initialIsCreating && canCreate);

  // Modal state
  const [activeItem, setActiveItem] = useState<NewsItem | null>(() => {
    if (initialActiveItem) return initialActiveItem;
    if (effectiveInitialIsCreating) {
      return {
        id: 'news-sudan-initial',
        titleAr: '',
        titleEn: '',
        summaryAr: '',
        summaryEn: '',
        bodyAr: '',
        bodyEn: '',
        richBodyAr: convertPlainTextToRichDocument('', 'rtl'),
        richBodyEn: convertPlainTextToRichDocument('', 'ltr'),
        author: currentUser.name,
        category: '',
        tags: [],
        sources: [],
        workflowState: WorkflowState.Draft,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        history: [],
        relatedVideoIds: [],
      };
    }
    return null;
  });
  const [isCreating, setIsCreating] = useState(effectiveInitialIsCreating);
  const [isSaveSuccess, setIsSaveSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<'content' | 'workflow'>(initialActiveTab);

  // Notification and error states
  const [successNotification, setSuccessNotification] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auto-dismiss and animate success notification after 3 seconds within the single modal container
  useEffect(() => {
    if (isSaveSuccess) {
      const animFrame = requestAnimationFrame(() => {
        
      });

      const dismissTimer = setTimeout(() => {
        
        const cleanupTimer = setTimeout(() => {
          persistedPreviewSessionRef.current.resetAndRevokeAll();
          imageSessionRef.current.resetSession();
          setSelectedImageFile(null);
          setLocalPreviewUrl(null);
          setImageMetadata(INITIAL_IMAGE_METADATA);
          setRetainedUpload(null);
          setHaltedUpload(null);
          setInlinePreviewUrls({});
          setPersistedPreviewUrls({});
          setIsImageModalOpen(false);
          setActiveInsertionRequest(null);
          setIsSaveSuccess(false);
          setActiveItem(null);
          setIsCreating(false);
          setSuccessNotification(null);
        }, 300);
        return () => clearTimeout(cleanupTimer);
      }, 3000);

      return () => {
        cancelAnimationFrame(animFrame);
        clearTimeout(dismissTimer);
      };
    } else {
      
    }
  }, [isSaveSuccess]);

  const handleCloseModal = () => {
    resetImageEditorSession();
    setTimeout(() => {
      setIsSaveSuccess(false);
      setActiveItem(null);
      setIsCreating(false);
      setSuccessNotification(null);
    }, 200);
  };

  // Comment prompt state for transitions requiring comments (e.g., Request Changes, Withdraw Publication)
  const [pendingTransition, setPendingTransition] = useState<WorkflowTransitionConfig | null>(() => {
    if (
      initialPendingTransition &&
      initialActiveItem &&
      canSelectNewsTransition(initialActiveItem.workflowState, initialPendingTransition, currentUser)
    ) {
      return initialPendingTransition;
    }
    return null;
  });
  const [transitionComment, setTransitionComment] = useState('');
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Form state for editor
  const [editForm, setEditForm] = useState<Partial<NewsItem> & { bodyArHasEdited?: boolean; bodyEnHasEdited?: boolean; richBodyAr?: any; richBodyEn?: any }>(() => {
    if (initialActiveItem) return { ...initialActiveItem };
    if (effectiveInitialIsCreating) {
      return {
        id: 'news-sudan-initial',
        titleAr: '',
        titleEn: '',
        summaryAr: '',
        summaryEn: '',
        bodyAr: '',
        bodyEn: '',
        richBodyAr: convertPlainTextToRichDocument('', 'rtl'),
        richBodyEn: convertPlainTextToRichDocument('', 'ltr'),
        author: currentUser.name,
        category: '',
        tags: [],
        sources: [],
        workflowState: WorkflowState.Draft,
        relatedVideoIds: [],
        bodyArHasEdited: true,
        bodyEnHasEdited: true,
      };
    }
    return {};
  });
  const [tagsInput, setTagsInput] = useState<string>('');
  const [sourcesInput, setSourcesInput] = useState<string>('');

  // Check user permission to save draft content
  const isDraft = isCreating || activeItem?.workflowState === WorkflowState.Draft;
  const canSaveContent = canEdit && isDraft;

  // Load canonical Media Library videos via MediaAdminClient.listAll() when editing a news article
  useEffect(() => {
    if (!activeItem) {
      return;
    }
    let isMounted = true;
    async function loadMediaLibraryVideos() {
      setIsLoadingMediaVideos(true);
      setMediaVideosLoadError(null);
      try {
        const videos = await MediaAdminClient.listAll();
        if (isMounted && Array.isArray(videos)) {
          setMediaVideos(videos);
        }
      } catch {
        if (isMounted) {
          setMediaVideosLoadError(
            isAr
              ? 'تعذر تحميل قائمة الفيديوهات من مكتبة الوسائط.'
              : 'Failed to load videos from the Media Library.'
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingMediaVideos(false);
        }
      }
    }
    void loadMediaLibraryVideos();
    return () => {
      isMounted = false;
    };
  }, [activeItem?.id, isAr]);

  // Filtered news items
  const filteredNews = newsList.filter(item => {
    const matchesSearch = 
      item.titleAr.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.titleEn.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.author.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.summaryAr.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.summaryEn.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = selectedStatus === 'All' || item.workflowState === selectedStatus;
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;

    return matchesSearch && matchesStatus && matchesCategory;
  });

  const effectiveEditorPreviewUrls = mergePersistedAndStagedPreviewUrlMaps(
    persistedPreviewUrls,
    inlinePreviewUrls
  );

  // Open item for editing/viewing
  const handleOpenItem = (item: NewsItem) => {
    resetImageEditorSession();
    setPendingTransition(null);
    setTransitionComment('');
    setVideoSearchQuery('');
    setVideoAttachmentFeedback(null);
    const nextRichBodyAr = item.richBodyAr
      ? JSON.parse(JSON.stringify(item.richBodyAr))
      : convertPlainTextToRichDocument(item.bodyAr || '', 'rtl');
    const nextRichBodyEn = item.richBodyEn
      ? JSON.parse(JSON.stringify(item.richBodyEn))
      : convertPlainTextToRichDocument(item.bodyEn || '', 'ltr');
    const normalizedRelatedVideoIds = Array.isArray(item.relatedVideoIds)
      ? [...item.relatedVideoIds]
      : [];
    setActiveItem({
      ...item,
      relatedVideoIds: normalizedRelatedVideoIds,
    });
    setEditForm({
      ...item,
      relatedVideoIds: normalizedRelatedVideoIds,
      richBodyAr: nextRichBodyAr,
      richBodyEn: nextRichBodyEn,
      bodyArHasEdited: false,
      bodyEnHasEdited: false,
    });
    setTagsInput(Array.isArray(item.tags) ? item.tags.join(', ') : '');
    setSourcesInput(Array.isArray(item.sources) ? item.sources.join(', ') : '');
    setIsCreating(false);
    setIsSaveSuccess(false);
    setSuccessNotification(null);
    setActiveTab('content');
    setErrorMessage(null);
    triggerPersistedPreviewsForArticle(nextRichBodyAr, nextRichBodyEn);
  };

  // Start creating new article
  const handleStartCreate = () => {
    if (!canCreate) {
      return;
    }
    resetImageEditorSession();
    setPendingTransition(null);
    setTransitionComment('');
    setVideoSearchQuery('');
    setVideoAttachmentFeedback(null);
    const newItem: NewsItem = {
      id: `news-sudan-${Date.now()}`,
      titleAr: '',
      titleEn: '',
      summaryAr: '',
      summaryEn: '',
      bodyAr: '',
      bodyEn: '',
      richBodyAr: convertPlainTextToRichDocument('', 'rtl'),
      richBodyEn: convertPlainTextToRichDocument('', 'ltr'),
      author: currentUser.name,
      category: '',
      tags: [],
      sources: [],
      workflowState: WorkflowState.Draft,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      history: [],
      relatedVideoIds: [],
    };
    setActiveItem(newItem);
    setEditForm({
      ...newItem,
      relatedVideoIds: [],
      bodyArHasEdited: true,
      bodyEnHasEdited: true,
    });
    setTagsInput('');
    setSourcesInput('');
    setIsCreating(true);
    setIsSaveSuccess(false);
    setSuccessNotification(null);
    setActiveTab('content');
    setErrorMessage(null);
  };

  const handleAttachRelatedVideo = (video: Video) => {
    if (!canSaveContent || imageSessionRef.current.isSaving() || isSaving) {
      return;
    }
    const attachResult = attachCanonicalVideoToDraftList(
      editForm.relatedVideoIds,
      video,
      mediaVideos,
      isAr
    );
    if (!attachResult.ok) {
      setVideoAttachmentFeedback(attachResult.errorMessage);
      return;
    }
    setVideoAttachmentFeedback(null);
    setErrorMessage(null);
    setEditForm((prev) => ({
      ...prev,
      relatedVideoIds: attachResult.relatedVideoIds,
    }));
  };

  const handleRemoveRelatedVideo = (videoId: string) => {
    if (!canSaveContent || imageSessionRef.current.isSaving() || isSaving) {
      return;
    }
    const nextIds = removeCanonicalVideoFromDraftList(
      editForm.relatedVideoIds,
      videoId
    );
    setVideoAttachmentFeedback(null);
    setErrorMessage(null);
    setEditForm((prev) => ({
      ...prev,
      relatedVideoIds: nextIds,
    }));
  };

  const handleSelectImageFile = (event: ChangeEvent<HTMLInputElement>) => {
    if (!canSaveContent || imageSessionRef.current.isSaving()) {
      return;
    }
    const file = event.target.files?.[0] ?? null;
    const { previewObjectUrl } = imageSessionRef.current.selectFile(file);
    setSelectedImageFile(file);
    setLocalPreviewUrl(previewObjectUrl);
    setRetainedUpload(null);
    setHaltedUpload(null);
    setErrorMessage(null);
  };

  const handleClearSelectedImageFile = () => {
    if (!canSaveContent || imageSessionRef.current.isSaving()) {
      return;
    }
    imageSessionRef.current.selectFile(null);
    setSelectedImageFile(null);
    setLocalPreviewUrl(null);
    setRetainedUpload(null);
    setHaltedUpload(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUpdateImageMetadata = (patch: Partial<NewsImageMetadataFormInput>) => {
    if (!canSaveContent || imageSessionRef.current.isSaving()) {
      return;
    }
    const updated = imageSessionRef.current.setImageMetadata(patch);
    setImageMetadata(updated);
  };

  // Image preparation modal handlers (IMG-F3-09/D2-D2B3A)
  const handleRequestInsertInlineImage = (
    targetEditor: 'ar' | 'en',
    request: EditorialImageInsertionRequest
  ) => {
    if (!canSaveContent || imageSessionRef.current.isSaving() || isSaving) {
      return;
    }
    setActiveInsertionRequest({ targetEditor, request });
    setIsImageModalOpen(true);
    setErrorMessage(null);
  };

  const handleOpenImageModalForCover = () => {
    if (!canSaveContent || imageSessionRef.current.isSaving() || isSaving) {
      return;
    }
    setActiveInsertionRequest(null);
    setIsImageModalOpen(true);
    setErrorMessage(null);
  };

  const handleCloseImageModal = () => {
    setIsImageModalOpen(false);
    setActiveInsertionRequest(null);
  };

  const handleConfirmImageModal = (prepared: PreparedEditorialImage): boolean => {
    // Guards: readOnly, active save, unavailable session
    if (!canSaveContent || imageSessionRef.current.isSaving() || isSaving) {
      setErrorMessage(
        isAr
          ? 'لا يمكن تعديل الصور أثناء حفظ التغييرات أو في وضع القراءة فقط.'
          : 'Cannot modify images while save is in flight or in read-only mode.'
      );
      return false;
    }

    // Both usage safety (Section 5)
    if (prepared.usage === 'both') {
      setErrorMessage(
        isAr
          ? 'خيار استخدام الصورة كغلاف وضمن النص معاً غير مفعل حالياً لمنع تكرار الرفع. يرجى اختيار "ضمن النص" أو "غلاف فقط".'
          : 'Using the image as both cover and inline is currently disabled to prevent duplicate uploads. Please select "Article Body" or "Cover Only".'
      );
      return false;
    }

    // Cover-only integration (Section 4)
    if (prepared.usage === 'cover') {
      const selectRes = imageSessionRef.current.selectFile(prepared.file);
      if (!selectRes || !selectRes.boundIds) {
        setErrorMessage(
          isAr
            ? 'فشلت جلسة محرر الصور في استيعاب صورة الغلاف المختارة.'
            : 'Editor session failed to accept selected cover image.'
        );
        return false;
      }
      setSelectedImageFile(prepared.file);
      setLocalPreviewUrl(selectRes.previewObjectUrl);
      const updatedMeta = imageSessionRef.current.setImageMetadata(prepared.metadata);
      setImageMetadata(updatedMeta);
      setRetainedUpload(null);
      setHaltedUpload(null);
      setErrorMessage(null);
      setIsImageModalOpen(false);
      setActiveInsertionRequest(null);
      return true;
    }

    // Inline integration (Section 3)
    if (prepared.usage === 'inline') {
      if (!activeInsertionRequest || activeInsertionRequest.request.isConsumed()) {
        setErrorMessage(
          isAr
            ? 'انتهت صلاحية طلب إدراج الصورة في المحرر. يرجى إعادة النقر على زر إدراج صورة داخل المحرر.'
            : 'Editor image insertion request is stale or expired. Please click the editor image button again.'
        );
        return false;
      }

      // 1. Call stageInlineImage(prepared.file, prepared.metadata)
      const stageResult = imageSessionRef.current.stageInlineImage(
        prepared.file,
        prepared.metadata
      );

      // 2. On staging failure, show the actual bilingual error and return false
      if (!stageResult.ok) {
        setErrorMessage(isAr ? stageResult.errorAr : stageResult.errorEn);
        return false;
      }

      // 3. On successful staging, insert a canonical V2 editorialImage using the one-shot insertion request
      const candidateAttrs: EditorialImageNodeAttrsV2 = {
        assetId: stageResult.assetId,
        altAr: prepared.metadata.altAr,
        width: prepared.inlineFormatting?.width ?? '50%',
        layout: prepared.inlineFormatting?.layout ?? 'float-start',
        ...(prepared.metadata.altEn ? { altEn: prepared.metadata.altEn } : {}),
        ...(prepared.metadata.captionAr ? { captionAr: prepared.metadata.captionAr } : {}),
        ...(prepared.metadata.captionEn ? { captionEn: prepared.metadata.captionEn } : {}),
      };

      const insertResult = activeInsertionRequest.request.insertCanonicalImage(candidateAttrs);

      // 4. If insertion fails, safely roll back the staged image using the existing verified removal API and return false
      if (!insertResult.ok) {
        imageSessionRef.current.removeInlineImage(stageResult.assetId);
        setInlinePreviewUrls(imageSessionRef.current.getInlinePreviewUrlMap());
        setErrorMessage(
          isAr
            ? `تعذر إدراج الصورة في المحرر (${insertResult.error}). تم التراجع عن تجهيز الصورة.`
            : `Failed to insert image into editor (${insertResult.error}). Staged image was rolled back.`
        );
        return false;
      }

      // 5. Refresh session-owned preview state
      setInlinePreviewUrls(imageSessionRef.current.getInlinePreviewUrlMap());

      // Update the originating editor's richBody in editForm
      if (activeInsertionRequest.targetEditor === 'ar') {
        setEditForm((prev) => ({
          ...prev,
          richBodyAr: insertResult.wrapper,
          bodyArHasEdited: true,
        }));
      } else {
        setEditForm((prev) => ({
          ...prev,
          richBodyEn: insertResult.wrapper,
          bodyEnHasEdited: true,
        }));
      }

      // 6. Close modal only after successful insertion
      setIsImageModalOpen(false);
      setActiveInsertionRequest(null);
      setErrorMessage(null);
      return true;
    }

    return false;
  };

  // Save article edits (including optional binary image intake before draft persistence)
  const handleSaveForm = async () => {
    if (!canSaveContent || imageSessionRef.current.isSaving()) {
      return;
    }

    setIsSaving(true);
    const outcome = await imageSessionRef.current.executeSaveWorkflow({
      isDraft,
      isCreating,
      activeItem,
      editForm,
      tagsInput,
      sourcesInput,
      currentUser,
      isAr,
    });
    setIsSaving(false);

    setRetainedUpload(imageSessionRef.current.getRetainedCompletedUpload());
    setHaltedUpload(imageSessionRef.current.getHaltedAmbiguousUpload());
    setInlinePreviewUrls(imageSessionRef.current.getInlinePreviewUrlMap());

    if (!outcome.ok) {
      if (outcome.reasonCode !== 'DUPLICATE_SUBMISSION_BLOCKED') {
        setErrorMessage(outcome.errorMessage);
      }
      return;
    }

    let savedItem = outcome.savedItem;
    try {
      const reloadedFromServer = await NewsAdminClient.getById(outcome.savedItem.id);
      if (reloadedFromServer) {
        savedItem = reloadedFromServer;
      }
    } catch {
      // Fall back to server saveDraft response if getById is unavailable in partial test transports
    }

    const persistedRelatedVideoIds = Array.isArray(savedItem.relatedVideoIds)
      ? [...savedItem.relatedVideoIds]
      : Array.isArray(editForm.relatedVideoIds)
        ? [...editForm.relatedVideoIds]
        : [];
    const normalizedSavedItem: NewsItem = {
      ...savedItem,
      relatedVideoIds: persistedRelatedVideoIds,
    };

    setSelectedImageFile(null);
    setLocalPreviewUrl(null);
    setImageMetadata(INITIAL_IMAGE_METADATA);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    if (isCreating) {
      setNewsList([normalizedSavedItem, ...newsList]);
      setActiveItem(normalizedSavedItem);
      setEditForm((prev) => ({
        ...prev,
        id: normalizedSavedItem.id,
        featuredImage: normalizedSavedItem.featuredImage,
        relatedVideoIds: persistedRelatedVideoIds,
      }));
      setIsCreating(false);
    } else {
      setNewsList(newsList.map(item => item.id === normalizedSavedItem.id ? normalizedSavedItem : item));
      setActiveItem(normalizedSavedItem);
      setEditForm((prev) => ({
        ...prev,
        featuredImage: normalizedSavedItem.featuredImage,
        relatedVideoIds: persistedRelatedVideoIds,
      }));
    }

    setErrorMessage(null);
    setSuccessNotification(
      isAr ? 'تم حفظ التعديلات بنجاح' : 'Article changes saved successfully'
    );
    setIsSaveSuccess(true);
  };

  // Execute workflow transition on activeItem
  const handleExecuteTransition = async (config: WorkflowTransitionConfig, comment?: string) => {
    if (!activeItem || isTransitioning) return;

    if (!canSelectNewsTransition(activeItem.workflowState, config, currentUser)) {
      setPendingTransition(null);
      setTransitionComment('');
      return;
    }

    if (config.requiresComment) {
      if (typeof comment !== 'string' || !comment.trim()) {
        return;
      }
      if (
        comment.length > MAX_NEWS_TRANSITION_COMMENT_LENGTH ||
        comment.trim().length > MAX_NEWS_TRANSITION_COMMENT_LENGTH
      ) {
        setErrorMessage(
          isAr
            ? `يتجاوز السبب المكتوب الحد الأقصى المسموح به (${MAX_NEWS_TRANSITION_COMMENT_LENGTH} حرف).`
            : `Written reason exceeds the maximum length of ${MAX_NEWS_TRANSITION_COMMENT_LENGTH} characters.`
        );
        return;
      }
    }

    setIsTransitioning(true);
    setErrorMessage(null);
    try {
      const updatedNewsItem = await NewsAdminClient.executeTransition(
        activeItem.id,
        config.toState,
        currentUser,
        comment?.trim()
      );

      setActiveItem(updatedNewsItem);
      setEditForm((prev) => ({
        ...prev,
        ...updatedNewsItem,
      }));
      setNewsList(newsList.map(n => n.id === updatedNewsItem.id ? updatedNewsItem : n));
      setPendingTransition(null);
      setTransitionComment('');
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage(err.message || (isAr ? 'فشل تنفيذ عملية الانتقال' : 'Transition failed'));
    } finally {
      setIsTransitioning(false);
    }
  };

  // Status Badge Helper
  const renderStatusBadge = (state: WorkflowState) => {
    switch (state) {
      case WorkflowState.Draft:
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 inline-flex items-center gap-1">
            <FileEdit className="w-3 h-3 text-gray-500" />
            <span>{isAr ? 'مسودة' : 'Draft'}</span>
          </span>
        );
      case WorkflowState.InReview:
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/50 inline-flex items-center gap-1">
            <FileSearch className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            <span>{isAr ? 'قيد المراجعة' : 'In Review'}</span>
          </span>
        );
      case WorkflowState.ChangesRequested:
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/50 inline-flex items-center gap-1">
            <RotateCcw className="w-3 h-3 text-rose-600 dark:text-rose-400" />
            <span>{isAr ? 'تعديلات مطلوبة' : 'Changes Requested'}</span>
          </span>
        );
      case WorkflowState.Approved:
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400 border border-sky-200/60 dark:border-sky-800/50 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-sky-600 dark:text-sky-400" />
            <span>{isAr ? 'معتمد' : 'Approved'}</span>
          </span>
        );
      case WorkflowState.Published:
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/50 inline-flex items-center gap-1">
            <Globe className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            <span>{isAr ? 'منشور' : 'Published'}</span>
          </span>
        );
      default:
        return null;
    }
  };

  // All 5 states for the visual stepper
  const lifecycleStates: { key: WorkflowState; labelAr: string; labelEn: string; icon: any }[] = [
    { key: WorkflowState.Draft, labelAr: 'مسودة', labelEn: 'Draft', icon: FileEdit },
    { key: WorkflowState.InReview, labelAr: 'قيد المراجعة', labelEn: 'In Review', icon: FileSearch },
    { key: WorkflowState.ChangesRequested, labelAr: 'تعديلات مطلوبة', labelEn: 'Changes Requested', icon: RotateCcw },
    { key: WorkflowState.Approved, labelAr: 'معتمد', labelEn: 'Approved', icon: CheckCircle2 },
    { key: WorkflowState.Published, labelAr: 'منشور للجمهور', labelEn: 'Published', icon: Globe },
  ];

  return (
    <div className="space-y-6" id="admin-news-management-view">
      {!activeItem ? (
        <>
          {/* Top Header Banner */}
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400 shrink-0">
                <Newspaper className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
                  <span>{isAr ? 'إدارة الأخبار والتغطيات البيئية' : 'Environmental Newsroom Management'}</span>
                  <span className="px-2 py-0.5 text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 rounded-md">
                    {isAr ? 'نواة الأخبار' : 'Newsroom Core'}
                  </span>
                </h1>
                <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
                  {isAr 
                    ? 'إدارة وتقييم المقالات الإخبارية، والتقارير الميدانية من الولايات، وتوجيهها خلال دورة الاعتماد والنشر.'
                    : 'Manage news articles, regional environmental bulletins, and guide stories through the editorial workflow.'}
                </p>
              </div>
            </div>
            {canCreate && (
              <button
                onClick={handleStartCreate}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm shadow-sm inline-flex items-center justify-center gap-2 transition-all shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{isAr ? 'إضافة خبر بيئي جديد' : 'New News Article'}</span>
              </button>
            )}
          </div>

          {/* Filter and Search Toolbar */}
          <div data-responsive-guard className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl p-4 shadow-xs space-y-3 sm:space-y-0 sm:flex sm:items-center justify-between gap-3 w-full max-w-full min-w-0">
            {/* Search Input */}
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 text-gray-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isAr ? 'البحث بالعنوان، الكاتب، أو المضمون...' : 'Search by title, author, or content...'}
                className="w-full ps-9 pe-4 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg text-xs sm:text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            {/* Filters Group */}
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              {/* Status Filter */}
              <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 min-w-0">
                <Filter className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-gray-700 dark:text-gray-300 focus:outline-none cursor-pointer truncate max-w-[140px]"
                >
                  <option value="All">{isAr ? 'كافة الحالات' : 'All States'}</option>
                  <option value={WorkflowState.Draft}>{isAr ? 'مسودة' : 'Draft'}</option>
                  <option value={WorkflowState.InReview}>{isAr ? 'قيد المراجعة' : 'In Review'}</option>
                  <option value={WorkflowState.ChangesRequested}>{isAr ? 'تعديلات مطلوبة' : 'Changes Requested'}</option>
                  <option value={WorkflowState.Approved}>{isAr ? 'معتمد' : 'Approved'}</option>
                  <option value={WorkflowState.Published}>{isAr ? 'منشور' : 'Published'}</option>
                </select>
              </div>
              {/* Category Filter */}
              <div className="flex items-center gap-1.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1.5 min-w-0">
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-gray-700 dark:text-gray-300 focus:outline-none cursor-pointer truncate max-w-[140px]"
                >
                  <option value="All">{isAr ? 'كافة التصنيفات' : 'All Categories'}</option>
                  {CANONICAL_CATEGORY_DEFINITIONS.map(cat => (
                    <option key={cat.value} value={cat.value}>
                      {isAr ? cat.labelAr : cat.labelEn}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* News Management View (< 1280px Compact Cards, >= 1280px Dense Table) */}
          <div data-responsive-guard className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-xs w-full max-w-full min-w-0">
            {filteredNews.length === 0 ? (
              <div className="p-12 text-center text-gray-500 dark:text-gray-400 space-y-2">
                <Newspaper className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto" />
                <p className="font-semibold text-sm">{isAr ? 'لا توجد أخبار تنطبق على محددات البحث' : 'No news articles match the selected filters'}</p>
              </div>
            ) : (
              <>
                {/* Compact Cards List (< 1280px) */}
                <div className="block xl:hidden divide-y divide-gray-100 dark:divide-gray-800 w-full max-w-full min-w-0">
                  {filteredNews.map(item => (
                    <div key={item.id} className="p-4 sm:p-5 space-y-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors w-full max-w-full min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium text-xs">
                          {getCategoryDisplayLabel(item.category, isAr)}
                        </span>
                        {renderStatusBadge(item.workflowState)}
                      </div>
                      <div className="space-y-1">
                        <h3 className="font-bold text-gray-900 dark:text-white text-sm sm:text-base leading-snug">
                          {isAr ? item.titleAr : (item.titleEn || item.titleAr)}
                        </h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                          {isAr ? (item.titleEn || item.summaryAr) : item.summaryEn}
                        </p>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400">
                        <div>
                          <span className="font-semibold text-gray-700 dark:text-gray-300">{item.author}</span>
                          <span className="mx-2">•</span>
                          <span>{new Date(item.updatedAt).toLocaleDateString(isAr ? 'ar-SD' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                        </div>
                        <button
                          onClick={() => handleOpenItem(item)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 dark:text-emerald-400 font-bold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>{isAr ? 'العرض والتحرير' : 'View & Edit'}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Dense Desktop Table View (>= 1280px) */}
                <div className="hidden xl:block overflow-x-auto w-full max-w-full min-w-0">
                  <table className="w-full text-start text-xs sm:text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">
                      <tr>
                        <th className="p-3.5 text-start">{isAr ? 'عنوان الخبر البيئي' : 'News Article Title'}</th>
                        <th className="p-3.5 text-start">{isAr ? 'التصنيف' : 'Category'}</th>
                        <th className="p-3.5 text-start">{isAr ? 'الكاتب' : 'Author'}</th>
                        <th className="p-3.5 text-start">{isAr ? 'حالة الاعتماد' : 'Workflow Status'}</th>
                        <th className="p-3.5 text-start">{isAr ? 'آخر تحديث' : 'Last Updated'}</th>
                        <th className="p-3.5 text-end">{isAr ? 'الإجراءات' : 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {filteredNews.map(item => (
                        <tr key={item.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/30 transition-colors">
                          <td className="p-3.5 max-w-xs sm:max-w-md">
                            <p className="font-bold text-gray-900 dark:text-white line-clamp-1">
                              {isAr ? item.titleAr : (item.titleEn || item.titleAr)}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">
                              {isAr ? (item.titleEn || item.summaryAr) : item.summaryEn}
                            </p>
                          </td>
                          <td className="p-3.5 whitespace-nowrap">
                            <span className="px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium text-xs">
                              {getCategoryDisplayLabel(item.category, isAr)}
                            </span>
                          </td>
                          <td className="p-3.5 whitespace-nowrap font-medium text-gray-700 dark:text-gray-300">
                            {item.author}
                          </td>
                          <td className="p-3.5 whitespace-nowrap">
                            {renderStatusBadge(item.workflowState)}
                          </td>
                          <td className="p-3.5 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                            {new Date(item.updatedAt).toLocaleDateString(isAr ? 'ar-SD' : 'en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric'
                            })}
                          </td>
                          <td className="p-3.5 whitespace-nowrap text-end">
                            <button
                              onClick={() => handleOpenItem(item)}
                              className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 dark:text-emerald-400 font-bold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>{isAr ? 'العرض والتحرير' : 'View & Edit'}</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      ) : isSaveSuccess ? (
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl max-w-md w-full mx-auto p-6 sm:p-8 flex flex-col items-center text-center shadow-xl my-12">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-100 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4 shadow-inner">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
            {isAr ? 'تم الحفظ بنجاح' : 'Successfully Saved'}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-300 font-medium mb-6">
            {successNotification}
          </p>
          <button
            onClick={handleCloseModal}
            className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs pop-motion-micro pop-hover-lift cursor-pointer flex items-center justify-center gap-2"
          >
            <span>{isAr ? 'موافق' : 'OK'}</span>
          </button>
        </div>
      ) : (
        <section
          aria-label={isAr ? 'مساحة تحرير الخبر' : 'News editorial workspace'}
          className="w-full min-w-0 flex flex-col bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl shadow-sm overflow-hidden"
          style={{ height: 'calc(100vh - 7rem)', minHeight: '650px' }}
        >
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3 bg-gray-50/50 dark:bg-gray-800/40 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 shrink-0">
                  <Newspaper className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">
                      {isCreating 
                        ? (isAr ? 'إنشاء مقال خبري جديد' : 'Create New News Article')
                        : (isAr ? activeItem.titleAr : (activeItem.titleEn || activeItem.titleAr))}
                    </h2>
                    {renderStatusBadge(activeItem.workflowState)}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                    {isAr ? `الكاتب: ${activeItem.author}` : `Author: ${activeItem.author}`}
                  </p>
                </div>
              </div>

              <button
                onClick={handleCloseModal}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error banner if present */}
            {errorMessage && (
              <div className="bg-rose-50 dark:bg-rose-950/50 border-b border-rose-200 dark:border-rose-900 px-5 py-3 flex items-center gap-2 text-rose-700 dark:text-rose-300 text-xs font-semibold shrink-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Tab Controls */}
            <div className="border-b border-gray-100 dark:border-gray-800 px-5 flex items-center gap-6 bg-white dark:bg-gray-900 shrink-0">
              <button
                onClick={() => setActiveTab('content')}
                className={`py-3 text-xs sm:text-sm font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
                  activeTab === 'content'
                    ? 'border-emerald-600 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <Edit3 className="w-4 h-4" />
                <span>{isAr ? 'بيانات ومضمون الخبر' : 'Article Content & Fields'}</span>
              </button>

              <button
                onClick={() => setActiveTab('workflow')}
                className={`py-3 text-xs sm:text-sm font-bold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
                  activeTab === 'workflow'
                    ? 'border-emerald-600 text-emerald-600 dark:border-emerald-400 dark:text-emerald-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                <History className="w-4 h-4" />
                <span>{isAr ? 'دورة الاعتماد وسجل التغييرات' : 'Workflow & Audit History'}</span>
                {activeItem.history.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] font-extrabold">
                    {activeItem.history.length}
                  </span>
                )}
              </button>
            </div>

            {/* Scrollable Workspace Body */}
            <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overscroll-contain">
              <div className="w-full max-w-5xl mx-auto p-4 sm:p-8 space-y-6">
                {activeTab === 'content' ? (
                <div className="space-y-4">
                  {!isDraft && activeItem && (
                    <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-800/50 flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-300 font-medium">
                      <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span>
                        {isAr
                          ? 'محتوى المقال مقفل لكونه خارج مرحلة المسودة. لتعديل المحتوى، يجب إعادة المقال إلى مرحلة المسودة عبر دورة الاعتماد.'
                          : 'Article content is locked because it is not in Draft state. To modify content, transition the article back to Draft via workflow.'}
                      </span>
                    </div>
                  )}

                  {/* Arabic Introductory Headline (Kicker) */}
                  <div className="space-y-1.5">
                    <label htmlFor="news-kicker-ar" className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                      <span>{isAr ? 'العنوان التمهيدي (بالعربية)' : 'Arabic Introductory Headline'}</span>
                    </label>
                    <input
                      id="news-kicker-ar"
                      type="text"
                      dir="rtl"
                      value={editForm.kickerAr ?? ''}
                      onChange={(e) => setEditForm({ ...editForm, kickerAr: e.target.value })}
                      placeholder="عنوان تمهيدي قصير يظهر فوق العنوان الرئيسي..."
                      disabled={!canSaveContent}
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                    />
                  </div>

                  {/* Arabic Title */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                      <span>{isAr ? 'عنوان الخبر البيئي (بالعربية) *' : 'Arabic Article Title *'}</span>
                    </label>
                    <input
                      type="text"
                      dir="rtl"
                      value={editForm.titleAr || ''}
                      onChange={(e) => setEditForm({ ...editForm, titleAr: e.target.value })}
                      placeholder="عنوان المقال الخبري بالعربية..."
                      disabled={!canSaveContent}
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                    />
                  </div>

                  {/* English Introductory Headline (Kicker) */}
                  <div className="space-y-1.5">
                    <label htmlFor="news-kicker-en" className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                      <span>{isAr ? 'العنوان التمهيدي (بالإنجليزية)' : 'English Introductory Headline'}</span>
                    </label>
                    <input
                      id="news-kicker-en"
                      type="text"
                      dir="ltr"
                      value={editForm.kickerEn ?? ''}
                      onChange={(e) => setEditForm({ ...editForm, kickerEn: e.target.value })}
                      placeholder="Short introductory kicker above primary title..."
                      disabled={!canSaveContent}
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                    />
                  </div>

                  {/* English Title */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                      <span>{isAr ? 'عنوان الخبر (بالإنجليزية)' : 'English Article Title'}</span>
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={editForm.titleEn || ''}
                      onChange={(e) => setEditForm({ ...editForm, titleEn: e.target.value })}
                      placeholder="Article title in English..."
                      disabled={!canSaveContent}
                      className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                    />
                  </div>

                  {/* Category, Journalistic Type & Author Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="space-y-1.5">
                      <label htmlFor="news-category" className="text-xs font-bold text-gray-700 dark:text-gray-300">
                        {isAr ? 'التصنيف البيئي' : 'Category'}
                      </label>
                      <select
                        id="news-category"
                        value={editForm.category || ''}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                        disabled={!canSaveContent}
                        className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 cursor-pointer"
                      >
                        <option value="" disabled>
                          {isAr ? 'اختر التصنيف البيئي...' : 'Select environmental category...'}
                        </option>
                        {Boolean(editForm.category && !isCanonicalCategory(editForm.category)) && (
                          <option value={editForm.category} disabled>
                            {isAr ? `تصنيف قديم (غير قياسي): ${editForm.category}` : `Legacy Category (Non-canonical): ${editForm.category}`}
                          </option>
                        )}
                        {CANONICAL_CATEGORY_DEFINITIONS.map(cat => (
                          <option key={cat.value} value={cat.value}>
                            {isAr ? cat.labelAr : cat.labelEn}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="news-journalistic-type" className="text-xs font-bold text-gray-700 dark:text-gray-300">
                        {isAr ? 'النوع الصحفي' : 'Journalistic Type'}
                      </label>
                      <select
                        id="news-journalistic-type"
                        value={editForm.journalisticType ?? ''}
                        onChange={(e) => {
                          const nextVal = e.target.value;
                          const hasPersistedType = Boolean(!isCreating && activeItem?.journalisticType);
                          if (!nextVal) {
                            if (!hasPersistedType) {
                              setEditForm({ ...editForm, journalisticType: undefined });
                            }
                            return;
                          }
                          setEditForm({ ...editForm, journalisticType: nextVal as JournalisticType });
                        }}
                        disabled={!canSaveContent}
                        className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60 cursor-pointer"
                      >
                        <option value="" disabled={Boolean(!isCreating && activeItem?.journalisticType)}>
                          {isAr ? 'غير محدد' : 'Not specified'}
                        </option>
                        {JOURNALISTIC_TYPE_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>
                            {isAr ? opt.labelAr : opt.labelEn}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                        {isAr ? 'اسم الكاتب / المحرر' : 'Author Name'}
                      </label>
                      <input
                        type="text"
                        value={editForm.author || ''}
                        onChange={(e) => setEditForm({ ...editForm, author: e.target.value })}
                        disabled={!canSaveContent}
                        className="w-full px-3.5 py-2.5 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                      />
                    </div>
                  </div>

                  {/* Arabic Summary */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                      {isAr ? 'الموجز الخبري (بالعربية)' : 'Arabic Summary'}
                    </label>
                    <textarea
                      dir="rtl"
                      rows={2}
                      value={editForm.summaryAr || ''}
                      onChange={(e) => setEditForm({ ...editForm, summaryAr: e.target.value })}
                      placeholder="ملخص موجز لأبرز نقاط الخبر..."
                      disabled={!canSaveContent}
                      className="w-full px-3.5 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                    />
                  </div>

                  {/* English Summary */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                      {isAr ? 'الموجز الخبري (بالإنجليزية)' : 'English Summary'}
                    </label>
                    <textarea
                      dir="ltr"
                      rows={2}
                      value={editForm.summaryEn || ''}
                      onChange={(e) => setEditForm({ ...editForm, summaryEn: e.target.value })}
                      placeholder="Brief article summary in English..."
                      disabled={!canSaveContent}
                      className="w-full px-3.5 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                    />
                  </div>

                  {/* Mobile responsive rule: on narrow viewports (<= 640px), inline images expand to full content width while preserving canonical attributes */}
                  <style>{`
                    @media (max-width: 640px) {
                      .pop-editorial-figure {
                        width: 100% !important;
                        max-width: 100% !important;
                      }
                    }
                  `}</style>

                  {/* Arabic Body */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                      {isAr ? 'نص الخبر الكامل (بالعربية)' : 'Arabic Article Body'}
                    </label>
                    <RichTextEditor
                      value={editForm.richBodyAr || convertPlainTextToRichDocument('', 'rtl')}
                      onChange={(val) => setEditForm(prev => ({ ...prev, richBodyAr: val, bodyArHasEdited: true }))}
                      readOnly={!canSaveContent}
                      lang="ar"
                      dir="rtl"
                      previewUrlsByAssetId={effectiveEditorPreviewUrls}
                      onRequestInsertInlineImage={(req) => handleRequestInsertInlineImage('ar', req)}
                    />
                  </div>

                  {/* English Body */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-700 dark:text-gray-300">
                      {isAr ? 'نص الخبر الكامل (بالإنجليزية)' : 'English Article Body'}
                    </label>
                    <RichTextEditor
                      value={editForm.richBodyEn || convertPlainTextToRichDocument('', 'ltr')}
                      onChange={(val) => setEditForm(prev => ({ ...prev, richBodyEn: val, bodyEnHasEdited: true }))}
                      readOnly={!canSaveContent}
                      lang="en"
                      dir="ltr"
                      previewUrlsByAssetId={effectiveEditorPreviewUrls}
                      onRequestInsertInlineImage={(req) => handleRequestInsertInlineImage('en', req)}
                    />
                  </div>

                  {/* Tags and Sources Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    {/* Tags */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                        <Tag className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{isAr ? 'الوسوم (مفصولة بفاصلة)' : 'Tags (comma separated)'}</span>
                      </label>
                      <input
                        type="text"
                        value={tagsInput}
                        onChange={(e) => setTagsInput(e.target.value)}
                        placeholder="النيل, طوارئ, زراعة"
                        disabled={!canSaveContent}
                        className="w-full px-3.5 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                      />
                    </div>

                    {/* Sources */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
                        <LinkIcon className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{isAr ? 'المصادر والجهات الرسمية' : 'Sources & References'}</span>
                      </label>
                      <input
                        type="text"
                        value={sourcesInput}
                        onChange={(e) => setSourcesInput(e.target.value)}
                        placeholder="وزارة الري, معهد علوم البحار"
                        disabled={!canSaveContent}
                        className="w-full px-3.5 py-2 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                      />
                    </div>
                  </div>

                  {/* Featured Editorial Image Intake & Metadata Section (IMG-F3-09/C) */}
                  <div
                    data-testid="news-featured-image-section"
                    className="bg-gray-50/70 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/80 rounded-2xl p-4 sm:p-5 space-y-4 mt-2"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-gray-200/70 dark:border-gray-700/70 pb-3">
                      <div className="flex items-center gap-2">
                        <ImageIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <h3 className="text-xs sm:text-sm font-extrabold text-gray-900 dark:text-white">
                          {isAr ? 'الصورة البارزة للخبر (استيعاب ثنائي آمن)' : 'Featured News Image (Secure Binary Intake)'}
                        </h3>
                      </div>
                      <span className="text-[11px] font-mono tabular-nums text-gray-500 dark:text-gray-400">
                        {isAr
                          ? 'PNG / JPEG / WebP • الحد الأقصى 15,000,000 بايت'
                          : 'PNG / JPEG / WebP • Max 15,000,000 bytes'}
                      </span>
                    </div>

                    {/* Upload Endpoint Availability Warning */}
                    {!NewsAdminClient.isImageUploadAvailable() && (
                      <div
                        data-testid="news-image-endpoint-unconfigured"
                        className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2"
                      >
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                          {isAr
                            ? 'رفع الصور غير متاح حالياً لعدم توفر رابط خدمة الرفع الآمنة (VITE_EDITORIAL_NEWS_IMAGE_UPLOAD_URL). يمكنك حفظ المسودة النصية بدون رفع صورة جديدة.'
                            : 'Image upload is currently unavailable because the verified upload endpoint URL (VITE_EDITORIAL_NEWS_IMAGE_UPLOAD_URL) is not configured. You may still save draft text changes without uploading a new image.'}
                        </span>
                      </div>
                    )}

                    {/* Existing Persisted Asset Reference Placeholder (when reopening draft with featuredImage and no new local file selected) */}
                    {!selectedImageFile && editForm.featuredImage && (
                      <div
                        data-testid="news-existing-asset-placeholder"
                        className="p-3.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-xs font-bold text-gray-800 dark:text-gray-200">
                            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                            <span>
                              {isAr
                                ? 'معرف الأصل الصوري المرتبط بالمسودة:'
                                : 'Linked Editorial Image Asset ID:'}
                            </span>
                            <code
                              dir="ltr"
                              data-testid="news-existing-asset-id"
                              className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono tabular-nums text-[11px] text-emerald-700 dark:text-emerald-300"
                            >
                              {editForm.featuredImage}
                            </code>
                          </div>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            {isAr
                              ? 'معاينة المتصفح من التخزين الخاص غير مفعلة في هذه المرحلة؛ يظل اعتماد حقوق النشر والتسليم العام منفصلين.'
                              : 'Private storage browser preview is not enabled in this unit; rights approval and public delivery remain governed separately.'}
                          </p>
                        </div>
                        {activeItem && !isCreating && (
                          <button
                            type="button"
                            data-testid="news-open-image-rights-panel-btn"
                            onClick={() => setActiveTab('workflow')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 transition-colors shrink-0"
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                            <span>
                              {isAr
                                ? 'مراجعة حقوق الصور في سير العمل'
                                : 'Review Image Rights in Workflow'}
                            </span>
                          </button>
                        )}
                      </div>
                    )}

                    {/* Retained Completed Upload Banner (when binary upload succeeded earlier in session, awaiting draft save retry) */}
                    {retainedUpload && (
                      <div
                        data-testid="news-retained-completed-upload"
                        className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 text-xs space-y-1"
                      >
                        <div className="font-bold flex items-center gap-1.5">
                          <Check className="w-4 h-4 shrink-0" />
                          <span>
                            {isAr
                              ? 'تم استيعاب الصورة بنجاح في هذه الجلسة — جاهزة للربط عند حفظ المسودة دون إعادة الرفع:'
                              : 'Image binary intake completed in this session — ready to link on Save Changes without re-upload:'}
                          </span>
                        </div>
                        <div dir="ltr" className="font-mono tabular-nums text-[11px] opacity-90">
                          assetId: {retainedUpload.assetId} | intakeId: {retainedUpload.intakeId}
                        </div>
                      </div>
                    )}

                    {/* Halted Ambiguous / Non-Completed Outcome Banner */}
                    {haltedUpload && (
                      <div
                        data-testid="news-halted-ambiguous-upload"
                        className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-300 text-xs space-y-1"
                      >
                        <div className="font-bold flex items-center gap-1.5">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>
                            {isAr
                              ? `توقف الربط التلقائي للصورة (الحالة: ${haltedUpload.status}) لمنع تكرار الرفع بمعرفات جديدة.`
                              : `Automatic image re-upload is halted (status: ${haltedUpload.status}) to prevent duplicate intake identities.`}
                          </span>
                        </div>
                        <div dir="ltr" className="font-mono tabular-nums text-[11px] opacity-90">
                          assetId: {haltedUpload.assetId} | intakeId: {haltedUpload.intakeId}
                        </div>
                      </div>
                    )}

                    {/* File Picker & Temporary Local Preview */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                      <div className="md:col-span-5 space-y-2.5">
                        <label
                          htmlFor="news-featured-image-file-input"
                          className="text-xs font-bold text-gray-700 dark:text-gray-300 block"
                        >
                          {isAr ? 'اختيار ملف الصورة (PNG / JPEG / WebP)' : 'Select Image File (PNG / JPEG / WebP)'}
                        </label>

                        <div className="flex flex-wrap items-center gap-2">
                          {/* Single Primary Cover-Image Preparation Action */}
                          <button
                            type="button"
                            data-testid="news-prepare-featured-image-btn"
                            disabled={!canSaveContent || isSaving}
                            onClick={handleOpenImageModalForCover}
                            className={`px-3.5 py-2 rounded-xl border border-emerald-600 bg-emerald-600 hover:bg-emerald-700 text-xs font-bold text-white inline-flex items-center gap-1.5 transition-colors shadow-sm ${
                              !canSaveContent || isSaving
                                ? 'opacity-60 cursor-not-allowed'
                                : 'cursor-pointer'
                            }`}
                          >
                            <Crop className="w-3.5 h-3.5 text-white" />
                            <span>{isAr ? 'إعداد وقص صورة الخبر...' : 'Prepare & Crop Cover Image...'}</span>
                          </button>

                          {/* Accessible Fallback Input (visually hidden, maintains DOM id and accessibility for test automation and screen readers) */}
                          <input
                            ref={fileInputRef}
                            id="news-featured-image-file-input"
                            data-testid="news-featured-image-file-input"
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            aria-label={isAr ? 'اختيار ملف صورة الغلاف' : 'Cover image file input'}
                            disabled={!canSaveContent || isSaving}
                            onChange={(e) => {
                              handleSelectImageFile(e);
                              e.target.value = '';
                            }}
                            className="sr-only"
                          />

                          {selectedImageFile && (
                            <button
                              type="button"
                              data-testid="news-clear-selected-image-btn"
                              disabled={!canSaveContent || isSaving}
                              onClick={handleClearSelectedImageFile}
                              className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-xs font-bold text-gray-600 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>{isAr ? 'إزالة الملف المختار' : 'Clear Selection'}</span>
                            </button>
                          )}
                        </div>

                        {selectedImageFile && (
                          <div
                            data-testid="news-selected-file-summary"
                            className="text-[11px] font-mono tabular-nums text-gray-600 dark:text-gray-400 space-y-0.5 bg-white dark:bg-gray-900 p-2.5 rounded-xl border border-gray-200/80 dark:border-gray-700/80"
                          >
                            <div className="truncate font-semibold text-gray-800 dark:text-gray-200">
                              {selectedImageFile.name}
                            </div>
                            <div>
                              {selectedImageFile.type || 'unknown'} • {selectedImageFile.size.toLocaleString('en-US')} bytes
                            </div>
                          </div>
                        )}

                        {/* Temporary Local Preview */}
                        {localPreviewUrl && selectedImageFile && (
                          <div
                            data-testid="news-temporary-local-preview"
                            className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 space-y-1.5"
                          >
                            <div className="flex items-center justify-between text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-1 rounded-lg">
                              <span>
                                {isAr
                                  ? 'معاينة محلية مؤقتة فقط (لا تُحفظ كرابط عام)'
                                  : 'Temporary Local Preview Only (Not a public URL)'}
                              </span>
                            </div>
                            <img
                              src={localPreviewUrl}
                              alt={imageMetadata.altAr || selectedImageFile.name}
                              className="w-full max-h-40 object-contain rounded-lg bg-gray-100 dark:bg-gray-800"
                            />
                          </div>
                        )}
                      </div>

                      {/* Metadata Fields for Editorial Image Upload */}
                      <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Required Arabic Alt Text */}
                        <div className="sm:col-span-2 space-y-1">
                          <label
                            htmlFor="news-image-alt-ar"
                            className="text-xs font-bold text-gray-700 dark:text-gray-300 block"
                          >
                            {isAr
                              ? 'النص البديل للصورة بالعربية (إلزامي لرفع الصورة) *'
                              : 'Arabic Alt Text (Required for Image Upload) *'}
                          </label>
                          <input
                            id="news-image-alt-ar"
                            data-testid="news-image-alt-ar"
                            type="text"
                            dir="rtl"
                            value={imageMetadata.altAr}
                            onChange={(e) => handleUpdateImageMetadata({ altAr: e.target.value })}
                            placeholder="وصف دقيق لمحتوى الصورة بالعربية لأغراض الوصول..."
                            disabled={!canSaveContent || isSaving}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                          />
                        </div>

                        {/* Optional English Alt Text */}
                        <div className="space-y-1">
                          <label
                            htmlFor="news-image-alt-en"
                            className="text-xs font-bold text-gray-700 dark:text-gray-300 block"
                          >
                            {isAr ? 'النص البديل بالإنجليزية (اختياري)' : 'English Alt Text (Optional)'}
                          </label>
                          <input
                            id="news-image-alt-en"
                            data-testid="news-image-alt-en"
                            type="text"
                            dir="ltr"
                            value={imageMetadata.altEn || ''}
                            onChange={(e) => handleUpdateImageMetadata({ altEn: e.target.value })}
                            placeholder="Descriptive alt text in English..."
                            disabled={!canSaveContent || isSaving}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                          />
                        </div>

                        {/* Optional Photographer / Source Credit */}
                        <div className="space-y-1">
                          <label
                            htmlFor="news-image-photographer-credit"
                            className="text-xs font-bold text-gray-700 dark:text-gray-300 block"
                          >
                            {isAr ? 'اسم المصور / جهة المصدر (اختياري)' : 'Photographer / Credit (Optional)'}
                          </label>
                          <input
                            id="news-image-photographer-credit"
                            data-testid="news-image-photographer-credit"
                            type="text"
                            value={imageMetadata.photographerCredit || ''}
                            onChange={(e) => handleUpdateImageMetadata({ photographerCredit: e.target.value })}
                            placeholder={isAr ? 'مثال: وحدة التوثيق الميداني' : 'e.g. Field Documentation Unit'}
                            disabled={!canSaveContent || isSaving}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                          />
                        </div>

                        {/* Optional Arabic Caption */}
                        <div className="space-y-1">
                          <label
                            htmlFor="news-image-caption-ar"
                            className="text-xs font-bold text-gray-700 dark:text-gray-300 block"
                          >
                            {isAr ? 'التعليق التوضيحي بالعربية (اختياري)' : 'Arabic Caption (Optional)'}
                          </label>
                          <input
                            id="news-image-caption-ar"
                            data-testid="news-image-caption-ar"
                            type="text"
                            dir="rtl"
                            value={imageMetadata.captionAr || ''}
                            onChange={(e) => handleUpdateImageMetadata({ captionAr: e.target.value })}
                            placeholder="تعليق توضيحي أسفل الصورة..."
                            disabled={!canSaveContent || isSaving}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                          />
                        </div>

                        {/* Optional English Caption */}
                        <div className="space-y-1">
                          <label
                            htmlFor="news-image-caption-en"
                            className="text-xs font-bold text-gray-700 dark:text-gray-300 block"
                          >
                            {isAr ? 'التعليق التوضيحي بالإنجليزية (اختياري)' : 'English Caption (Optional)'}
                          </label>
                          <input
                            id="news-image-caption-en"
                            data-testid="news-image-caption-en"
                            type="text"
                            dir="ltr"
                            value={imageMetadata.captionEn || ''}
                            onChange={(e) => handleUpdateImageMetadata({ captionEn: e.target.value })}
                            placeholder="Image caption in English..."
                            disabled={!canSaveContent || isSaving}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                          />
                        </div>

                        {/* Optional Licensing Info */}
                        <div className="sm:col-span-2 space-y-1">
                          <label
                            htmlFor="news-image-licensing-info"
                            className="text-xs font-bold text-gray-700 dark:text-gray-300 block"
                          >
                            {isAr ? 'بيانات الترخيص والحقوق الأولية (اختياري)' : 'Licensing & Rights Note (Optional)'}
                          </label>
                          <input
                            id="news-image-licensing-info"
                            data-testid="news-image-licensing-info"
                            type="text"
                            value={imageMetadata.licensingInfo || ''}
                            onChange={(e) => handleUpdateImageMetadata({ licensingInfo: e.target.value })}
                            placeholder={
                              isAr
                                ? 'ملاحظة أولية للحقوق (لا تُعد موافقة نشر نهائية)...'
                                : 'Initial rights note (does not constitute final publication rights approval)...'
                            }
                            disabled={!canSaveContent || isSaving}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Related Videos from Canonical Media Library (NEWS-VIDEO-01A) */}
                  <div
                    data-testid="news-related-videos-section"
                    className="p-4 sm:p-5 rounded-2xl bg-gray-50/70 dark:bg-gray-800/40 border border-gray-200/80 dark:border-gray-700/80 space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-1">
                        <h3 className="text-xs sm:text-sm font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
                          <VideoIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span>{isAr ? 'الفيديوهات المرتبطة بالخبر' : 'Related Videos'}</span>
                        </h3>
                        <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                          {isAr
                            ? 'يرتبط الخبر تحريرياً بفيديوهات موجودة في مكتبة الوسائط المعتمدة فقط. الربط بالمسودة يوثّق العلاقة التحريرية، بينما يتطلب العرض العام نشر الفيديو واعتماد حقوقه.'
                            : 'Attach existing canonical videos from the Media Library to this draft. Editorial attachment records the association on the draft, while public playback requires the video to be Published and Rights-Approved.'}
                        </p>
                      </div>
                      <span
                        data-testid="news-related-videos-counter"
                        className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-xs shrink-0"
                      >
                        {(editForm.relatedVideoIds ?? []).length} / {MAX_RELATED_VIDEOS_PER_NEWS_ARTICLE}
                      </span>
                    </div>

                    {!isDraft ? (
                      <div
                        data-testid="news-related-videos-locked-notice"
                        className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-800/50 text-xs text-amber-800 dark:text-amber-300 font-medium"
                      >
                        {isAr
                          ? 'إدارة الفيديوهات المرتبطة متاحة فقط عندما يكون الخبر في مرحلة المسودة.'
                          : 'Managing related videos is available only while the article is in Draft state.'}
                      </div>
                    ) : null}

                    {/* Attached Videos List */}
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-gray-700 dark:text-gray-300">
                        {isAr ? 'الفيديوهات المرتبطة حالياً بالمسودة:' : 'Videos Currently Attached to Draft:'}
                      </p>
                      {(editForm.relatedVideoIds ?? []).length === 0 ? (
                        <div
                          data-testid="news-attached-videos-empty"
                          className="p-3 rounded-xl bg-white dark:bg-gray-900/60 border border-dashed border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400"
                        >
                          {isAr
                            ? 'لا توجد فيديوهات مرتبطة بهذه المسودة حالياً.'
                            : 'No videos are currently attached to this draft.'}
                        </div>
                      ) : (
                        <div
                          data-testid="news-attached-videos-list"
                          className="space-y-2"
                        >
                          {(editForm.relatedVideoIds ?? []).map((attachedId) => {
                            const matchedVideo = mediaVideos.find((v) => v.id === attachedId);
                            const evaluation = matchedVideo
                              ? evaluateVideoEditorialAttachmentStatus(matchedVideo)
                              : null;

                            return (
                              <div
                                key={attachedId}
                                data-testid={`news-attached-video-item-${attachedId}`}
                                className="p-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 flex items-start justify-between gap-3"
                              >
                                <div className="min-w-0 space-y-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-xs sm:text-sm text-gray-900 dark:text-white">
                                      {matchedVideo
                                        ? isAr
                                          ? matchedVideo.titleAr || matchedVideo.titleEn
                                          : matchedVideo.titleEn || matchedVideo.titleAr
                                        : attachedId}
                                    </span>
                                    <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[11px] font-mono text-gray-600 dark:text-gray-400">
                                      {attachedId}
                                    </span>
                                  </div>

                                  {matchedVideo && evaluation ? (
                                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                                      <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 font-semibold">
                                        {isAr
                                          ? evaluation.editorialAssociationLabelAr
                                          : evaluation.editorialAssociationLabelEn}
                                      </span>
                                      <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 font-medium">
                                        {isAr
                                          ? `حالة النشر: ${evaluation.publicationStatus}`
                                          : `Status: ${evaluation.publicationStatus}`}
                                      </span>
                                      <span className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 font-medium">
                                        {isAr
                                          ? `الاعتماد: ${evaluation.approvalStatus} | الحقوق: ${evaluation.rightsStatus}`
                                          : `Approval: ${evaluation.approvalStatus} | Rights: ${evaluation.rightsStatus}`}
                                      </span>
                                      <span
                                        data-testid={`news-attached-video-eligibility-${attachedId}`}
                                        className={`px-2 py-0.5 rounded-md font-semibold ${
                                          evaluation.isPubliclyPlayable
                                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                            : 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                        }`}
                                      >
                                        {isAr
                                          ? evaluation.publicEligibilityLabelAr
                                          : evaluation.publicEligibilityLabelEn}
                                      </span>
                                    </div>
                                  ) : (
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                      {isAr
                                        ? 'معرّف فيديو محفوظ من مكتبة الوسائط.'
                                        : 'Persisted canonical video ID from Media Library.'}
                                    </p>
                                  )}
                                </div>

                                {canSaveContent && (
                                  <button
                                    type="button"
                                    data-testid={`news-remove-related-video-btn-${attachedId}`}
                                    onClick={() => handleRemoveRelatedVideo(attachedId)}
                                    className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 dark:text-rose-300 text-xs font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>{isAr ? 'إزالة الربط' : 'Remove'}</span>
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Media Library Picker (Draft only) */}
                    {isDraft && (
                      <div className="space-y-3 pt-2 border-t border-gray-200/70 dark:border-gray-700/70">
                        <div className="space-y-1.5">
                          <label
                            htmlFor="news-related-video-search"
                            className="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1.5"
                          >
                            <Search className="w-3.5 h-3.5 text-emerald-600" />
                            <span>
                              {isAr
                                ? 'البحث في مكتبة الوسائط لاختيار فيديو موجود'
                                : 'Search Media Library to Select an Existing Video'}
                            </span>
                          </label>
                          <input
                            id="news-related-video-search"
                            data-testid="news-related-video-search-input"
                            type="text"
                            value={videoSearchQuery}
                            onChange={(e) => {
                              setVideoSearchQuery(e.target.value);
                              setVideoAttachmentFeedback(null);
                            }}
                            disabled={!canSaveContent}
                            placeholder={
                              isAr
                                ? 'ابحث بعنوان الفيديو أو المعرف في مكتبة الوسائط (لا يُسمح بلصق روابط يوتيوب)...'
                                : 'Search by video title or ID in Media Library (pasting YouTube URLs is not allowed)...'
                            }
                            className="w-full px-3.5 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                          />
                        </div>

                        {videoSearchQuery.trim().length > 0 &&
                          isArbitraryUrlOrInvalidVideoId(videoSearchQuery.trim()) &&
                          /https?:\/\/|youtube\.com|youtu\.be/i.test(videoSearchQuery) && (
                            <div
                              data-testid="news-related-video-url-rejected-warning"
                              role="alert"
                              className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 font-semibold flex items-center gap-2"
                            >
                              <AlertCircle className="w-4 h-4 shrink-0" />
                              <span>
                                {isAr
                                  ? 'لا يُسمح بلصق روابط يوتيوب مباشرة داخل محرر الأخبار. يرجى اختيار فيديو مسجل مسبقاً في مكتبة الوسائط.'
                                  : 'Pasting arbitrary YouTube URLs is prohibited in the news editor. Please select a canonical video from the Media Library.'}
                              </span>
                            </div>
                          )}

                        {videoAttachmentFeedback && (
                          <div
                            data-testid="news-related-video-feedback"
                            role="alert"
                            className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 font-semibold flex items-center gap-2"
                          >
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>{videoAttachmentFeedback}</span>
                          </div>
                        )}

                        {mediaVideosLoadError && (
                          <div
                            data-testid="news-related-videos-load-error"
                            className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 font-medium"
                          >
                            {mediaVideosLoadError}
                          </div>
                        )}

                        {isLoadingMediaVideos ? (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {isAr ? 'جاري تحميل فيديوهات مكتبة الوسائط...' : 'Loading Media Library videos...'}
                          </p>
                        ) : (
                          <div
                            data-testid="news-available-videos-list"
                            className="max-h-56 overflow-y-auto space-y-2 pr-1"
                          >
                            {mediaVideos
                              .filter((video) => {
                                const q = videoSearchQuery.trim().toLowerCase();
                                if (!q) return true;
                                return (
                                  video.id.toLowerCase().includes(q) ||
                                  (video.titleAr || '').toLowerCase().includes(q) ||
                                  (video.titleEn || '').toLowerCase().includes(q) ||
                                  (video.category || '').toLowerCase().includes(q)
                                );
                              })
                              .map((video) => {
                                const isAlreadyAttached = (editForm.relatedVideoIds ?? []).includes(video.id);
                                const isLimitReached =
                                  (editForm.relatedVideoIds ?? []).length >= MAX_RELATED_VIDEOS_PER_NEWS_ARTICLE;
                                const evaluation = evaluateVideoEditorialAttachmentStatus(video);

                                return (
                                  <div
                                    key={video.id}
                                    data-testid={`news-available-video-option-${video.id}`}
                                    className="p-2.5 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3"
                                  >
                                    <div className="min-w-0 space-y-1">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-bold text-xs text-gray-900 dark:text-white">
                                          {isAr
                                            ? video.titleAr || video.titleEn
                                            : video.titleEn || video.titleAr}
                                        </span>
                                        <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[10px] font-mono text-gray-600 dark:text-gray-400">
                                          {video.id}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                                        <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                                          {isAr
                                            ? `النشر: ${evaluation.publicationStatus}`
                                            : `Status: ${evaluation.publicationStatus}`}
                                        </span>
                                        <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                                          {isAr
                                            ? `الحقوق: ${evaluation.rightsStatus}`
                                            : `Rights: ${evaluation.rightsStatus}`}
                                        </span>
                                        <span
                                          className={`px-1.5 py-0.5 rounded font-semibold ${
                                            evaluation.isPubliclyPlayable
                                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                              : 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                          }`}
                                        >
                                          {isAr
                                            ? evaluation.publicEligibilityLabelAr
                                            : evaluation.publicEligibilityLabelEn}
                                        </span>
                                      </div>
                                    </div>

                                    <button
                                      type="button"
                                      data-testid={`news-attach-related-video-btn-${video.id}`}
                                      disabled={!canSaveContent || isAlreadyAttached || isLimitReached}
                                      onClick={() => handleAttachRelatedVideo(video)}
                                      className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors ${
                                        isAlreadyAttached
                                          ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 cursor-not-allowed'
                                          : isLimitReached || !canSaveContent
                                            ? 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500 cursor-not-allowed'
                                            : 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
                                      }`}
                                    >
                                      {isAlreadyAttached
                                        ? isAr
                                          ? 'مرتبط بالمسودة'
                                          : 'Attached'
                                        : isAr
                                          ? 'ربط بالمسودة'
                                          : 'Attach Video'}
                                    </button>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* WORKFLOW & AUDIT TRAIL TAB */
                <div className="space-y-6">
                  {/* Visual Lifecycle Stepper */}
                  <div className="bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 p-4 sm:p-5 rounded-2xl">
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-4">
                      {isAr ? 'مراحل خط الاعتماد الخبري' : 'News Editorial Pipeline'}
                    </h3>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
                      {lifecycleStates.map((step) => {
                        const Icon = step.icon;
                        const isCurrent = activeItem.workflowState === step.key;
                        
                        return (
                          <div
                            key={step.key}
                            className={`p-3 rounded-xl border flex flex-col items-center justify-center text-center transition-all ${
                              isCurrent
                                ? 'bg-emerald-500 text-white border-emerald-600 shadow-md ring-2 ring-emerald-400/40 dark:ring-emerald-500/50'
                                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700'
                            }`}
                          >
                            <Icon className={`w-4 h-4 mb-1.5 ${isCurrent ? 'text-white' : 'text-gray-400'}`} />
                            <span className="text-xs font-bold leading-tight">
                              {isAr ? step.labelAr : step.labelEn}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Authorized Workflow Transition Actions */}
                  <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5 rounded-2xl space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-extrabold text-gray-900 dark:text-white">
                        {isAr ? 'الإجراءات المتاحة لدورك الحالي:' : 'Permitted Actions for Your Role:'}
                      </h3>
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-md">
                        {currentUser.role}
                      </span>
                    </div>

                    {/* Check authorized transitions (requiring BOTH WorkflowEngine and server-equivalent permission) */}
                    {(() => {
                      const authorizedTransitions = getAuthorizedNewsArticleTransitions(
                        activeItem.workflowState,
                        currentUser
                      );

                      // Owner-only withdrawal from Published -> Draft must not be rendered for non-Owner users
                      const validTransitions = WorkflowEngine.getValidTransitionsFromState(
                        activeItem.workflowState
                      ).filter(config => {
                        if (config.action === WorkflowAction.WithdrawForRevision) {
                          return canSelectNewsTransition(
                            activeItem.workflowState,
                            config,
                            currentUser
                          );
                        }
                        return true;
                      });

                      if (validTransitions.length === 0) {
                        return (
                          <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                            {isAr ? 'هذا المقال الخبري في حالته النهائية ولا يتطلب أي إجراءات إضافية.' : 'This article is in its terminal state.'}
                          </p>
                        );
                      }

                      return (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {validTransitions.map(config => {
                            const isAuthorized =
                              authorizedTransitions.some(t => t.toState === config.toState) &&
                              canSelectNewsTransition(activeItem.workflowState, config, currentUser);
                            const isWithdrawalAction =
                              config.action === WorkflowAction.WithdrawForRevision;

                            return (
                              <button
                                key={config.toState}
                                data-testid={`news-workflow-transition-btn-${config.toState}`}
                                disabled={!isAuthorized || isTransitioning}
                                onClick={() => {
                                  if (!canSelectNewsTransition(activeItem.workflowState, config, currentUser)) {
                                    setPendingTransition(null);
                                    setTransitionComment('');
                                    return;
                                  }
                                  if (config.requiresComment) {
                                    setPendingTransition(config);
                                    setTransitionComment('');
                                    setErrorMessage(null);
                                  } else {
                                    handleExecuteTransition(config);
                                  }
                                }}
                                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 ${
                                  isAuthorized
                                    ? isWithdrawalAction
                                      ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs'
                                      : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                                    : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600 cursor-not-allowed'
                                }`}
                              >
                                {isWithdrawalAction && <RotateCcw className="w-3.5 h-3.5" />}
                                <span>{isAr ? config.labelAr : config.labelEn}</span>
                                {!isAuthorized && <ShieldAlert className="w-3.5 h-3.5 text-gray-400" />}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Comment Prompt Drawer / Modal for Request Changes or Owner Withdrawal */}
                  {pendingTransition &&
                    canSelectNewsTransition(activeItem.workflowState, pendingTransition, currentUser) && (
                    <div
                      data-testid="news-workflow-comment-drawer"
                      className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 space-y-3"
                    >
                      {pendingTransition.action === WorkflowAction.WithdrawForRevision && (
                        <div
                          data-testid="news-withdrawal-public-warning"
                          role="alert"
                          className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/70 flex items-start gap-2.5 text-xs text-rose-800 dark:text-rose-200 font-semibold leading-relaxed"
                        >
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                          <span>
                            {isAr
                              ? 'تحذير هام: سيؤدي هذا الإجراء إلى سحب المقال فوراً من بوابة الأخبار العامة وإخفائه عن الجمهور، وإعادته إلى حالة المسودة للمراجعة والتحرير. لن يُعاد نشر المقال إلا بعد استكمال دورة المراجعة والاعتماد والنشر الكاملة من جديد.'
                              : 'Important Warning: This action will immediately withdraw the article from public news and return it to Draft state for revision. It will not appear publicly again until it completes the full review, approval, and publication workflow.'}
                          </span>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2 text-amber-800 dark:text-amber-300 font-bold text-xs">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-4 h-4" />
                          <span>
                            {pendingTransition.action === WorkflowAction.WithdrawForRevision
                              ? isAr
                                ? 'يرجى تدوين سبب السحب من النشر وإعادة المسودة (إلزامي):'
                                : 'Please provide the mandatory written reason for withdrawing publication:'
                              : isAr
                                ? 'يرجى تدوين ملاحظات التعديل المطلوب:'
                                : 'Please provide change feedback notes:'}
                          </span>
                        </div>
                        <span
                          data-testid="news-workflow-comment-counter"
                          className={`text-[11px] font-semibold ${
                            transitionComment.length > MAX_NEWS_TRANSITION_COMMENT_LENGTH
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-amber-700/80 dark:text-amber-400/80'
                          }`}
                        >
                          {transitionComment.trim().length} / {MAX_NEWS_TRANSITION_COMMENT_LENGTH}
                        </span>
                      </div>

                      <textarea
                        data-testid="news-workflow-comment-input"
                        rows={3}
                        disabled={isTransitioning}
                        value={transitionComment}
                        onChange={(e) => setTransitionComment(e.target.value)}
                        placeholder={
                          pendingTransition.action === WorkflowAction.WithdrawForRevision
                            ? isAr
                              ? 'اكتب السبب التحريري لسحب المقال المنشور وإعادته إلى المسودة...'
                              : 'Enter the editorial reason for withdrawing this published article to Draft...'
                            : isAr
                              ? 'اكتب ملاحظات التدقيق والتحسينات المطلوبة...'
                              : 'Enter feedback notes...'
                        }
                        className="w-full p-3 text-xs bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-700 rounded-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-60"
                      />

                      {transitionComment.length > MAX_NEWS_TRANSITION_COMMENT_LENGTH && (
                        <p
                          data-testid="news-workflow-comment-length-error"
                          className="text-xs font-semibold text-rose-600 dark:text-rose-400"
                        >
                          {isAr
                            ? `يتجاوز النص الحد الأقصى المسموح به (${MAX_NEWS_TRANSITION_COMMENT_LENGTH} حرف).`
                            : `Reason exceeds the maximum length of ${MAX_NEWS_TRANSITION_COMMENT_LENGTH} characters.`}
                        </p>
                      )}

                      <div className="flex items-center justify-end gap-2">
                        <button
                          data-testid="news-workflow-cancel-comment-btn"
                          disabled={isTransitioning}
                          onClick={() => {
                            setPendingTransition(null);
                            setTransitionComment('');
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-amber-100/50 dark:hover:bg-amber-900/40 disabled:opacity-50"
                        >
                          {isAr ? 'إلغاء' : 'Cancel'}
                        </button>
                        <button
                          data-testid="news-workflow-confirm-comment-btn"
                          disabled={
                            isTransitioning ||
                            !canConfirmNewsTransitionComment(
                              activeItem.workflowState,
                              pendingTransition,
                              transitionComment,
                              currentUser
                            )
                          }
                          onClick={() => {
                            if (
                              isTransitioning ||
                              !canConfirmNewsTransitionComment(
                                activeItem.workflowState,
                                pendingTransition,
                                transitionComment,
                                currentUser
                              )
                            ) {
                              return;
                            }
                            handleExecuteTransition(pendingTransition, transitionComment);
                          }}
                          className="px-4 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
                        >
                          {pendingTransition.action === WorkflowAction.WithdrawForRevision
                            ? isTransitioning
                              ? isAr
                                ? 'جارٍ سحب المقال...'
                                : 'Withdrawing Article...'
                              : isAr
                                ? 'تأكيد سحب النشر وإعادة المسودة'
                                : 'Confirm Withdrawal to Draft'
                            : isAr
                              ? 'تأكيد إرسال الملاحظات'
                              : 'Confirm Feedback'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Editorial Image Rights Review Panel (Single Canonical Surface) */}
                  <EditorialImageRightsReviewPanel
                    currentUser={currentUser}
                    articleId={
                      activeItem && !isCreating && !activeItem.id.startsWith('news-sudan-')
                        ? activeItem.id
                        : undefined
                    }
                    featuredImage={editForm.featuredImage ?? activeItem?.featuredImage}
                    richBodyAr={editForm.richBodyAr ?? activeItem?.richBodyAr}
                    richBodyEn={editForm.richBodyEn ?? activeItem?.richBodyEn}
                    unsavedLocalAssetIds={imageSessionRef.current
                      .getAllInlineImageStates()
                      .filter((s) => s.status === 'Staged' && !s.retainedCompletedUpload)
                      .map((s) => s.assetId)}
                    isAr={isAr}
                  />

                  {/* Audit Log / History */}
                  <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 p-5 rounded-2xl space-y-4">
                    <h3 className="text-sm font-extrabold text-gray-900 dark:text-white flex items-center gap-2">
                      <Clock className="w-4 h-4 text-emerald-600" />
                      <span>{isAr ? 'سجل العمليات والقرارات السابقة' : 'Transition Audit History'}</span>
                    </h3>

                    {activeItem.history.length === 0 ? (
                      <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                        {isAr ? 'لا توجد انتقالات سابقة مسجلة على هذا الخبر.' : 'No audit history available.'}
                      </p>
                    ) : (
                      <div className="space-y-3 relative before:absolute before:start-3.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-gray-100 dark:before:bg-gray-800">
                        {activeItem.history.map(record => (
                          <div key={record.id} className="relative ps-8 space-y-1">
                            <div className="absolute start-1.5 top-1 w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px]">
                              <Check className="w-2.5 h-2.5" />
                            </div>
                            <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                              <span className="font-bold text-gray-900 dark:text-white">
                                {record.actorName} <span className="text-gray-400 font-normal">({record.actorRole})</span>
                              </span>
                              <span className="text-[11px] text-gray-400">
                                {new Date(record.timestamp).toLocaleString(isAr ? 'ar-SD' : 'en-US')}
                              </span>
                            </div>
                            <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                              {record.fromState} ← {record.toState}
                            </p>
                            {record.comment && (
                              <p className="text-xs bg-gray-50 dark:bg-gray-800/60 p-2.5 rounded-lg text-gray-600 dark:text-gray-300 italic border border-gray-100 dark:border-gray-800 mt-1">
                                "{record.comment}"
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/40 shrink-0">
              <div className="max-w-5xl mx-auto w-full p-4 sm:p-5 flex items-center justify-between gap-3">
                <button
                  onClick={handleCloseModal}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                >
                  {isAr ? 'إغلاق' : 'Close'}
                </button>

                {canSaveContent && activeTab === 'content' && (
                  <button
                    data-testid="news-save-changes-btn"
                    disabled={isSaving}
                    onClick={handleSaveForm}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-xs shadow-sm inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Save className="w-4 h-4" />
                    <span>{isAr ? 'حفظ البيانات والتعديلات' : 'Save Changes'}</span>
                  </button>
                )}
              </div>
            </div>
          </section>
      )}

      {/* Editorial Image Preparation Modal (IMG-F3-09/D2-D2B3A) */}
      <EditorialInlineImageModal
        isOpen={isImageModalOpen}
        onClose={handleCloseImageModal}
        onConfirm={handleConfirmImageModal}
        errorMessage={errorMessage}
        lang={activeInsertionRequest ? activeInsertionRequest.request.editorLang : (isAr ? 'ar' : 'en')}
        dir={activeInsertionRequest ? activeInsertionRequest.request.editorDir : (isAr ? 'rtl' : 'ltr')}
        readOnly={!canSaveContent}
        busy={isSaving}
        initialUsage={activeInsertionRequest ? 'inline' : 'cover'}
      />
    </div>
  );
}
