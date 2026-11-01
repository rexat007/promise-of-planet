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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tab View State: 'documents' | 'organizations' | 'sources'
  const [activeTab, setActiveTab] = useState<'documents' | 'organizations' | 'sources'>('documents');

  // Filter States for Documents
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [selectedRights, setSelectedRights] = useState<string>('ALL');
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('ALL');

  // Search Filter for Organizations & Sources
  const [orgSearchQuery, setOrgSearchQuery] = useState('');
  const [sourceSearchQuery, setSourceSearchQuery] = useState('');

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

  // Registry Action Feedback State
  const [submittingRegistry, setSubmittingRegistry] = useState(false);
  const [registryFormError, setRegistryFormError] = useState<string | null>(null);
  const [registryFormSuccess, setRegistryFormSuccess] = useState<string | null>(null);

  const canCreate = AdminAccessService.hasPermission(currentUser, AdminPermission.Create);
  const canManageRights = AdminAccessService.hasPermission(currentUser, AdminPermission.ManageRights);
  const canRegisterRegistry = canCreate || canManageRights;

  const loadAllData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!LibraryAdminClient.isBackendAvailable() || !LibraryAdminClient.isAuthenticated()) {
        setError(isAr ? 'الخادم غير متصل أو لم يتم تسجيل الدخول كمسؤول' : 'Backend unconfigured or unauthenticated session.');
        setDocuments([]);
        setOrganizations([]);
        setSources([]);
        setLoading(false);
        return;
      }
      const [remoteDocs, remoteOrgs, remoteSources] = await Promise.all([
        LibraryAdminClient.listAll(),
        LibraryAdminClient.listOrganizations(),
        LibraryAdminClient.listSources(),
      ]);
      setDocuments(remoteDocs);
      setOrganizations(remoteOrgs);
      setSources(remoteSources);
    } catch (err: any) {
      setError(err.message || 'Failed to load library data');
      setDocuments([]);
      setOrganizations([]);
      setSources([]);
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs sm:text-sm font-semibold">
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

      {/* Navigation Sub-Tabs: Documents | Organizations | Sources */}
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
