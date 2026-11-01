import { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  BookOpen, 
  Search, 
  Plus, 
  ShieldCheck, 
  Building2, 
  FileText, 
  Clock, 
  AlertTriangle, 
  Edit3, 
  RefreshCw,
  Loader2,
  ExternalLink,
  CheckCircle2,
  Database,
  Globe,
  Inbox,
  Sparkles,
  X
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import { WorkflowState } from '../../types/workflow';
import { AdminAccessService } from '../../services/adminAccess';
import { AdminPermission } from '../../types/admin';
import { 
  LibraryDocumentType, 
  LibraryRightsStatus 
} from '../../types/library';
import type { 
  LibraryDocument, 
  LibraryOrganization, 
  LibrarySource 
} from '../../types/library';
import { 
  LibraryIntakeStatus,
  LibraryIntakeAIInputBasis,
  type LibraryIntakeRecord 
} from '../../../functions/src/shared/libraryContract';
import { LibraryDocumentEditorModal } from './LibraryDocumentEditorModal';
import { LibraryAdminClient } from '../../services/libraryAdminClient';

interface AdminLibraryManagementProps {
  currentUser: AdminUser;
}

export function AdminLibraryManagement({ currentUser }: AdminLibraryManagementProps) {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar';

  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [organizations, setOrganizations] = useState<LibraryOrganization[]>([]);
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [intakeRecords, setIntakeRecords] = useState<LibraryIntakeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tab View State: 'documents' | 'organizations' | 'sources' | 'intake'
  const [activeTab, setActiveTab] = useState<'documents' | 'organizations' | 'sources' | 'intake'>('documents');

  // Filter States for Documents
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedRights, setSelectedRights] = useState<string>('ALL');
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('ALL');

  // Search Filter for Organizations & Sources
  const [orgSearchQuery, setOrgSearchQuery] = useState('');
  const [sourceSearchQuery, setSourceSearchQuery] = useState('');

  // Search & Filter for Intake Inbox
  const [intakeSearchQuery, setIntakeSearchQuery] = useState('');
  const [intakeStatusFilter, setIntakeStatusFilter] = useState<string>('ALL');

  // Modal State for Document Editor
  const [activeModalDoc, setActiveModalDoc] = useState<LibraryDocument | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Modal State for Register Organization
  const [isOrgModalOpen, setIsOrgModalOpen] = useState(false);
  const [newOrgNameAr, setNewOrgNameAr] = useState('');
  const [newOrgNameEn, setNewOrgNameEn] = useState('');
  const [newOrgType, setNewOrgType] = useState<'Ministry' | 'InternationalBody' | 'ResearchCenter' | 'NGO' | 'Judicial'>('Ministry');
  const [newOrgCountryAr, setNewOrgCountryAr] = useState('');
  const [newOrgCountryEn, setNewOrgCountryEn] = useState('');
  const [newOrgWebsite, setNewOrgWebsite] = useState('');

  // Modal State for Register Source
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [newSourceOrgId, setNewSourceOrgId] = useState('');
  const [newSourceNameAr, setNewSourceNameAr] = useState('');
  const [newSourceNameEn, setNewSourceNameEn] = useState('');
  const [newSourceType, setNewSourceType] = useState<'OfficialGazette' | 'GovernmentPortal' | 'AcademicJournal' | 'InstitutionalArchive'>('OfficialGazette');
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceStatus, setNewSourceStatus] = useState<'Verified' | 'PendingVerification' | 'ThirdPartyIndex'>('PendingVerification');

  // Modal State for Submitting Intake Reference
  const [isSubmitIntakeModalOpen, setIsSubmitIntakeModalOpen] = useState(false);
  const [intakeUrl, setIntakeUrl] = useState('');
  const [intakeTitle, setIntakeTitle] = useState('');
  const [intakeOrgId, setIntakeOrgId] = useState('');
  const [intakeSourceId, setIntakeSourceId] = useState('');
  const [intakeLanguage, setIntakeLanguage] = useState<'ar' | 'en' | 'bilingual' | 'other'>('ar');
  const [intakeNotes, setIntakeNotes] = useState('');
  const [submittingIntake, setSubmittingIntake] = useState(false);
  const [intakeFormError, setIntakeFormError] = useState<string | null>(null);
  const [intakeFormSuccess, setIntakeFormSuccess] = useState<string | null>(null);

  // Modal State for Reviewing Intake Reference
  const [reviewingIntake, setReviewingIntake] = useState<LibraryIntakeRecord | null>(null);
  const [reviewTargetStatus, setReviewTargetStatus] = useState<LibraryIntakeStatus>(LibraryIntakeStatus.InPreparation);
  const [reviewEditorialNotes, setReviewEditorialNotes] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewModalError, setReviewModalError] = useState<string | null>(null);

  // Modal State for Human-Triggered AI Preparation Assistant
  const [aiPrepIntake, setAiPrepIntake] = useState<LibraryIntakeRecord | null>(null);
  const [aiPrepExcerpt, setAiPrepExcerpt] = useState('');
  const [generatingAiPrep, setGeneratingAiPrep] = useState(false);
  const [aiPrepError, setAiPrepError] = useState<string | null>(null);

  // Registry Action Feedback State
  const [submittingRegistry, setSubmittingRegistry] = useState(false);
  const [registryFormError, setRegistryFormError] = useState<string | null>(null);
  const [registryFormSuccess, setRegistryFormSuccess] = useState<string | null>(null);

  const canCreate = AdminAccessService.hasPermission(currentUser, AdminPermission.Create);
  const canEdit = AdminAccessService.hasPermission(currentUser, AdminPermission.Edit);
  const canReview = AdminAccessService.hasPermission(currentUser, AdminPermission.Review);
  const canApprove = AdminAccessService.hasPermission(currentUser, AdminPermission.Approve);
  const canManageRights = AdminAccessService.hasPermission(currentUser, AdminPermission.ManageRights);
  const canRegisterRegistry = canCreate || canManageRights;
  const canSubmitIntake = canCreate || canEdit;
  const canReviewIntake = canReview || canApprove || canManageRights;
  const canPrepareAiIntake = canCreate || canEdit || canReview || canApprove || canManageRights;

  const loadAllData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!LibraryAdminClient.isBackendAvailable() || !LibraryAdminClient.isAuthenticated()) {
        setError(isAr ? 'الخادم غير متصل أو لم يتم تسجيل الدخول كمسؤول' : 'Backend unconfigured or unauthenticated session.');
        setDocuments([]);
        setOrganizations([]);
        setSources([]);
        setIntakeRecords([]);
        setLoading(false);
        return;
      }
      const [remoteDocs, remoteOrgs, remoteSources, remoteIntake] = await Promise.all([
        LibraryAdminClient.listAll(),
        LibraryAdminClient.listOrganizations(),
        LibraryAdminClient.listSources(),
        LibraryAdminClient.listIntake(),
      ]);
      setDocuments(remoteDocs);
      setOrganizations(remoteOrgs);
      setSources(remoteSources);
      setIntakeRecords(remoteIntake);
    } catch (err: any) {
      setError(err.message || 'Failed to load library data');
      setDocuments([]);
      setOrganizations([]);
      setSources([]);
      setIntakeRecords([]);
    } finally {
      setLoading(false);
    }
  }, [isAr]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Filtered List Computation for Documents
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitleAr = doc.titleAr.toLowerCase().includes(q);
        const matchTitleEn = doc.titleEn.toLowerCase().includes(q);
        const matchOrg = doc.organizationId.toLowerCase().includes(q);
        const matchTopic = doc.topicsAr.some(t => t.toLowerCase().includes(q)) ||
                           doc.topicsEn.some(t => t.toLowerCase().includes(q));
        if (!matchTitleAr && !matchTitleEn && !matchOrg && !matchTopic) {
          return false;
        }
      }

      // Document Type
      if (selectedType !== 'ALL' && doc.documentType !== selectedType) {
        return false;
      }

      // Rights Status
      if (selectedRights !== 'ALL' && doc.rightsStatus !== selectedRights) {
        return false;
      }

      // Workflow State
      if (selectedWorkflow !== 'ALL' && doc.workflowState !== selectedWorkflow) {
        return false;
      }

      return true;
    });
  }, [documents, searchQuery, selectedType, selectedRights, selectedWorkflow]);

  const handleSaveDocument = async (savedDoc: LibraryDocument) => {
    try {
      const exists = documents.some((d) => d.id === savedDoc.id);
      let canonical: LibraryDocument;
      if (exists) {
        canonical = await LibraryAdminClient.updateMetadata(savedDoc.id, {
          titleAr: savedDoc.titleAr,
          titleEn: savedDoc.titleEn,
          originalTitle: savedDoc.originalTitle,
          documentType: savedDoc.documentType,
          organizationId: savedDoc.organizationId,
          sourceId: savedDoc.sourceId,
          geographyAr: savedDoc.geographyAr,
          geographyEn: savedDoc.geographyEn,
          publicationDate: savedDoc.publicationDate,
          language: savedDoc.language,
          summaryAr: savedDoc.summaryAr,
          summaryEn: savedDoc.summaryEn,
          topicsAr: savedDoc.topicsAr,
          topicsEn: savedDoc.topicsEn,
          environmentalDomains: savedDoc.environmentalDomains,
          legalStatusDescriptionAr: savedDoc.legalStatusDescriptionAr,
          legalStatusDescriptionEn: savedDoc.legalStatusDescriptionEn,
          authorMetadataAr: savedDoc.authorMetadataAr,
          authorMetadataEn: savedDoc.authorMetadataEn,
        });
      } else {
        canonical = await LibraryAdminClient.create({
          id: savedDoc.id,
          titleAr: savedDoc.titleAr,
          titleEn: savedDoc.titleEn,
          originalTitle: savedDoc.originalTitle,
          documentType: savedDoc.documentType,
          organizationId: savedDoc.organizationId,
          sourceId: savedDoc.sourceId,
          geographyAr: savedDoc.geographyAr,
          geographyEn: savedDoc.geographyEn,
          publicationDate: savedDoc.publicationDate,
          language: savedDoc.language,
          summaryAr: savedDoc.summaryAr,
          summaryEn: savedDoc.summaryEn,
          topicsAr: savedDoc.topicsAr,
          topicsEn: savedDoc.topicsEn,
          environmentalDomains: savedDoc.environmentalDomains,
          legalStatusDescriptionAr: savedDoc.legalStatusDescriptionAr,
          legalStatusDescriptionEn: savedDoc.legalStatusDescriptionEn,
          authorMetadataAr: savedDoc.authorMetadataAr,
          authorMetadataEn: savedDoc.authorMetadataEn,
          rightsStatus: savedDoc.rightsStatus,
          rightsNotesAr: savedDoc.rightsNotesAr,
          rightsNotesEn: savedDoc.rightsNotesEn,
        });
      }
      await loadAllData();
      setActiveModalDoc(canonical);
    } catch (err: any) {
      alert(err.message || 'Failed to save document');
    }
  };

  const handleCreateNew = () => {
    if (organizations.length === 0) {
      alert(isAr ? 'يرجى تسجيل مؤسسة معتمدة أولاً قبل إنشاء وثيقة جديدة.' : 'Please register an authorized organization before creating a new document.');
      setActiveTab('organizations');
      return;
    }

    const newDoc: LibraryDocument = {
      id: `doc-${Date.now()}`,
      titleAr: 'وثيقة بيئية جديدة قيد التوصيف',
      titleEn: 'New Environmental Knowledge Document',
      originalTitle: '',
      documentType: LibraryDocumentType.Law,
      organizationId: organizations[0]?.id || '',
      sourceId: sources[0]?.id || '',
      geographyAr: 'إقليمي / وطني',
      geographyEn: 'Regional / National',
      publicationDate: new Date().toISOString().split('T')[0],
      language: 'ar',
      summaryAr: 'ملخص أولي للمادة المعرفية البيئية قيد الإدخال...',
      summaryEn: 'Initial summary of the environmental knowledge item under drafting...',
      topicsAr: ['بيئة', 'تشريعات'],
      topicsEn: ['Environment', 'Legislation'],
      environmentalDomains: ['LawAndPolicy'],
      rightsStatus: LibraryRightsStatus.Unknown,
      rightsNotesAr: 'قيد المراجعة الحقوقية والتثبت من قيود الملكية النشرية.',
      rightsNotesEn: 'Under rights audit and copyright verification.',
      workflowState: WorkflowState.Draft,
      workflowHistory: [],
      legalStatusDescriptionAr: 'بيان توثيقي أولي لم يستكمل التدقيق الميداني بعد.',
      legalStatusDescriptionEn: 'Initial descriptive metadata pending cataloging audit.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      versions: [
        {
          id: `ver-${Date.now()}`,
          documentId: `doc-${Date.now()}`,
          versionNumber: '1.0',
          publishedDate: new Date().toISOString().split('T')[0],
          changeDescriptionAr: 'إنشاء مسودة السجل المرجعي الأولية',
          changeDescriptionEn: 'Initial draft catalog entry created'
        }
      ]
    };
    setActiveModalDoc(newDoc);
    setIsModalOpen(true);
  };

  const getOrganizationName = (orgId: string) => {
    const org = organizations.find((o) => o.id === orgId);
    if (!org) return orgId;
    return isAr ? org.nameAr : org.nameEn;
  };

  const getSourceName = (srcId: string) => {
    const src = sources.find((s) => s.id === srcId);
    if (!src) return srcId;
    return isAr ? src.sourceNameAr : src.sourceNameEn;
  };

  const getSourceVerificationBadge = (status: 'Verified' | 'PendingVerification' | 'ThirdPartyIndex') => {
    switch (status) {
      case 'Verified':
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1 w-fit">
            <ShieldCheck className="h-3 w-3" />
            <span>{isAr ? 'موثق ومعتمد' : 'Verified'}</span>
          </span>
        );
      case 'PendingVerification':
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-800 flex items-center gap-1 w-fit">
            <Clock className="h-3 w-3" />
            <span>{isAr ? 'قيد التحقق' : 'Pending Verification'}</span>
          </span>
        );
      case 'ThirdPartyIndex':
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-300 dark:border-blue-800 flex items-center gap-1 w-fit">
            <Globe className="h-3 w-3" />
            <span>{isAr ? 'فهرس خارجي' : 'Third-Party Index'}</span>
          </span>
        );
    }
  };

  const handleRegisterOrganization = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingRegistry(true);
    setRegistryFormError(null);
    try {
      if (!newOrgNameAr.trim() || !newOrgNameEn.trim() || !newOrgCountryAr.trim() || !newOrgCountryEn.trim()) {
        throw new Error(isAr ? 'يرجى استكمال جميع الحقول المطلوبة للمؤسسة' : 'Please fill all required organization fields');
      }
      await LibraryAdminClient.registerOrganization({
        nameAr: newOrgNameAr.trim(),
        nameEn: newOrgNameEn.trim(),
        type: newOrgType,
        countryRegionAr: newOrgCountryAr.trim(),
        countryRegionEn: newOrgCountryEn.trim(),
        websiteUrl: newOrgWebsite.trim() || undefined,
      });
      setRegistryFormSuccess(isAr ? 'تم تسجيل المؤسسة بنجاح في السجل المعتمد' : 'Organization registered successfully in verified registry');
      setNewOrgNameAr('');
      setNewOrgNameEn('');
      setNewOrgCountryAr('');
      setNewOrgCountryEn('');
      setNewOrgWebsite('');
      await loadAllData();
      setTimeout(() => {
        setIsOrgModalOpen(false);
        setRegistryFormSuccess(null);
      }, 1000);
    } catch (err: any) {
      setRegistryFormError(err.message || 'Failed to register organization');
    } finally {
      setSubmittingRegistry(false);
    }
  };

  const handleRegisterSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingRegistry(true);
    setRegistryFormError(null);
    try {
      if (!newSourceOrgId) {
        throw new Error(isAr ? 'يجب ربط المصدر بمؤسسة مسجلة معتمدة' : 'Source must reference an existing registered organization');
      }
      if (!newSourceNameAr.trim() || !newSourceNameEn.trim()) {
        throw new Error(isAr ? 'يرجى إدخال اسم المصدر بالعربية والإنجليزية' : 'Please provide source name in Arabic and English');
      }
      const finalStatus = canManageRights ? newSourceStatus : 'PendingVerification';
      await LibraryAdminClient.registerSource({
        organizationId: newSourceOrgId,
        sourceNameAr: newSourceNameAr.trim(),
        sourceNameEn: newSourceNameEn.trim(),
        sourceType: newSourceType,
        sourceUrl: newSourceUrl.trim() || undefined,
        verificationStatus: finalStatus,
      });
      setRegistryFormSuccess(isAr ? 'تم تسجيل المصدر بنجاح في السجل المرجعي' : 'Source registered successfully in catalog registry');
      setNewSourceNameAr('');
      setNewSourceNameEn('');
      setNewSourceUrl('');
      setNewSourceStatus('PendingVerification');
      await loadAllData();
      setTimeout(() => {
        setIsSourceModalOpen(false);
        setRegistryFormSuccess(null);
      }, 1000);
    } catch (err: any) {
      setRegistryFormError(err.message || 'Failed to register source');
    } finally {
      setSubmittingRegistry(false);
    }
  };

  const handleVerifySource = async (sourceId: string, status: 'Verified' | 'PendingVerification' | 'ThirdPartyIndex') => {
    try {
      await LibraryAdminClient.verifySource(sourceId, status);
      await loadAllData();
    } catch (err: any) {
      alert(err.message || 'Failed to update verification status');
    }
  };

  const filteredOrganizations = useMemo(() => {
    if (!orgSearchQuery.trim()) return organizations;
    const q = orgSearchQuery.toLowerCase();
    return organizations.filter(o => 
      o.nameAr.toLowerCase().includes(q) ||
      o.nameEn.toLowerCase().includes(q) ||
      o.countryRegionAr.toLowerCase().includes(q) ||
      o.countryRegionEn.toLowerCase().includes(q) ||
      o.type.toLowerCase().includes(q)
    );
  }, [organizations, orgSearchQuery]);

  const filteredSources = useMemo(() => {
    if (!sourceSearchQuery.trim()) return sources;
    const q = sourceSearchQuery.toLowerCase();
    return sources.filter(s => 
      s.sourceNameAr.toLowerCase().includes(q) ||
      s.sourceNameEn.toLowerCase().includes(q) ||
      s.sourceType.toLowerCase().includes(q) ||
      s.verificationStatus.toLowerCase().includes(q) ||
      getOrganizationName(s.organizationId).toLowerCase().includes(q)
    );
  }, [sources, sourceSearchQuery, organizations]);

  const filteredIntakeRecords = useMemo(() => {
    return intakeRecords.filter((rec) => {
      if (intakeStatusFilter !== 'ALL' && rec.status !== intakeStatusFilter) {
        return false;
      }
      if (intakeSearchQuery.trim()) {
        const q = intakeSearchQuery.toLowerCase();
        const matchTitle = rec.title.toLowerCase().includes(q);
        const matchUrl = rec.url.toLowerCase().includes(q) || rec.normalizedUrl.toLowerCase().includes(q);
        const matchNotes = rec.notes ? rec.notes.toLowerCase().includes(q) : false;
        const matchOrg = rec.organizationId ? getOrganizationName(rec.organizationId).toLowerCase().includes(q) : false;
        const matchSrc = rec.sourceId ? getSourceName(rec.sourceId).toLowerCase().includes(q) : false;
        if (!matchTitle && !matchUrl && !matchNotes && !matchOrg && !matchSrc) {
          return false;
        }
      }
      return true;
    });
  }, [intakeRecords, intakeSearchQuery, intakeStatusFilter, organizations, sources]);

  const handleSubmitIntake = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingIntake(true);
    setIntakeFormError(null);
    setIntakeFormSuccess(null);
    try {
      if (!intakeUrl.trim() || !intakeTitle.trim()) {
        throw new Error(isAr ? 'يرجى إدخال عنوان الوثيقة ورابط المرجع المؤمن (HTTPS)' : 'Please provide both document title and HTTPS reference URL');
      }
      await LibraryAdminClient.submitIntake({
        url: intakeUrl.trim(),
        title: intakeTitle.trim(),
        organizationId: intakeOrgId || undefined,
        sourceId: intakeSourceId || undefined,
        language: intakeLanguage,
        notes: intakeNotes.trim() || undefined,
      });
      setIntakeFormSuccess(isAr ? 'تم إيداع المرجع في سجل الاستقبال بنجاح' : 'Reference submitted to intake inbox successfully');
      setIntakeUrl('');
      setIntakeTitle('');
      setIntakeOrgId('');
      setIntakeSourceId('');
      setIntakeLanguage('ar');
      setIntakeNotes('');
      await loadAllData();
      setTimeout(() => {
        setIsSubmitIntakeModalOpen(false);
        setIntakeFormSuccess(null);
      }, 1000);
    } catch (err: any) {
      setIntakeFormError(err.message || 'Failed to submit intake reference');
    } finally {
      setSubmittingIntake(false);
    }
  };

  const handleUpdateIntakeStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewingIntake) return;
    setSubmittingReview(true);
    setReviewModalError(null);
    try {
      await LibraryAdminClient.updateIntakeStatus(
        reviewingIntake.id,
        reviewTargetStatus,
        reviewEditorialNotes.trim() || undefined
      );
      await loadAllData();
      setReviewingIntake(null);
      setReviewEditorialNotes('');
    } catch (err: any) {
      setReviewModalError(err.message || 'Failed to update intake review status');
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleGenerateAiSuggestions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiPrepIntake) return;
    setGeneratingAiPrep(true);
    setAiPrepError(null);
    try {
      const updatedRecord = await LibraryAdminClient.generateIntakeAISuggestions(
        aiPrepIntake.id,
        aiPrepExcerpt.trim() || undefined
      );
      setAiPrepIntake(updatedRecord);
      await loadAllData();
    } catch (err: any) {
      setAiPrepError(err.message || (isAr ? 'تعذر توليد مقترحات الذكاء الاصطناعي' : 'Failed to generate AI preparation suggestions'));
    } finally {
      setGeneratingAiPrep(false);
    }
  };

  const getIntakeStatusBadge = (status: LibraryIntakeStatus) => {
    switch (status) {
      case LibraryIntakeStatus.PendingReview:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-800 flex items-center gap-1 w-fit">
            <Clock className="h-3 w-3" />
            <span>{isAr ? 'قيد المراجعة الأولية' : 'Pending Review'}</span>
          </span>
        );
      case LibraryIntakeStatus.InPreparation:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-300 dark:border-blue-800 flex items-center gap-1 w-fit">
            <CheckCircle2 className="h-3 w-3" />
            <span>{isAr ? 'قيد الإعداد والتوثيق' : 'In Preparation'}</span>
          </span>
        );
      case LibraryIntakeStatus.Rejected:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 dark:border-rose-800 flex items-center gap-1 w-fit">
            <AlertTriangle className="h-3 w-3" />
            <span>{isAr ? 'مستبعد / غير مطابق' : 'Rejected'}</span>
          </span>
        );
    }
  };

  const getRightsBadge = (status: LibraryRightsStatus) => {
    switch (status) {
      case 'OpenPubliclyAvailable':
      case 'PermissionGranted':
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1 w-fit">
            <ShieldCheck className="h-3 w-3" />
            <span>{status}</span>
          </span>
        );
      case 'ReviewRequired':
      case 'PermissionRequired':
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-800 flex items-center gap-1 w-fit">
            <AlertTriangle className="h-3 w-3" />
            <span>{status}</span>
          </span>
        );
      case 'Restricted':
      case 'NotRedistributable':
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-300 dark:border-rose-800 flex items-center gap-1 w-fit">
            <ShieldCheck className="h-3 w-3" />
            <span>{status}</span>
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-gray-300 dark:border-gray-700 flex items-center gap-1 w-fit">
            <Clock className="h-3 w-3" />
            <span>{status}</span>
          </span>
        );
    }
  };

  const getWorkflowBadge = (state: WorkflowState) => {
    switch (state) {
      case WorkflowState.Published:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
            {isAr ? 'منشور للجمهور' : 'Published'}
          </span>
        );
      case WorkflowState.Approved:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            {isAr ? 'معتمد تحريرياً' : 'Approved'}
          </span>
        );
      case WorkflowState.InReview:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
            {isAr ? 'قيد المراجعة' : 'In Review'}
          </span>
        );
      case WorkflowState.ChangesRequested:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-950/80 dark:text-orange-300 border border-orange-300 dark:border-orange-800">
            {isAr ? 'تعديلات مطلوبة' : 'Changes Requested'}
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border border-gray-300 dark:border-gray-700">
            {isAr ? 'مسودة إعداد' : 'Draft'}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6" dir={isAr ? 'rtl' : 'ltr'}>
      {/* Hero Header Banner */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-emerald-950 text-white rounded-2xl p-6 sm:p-8 shadow-md relative overflow-hidden border border-emerald-800/60">
        <div className="relative z-10 space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 text-emerald-300">
              <BookOpen className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                {isAr ? 'إدارة المكتبة البيئية والمعرفية' : 'Environmental Knowledge Library'}
              </h1>
              <p className="text-xs sm:text-sm text-emerald-100/90 max-w-2xl font-medium">
                {isAr 
                  ? 'مستودع موثق ومعتمد للتشريعات والاتفاقيات والتقارير البيئية، مفصل الأبعاد الحقوقية والتنظيمية.'
                  : 'Authenticated repository for environmental laws, treaties, policy papers, and institutional reports.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 text-xs sm:text-sm font-semibold">
        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-xs">{isAr ? 'إجمالي الوثائق' : 'Total Documents'}</p>
            <p className="text-lg font-extrabold text-gray-900 dark:text-gray-100">{documents.length}</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-400">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-xs">{isAr ? 'المؤسسات المعتمدة' : 'Verified Bodies'}</p>
            <p className="text-lg font-extrabold text-gray-900 dark:text-gray-100">{organizations.length}</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-teal-100 dark:bg-teal-950/80 text-teal-700 dark:text-teal-400">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-xs">{isAr ? 'المصادر المسجلة' : 'Registered Sources'}</p>
            <p className="text-lg font-extrabold text-gray-900 dark:text-gray-100">{sources.length}</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-400">
            <Inbox className="h-5 w-5" />
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-xs">{isAr ? 'مراجع الاستقبال' : 'Intake References'}</p>
            <p className="text-lg font-extrabold text-gray-900 dark:text-gray-100">{intakeRecords.length}</p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-xs flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-gray-500 dark:text-gray-400 text-xs">{isAr ? 'تدقيق الحقوق' : 'Rights Audits'}</p>
            <p className="text-lg font-extrabold text-gray-900 dark:text-gray-100">
              {documents.filter(d => d.rightsStatus === 'ReviewRequired' || d.rightsStatus === 'PermissionRequired').length}
            </p>
          </div>
        </div>
      </div>

      {/* Safety Principle Banner */}
      <div className="p-4 rounded-2xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/80 text-amber-900 dark:text-amber-200 flex items-start gap-3 text-xs sm:text-sm">
        <ShieldCheck className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h3 className="font-extrabold">
            {isAr ? 'مبدأ الاستقلالية الحقوقية والتوصيف القانوني في "وعد الكوكب"' : 'Promise of Planet Independent Rights & Legal Principle'}
          </h3>
          <p className="leading-relaxed text-xs opacity-90">
            {isAr 
              ? 'تدار حالات الاعتماد التحريري (Workflow) بشكل مستقل تماماً عن حالات الترخيص الحقوقي (Rights Status). لا تعتبر الوثائق المعتمدة صحفياً مبرأة الذمة حقوقياً لإعادة التوزيع إلا إذا كانت حالتها صريحة بـ (Permission Granted) أو (Open Publicly Available).'
              : 'Editorial Approval is strictly decoupled from Rights Clearance. Documents approved in workflow are NOT automatically cleared for redistribution without explicit rights clearance.'}
          </p>
        </div>
      </div>

      {/* Navigation Sub-Tabs: Documents | Organizations | Sources | Intake */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 text-xs sm:text-sm font-bold gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('documents')}
          className={`px-4 py-3 border-b-2 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'documents'
              ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400 font-extrabold'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>{isAr ? `وثائق المكتبة (${documents.length})` : `Documents (${documents.length})`}</span>
        </button>

        <button
          onClick={() => setActiveTab('organizations')}
          className={`px-4 py-3 border-b-2 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'organizations'
              ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400 font-extrabold'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Building2 className="h-4 w-4" />
          <span>{isAr ? `سجل المؤسسات والجهات (${organizations.length})` : `Organizations Registry (${organizations.length})`}</span>
        </button>

        <button
          onClick={() => setActiveTab('sources')}
          className={`px-4 py-3 border-b-2 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'sources'
              ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400 font-extrabold'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Database className="h-4 w-4" />
          <span>{isAr ? `سجل المصادر والمراجع (${sources.length})` : `Sources Registry (${sources.length})`}</span>
        </button>

        <button
          onClick={() => setActiveTab('intake')}
          className={`px-4 py-3 border-b-2 flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'intake'
              ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400 font-extrabold'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          <Inbox className="h-4 w-4" />
          <span>{isAr ? `سجل الاستقبال والإدخال الأولي (${intakeRecords.length})` : `Intake Inbox (${intakeRecords.length})`}</span>
        </button>
      </div>


      {/* ================= TAB 1: DOCUMENTS ================= */}
      {activeTab === 'documents' && (
        <div className="space-y-6">
          {/* Search & Multi-filter Controls */}
          <div data-responsive-guard className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4 w-full max-w-full min-w-0">
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between w-full min-w-0">
              {/* Search bar */}
              <div className="relative w-full sm:max-w-md min-w-0">
                <Search className="absolute right-3.5 rtl:right-3.5 ltr:left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder={isAr ? 'بحث في العنوان، الموضوع، أو الجهة المسؤولة...' : 'Search by title, topic, or organization...'}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-3 rtl:pl-3 ltr:pl-10 pr-10 rtl:pr-10 ltr:pr-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-xs sm:text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                />
              </div>

              {/* Add Document Action & Refresh */}
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={loadAllData}
                  className="p-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors cursor-pointer"
                  title={isAr ? 'تحديث القائمة' : 'Refresh list'}
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
                {canCreate && (
                  <button
                    onClick={handleCreateNew}
                    className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs sm:text-sm transition-all shadow-md flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{isAr ? 'إضافة وثيقة معرفية جديدة' : 'Add Knowledge Document'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Filters dropdown row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-gray-100 dark:border-gray-800/80 text-xs w-full min-w-0">
              <div>
                <label className="block font-bold mb-1 text-gray-600 dark:text-gray-400">
                  {isAr ? 'تصفية بنوع الوثيقة:' : 'Filter by Document Type:'}
                </label>
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                >
                  <option value="ALL">{isAr ? 'جميع أنواع الوثائق' : 'All Document Types'}</option>
                  {Object.values(LibraryDocumentType).map((dt) => (
                    <option key={dt} value={dt}>
                      {dt}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1 text-gray-600 dark:text-gray-400">
                  {isAr ? 'تصفية بالوضع الحقوقي:' : 'Filter by Rights Status:'}
                </label>
                <select
                  value={selectedRights}
                  onChange={(e) => setSelectedRights(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                >
                  <option value="ALL">{isAr ? 'جميع حالات الحقوق' : 'All Rights States'}</option>
                  {Object.values(LibraryRightsStatus).map((rs) => (
                    <option key={rs} value={rs}>
                      {rs}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1 text-gray-600 dark:text-gray-400">
                  {isAr ? 'تصفية بحالة الاعتماد:' : 'Filter by Workflow State:'}
                </label>
                <select
                  value={selectedWorkflow}
                  onChange={(e) => setSelectedWorkflow(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                >
                  <option value="ALL">{isAr ? 'جميع حالات الاعتماد' : 'All Workflow States'}</option>
                  {Object.values(WorkflowState).map((ws) => (
                    <option key={ws} value={ws}>
                      {ws}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Main Documents Table */}
          <div data-responsive-guard className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xs overflow-hidden w-full max-w-full min-w-0">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 flex justify-between items-center text-xs font-bold text-gray-700 dark:text-gray-300 w-full min-w-0">
              <span>
                {isAr ? `نتائج البحث والتوثيق (${filteredDocuments.length})` : `Catalog Results (${filteredDocuments.length})`}
              </span>
              {(searchQuery || selectedType !== 'ALL' || selectedRights !== 'ALL' || selectedWorkflow !== 'ALL') && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedType('ALL');
                    setSelectedRights('ALL');
                    setSelectedWorkflow('ALL');
                  }}
                  className="text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>{isAr ? 'إعادة ضبط الفلاتر' : 'Reset Filters'}</span>
                </button>
              )}
            </div>

            {loading ? (
              <div className="p-16 text-center text-gray-500 dark:text-gray-400 space-y-3">
                <Loader2 className="h-8 w-8 mx-auto animate-spin text-emerald-600" />
                <p className="font-bold text-sm">
                  {isAr ? 'جاري تحميل السجلات المعرفية من الخادم الآمن...' : 'Loading canonical library records from secure server...'}
                </p>
              </div>
            ) : error ? (
              <div className="p-12 text-center text-rose-600 dark:text-rose-400 space-y-3">
                <AlertTriangle className="h-10 w-10 mx-auto" />
                <p className="font-bold text-sm">{error}</p>
                <button
                  onClick={loadAllData}
                  className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-800 font-bold text-xs cursor-pointer"
                >
                  {isAr ? 'إعادة المحاولة' : 'Retry'}
                </button>
              </div>
            ) : filteredDocuments.length === 0 ? (
              <div className="p-12 text-center text-gray-500 dark:text-gray-400 space-y-3">
                <BookOpen className="h-10 w-10 mx-auto text-gray-300 dark:text-gray-700" />
                <p className="font-bold text-sm">
                  {isAr ? 'لم يتم العثور على وثائق بيئية تطابق شروط التصفية أو أن السجل فارغ.' : 'No knowledge documents found or catalog is empty.'}
                </p>
              </div>
            ) : (
              <>
                {/* Compact Cards List (< 1280px) */}
                <div className="block xl:hidden divide-y divide-gray-100 dark:divide-gray-800 w-full max-w-full min-w-0">
                  {filteredDocuments.map((doc) => (
                    <div key={doc.id} className="p-4 sm:p-5 space-y-3 hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors w-full max-w-full min-w-0">
                      <div className="space-y-1.5">
                        <h4 className="font-extrabold text-gray-900 dark:text-gray-100 text-sm leading-snug">
                          {isAr ? doc.titleAr : doc.titleEn}
                        </h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                          {isAr ? doc.summaryAr : doc.summaryEn}
                        </p>
                        <div className="flex flex-wrap gap-1.5 pt-1 text-[10px]">
                          <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-semibold">
                            📍 {isAr ? doc.geographyAr : doc.geographyEn}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-semibold">
                            🗓️ {doc.publicationDate}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          {doc.documentType}
                        </span>
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                          🏛️ {getOrganizationName(doc.organizationId)} • 📖 {getSourceName(doc.sourceId)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div>
                          <span className="text-[10px] font-bold text-gray-400 block mb-0.5">{isAr ? 'الوضع الحقوقي' : 'Rights Status'}</span>
                          {getRightsBadge(doc.rightsStatus)}
                        </div>
                        <div>
                          <span className="text-[10px] font-bold text-gray-400 block mb-0.5">{isAr ? 'حالة التحرير' : 'Editorial Workflow'}</span>
                          {getWorkflowBadge(doc.workflowState)}
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-end">
                        <button
                          onClick={() => {
                            setActiveModalDoc(doc);
                            setIsModalOpen(true);
                          }}
                          className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gray-100 hover:bg-emerald-100 dark:bg-gray-800 dark:hover:bg-emerald-950/60 text-gray-800 dark:text-gray-200 hover:text-emerald-700 dark:hover:text-emerald-300 font-bold text-xs transition-all border border-gray-200 dark:border-gray-700 inline-flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          <span>{isAr ? 'عرض وتعديل الوثيقة' : 'View / Edit Document'}</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop Table View (>= 1280px) */}
                <div className="hidden xl:block overflow-x-auto w-full max-w-full min-w-0">
                  <table className="w-full text-right rtl:text-right ltr:text-left text-xs sm:text-sm">
                    <thead className="bg-gray-50/80 dark:bg-gray-950/80 text-gray-500 dark:text-gray-400 font-extrabold uppercase border-b border-gray-100 dark:border-gray-800">
                      <tr>
                        <th className="p-3.5 sm:p-4">{isAr ? 'عنوان الوثيقة البيئية' : 'Document Title'}</th>
                        <th className="p-3.5 sm:p-4">{isAr ? 'النوع والمؤسسة' : 'Type & Entity'}</th>
                        <th className="p-3.5 sm:p-4">{isAr ? 'الوضع الحقوقي' : 'Rights Status'}</th>
                        <th className="p-3.5 sm:p-4">{isAr ? 'حالة التحرير' : 'Editorial Workflow'}</th>
                        <th className="p-3.5 sm:p-4 text-center">{isAr ? 'الإجراءات' : 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60 font-medium text-gray-800 dark:text-gray-200">
                      {filteredDocuments.map((doc) => (
                        <tr key={doc.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/40 transition-colors">
                          <td className="p-3.5 sm:p-4 max-w-xs sm:max-w-md">
                            <div className="space-y-1">
                              <p className="font-extrabold text-gray-900 dark:text-gray-100 text-xs sm:text-sm leading-snug">
                                {isAr ? doc.titleAr : doc.titleEn}
                              </p>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 line-clamp-1">
                                {isAr ? doc.summaryAr : doc.summaryEn}
                              </p>
                              <div className="flex flex-wrap gap-1.5 pt-1 text-[10px]">
                                <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-semibold">
                                  📍 {isAr ? doc.geographyAr : doc.geographyEn}
                                </span>
                                <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-semibold">
                                  🗓️ {doc.publicationDate}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="p-3.5 sm:p-4 whitespace-nowrap">
                            <div className="space-y-1">
                              <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 inline-block">
                                {doc.documentType}
                              </span>
                              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate max-w-[160px]">
                                🏛️ {getOrganizationName(doc.organizationId)}
                              </p>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-[160px]">
                                📖 {getSourceName(doc.sourceId)}
                              </p>
                            </div>
                          </td>

                          <td className="p-3.5 sm:p-4 whitespace-nowrap">
                            {getRightsBadge(doc.rightsStatus)}
                          </td>

                          <td className="p-3.5 sm:p-4 whitespace-nowrap">
                            {getWorkflowBadge(doc.workflowState)}
                          </td>

                          <td className="p-3.5 sm:p-4 whitespace-nowrap text-center">
                            <button
                              onClick={() => {
                                setActiveModalDoc(doc);
                                setIsModalOpen(true);
                              }}
                              className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-emerald-100 dark:bg-gray-800 dark:hover:bg-emerald-950/60 text-gray-800 dark:text-gray-200 hover:text-emerald-700 dark:hover:text-emerald-300 font-bold text-xs transition-all border border-gray-200 dark:border-gray-700 inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              <span>{isAr ? 'عرض وتعديل' : 'View / Edit'}</span>
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
        </div>
      )}

      {/* ================= TAB 2: ORGANIZATIONS REGISTRY ================= */}
      {activeTab === 'organizations' && (
        <div className="space-y-6">
          <div data-responsive-guard className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4 w-full max-w-full min-w-0">
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between w-full min-w-0">
              <div className="relative w-full sm:max-w-md min-w-0">
                <Search className="absolute right-3.5 rtl:right-3.5 ltr:left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder={isAr ? 'بحث في المؤسسات والجهات المسجلة...' : 'Search registered organizations...'}
                  value={orgSearchQuery}
                  onChange={(e) => setOrgSearchQuery(e.target.value)}
                  className="w-full pl-3 rtl:pl-3 ltr:pl-10 pr-10 rtl:pr-10 ltr:pr-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-xs sm:text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={loadAllData}
                  className="p-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors cursor-pointer"
                  title={isAr ? 'تحديث القائمة' : 'Refresh list'}
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
                {canRegisterRegistry && (
                  <button
                    onClick={() => {
                      setRegistryFormError(null);
                      setRegistryFormSuccess(null);
                      setIsOrgModalOpen(true);
                    }}
                    className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs sm:text-sm transition-all shadow-md flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{isAr ? 'تسجيل مؤسسة معتمدة جديدة' : 'Register New Organization'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div data-responsive-guard className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xs overflow-hidden w-full max-w-full min-w-0">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 flex justify-between items-center text-xs font-bold text-gray-700 dark:text-gray-300 w-full min-w-0">
              <span>
                {isAr ? `قائمة المؤسسات والجهات المعتمدة (${filteredOrganizations.length})` : `Authorized Bodies & Institutions (${filteredOrganizations.length})`}
              </span>
            </div>

            {loading ? (
              <div className="p-16 text-center text-gray-500 dark:text-gray-400 space-y-3">
                <Loader2 className="h-8 w-8 mx-auto animate-spin text-emerald-600" />
                <p className="font-bold text-sm">
                  {isAr ? 'جاري تحميل سجل المؤسسات من قاعدة البيانات...' : 'Loading organizations registry from database...'}
                </p>
              </div>
            ) : filteredOrganizations.length === 0 ? (
              <div className="p-12 text-center text-gray-500 dark:text-gray-400 space-y-3">
                <Building2 className="h-10 w-10 mx-auto text-gray-300 dark:text-gray-700" />
                <p className="font-bold text-sm">
                  {isAr ? 'لا توجد مؤسسات مسجلة حالياً في السجل المعتمد.' : 'No organizations currently registered in the database.'}
                </p>
                {canRegisterRegistry && (
                  <button
                    onClick={() => {
                      setRegistryFormError(null);
                      setRegistryFormSuccess(null);
                      setIsOrgModalOpen(true);
                    }}
                    className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-bold text-xs inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{isAr ? 'تسجيل مؤسسة الآن' : 'Register Organization Now'}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto w-full max-w-full min-w-0">
                <table className="w-full text-right rtl:text-right ltr:text-left text-xs sm:text-sm">
                  <thead className="bg-gray-50/80 dark:bg-gray-950/80 text-gray-500 dark:text-gray-400 font-extrabold uppercase border-b border-gray-100 dark:border-gray-800">
                    <tr>
                      <th className="p-3.5 sm:p-4">{isAr ? 'المعرف المؤسسي' : 'ID'}</th>
                      <th className="p-3.5 sm:p-4">{isAr ? 'اسم الجهة / المؤسسة' : 'Organization Name'}</th>
                      <th className="p-3.5 sm:p-4">{isAr ? 'النوع المؤسسي' : 'Type'}</th>
                      <th className="p-3.5 sm:p-4">{isAr ? 'الدولة / النطاق' : 'Country / Region'}</th>
                      <th className="p-3.5 sm:p-4">{isAr ? 'الموقع الإلكتروني' : 'Website'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60 font-medium text-gray-800 dark:text-gray-200">
                    {filteredOrganizations.map((org) => (
                      <tr key={org.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/40 transition-colors">
                        <td className="p-3.5 sm:p-4 font-mono text-[11px] text-gray-500">
                          {org.id}
                        </td>
                        <td className="p-3.5 sm:p-4">
                          <p className="font-extrabold text-gray-900 dark:text-gray-100 text-xs sm:text-sm leading-snug">
                            {isAr ? org.nameAr : org.nameEn}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            {isAr ? org.nameEn : org.nameAr}
                          </p>
                        </td>
                        <td className="p-3.5 sm:p-4 whitespace-nowrap">
                          <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                            {org.type}
                          </span>
                        </td>
                        <td className="p-3.5 sm:p-4 whitespace-nowrap text-xs">
                          📍 {isAr ? org.countryRegionAr : org.countryRegionEn}
                        </td>
                        <td className="p-3.5 sm:p-4 whitespace-nowrap text-xs">
                          {org.websiteUrl ? (
                            <a
                              href={org.websiteUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 font-semibold"
                            >
                              <span>{org.websiteUrl.replace(/^https?:\/\//, '')}</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 3: SOURCES REGISTRY ================= */}
      {activeTab === 'sources' && (
        <div className="space-y-6">
          <div data-responsive-guard className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4 w-full max-w-full min-w-0">
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between w-full min-w-0">
              <div className="relative w-full sm:max-w-md min-w-0">
                <Search className="absolute right-3.5 rtl:right-3.5 ltr:left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder={isAr ? 'بحث في المصادر والمراجع...' : 'Search registered sources...'}
                  value={sourceSearchQuery}
                  onChange={(e) => setSourceSearchQuery(e.target.value)}
                  className="w-full pl-3 rtl:pl-3 ltr:pl-10 pr-10 rtl:pr-10 ltr:pr-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-xs sm:text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={loadAllData}
                  className="p-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors cursor-pointer"
                  title={isAr ? 'تحديث القائمة' : 'Refresh list'}
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
                {canRegisterRegistry && (
                  <button
                    onClick={() => {
                      if (organizations.length === 0) {
                        alert(isAr ? 'يرجى تسجيل مؤسسة أولاً قبل إضافة مصدر' : 'Please register an organization first');
                        setActiveTab('organizations');
                        return;
                      }
                      setNewSourceOrgId(organizations[0]?.id || '');
                      setRegistryFormError(null);
                      setRegistryFormSuccess(null);
                      setIsSourceModalOpen(true);
                    }}
                    className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs sm:text-sm transition-all shadow-md flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{isAr ? 'تسجيل مصدر مرجعي جديد' : 'Register New Source'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div data-responsive-guard className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xs overflow-hidden w-full max-w-full min-w-0">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 flex justify-between items-center text-xs font-bold text-gray-700 dark:text-gray-300 w-full min-w-0">
              <span>
                {isAr ? `قائمة المصادر والمراجع المسجلة (${filteredSources.length})` : `Registered Sources & Origins (${filteredSources.length})`}
              </span>
            </div>

            {loading ? (
              <div className="p-16 text-center text-gray-500 dark:text-gray-400 space-y-3">
                <Loader2 className="h-8 w-8 mx-auto animate-spin text-emerald-600" />
                <p className="font-bold text-sm">
                  {isAr ? 'جاري تحميل سجل المصادر من قاعدة البيانات...' : 'Loading sources registry from database...'}
                </p>
              </div>
            ) : filteredSources.length === 0 ? (
              <div className="p-12 text-center text-gray-500 dark:text-gray-400 space-y-3">
                <Database className="h-10 w-10 mx-auto text-gray-300 dark:text-gray-700" />
                <p className="font-bold text-sm">
                  {isAr ? 'لا توجد مصادر مسجلة حالياً في السجل المعتمد.' : 'No sources currently registered in the database.'}
                </p>
                {canRegisterRegistry && (
                  <button
                    onClick={() => {
                      if (organizations.length === 0) {
                        alert(isAr ? 'يرجى تسجيل مؤسسة أولاً' : 'Please register an organization first');
                        setActiveTab('organizations');
                        return;
                      }
                      setNewSourceOrgId(organizations[0]?.id || '');
                      setRegistryFormError(null);
                      setRegistryFormSuccess(null);
                      setIsSourceModalOpen(true);
                    }}
                    className="px-4 py-2 rounded-xl bg-emerald-700 text-white font-bold text-xs inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{isAr ? 'تسجيل مصدر الآن' : 'Register Source Now'}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto w-full max-w-full min-w-0">
                <table className="w-full text-right rtl:text-right ltr:text-left text-xs sm:text-sm">
                  <thead className="bg-gray-50/80 dark:bg-gray-950/80 text-gray-500 dark:text-gray-400 font-extrabold uppercase border-b border-gray-100 dark:border-gray-800">
                    <tr>
                      <th className="p-3.5 sm:p-4">{isAr ? 'المعرف' : 'ID'}</th>
                      <th className="p-3.5 sm:p-4">{isAr ? 'اسم المصدر' : 'Source Name'}</th>
                      <th className="p-3.5 sm:p-4">{isAr ? 'الجهة المالكة' : 'Parent Organization'}</th>
                      <th className="p-3.5 sm:p-4">{isAr ? 'نوع المصدر' : 'Source Type'}</th>
                      <th className="p-3.5 sm:p-4">{isAr ? 'حالة التوثيق' : 'Verification'}</th>
                      <th className="p-3.5 sm:p-4">{isAr ? 'الرابط المرجعي' : 'URL'}</th>
                      {canManageRights && <th className="p-3.5 sm:p-4 text-center">{isAr ? 'إجراءات التدقيق' : 'Verification Action'}</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800/60 font-medium text-gray-800 dark:text-gray-200">
                    {filteredSources.map((src) => (
                      <tr key={src.id} className="hover:bg-gray-50/60 dark:hover:bg-gray-800/40 transition-colors">
                        <td className="p-3.5 sm:p-4 font-mono text-[11px] text-gray-500">
                          {src.id}
                        </td>
                        <td className="p-3.5 sm:p-4">
                          <p className="font-extrabold text-gray-900 dark:text-gray-100 text-xs sm:text-sm leading-snug">
                            {isAr ? src.sourceNameAr : src.sourceNameEn}
                          </p>
                          <p className="text-[11px] text-gray-400">
                            {isAr ? src.sourceNameEn : src.sourceNameAr}
                          </p>
                        </td>
                        <td className="p-3.5 sm:p-4 whitespace-nowrap text-xs font-semibold text-gray-700 dark:text-gray-300">
                          🏛️ {getOrganizationName(src.organizationId)}
                        </td>
                        <td className="p-3.5 sm:p-4 whitespace-nowrap">
                          <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                            {src.sourceType}
                          </span>
                        </td>
                        <td className="p-3.5 sm:p-4 whitespace-nowrap">
                          {getSourceVerificationBadge(src.verificationStatus)}
                        </td>
                        <td className="p-3.5 sm:p-4 whitespace-nowrap text-xs">
                          {src.sourceUrl ? (
                            <a
                              href={src.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-emerald-700 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 font-semibold"
                            >
                              <span>{src.sourceUrl.replace(/^https?:\/\//, '')}</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        {canManageRights && (
                          <td className="p-3.5 sm:p-4 whitespace-nowrap text-center">
                            {src.verificationStatus === 'PendingVerification' ? (
                              <button
                                onClick={() => handleVerifySource(src.id, 'Verified')}
                                className="px-3 py-1.5 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 text-xs font-extrabold transition-all border border-emerald-300 cursor-pointer inline-flex items-center gap-1"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>{isAr ? 'اعتماد كـ Verified' : 'Mark Verified'}</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => handleVerifySource(src.id, 'PendingVerification')}
                                className="px-3 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300 text-xs font-semibold transition-all border border-gray-300 cursor-pointer"
                              >
                                <span>{isAr ? 'تعليق التحقق' : 'Revoke Verification'}</span>
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 4: INTAKE INBOX ================= */}
      {activeTab === 'intake' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto flex-1">
                <div className="relative w-full sm:max-w-md">
                  <Search className="absolute right-3.5 rtl:right-3.5 ltr:left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder={isAr ? 'بحث في العنوان، الرابط، الملاحظات، أو الجهة...' : 'Search by title, URL, notes, or organization...'}
                    value={intakeSearchQuery}
                    onChange={(e) => setIntakeSearchQuery(e.target.value)}
                    className="w-full pl-3 rtl:pl-3 ltr:pl-10 pr-10 rtl:pr-10 ltr:pr-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-xs sm:text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>

                <select
                  value={intakeStatusFilter}
                  onChange={(e) => setIntakeStatusFilter(e.target.value)}
                  className="px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-xs sm:text-sm text-gray-900 dark:text-gray-100 outline-none"
                >
                  <option value="ALL">{isAr ? 'جميع الحالات' : 'All Statuses'}</option>
                  <option value={LibraryIntakeStatus.PendingReview}>{isAr ? 'قيد المراجعة الأولية' : 'Pending Review'}</option>
                  <option value={LibraryIntakeStatus.InPreparation}>{isAr ? 'قيد الإعداد والتوثيق' : 'In Preparation'}</option>
                  <option value={LibraryIntakeStatus.Rejected}>{isAr ? 'مستبعد / غير مطابق' : 'Rejected'}</option>
                </select>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={loadAllData}
                  className="p-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors cursor-pointer"
                  title={isAr ? 'تحديث سجل الاستقبال' : 'Refresh Intake Inbox'}
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
                {canSubmitIntake && (
                  <button
                    onClick={() => {
                      setIntakeFormError(null);
                      setIntakeFormSuccess(null);
                      setIsSubmitIntakeModalOpen(true);
                    }}
                    className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs sm:text-sm transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{isAr ? 'إيداع مرجع خارجي للاستقبال' : 'Submit Intake Reference'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xs overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-gray-500 flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
                <p className="text-xs sm:text-sm font-bold">{isAr ? 'جاري تحميل سجل الاستقبال...' : 'Loading intake inbox...'}</p>
              </div>
            ) : filteredIntakeRecords.length === 0 ? (
              <div className="p-12 text-center text-gray-500 space-y-2">
                <Inbox className="h-10 w-10 mx-auto text-gray-400 stroke-1" />
                <p className="font-bold text-sm">
                  {isAr ? 'لا توجد مراجع مودعة في سجل الاستقبال حالياً' : 'No intake references found in the inbox'}
                </p>
                <p className="text-xs text-gray-400">
                  {isAr
                    ? 'يمكنك إيداع روابط HTTPS لمراجع بيئية وتشريعية خارجية لمراجعتها وتحضيرها تحريرياً.'
                    : 'Submit HTTPS environmental reference links to track and prepare them before canonical library registration.'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right rtl:text-right ltr:text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-800 text-[11px] font-extrabold text-gray-500 uppercase tracking-wider">
                      <th className="p-3.5 sm:p-4">{isAr ? 'عنوان المرجع والرابط المؤمن' : 'Reference Title & HTTPS URL'}</th>
                      <th className="p-3.5 sm:p-4">{isAr ? 'الجهة / المصدر المرتبط' : 'Linked Organization / Source'}</th>
                      <th className="p-3.5 sm:p-4">{isAr ? 'اللغة والملاحظات' : 'Language & Notes'}</th>
                      <th className="p-3.5 sm:p-4">{isAr ? 'حالة المراجعة' : 'Intake Status'}</th>
                      <th className="p-3.5 sm:p-4">{isAr ? 'تتبع الإيداع والتدقيق' : 'Submission & Review Audit'}</th>
                      {(canReviewIntake || canPrepareAiIntake) && (
                        <th className="p-3.5 sm:p-4 text-center">{isAr ? 'إجراءات التحضير والمراجعة' : 'Preparation & Review Actions'}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-800 text-xs sm:text-sm">
                    {filteredIntakeRecords.map((rec) => (
                      <tr key={rec.id} className="hover:bg-gray-50/80 dark:hover:bg-gray-800/40 transition-colors">
                        <td className="p-3.5 sm:p-4 max-w-xs">
                          <div className="font-extrabold text-gray-900 dark:text-gray-100">{rec.title}</div>
                          <a
                            href={rec.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline font-bold text-xs mt-1 break-all"
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="truncate max-w-[240px]">{rec.normalizedUrl}</span>
                          </a>
                          <div className="text-[10px] text-gray-400 font-mono mt-0.5">{rec.id}</div>
                        </td>

                        <td className="p-3.5 sm:p-4">
                          <div className="space-y-1 text-xs">
                            {rec.organizationId ? (
                              <div className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1">
                                <Building2 className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                                <span>{getOrganizationName(rec.organizationId)}</span>
                              </div>
                            ) : (
                              <span className="text-gray-400 italic block">{isAr ? 'بدون مؤسسة مرتبطة' : 'No organization'}</span>
                            )}
                            {rec.sourceId && (
                              <div className="text-gray-600 dark:text-gray-400 flex items-center gap-1 text-[11px]">
                                <Database className="h-3 w-3 text-teal-600 shrink-0" />
                                <span>{getSourceName(rec.sourceId)}</span>
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="p-3.5 sm:p-4 max-w-xs">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-[11px] uppercase">
                              {rec.language}
                            </span>
                            {rec.aiSuggestion && (
                              <span className="px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950/70 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800 font-extrabold text-[10px] inline-flex items-center gap-1">
                                <Sparkles className="h-2.5 w-2.5" />
                                <span>{isAr ? 'مقترحات آلية (غير موثقة)' : 'AI Suggestions (Unverified)'}</span>
                              </span>
                            )}
                          </div>
                          {rec.notes && (
                            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 line-clamp-2">
                              {rec.notes}
                            </p>
                          )}
                          {rec.reviewNotes && (
                            <div className="mt-1.5 p-2 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/60 text-[11px] text-amber-900 dark:text-amber-300">
                              <span className="font-extrabold">{isAr ? 'ملاحظة المراجع: ' : 'Review Note: '}</span>
                              {rec.reviewNotes}
                            </div>
                          )}
                        </td>

                        <td className="p-3.5 sm:p-4 whitespace-nowrap">
                          {getIntakeStatusBadge(rec.status)}
                        </td>

                        <td className="p-3.5 sm:p-4 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap space-y-1">
                          <div>
                            <span className="font-bold text-gray-700 dark:text-gray-300">{isAr ? 'أودع بواسطة: ' : 'Submitted by: '}</span>
                            <span>{rec.submittedByAdminName}</span>
                          </div>
                          <div className="text-[11px] text-gray-400">
                            {new Date(rec.createdAt).toLocaleDateString(isAr ? 'ar-EG' : 'en-US')}
                          </div>
                          {rec.reviewedByAdminName && (
                            <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold">
                              {isAr ? `تحديث: ${rec.reviewedByAdminName}` : `Reviewed: ${rec.reviewedByAdminName}`}
                            </div>
                          )}
                        </td>

                        {(canReviewIntake || canPrepareAiIntake) && (
                          <td className="p-3.5 sm:p-4 whitespace-nowrap text-center">
                            <div className="flex flex-col sm:flex-row items-center justify-center gap-1.5">
                              {canPrepareAiIntake && (
                                <button
                                  onClick={() => {
                                    setAiPrepIntake(rec);
                                    setAiPrepExcerpt(rec.suppliedExcerpt || '');
                                    setAiPrepError(null);
                                  }}
                                  className="px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300 text-xs font-extrabold transition-all border border-purple-200 dark:border-purple-800 cursor-pointer inline-flex items-center gap-1"
                                >
                                  <Sparkles className="h-3.5 w-3.5" />
                                  <span>{isAr ? 'إعداد مقترحات الذكاء الاصطناعي' : 'Generate AI Preparation Suggestions'}</span>
                                </button>
                              )}
                              {canReviewIntake && (
                                <button
                                  onClick={() => {
                                    setReviewingIntake(rec);
                                    setReviewTargetStatus(rec.status);
                                    setReviewEditorialNotes(rec.reviewNotes || '');
                                    setReviewModalError(null);
                                  }}
                                  className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 text-xs font-extrabold transition-all border border-indigo-200 dark:border-indigo-800 cursor-pointer inline-flex items-center gap-1"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                  <span>{isAr ? 'تحديث الحالة' : 'Review Status'}</span>
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= REGISTER ORGANIZATION MODAL ================= */}
      {isOrgModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-emerald-600" />
                <h3 className="font-extrabold text-sm sm:text-base text-gray-900 dark:text-gray-100">
                  {isAr ? 'تسجيل مؤسسة أو جهة معتمدة جديدة' : 'Register New Authorized Organization'}
                </h3>
              </div>
              <button
                onClick={() => setIsOrgModalOpen(false)}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {registryFormError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold">
                {registryFormError}
              </div>
            )}

            {registryFormSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                <span>{registryFormSuccess}</span>
              </div>
            )}

            <form onSubmit={handleRegisterOrganization} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                  {isAr ? 'اسم المؤسسة / الجهة بالعربية *' : 'Organization Name (Arabic) *'}
                </label>
                <input
                  type="text"
                  required
                  value={newOrgNameAr}
                  onChange={(e) => setNewOrgNameAr(e.target.value)}
                  placeholder={isAr ? 'مثال: وزارة البيئة والتنمية المستدامة' : 'e.g. Ministry of Environment'}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                  {isAr ? 'اسم المؤسسة بالإنجليزية *' : 'Organization Name (English) *'}
                </label>
                <input
                  type="text"
                  required
                  value={newOrgNameEn}
                  onChange={(e) => setNewOrgNameEn(e.target.value)}
                  placeholder="e.g. Ministry of Environment"
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'النوع المؤسسي *' : 'Organization Type *'}
                  </label>
                  <select
                    value={newOrgType}
                    onChange={(e: any) => setNewOrgType(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                  >
                    <option value="Ministry">{isAr ? 'وزارة حكومية' : 'Ministry'}</option>
                    <option value="InternationalBody">{isAr ? 'منظمة دولية' : 'International Body'}</option>
                    <option value="ResearchCenter">{isAr ? 'مركز أبحاث' : 'Research Center'}</option>
                    <option value="NGO">{isAr ? 'منظمة غير حكومية' : 'NGO'}</option>
                    <option value="Judicial">{isAr ? 'جهة قضائية' : 'Judicial'}</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'رابط الموقع الرسمي' : 'Website URL'}
                  </label>
                  <input
                    type="url"
                    value={newOrgWebsite}
                    onChange={(e) => setNewOrgWebsite(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'الدولة / الإقليم بالعربية *' : 'Country / Region (Arabic) *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={newOrgCountryAr}
                    onChange={(e) => setNewOrgCountryAr(e.target.value)}
                    placeholder={isAr ? 'مصر / المنطقة العربية' : 'Egypt & Arab Region'}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'الدولة / الإقليم بالإنجليزية *' : 'Country / Region (English) *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={newOrgCountryEn}
                    onChange={(e) => setNewOrgCountryEn(e.target.value)}
                    placeholder="Egypt & Arab Region"
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsOrgModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold cursor-pointer"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submittingRegistry}
                  className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {submittingRegistry && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{isAr ? 'حفظ وتسجيل المؤسسة' : 'Register Organization'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= REGISTER SOURCE MODAL ================= */}
      {isSourceModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-teal-600" />
                <h3 className="font-extrabold text-sm sm:text-base text-gray-900 dark:text-gray-100">
                  {isAr ? 'تسجيل مصدر مرجعي جديد' : 'Register New Knowledge Source'}
                </h3>
              </div>
              <button
                onClick={() => setIsSourceModalOpen(false)}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {registryFormError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold">
                {registryFormError}
              </div>
            )}

            {registryFormSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                <span>{registryFormSuccess}</span>
              </div>
            )}

            <form onSubmit={handleRegisterSource} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                  {isAr ? 'المؤسسة المعتمدة التابع لها المصدر *' : 'Parent Organization *'}
                </label>
                <select
                  required
                  value={newSourceOrgId}
                  onChange={(e) => setNewSourceOrgId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                >
                  <option value="">{isAr ? '-- اختر المؤسسة --' : '-- Select Organization --'}</option>
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {isAr ? org.nameAr : org.nameEn} ({org.type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                  {isAr ? 'اسم المصدر بالعربية *' : 'Source Name (Arabic) *'}
                </label>
                <input
                  type="text"
                  required
                  value={newSourceNameAr}
                  onChange={(e) => setNewSourceNameAr(e.target.value)}
                  placeholder={isAr ? 'مثال: الجريدة الرسمية - الوقائع المصرية' : 'e.g. Official Gazette'}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                  {isAr ? 'اسم المصدر بالإنجليزية *' : 'Source Name (English) *'}
                </label>
                <input
                  type="text"
                  required
                  value={newSourceNameEn}
                  onChange={(e) => setNewSourceNameEn(e.target.value)}
                  placeholder="e.g. Official Gazette"
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'نوع المصدر *' : 'Source Type *'}
                  </label>
                  <select
                    value={newSourceType}
                    onChange={(e: any) => setNewSourceType(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                  >
                    <option value="OfficialGazette">{isAr ? 'جريدة رسمية' : 'Official Gazette'}</option>
                    <option value="GovernmentPortal">{isAr ? 'بوابة حكومية' : 'Government Portal'}</option>
                    <option value="AcademicJournal">{isAr ? 'مجلة أكاديمية' : 'Academic Journal'}</option>
                    <option value="InstitutionalArchive">{isAr ? 'مستودع مؤسسي' : 'Institutional Archive'}</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'حالة التوثيق الأولية' : 'Verification Status'}
                  </label>
                  {canManageRights ? (
                    <select
                      value={newSourceStatus}
                      onChange={(e: any) => setNewSourceStatus(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                    >
                      <option value="PendingVerification">{isAr ? 'قيد التحقق' : 'Pending Verification'}</option>
                      <option value="Verified">{isAr ? 'موثق ومعتمد' : 'Verified'}</option>
                      <option value="ThirdPartyIndex">{isAr ? 'فهرس خارجي' : 'Third-Party Index'}</option>
                    </select>
                  ) : (
                    <div className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-500 font-semibold text-xs">
                      {isAr ? 'قيد التحقق (يتطلب صلاحية ManageRights)' : 'Pending Verification (Requires ManageRights)'}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                  {isAr ? 'رابط المصدر المباشر' : 'Source URL'}
                </label>
                <input
                  type="url"
                  value={newSourceUrl}
                  onChange={(e) => setNewSourceUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                />
              </div>

              <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsSourceModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold cursor-pointer"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submittingRegistry}
                  className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {submittingRegistry && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{isAr ? 'حفظ وتسجيل المصدر' : 'Register Source'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= SUBMIT INTAKE REFERENCE MODAL ================= */}
      {isSubmitIntakeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
              <div className="flex items-center gap-2">
                <Inbox className="h-5 w-5 text-emerald-600" />
                <h3 className="font-extrabold text-sm sm:text-base text-gray-900 dark:text-gray-100">
                  {isAr ? 'إيداع مرجع خارجي في سجل الاستقبال' : 'Submit External Reference to Intake Inbox'}
                </h3>
              </div>
              <button
                onClick={() => setIsSubmitIntakeModalOpen(false)}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {intakeFormError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold">
                {intakeFormError}
              </div>
            )}

            {intakeFormSuccess && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                <span>{intakeFormSuccess}</span>
              </div>
            )}

            <form onSubmit={handleSubmitIntake} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                  {isAr ? 'عنوان الوثيقة أو المرجع الأولي *' : 'Initial Document / Reference Title *'}
                </label>
                <input
                  type="text"
                  required
                  value={intakeTitle}
                  onChange={(e) => setIntakeTitle(e.target.value)}
                  placeholder={isAr ? 'مثال: اللائحة التنفيذية لقانون تنظيم إدارة المخلفات' : 'e.g. Executive Regulation of Waste Management Law'}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                />
              </div>

              <div>
                <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                  {isAr ? 'رابط المرجع الخارجي المؤمن (HTTPS فقط) *' : 'External Reference URL (HTTPS only) *'}
                </label>
                <input
                  type="url"
                  required
                  value={intakeUrl}
                  onChange={(e) => setIntakeUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'المؤسسة المصدرة (اختياري)' : 'Organization (Optional)'}
                  </label>
                  <select
                    value={intakeOrgId}
                    onChange={(e) => {
                      setIntakeOrgId(e.target.value);
                      setIntakeSourceId('');
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                  >
                    <option value="">{isAr ? '-- غير محدد --' : '-- Unspecified --'}</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {isAr ? org.nameAr : org.nameEn}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                    {isAr ? 'المصدر المرجعي (اختياري)' : 'Source (Optional)'}
                  </label>
                  <select
                    value={intakeSourceId}
                    onChange={(e) => setIntakeSourceId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                  >
                    <option value="">{isAr ? '-- غير محدد --' : '-- Unspecified --'}</option>
                    {sources
                      .filter((s) => !intakeOrgId || s.organizationId === intakeOrgId)
                      .map((src) => (
                        <option key={src.id} value={src.id}>
                          {isAr ? src.sourceNameAr : src.sourceNameEn}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                  {isAr ? 'لغة الوثيقة الأصلية' : 'Original Document Language'}
                </label>
                <select
                  value={intakeLanguage}
                  onChange={(e: any) => setIntakeLanguage(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                >
                  <option value="ar">{isAr ? 'العربية (ar)' : 'Arabic (ar)'}</option>
                  <option value="en">{isAr ? 'الإنجليزية (en)' : 'English (en)'}</option>
                  <option value="bilingual">{isAr ? 'ثنائية اللغة (bilingual)' : 'Bilingual'}</option>
                  <option value="other">{isAr ? 'أخرى (other)' : 'Other'}</option>
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                  {isAr ? 'ملاحظات التحضير والوصف المرجعي' : 'Preparation & Context Notes'}
                </label>
                <textarea
                  rows={3}
                  value={intakeNotes}
                  onChange={(e) => setIntakeNotes(e.target.value)}
                  placeholder={isAr ? 'ملاحظات أولية حول سياق المرجع، رقم القانون، أو ضوابط المراجعة الحقوقية...' : 'Initial context notes, decree number, or rights considerations...'}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                />
              </div>

              <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsSubmitIntakeModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold cursor-pointer"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submittingIntake}
                  className="px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {submittingIntake && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{isAr ? 'إيداع في سجل الاستقبال' : 'Submit Reference'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= REVIEW INTAKE STATUS MODAL ================= */}
      {reviewingIntake && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-indigo-600" />
                <h3 className="font-extrabold text-sm sm:text-base text-gray-900 dark:text-gray-100">
                  {isAr ? 'مراجعة وتحديث حالة مرجع الاستقبال' : 'Review & Update Intake Reference Status'}
                </h3>
              </div>
              <button
                onClick={() => setReviewingIntake(null)}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800 text-xs space-y-1">
              <div className="font-extrabold text-gray-900 dark:text-gray-100">{reviewingIntake.title}</div>
              <div className="text-emerald-700 dark:text-emerald-400 break-all font-mono text-[11px]">{reviewingIntake.normalizedUrl}</div>
            </div>

            {reviewModalError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold">
                {reviewModalError}
              </div>
            )}

            <form onSubmit={handleUpdateIntakeStatus} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                  {isAr ? 'حالة المراجعة والتحضير *' : 'Intake Review Status *'}
                </label>
                <select
                  value={reviewTargetStatus}
                  onChange={(e: any) => setReviewTargetStatus(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                >
                  <option value={LibraryIntakeStatus.PendingReview}>
                    {isAr ? 'قيد المراجعة الأولية (PendingReview)' : 'Pending Review'}
                  </option>
                  <option value={LibraryIntakeStatus.InPreparation}>
                    {isAr ? 'قيد الإعداد والتوثيق (InPreparation)' : 'In Preparation'}
                  </option>
                  <option value={LibraryIntakeStatus.Rejected}>
                    {isAr ? 'مستبعد / غير مطابق (Rejected)' : 'Rejected'}
                  </option>
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1 text-gray-700 dark:text-gray-300">
                  {isAr ? 'ملاحظات المراجع التحريري / الحقوقي' : 'Editorial / Rights Review Notes'}
                </label>
                <textarea
                  rows={3}
                  value={reviewEditorialNotes}
                  onChange={(e) => setReviewEditorialNotes(e.target.value)}
                  placeholder={isAr ? 'سجل سبب القرار أو توجيهات استكمال البيانات المعرفية...' : 'Record review rationale or cataloging preparation instructions...'}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                />
              </div>

              <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReviewingIntake(null)}
                  className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold cursor-pointer"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submittingReview}
                  className="px-5 py-2 rounded-xl bg-indigo-700 hover:bg-indigo-800 text-white font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {submittingReview && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>{isAr ? 'حفظ قرار المراجعة' : 'Save Review Decision'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= HUMAN-TRIGGERED AI PREPARATION ASSISTANT MODAL ================= */}
      {aiPrepIntake && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-600" />
                <div>
                  <h3 className="font-extrabold text-sm sm:text-base text-gray-900 dark:text-gray-100">
                    {isAr
                      ? 'مساعد الإعداد التحريري بالذكاء الاصطناعي (مراجعة بشرية إلزامية)'
                      : 'Human-Reviewed AI Preparation Assistant'}
                  </h3>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {isAr
                      ? 'توليد مقترحات استرشادية غير موثقة لسجل الاستقبال دون أي ترقية أو نشر تلقائي.'
                      : 'Generates unverified advisory recommendations for an intake record without automatic promotion or publication.'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAiPrepIntake(null)}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Canonical Intake Summary Box */}
            <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800 text-xs space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-extrabold text-gray-900 dark:text-gray-100">{aiPrepIntake.title}</span>
                {getIntakeStatusBadge(aiPrepIntake.status)}
              </div>
              <div className="text-emerald-700 dark:text-emerald-400 break-all font-mono text-[11px]">
                {aiPrepIntake.normalizedUrl}
              </div>
              {aiPrepIntake.notes && (
                <p className="text-gray-600 dark:text-gray-400 text-[11px]">
                  <span className="font-bold">{isAr ? 'ملاحظات الإيداع: ' : 'Intake Notes: '}</span>
                  {aiPrepIntake.notes}
                </p>
              )}
            </div>

            {aiPrepError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold">
                {aiPrepError}
              </div>
            )}

            {/* Trigger Form with Optional Excerpt */}
            <form onSubmit={handleGenerateAiSuggestions} className="space-y-3 text-xs border border-purple-200/70 dark:border-purple-900/60 rounded-xl p-4 bg-purple-50/30 dark:bg-purple-950/15">
              <div>
                <label className="block font-bold mb-1 text-gray-800 dark:text-gray-200">
                  {isAr
                    ? 'مقتطف نصي أو مستخلص من الوثيقة (اختياري — بحد أقصى 12,000 حرف)'
                    : 'Admin-Supplied Document Excerpt / Abstract (Optional — Max 12,000 chars)'}
                </label>
                <textarea
                  rows={3}
                  maxLength={12000}
                  value={aiPrepExcerpt}
                  onChange={(e) => setAiPrepExcerpt(e.target.value)}
                  placeholder={
                    isAr
                      ? 'ألصق هنا ديباجة القانون أو مستخلص التقرير في حال رغبتك بتوليد ملخص تحريري مقترح. في حال ترك هذا الحقل فارغاً سيعمل المساعد بوضع (البيانات الوصفية فقط MetadataOnly) ولن يولّد ملخصاً لوثيقة لم يُقرأ نصها.'
                      : 'Paste an official abstract or legal preamble here if you want bilingual summary suggestions. If left blank, the assistant runs in MetadataOnly mode and will NOT fabricate a summary of an unread document.'
                  }
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none"
                />
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  {aiPrepExcerpt.trim().length > 0
                    ? isAr
                      ? `أساس الإدخال الحالي: مقتطف نصي + بيانات وصفية (SuppliedExcerptAndMetadata — ${aiPrepExcerpt.trim().length} حرف)`
                      : `Current Input Basis: SuppliedExcerptAndMetadata (${aiPrepExcerpt.trim().length} chars)`
                    : isAr
                      ? 'أساس الإدخال الحالي: بيانات وصفية فقط (MetadataOnly — بدون قراءة نص الوثيقة الخارجي أو توليد ملخص)'
                      : 'Current Input Basis: MetadataOnly (no external document body read; summary generation disabled)'}
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="submit"
                  disabled={generatingAiPrep}
                  className="px-4 py-2 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {generatingAiPrep ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  <span>
                    {isAr ? 'إعداد مقترحات الذكاء الاصطناعي' : 'Generate AI Preparation Suggestions'}
                  </span>
                </button>
              </div>
            </form>

            {/* Persisted AI Suggestion Display */}
            {aiPrepIntake.aiSuggestion && (
              <div className="space-y-4 pt-2">
                {/* Mandatory Unverified Machine-Generated Warning Banner */}
                <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs space-y-1">
                  <div className="font-extrabold flex items-center gap-1.5">
                    <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    <span>
                      {isAr
                        ? 'مقترحات آلية غير موثقة — تتطلب مراجعة واعتماداً بشرياً'
                        : 'Unverified Machine-Generated Recommendations — Requires Human Review'}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    {isAr
                      ? aiPrepIntake.aiSuggestion.verificationWarningAr
                      : aiPrepIntake.aiSuggestion.verificationWarningEn}
                  </p>
                  <div className="flex flex-wrap gap-3 pt-1 text-[10px] font-mono text-amber-800 dark:text-amber-300">
                    <span>Model: {aiPrepIntake.aiSuggestion.modelId}</span>
                    <span>Basis: {aiPrepIntake.aiSuggestion.inputBasis}</span>
                    <span>By: {aiPrepIntake.aiSuggestion.generatedByAdminName}</span>
                    <span>At: {new Date(aiPrepIntake.aiSuggestion.generatedAt).toLocaleString(isAr ? 'ar-EG' : 'en-US')}</span>
                  </div>
                </div>

                {/* Suggested Bibliographic & Classification Fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase">
                      {isAr ? 'العنوان المقترح (عربي)' : 'Suggested Title (Arabic)'}
                    </span>
                    <p className="font-extrabold text-gray-900 dark:text-gray-100 select-all">
                      {aiPrepIntake.aiSuggestion.suggestedTitleAr}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase">
                      {isAr ? 'العنوان المقترح (إنجليزي)' : 'Suggested Title (English)'}
                    </span>
                    <p className="font-extrabold text-gray-900 dark:text-gray-100 select-all">
                      {aiPrepIntake.aiSuggestion.suggestedTitleEn}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase">
                      {isAr ? 'الجهة المصدرة المقترحة' : 'Suggested Issuing Organization'}
                    </span>
                    <p className="font-bold text-gray-800 dark:text-gray-200 select-all">
                      {aiPrepIntake.aiSuggestion.suggestedIssuingOrganization}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase">
                      {isAr ? 'نوع الوثيقة المقترح' : 'Suggested Document Type'}
                    </span>
                    <p className="font-extrabold text-emerald-700 dark:text-emerald-400">
                      {aiPrepIntake.aiSuggestion.suggestedDocumentType}
                    </p>
                  </div>
                </div>

                {/* Domains & Topics */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1.5">
                    <span className="text-[10px] font-bold text-gray-500 uppercase block">
                      {isAr ? 'المجالات البيئية المقترحة' : 'Suggested Environmental Domains'}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {aiPrepIntake.aiSuggestion.suggestedEnvironmentalDomains.map((dom, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-bold text-[11px]">
                          {dom}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1.5">
                    <span className="text-[10px] font-bold text-gray-500 uppercase block">
                      {isAr ? 'الكلمات المفتاحية (عربي)' : 'Suggested Topics (Arabic)'}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {aiPrepIntake.aiSuggestion.suggestedTopicsAr.map((t, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 font-bold text-[11px]">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1.5">
                    <span className="text-[10px] font-bold text-gray-500 uppercase block">
                      {isAr ? 'الكلمات المفتاحية (إنجليزي)' : 'Suggested Topics (English)'}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {aiPrepIntake.aiSuggestion.suggestedTopicsEn.map((t, idx) => (
                        <span key={idx} className="px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300 font-bold text-[11px]">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Conditional Bilingual Summaries vs Metadata-Only Truthfulness Notice */}
                {aiPrepIntake.aiSuggestion.inputBasis === LibraryIntakeAIInputBasis.SuppliedExcerptAndMetadata &&
                (aiPrepIntake.aiSuggestion.suggestedSummaryAr || aiPrepIntake.aiSuggestion.suggestedSummaryEn) ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1">
                      <span className="text-[10px] font-bold text-gray-500 uppercase block">
                        {isAr ? 'الملخص المقترح من المقتطف (عربي)' : 'Suggested Excerpt Summary (Arabic)'}
                      </span>
                      <p className="text-gray-800 dark:text-gray-200 leading-relaxed select-all">
                        {aiPrepIntake.aiSuggestion.suggestedSummaryAr}
                      </p>
                    </div>
                    <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1">
                      <span className="text-[10px] font-bold text-gray-500 uppercase block">
                        {isAr ? 'الملخص المقترح من المقتطف (إنجليزي)' : 'Suggested Excerpt Summary (English)'}
                      </span>
                      <p className="text-gray-800 dark:text-gray-200 leading-relaxed select-all">
                        {aiPrepIntake.aiSuggestion.suggestedSummaryEn}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100/70 dark:bg-gray-800/50 text-xs text-gray-600 dark:text-gray-400">
                    <span className="font-extrabold">
                      {isAr ? 'ملاحظة النزاهة التحريرية للملخص: ' : 'Summary Truthfulness Notice: '}
                    </span>
                    {isAr
                      ? 'لم يتم توليد ملخص عربي أو إنجليزي لأن الإدخال اعتمد على البيانات الوصفية فقط (MetadataOnly) دون تزويد مقتطف نصي من الوثيقة.'
                      : 'No Arabic/English document summary was generated because inputBasis is MetadataOnly and the remote document body/PDF was not read.'}
                  </div>
                )}

                {/* Provenance Observations & Uncertainty Notices */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1.5">
                    <span className="text-[10px] font-bold text-gray-500 uppercase block">
                      {isAr ? 'ملاحظات المصدر والأصل المرجعي' : 'Provenance & Source Observations'}
                    </span>
                    <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                      {(isAr
                        ? aiPrepIntake.aiSuggestion.provenanceObservationsAr
                        : aiPrepIntake.aiSuggestion.provenanceObservationsEn
                      ).map((obs, idx) => (
                        <li key={idx}>{obs}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 space-y-1.5">
                    <span className="text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase block">
                      {isAr ? 'تنبيهات عدم اليقين والتحقق البشري' : 'Uncertainty & Verification Notices'}
                    </span>
                    <ul className="list-disc list-inside space-y-1 text-amber-900 dark:text-amber-200">
                      {(isAr
                        ? aiPrepIntake.aiSuggestion.uncertaintyNoticesAr
                        : aiPrepIntake.aiSuggestion.uncertaintyNoticesEn
                      ).map((notice, idx) => (
                        <li key={idx}>{notice}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex justify-end">
              <button
                type="button"
                onClick={() => setAiPrepIntake(null)}
                className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-xs cursor-pointer"
              >
                {isAr ? 'إغلاق نافذة التحضير' : 'Close Preparation Assistant'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Editor & Detail Modal */}
      <LibraryDocumentEditorModal
        document={activeModalDoc}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          loadAllData();
        }}
        onSave={handleSaveDocument}
        organizations={organizations}
        sources={sources}
        currentUser={currentUser}
      />
    </div>
  );
}

