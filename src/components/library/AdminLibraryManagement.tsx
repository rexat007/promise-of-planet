import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
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
  Lock,
  X
} from 'lucide-react';
import type { AdminUser } from '../../types/admin';
import {
  AdminDomain,
  AdminPermission,
  AdminRole,
  hasDomainResponsibility,
} from '../../types/admin';
import { WorkflowState } from '../../types/workflow';
import { AdminAccessService } from '../../services/adminAccess';
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
  type LibraryIntakeRecord 
} from '../../../functions/src/shared/libraryContract';
import { LibraryDocumentEditorModal } from './LibraryDocumentEditorModal';
import { LibraryQuarantineUploadPanel } from './LibraryQuarantineUploadPanel';
import {
  canUploadToLibraryQuarantine,
  LibraryQuarantineUploadSessionController,
  type LibraryQuarantineUploadRuntimeDependencies,
} from '../../services/libraryQuarantineUploadClient';
import {
  LibraryAdminClient,
  AITaskStatus,
  PEIALibraryPreparationInputBasis,
  type SanitizedLibraryIntakePeiaPreparationStatusDto,
  type GetLibraryIntakePeiaPreparationStatusResponseDto,
  type RequestLibraryIntakePeiaPreparationResponseDto,
  type PeiaTaskEnqueueDisposition,
} from '../../services/libraryAdminClient';

const LIBRARY_INTAKE_PEIA_REQUIRED_ANY_PERMISSIONS: readonly AdminPermission[] = Object.freeze([
  AdminPermission.Create,
  AdminPermission.Edit,
  AdminPermission.Review,
  AdminPermission.Approve,
  AdminPermission.ManageRights,
]);

/**
 * Canonical role & permission check for Library Intake PEIA preparation actions.
 * Matches server-side `requireLibraryEditorialCurationAccess` in `libraryAdminHandlers.ts`:
 * - Active human admin (`isActive === true` and `role !== AdminRole.AIAssistant`)
 * - Library domain responsibility (`Owner`, `LibraryCurator`) or narrow `RightsReviewer` exception
 * - At least one of `Create`, `Edit`, `Review`, `Approve`, `ManageRights`
 */
export function canAccessLibraryIntakePeiaPreparation(
  user: AdminUser | null | undefined
): boolean {
  if (!user || user.isActive !== true) {
    return false;
  }
  if (user.role === AdminRole.AIAssistant) {
    return false;
  }
  const hasLibraryDomainAccess =
    hasDomainResponsibility(user.role, AdminDomain.Library) ||
    user.role === AdminRole.RightsReviewer;
  if (!hasLibraryDomainAccess) {
    return false;
  }
  return LIBRARY_INTAKE_PEIA_REQUIRED_ANY_PERMISSIONS.some((perm) =>
    AdminAccessService.hasPermission(user, perm)
  );
}

/**
 * Checks whether the current user can request a new PEIA preparation task for a specific intake record.
 * Rejected intake records are not eligible for PEIA task queueing.
 */
export function canRequestLibraryIntakePeiaForRecord(
  user: AdminUser | null | undefined,
  record: Pick<LibraryIntakeRecord, 'status'> | null | undefined
): boolean {
  if (!canAccessLibraryIntakePeiaPreparation(user)) {
    return false;
  }
  if (!record || record.status === LibraryIntakeStatus.Rejected) {
    return false;
  }
  return true;
}

export interface LibraryIntakePeiaVersionMismatchNotice {
  readonly previousUpdatedAt: string;
  readonly refreshedUpdatedAt: string;
}

export interface LibraryIntakePeiaModalSnapshot {
  readonly activeIntake: LibraryIntakeRecord | null;
  readonly peiaStatus: SanitizedLibraryIntakePeiaPreparationStatusDto | null;
  readonly loadingStatus: boolean;
  readonly requestingPrep: boolean;
  readonly peiaError: string | null;
  readonly lastEnqueueDisposition: PeiaTaskEnqueueDisposition | null;
  readonly versionMismatchNotice: LibraryIntakePeiaVersionMismatchNotice | null;
  readonly sessionToken: number;
}

export function createInitialLibraryIntakePeiaModalSnapshot(
  sessionToken = 0
): LibraryIntakePeiaModalSnapshot {
  return {
    activeIntake: null,
    peiaStatus: null,
    loadingStatus: false,
    requestingPrep: false,
    peiaError: null,
    lastEnqueueDisposition: null,
    versionMismatchNotice: null,
    sessionToken,
  };
}

export interface LibraryIntakePeiaClientDeps {
  readonly getIntakeById: (id: string) => Promise<LibraryIntakeRecord | null>;
  readonly getIntakePeiaPreparationStatus: (
    intakeId: string,
    taskId?: string
  ) => Promise<GetLibraryIntakePeiaPreparationStatusResponseDto>;
  readonly requestIntakePeiaPreparation: (
    intakeId: string,
    expectedUpdatedAt: string
  ) => Promise<RequestLibraryIntakePeiaPreparationResponseDto>;
  readonly onIntakeRecordRefreshed?: (record: LibraryIntakeRecord) => void;
}

/**
 * Deterministic state & async workflow controller for the Library Intake PEIA Preparation modal.
 * Enforces:
 * - Status-only read on modal open (never enqueues or calls Gemini on open)
 * - Session-token isolation against late responses when switching records or closing the modal
 * - Duplicate-click prevention while `requestingPrep` is in flight
 * - Authoritative `getIntakeById` check before `requestIntakePeiaPreparation`
 * - Fail-closed version-mismatch pause when `refreshedRecord.updatedAt !== displayedRecord.updatedAt`
 * - Preservation of server errors without automatic retry or editorial status mutation
 */
export class LibraryIntakePeiaPreparationController {
  private currentUser: AdminUser;
  private deps: LibraryIntakePeiaClientDeps;
  private state: LibraryIntakePeiaModalSnapshot;
  private listeners: Set<(snapshot: LibraryIntakePeiaModalSnapshot) => void> = new Set();

  constructor(
    currentUser: AdminUser,
    deps?: Partial<LibraryIntakePeiaClientDeps>,
    initialState?: Partial<LibraryIntakePeiaModalSnapshot>
  ) {
    this.currentUser = currentUser;
    this.deps = {
      getIntakeById: deps?.getIntakeById ?? ((id) => LibraryAdminClient.getIntakeById(id)),
      getIntakePeiaPreparationStatus:
        deps?.getIntakePeiaPreparationStatus ??
        ((intakeId, taskId) => LibraryAdminClient.getIntakePeiaPreparationStatus(intakeId, taskId)),
      requestIntakePeiaPreparation:
        deps?.requestIntakePeiaPreparation ??
        ((intakeId, expectedUpdatedAt) =>
          LibraryAdminClient.requestIntakePeiaPreparation(intakeId, expectedUpdatedAt)),
      onIntakeRecordRefreshed: deps?.onIntakeRecordRefreshed,
    };
    this.state = {
      ...createInitialLibraryIntakePeiaModalSnapshot(initialState?.sessionToken ?? 0),
      ...initialState,
    };
  }

  public getSnapshot(): LibraryIntakePeiaModalSnapshot {
    return this.state;
  }

  public setCurrentUser(user: AdminUser): void {
    this.currentUser = user;
  }

  public subscribe(listener: (snapshot: LibraryIntakePeiaModalSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(patch: Partial<LibraryIntakePeiaModalSnapshot>): void {
    this.state = {
      ...this.state,
      ...patch,
    };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  public async openModal(intake: LibraryIntakeRecord): Promise<void> {
    if (!canAccessLibraryIntakePeiaPreparation(this.currentUser)) {
      return;
    }

    const nextToken = this.state.sessionToken + 1;
    const targetIntakeId = intake.id;

    this.setState({
      activeIntake: intake,
      peiaStatus: null,
      loadingStatus: true,
      requestingPrep: false,
      peiaError: null,
      lastEnqueueDisposition: null,
      versionMismatchNotice: null,
      sessionToken: nextToken,
    });

    try {
      const res = await this.deps.getIntakePeiaPreparationStatus(targetIntakeId);
      if (
        this.state.sessionToken !== nextToken ||
        !this.state.activeIntake ||
        this.state.activeIntake.id !== targetIntakeId
      ) {
        return;
      }
      this.setState({
        peiaStatus: res.preparationStatus,
        loadingStatus: false,
        peiaError: null,
      });
    } catch (err: any) {
      if (
        this.state.sessionToken !== nextToken ||
        !this.state.activeIntake ||
        this.state.activeIntake.id !== targetIntakeId
      ) {
        return;
      }
      this.setState({
        peiaStatus: null,
        loadingStatus: false,
        peiaError:
          err?.message ||
          'PEIA_STATUS_FETCH_FAILED: Failed to load PEIA preparation status.',
      });
    }
  }

  public closeModal(): void {
    const nextToken = this.state.sessionToken + 1;
    this.setState(createInitialLibraryIntakePeiaModalSnapshot(nextToken));
  }

  public async refreshStatus(explicitTaskId?: string): Promise<void> {
    if (!this.state.activeIntake || this.state.loadingStatus || this.state.requestingPrep) {
      return;
    }
    if (!canAccessLibraryIntakePeiaPreparation(this.currentUser)) {
      this.setState({
        peiaError:
          'PERMISSION_DENIED: Current admin role is not authorized to read Library Intake PEIA preparation status.',
      });
      return;
    }

    const activeToken = this.state.sessionToken;
    const targetIntakeId = this.state.activeIntake.id;

    this.setState({
      loadingStatus: true,
      peiaError: null,
    });

    try {
      const res = await this.deps.getIntakePeiaPreparationStatus(targetIntakeId, explicitTaskId);
      if (
        this.state.sessionToken !== activeToken ||
        !this.state.activeIntake ||
        this.state.activeIntake.id !== targetIntakeId
      ) {
        return;
      }
      this.setState({
        peiaStatus: res.preparationStatus,
        loadingStatus: false,
        peiaError: null,
      });
    } catch (err: any) {
      if (
        this.state.sessionToken !== activeToken ||
        !this.state.activeIntake ||
        this.state.activeIntake.id !== targetIntakeId
      ) {
        return;
      }
      this.setState({
        loadingStatus: false,
        peiaError:
          err?.message ||
          'PEIA_STATUS_FETCH_FAILED: Failed to refresh PEIA preparation status.',
      });
    }
  }

  public async requestPreparation(): Promise<void> {
    if (!this.state.activeIntake || this.state.requestingPrep) {
      return;
    }

    if (!canAccessLibraryIntakePeiaPreparation(this.currentUser)) {
      this.setState({
        peiaError:
          'PERMISSION_DENIED: Current admin role is not authorized to request Library Intake PEIA preparation.',
      });
      return;
    }

    if (this.state.activeIntake.status === LibraryIntakeStatus.Rejected) {
      this.setState({
        peiaError:
          'REJECTED_INTAKE_NOT_ELIGIBLE: Rejected intake records cannot be queued for PEIA preparation.',
      });
      return;
    }

    const activeToken = this.state.sessionToken;
    const displayedRecord = this.state.activeIntake;
    const targetIntakeId = displayedRecord.id;
    const displayedUpdatedAt = displayedRecord.updatedAt;

    this.setState({
      requestingPrep: true,
      peiaError: null,
      lastEnqueueDisposition: null,
      versionMismatchNotice: null,
    });

    try {
      const refreshedRecord = await this.deps.getIntakeById(targetIntakeId);
      if (
        this.state.sessionToken !== activeToken ||
        !this.state.activeIntake ||
        this.state.activeIntake.id !== targetIntakeId
      ) {
        return;
      }

      if (!refreshedRecord) {
        this.setState({
          requestingPrep: false,
          peiaError: `NOT_FOUND: Library intake record '${targetIntakeId}' no longer exists.`,
        });
        return;
      }

      this.deps.onIntakeRecordRefreshed?.(refreshedRecord);

      if (refreshedRecord.status === LibraryIntakeStatus.Rejected) {
        this.setState({
          activeIntake: refreshedRecord,
          requestingPrep: false,
          peiaError:
            'REJECTED_INTAKE_NOT_ELIGIBLE: Intake record status is Rejected and cannot be queued for PEIA preparation.',
        });
        return;
      }

      if (refreshedRecord.updatedAt !== displayedUpdatedAt) {
        this.setState({
          activeIntake: refreshedRecord,
          requestingPrep: false,
          loadingStatus: true,
          versionMismatchNotice: {
            previousUpdatedAt: displayedUpdatedAt,
            refreshedUpdatedAt: refreshedRecord.updatedAt,
          },
        });

        try {
          const latestStatusRes = await this.deps.getIntakePeiaPreparationStatus(targetIntakeId);
          if (
            this.state.sessionToken !== activeToken ||
            !this.state.activeIntake ||
            this.state.activeIntake.id !== targetIntakeId
          ) {
            return;
          }
          this.setState({
            peiaStatus: latestStatusRes.preparationStatus,
            loadingStatus: false,
          });
        } catch (statusErr: any) {
          if (
            this.state.sessionToken !== activeToken ||
            !this.state.activeIntake ||
            this.state.activeIntake.id !== targetIntakeId
          ) {
            return;
          }
          this.setState({
            peiaStatus: null,
            loadingStatus: false,
            peiaError:
              statusErr?.message ||
              'PEIA_STATUS_FETCH_FAILED: Failed to load PEIA status for refreshed intake version.',
          });
        }
        return;
      }

      const enqueueRes = await this.deps.requestIntakePeiaPreparation(
        refreshedRecord.id,
        refreshedRecord.updatedAt
      );

      if (
        this.state.sessionToken !== activeToken ||
        !this.state.activeIntake ||
        this.state.activeIntake.id !== targetIntakeId
      ) {
        return;
      }

      this.setState({
        activeIntake: refreshedRecord,
        peiaStatus: enqueueRes.preparationStatus,
        lastEnqueueDisposition: enqueueRes.disposition,
        requestingPrep: false,
        peiaError: null,
        versionMismatchNotice: null,
      });
    } catch (err: any) {
      if (
        this.state.sessionToken !== activeToken ||
        !this.state.activeIntake ||
        this.state.activeIntake.id !== targetIntakeId
      ) {
        return;
      }
      this.setState({
        requestingPrep: false,
        peiaError:
          err?.message ||
          'PEIA_REQUEST_FAILED: Failed to request PEIA preparation.',
      });
    }
  }
}

export interface AdminLibraryManagementProps {
  currentUser: AdminUser;
  initialTab?: 'documents' | 'organizations' | 'sources' | 'intake';
  initialIntakeRecords?: LibraryIntakeRecord[];
  initialOrganizations?: LibraryOrganization[];
  initialSources?: LibrarySource[];
  initialDocuments?: LibraryDocument[];
  initialLoading?: boolean;
  initialPeiaModalState?: Partial<LibraryIntakePeiaModalSnapshot>;
  initialQuarantineUploadOpen?: boolean;
  quarantineUploadRuntimeDeps?: LibraryQuarantineUploadRuntimeDependencies;
  quarantineUploadController?: LibraryQuarantineUploadSessionController;
  languageOverride?: 'ar' | 'en';
}

export function AdminLibraryManagement({
  currentUser,
  initialTab = 'documents',
  initialIntakeRecords = [],
  initialOrganizations = [],
  initialSources = [],
  initialDocuments = [],
  initialLoading = true,
  initialPeiaModalState,
  initialQuarantineUploadOpen = false,
  quarantineUploadRuntimeDeps,
  quarantineUploadController,
  languageOverride,
}: AdminLibraryManagementProps) {
  const { i18n } = useTranslation();
  const isAr = (languageOverride ?? i18n.language) === 'ar';

  const [documents, setDocuments] = useState<LibraryDocument[]>(initialDocuments);
  const [organizations, setOrganizations] = useState<LibraryOrganization[]>(initialOrganizations);
  const [sources, setSources] = useState<LibrarySource[]>(initialSources);
  const [intakeRecords, setIntakeRecords] = useState<LibraryIntakeRecord[]>(initialIntakeRecords);
  const [loading, setLoading] = useState(initialLoading);
  const [error, setError] = useState<string | null>(null);

  // Tab View State: 'documents' | 'organizations' | 'sources' | 'intake'
  const [activeTab, setActiveTab] = useState<'documents' | 'organizations' | 'sources' | 'intake'>(initialTab);

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

  // Modal State for Private Quarantine Document Upload
  const [isQuarantineUploadOpen, setIsQuarantineUploadOpen] = useState(
    initialQuarantineUploadOpen
  );

  // Modal State for Reviewing Intake Reference
  const [reviewingIntake, setReviewingIntake] = useState<LibraryIntakeRecord | null>(null);
  const [reviewTargetStatus, setReviewTargetStatus] = useState<LibraryIntakeStatus>(LibraryIntakeStatus.InPreparation);
  const [reviewEditorialNotes, setReviewEditorialNotes] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewModalError, setReviewModalError] = useState<string | null>(null);

  // Reused Modal State for Canonical PEIA Intake Preparation Assistant
  const [peiaModalState, setPeiaModalState] = useState<LibraryIntakePeiaModalSnapshot>(() => ({
    ...createInitialLibraryIntakePeiaModalSnapshot(initialPeiaModalState?.sessionToken ?? 0),
    ...initialPeiaModalState,
  }));

  const peiaControllerRef = useRef<LibraryIntakePeiaPreparationController | null>(null);
  if (!peiaControllerRef.current) {
    peiaControllerRef.current = new LibraryIntakePeiaPreparationController(
      currentUser,
      {
        onIntakeRecordRefreshed: (refreshedRecord) => {
          setIntakeRecords((prev) =>
            prev.map((item) => (item.id === refreshedRecord.id ? refreshedRecord : item))
          );
        },
      },
      initialPeiaModalState
    );
  }
  peiaControllerRef.current.setCurrentUser(currentUser);

  useEffect(() => {
    const controller = peiaControllerRef.current;
    if (!controller) return;
    return controller.subscribe((snapshot) => {
      setPeiaModalState(snapshot);
    });
  }, []);

  const aiPrepIntake = peiaModalState.activeIntake;
  const peiaStatus = peiaModalState.peiaStatus;
  const loadingPeiaStatus = peiaModalState.loadingStatus;
  const requestingPeiaPrep = peiaModalState.requestingPrep;
  const aiPrepError = peiaModalState.peiaError;
  const lastPeiaDisposition = peiaModalState.lastEnqueueDisposition;
  const peiaVersionMismatchNotice = peiaModalState.versionMismatchNotice;

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
  const canUploadQuarantine = canUploadToLibraryQuarantine(currentUser);
  const canReviewIntake = canReview || canApprove || canManageRights;
  const canPrepareAiIntake = canAccessLibraryIntakePeiaPreparation(currentUser);

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

  const handleOpenPeiaPreparationModal = async (intake: LibraryIntakeRecord) => {
    await peiaControllerRef.current?.openModal(intake);
  };

  const handleClosePeiaPreparationModal = () => {
    peiaControllerRef.current?.closeModal();
  };

  const handleRefreshPeiaPreparationStatus = async () => {
    await peiaControllerRef.current?.refreshStatus();
  };

  const handleRequestPeiaPreparation = async () => {
    await peiaControllerRef.current?.requestPreparation();
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

              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                <button
                  onClick={loadAllData}
                  className="p-2.5 rounded-xl border border-gray-300 dark:border-gray-700 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors cursor-pointer"
                  title={isAr ? 'تحديث سجل الاستقبال' : 'Refresh Intake Inbox'}
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
                {canUploadQuarantine && (
                  <button
                    type="button"
                    onClick={() => setIsQuarantineUploadOpen(true)}
                    data-testid="open-library-quarantine-upload-btn"
                    className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-extrabold text-xs sm:text-sm transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Lock className="h-4 w-4" />
                    <span>{isAr ? 'رفع مستند إلى الحجر الخاص' : 'Upload document to private quarantine'}</span>
                  </button>
                )}
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
              <div>
                {/* Desktop Table View (>= lg) */}
                <div className="hidden lg:block overflow-x-auto" data-testid="intake-desktop-table">
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
                                    type="button"
                                    data-testid={`intake-peia-prep-action-${rec.id}`}
                                    onClick={() => {
                                      void handleOpenPeiaPreparationModal(rec);
                                    }}
                                    className="px-3 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300 text-xs font-extrabold transition-all border border-purple-200 dark:border-purple-800 cursor-pointer inline-flex items-center gap-1"
                                  >
                                    <Sparkles className="h-3.5 w-3.5" />
                                    <span>{isAr ? 'تحضير ومراجعة PEIA الاسترشادية' : 'PEIA Preparation Assistant'}</span>
                                  </button>
                                )}
                                {canReviewIntake && (
                                  <button
                                    type="button"
                                    data-testid={`intake-human-review-action-${rec.id}`}
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

                {/* Mobile / Narrow Viewport Card View (< lg) */}
                <div className="block lg:hidden divide-y divide-gray-200 dark:divide-gray-800" data-testid="intake-mobile-cards">
                  {filteredIntakeRecords.map((rec) => (
                    <div
                      key={rec.id}
                      data-testid={`intake-mobile-card-${rec.id}`}
                      className="p-4 space-y-3.5 bg-white dark:bg-gray-900 transition-colors"
                    >
                      {/* Header: Title and Status Badge */}
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h4 className="font-extrabold text-sm text-gray-900 dark:text-gray-100 break-words">
                            {rec.title}
                          </h4>
                          <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                            {rec.id}
                          </div>
                        </div>
                        <div className="shrink-0 self-start">
                          {getIntakeStatusBadge(rec.status)}
                        </div>
                      </div>

                      {/* Reference URL */}
                      <div>
                        <a
                          href={rec.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 hover:underline font-bold text-xs break-all"
                        >
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          <span>{rec.normalizedUrl}</span>
                        </a>
                      </div>

                      {/* Metadata Grid: Organization, Source, Language, Legacy AI */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs pt-1">
                        {/* Linked Organization & Source */}
                        <div className="space-y-1">
                          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                            {isAr ? 'الجهة / المصدر' : 'Organization / Source'}
                          </div>
                          {rec.organizationId ? (
                            <div className="font-bold text-gray-800 dark:text-gray-200 flex items-center gap-1.5 break-words">
                              <Building2 className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                              <span>{getOrganizationName(rec.organizationId)}</span>
                            </div>
                          ) : (
                            <span className="text-gray-400 italic block">{isAr ? 'بدون مؤسسة مرتبطة' : 'No organization'}</span>
                          )}
                          {rec.sourceId && (
                            <div className="text-gray-600 dark:text-gray-400 flex items-center gap-1.5 text-[11px] break-words">
                              <Database className="h-3 w-3 text-teal-600 shrink-0" />
                              <span>{getSourceName(rec.sourceId)}</span>
                            </div>
                          )}
                        </div>

                        {/* Language & Badges */}
                        <div className="space-y-1">
                          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                            {isAr ? 'اللغة والسمات' : 'Language & Traits'}
                          </div>
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
                        </div>
                      </div>

                      {/* Editorial & Review Notes */}
                      {rec.notes && (
                        <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/40 p-2.5 rounded-xl border border-gray-100 dark:border-gray-800">
                          <span className="font-bold text-gray-700 dark:text-gray-300 block mb-0.5">
                            {isAr ? 'ملاحظات الإيداع:' : 'Submission Notes:'}
                          </span>
                          <p className="break-words">{rec.notes}</p>
                        </div>
                      )}

                      {rec.reviewNotes && (
                        <div className="p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-300">
                          <span className="font-extrabold block mb-0.5">{isAr ? 'ملاحظة المراجع: ' : 'Review Note: '}</span>
                          <p className="break-words">{rec.reviewNotes}</p>
                        </div>
                      )}

                      {/* Submission & Review Audit Footer */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-gray-100 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400">
                        <div>
                          <span className="font-bold text-gray-700 dark:text-gray-300">{isAr ? 'أودع بواسطة: ' : 'Submitted by: '}</span>
                          <span>{rec.submittedByAdminName}</span>
                          <span className="mx-1.5 text-gray-300 dark:text-gray-700">•</span>
                          <span>{new Date(rec.createdAt).toLocaleDateString(isAr ? 'ar-EG' : 'en-US')}</span>
                        </div>
                        {rec.reviewedByAdminName && (
                          <div className="text-emerald-700 dark:text-emerald-400 font-semibold">
                            {isAr ? `تحديث: ${rec.reviewedByAdminName}` : `Reviewed: ${rec.reviewedByAdminName}`}
                          </div>
                        )}
                      </div>

                      {/* Actions: PEIA Preparation & Human Review */}
                      {(canReviewIntake || canPrepareAiIntake) && (
                        <div className="pt-2 flex flex-col sm:flex-row gap-2">
                          {canPrepareAiIntake && (
                            <button
                              type="button"
                              data-testid={`intake-peia-prep-action-mobile-${rec.id}`}
                              onClick={() => {
                                void handleOpenPeiaPreparationModal(rec);
                              }}
                              className="w-full sm:w-auto flex-1 justify-center px-3.5 py-2 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300 text-xs font-extrabold transition-all border border-purple-200 dark:border-purple-800 cursor-pointer inline-flex items-center gap-1.5"
                            >
                              <Sparkles className="h-3.5 w-3.5 shrink-0" />
                              <span>{isAr ? 'تحضير ومراجعة PEIA الاسترشادية' : 'PEIA Preparation Assistant'}</span>
                            </button>
                          )}
                          {canReviewIntake && (
                            <button
                              type="button"
                              data-testid={`intake-human-review-action-mobile-${rec.id}`}
                              onClick={() => {
                                setReviewingIntake(rec);
                                setReviewTargetStatus(rec.status);
                                setReviewEditorialNotes(rec.reviewNotes || '');
                                setReviewModalError(null);
                              }}
                              className="w-full sm:w-auto px-3.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 text-xs font-extrabold transition-all border border-indigo-200 dark:border-indigo-800 cursor-pointer inline-flex items-center justify-center gap-1.5"
                            >
                              <Edit3 className="h-3.5 w-3.5 shrink-0" />
                              <span>{isAr ? 'تحديث الحالة' : 'Review Status'}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
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

      {/* ================= HUMAN-TRIGGERED PEIA PREPARATION ASSISTANT MODAL ================= */}
      {aiPrepIntake && (
        <div
          data-testid="peia-preparation-modal"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl max-w-3xl w-full p-4 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto text-right rtl:text-right ltr:text-left">
            <div className="flex justify-between items-center border-b border-gray-100 dark:border-gray-800 pb-3 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="h-5 w-5 text-purple-600 shrink-0" />
                <div className="min-w-0">
                  <h3 className="font-extrabold text-sm sm:text-base text-gray-900 dark:text-gray-100">
                    {isAr
                      ? 'مساعد التحضير الاسترشادي الموحد (PEIA — مراجعة بشرية إلزامية)'
                      : 'PEIA Unified Intake Preparation Assistant (Mandatory Human Review)'}
                  </h3>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {isAr
                      ? 'مخرجات تحضيرية استرشادية غير موثقة لسجل الاستقبال عبر طابور مهام PEIA الموحد دون أي اعتماد أو ترقية أو نشر تلقائي.'
                      : 'Unverified advisory preparation output via the canonical PEIA task queue without automatic approval, promotion, or publication.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="peia-modal-close-btn"
                onClick={handleClosePeiaPreparationModal}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 cursor-pointer shrink-0"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Canonical Intake Summary & Stored Input Basis Box */}
            <div className="p-3.5 rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-800 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-extrabold text-gray-900 dark:text-gray-100">{aiPrepIntake.title}</span>
                {getIntakeStatusBadge(aiPrepIntake.status)}
              </div>
              <div className="text-emerald-700 dark:text-emerald-400 break-all font-mono text-[11px]">
                {aiPrepIntake.normalizedUrl}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-gray-500 dark:text-gray-400">
                <span>ID: {aiPrepIntake.id}</span>
                <span data-testid="peia-intake-version-timestamp">
                  {isAr ? `نسخة السجل (updatedAt): ${aiPrepIntake.updatedAt}` : `Record Version (updatedAt): ${aiPrepIntake.updatedAt}`}
                </span>
              </div>
              {aiPrepIntake.notes && (
                <p className="text-gray-600 dark:text-gray-400 text-[11px]">
                  <span className="font-bold">{isAr ? 'ملاحظات الإيداع: ' : 'Intake Notes: '}</span>
                  {aiPrepIntake.notes}
                </p>
              )}

              {/* Read-Only Canonical Stored Excerpt / Input Basis Explanation */}
              <div className="pt-2 border-t border-gray-200 dark:border-gray-700/70 space-y-1.5">
                {typeof aiPrepIntake.suppliedExcerpt === 'string' &&
                aiPrepIntake.suppliedExcerpt.trim().length > 0 ? (
                  <div data-testid="peia-canonical-stored-excerpt" className="space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-extrabold text-gray-800 dark:text-gray-200 text-[11px]">
                        {isAr
                          ? 'المقتطف النصي المحفوظ في سجل الاستقبال (للقراءة فقط — مصدر لقطة PEIA)'
                          : 'Canonical Stored Intake Excerpt (Read-Only — PEIA Snapshot Source)'}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950/70 text-purple-800 dark:text-purple-300 font-mono font-bold text-[10px]">
                        {PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata}
                      </span>
                    </div>
                    <p className="p-2.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-[11px] leading-relaxed whitespace-pre-wrap">
                      {aiPrepIntake.suppliedExcerpt.trim()}
                    </p>
                  </div>
                ) : (
                  <div
                    data-testid="peia-metadata-only-basis-notice"
                    className="p-2.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 text-amber-900 dark:text-amber-200 text-[11px] space-y-1"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-extrabold">
                        {isAr
                          ? 'أساس الإدخال القياسي: بيانات وصفية فقط (MetadataOnly)'
                          : 'Canonical Input Basis: MetadataOnly'}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/70 text-amber-900 dark:text-amber-200 font-mono font-bold text-[10px]">
                        {PEIALibraryPreparationInputBasis.MetadataOnly}
                      </span>
                    </div>
                    <p className="leading-relaxed">
                      {isAr
                        ? 'لا يوجد مقتطف نصي محفوظ في سجل الاستقبال؛ سيعمل تحضير PEIA بوضع البيانات الوصفية فقط (MetadataOnly) ولن يصطنع ملخصاً لوثيقة خارجية لم يُقرأ نصها.'
                        : 'No stored excerpt exists on this intake record; PEIA preparation runs in MetadataOnly mode and will NOT fabricate a summary of an unread external document.'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* PEIA Controls & Action Bar */}
            <div className="p-3.5 rounded-xl border border-purple-200/80 dark:border-purple-900/60 bg-purple-50/30 dark:bg-purple-950/15 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="space-y-0.5">
                <div className="font-extrabold text-gray-900 dark:text-gray-100">
                  {isAr ? 'إدارة مهمة التحضير الاسترشادي (PEIA)' : 'PEIA Preparation Task Controls'}
                </div>
                <p className="text-[11px] text-gray-600 dark:text-gray-400">
                  {isAr
                    ? 'يتم بناء لقطة المهمة على الخادم حصراً من بيانات السجل المحفوظة والتحقق من نسخة السجل (expectedUpdatedAt).'
                    : 'The task snapshot is built exclusively on the server from canonical stored intake data with strict expectedUpdatedAt version verification.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  data-testid="peia-refresh-status-btn"
                  disabled={loadingPeiaStatus || requestingPeiaPrep}
                  onClick={() => {
                    void handleRefreshPeiaPreparationStatus();
                  }}
                  className="px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-700 bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingPeiaStatus ? 'animate-spin' : ''}`} />
                  <span>{isAr ? 'تحديث حالة المهمة' : 'Refresh Status'}</span>
                </button>

                {canPrepareAiIntake && (
                  <button
                    type="button"
                    data-testid="peia-request-prep-btn"
                    disabled={
                      requestingPeiaPrep ||
                      aiPrepIntake.status === LibraryIntakeStatus.Rejected
                    }
                    onClick={() => {
                      void handleRequestPeiaPreparation();
                    }}
                    className="px-4 py-2 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-extrabold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {requestingPeiaPrep ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {peiaVersionMismatchNotice
                        ? isAr
                          ? 'تأكيد طلب تحضير PEIA للنسخة المحدثة'
                          : 'Confirm PEIA Request for Updated Version'
                        : peiaStatus?.isStale
                          ? isAr
                            ? 'طلب مهمة تحضير PEIA للنسخة الحالية'
                            : 'Request Fresh PEIA Preparation'
                          : isAr
                            ? 'طلب تحضير استرشادي عبر PEIA'
                            : 'Request PEIA Preparation'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Rejected Record Notice */}
            {aiPrepIntake.status === LibraryIntakeStatus.Rejected && (
              <div
                data-testid="peia-rejected-intake-notice"
                className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-bold"
              >
                {isAr
                  ? 'هذا السجل بحالة مستبعد (Rejected)؛ لا يمكن إدراج السجلات المستبعدة في طابور مهام التحضير الاسترشادي PEIA.'
                  : 'This intake record is Rejected; rejected intake records cannot be queued for PEIA preparation.'}
              </div>
            )}

            {/* Version Mismatch Notice (when getIntakeById detected a newer updatedAt) */}
            {peiaVersionMismatchNotice && (
              <div
                data-testid="peia-version-mismatch-notice"
                className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs space-y-1"
              >
                <div className="font-extrabold flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>
                    {isAr
                      ? 'تم تحديث سجل الاستقبال أثناء فتح النافذة — تم إيقاف الإرسال التلقائي'
                      : 'Intake Record Changed While Modal Was Open — Request Paused for Confirmation'}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  {isAr
                    ? `تغيرت نسخة السجل من (${peiaVersionMismatchNotice.previousUpdatedAt}) إلى (${peiaVersionMismatchNotice.refreshedUpdatedAt}). تم تحميل أحدث بيانات السجل؛ يرجى مراجعتها ثم الضغط على زر التأكيد لإرسال طلب PEIA للنسخة المحدثة.`
                    : `The intake record version changed from (${peiaVersionMismatchNotice.previousUpdatedAt}) to (${peiaVersionMismatchNotice.refreshedUpdatedAt}). The latest record has been loaded; please review and click confirm to queue PEIA preparation for the updated version.`}
                </p>
              </div>
            )}

            {/* Error Banner */}
            {aiPrepError && (
              <div
                data-testid="peia-error-banner"
                className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-bold"
              >
                {aiPrepError}
              </div>
            )}

            {/* Enqueue Disposition Feedback Banner */}
            {lastPeiaDisposition === 'CREATED' && (
              <div
                data-testid="peia-disposition-created"
                className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-bold flex items-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  {isAr
                    ? 'تم إنشاء وإدراج مهمة تحضير PEIA جديدة بنجاح لهذه النسخة من سجل الاستقبال (Disposition: CREATED).'
                    : 'A new PEIA preparation task was successfully queued for this intake record version (Disposition: CREATED).'}
                </span>
              </div>
            )}

            {lastPeiaDisposition === 'ALREADY_EXISTS' && (
              <div
                data-testid="peia-disposition-already-exists"
                className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300 text-xs font-bold flex items-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  {isAr
                    ? 'توجد مهمة تحضير PEIA مطابقة ومسجلة مسبقاً لهذه النسخة من سجل الاستقبال (Disposition: ALREADY_EXISTS).'
                    : 'An identical PEIA preparation task already exists for this intake record version (Disposition: ALREADY_EXISTS).'}
                </span>
              </div>
            )}

            {/* Stale Historical Task Warning Banner */}
            {peiaStatus && peiaStatus.isStale && (
              <div
                data-testid="peia-stale-warning-banner"
                className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-200 text-xs space-y-1"
              >
                <div className="font-extrabold flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span>
                    {isAr
                      ? 'تنبيه: نتائج مهمة PEIA المعروضة تعود لنسخة سابقة من سجل الاستقبال (Stale Result)'
                      : 'Stale PEIA Task Warning: Displayed Task Belongs to an Older Intake Version'}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  {isAr
                    ? `نسخة المهمة المسجلة (${peiaStatus.taskSourceUpdatedAt ?? 'N/A'}) أقدم من النسخة الحالية للسجل (${peiaStatus.currentSourceUpdatedAt}). تبقى المخرجات التاريخية أدناه متاحة للتدقيق، ويمكنك طلب مهمة تحضير جديدة للنسخة الحالية.`
                    : `Task target version (${peiaStatus.taskSourceUpdatedAt ?? 'N/A'}) is older than the current intake record version (${peiaStatus.currentSourceUpdatedAt}). Historical findings remain visible below for audit context, and you may request a fresh PEIA task for the current version.`}
                </p>
              </div>
            )}

            {/* Loading Status Indicator */}
            {loadingPeiaStatus && !peiaStatus && (
              <div
                data-testid="peia-status-loading"
                className="p-6 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30 flex items-center justify-center gap-2 text-xs font-bold text-gray-600 dark:text-gray-300"
              >
                <Loader2 className="h-4 w-4 animate-spin text-purple-600" />
                <span>
                  {isAr
                    ? 'جاري جلب حالة التحضير الاسترشادي (PEIA)...'
                    : 'Loading PEIA preparation status...'}
                </span>
              </div>
            )}

            {/* Canonical PEIA Status Section */}
            {peiaStatus && (
              <div className="space-y-4">
                {/* STATE A: NotRequested */}
                {peiaStatus.status === 'NotRequested' && (
                  <div
                    data-testid="peia-status-not-requested"
                    className="p-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/40 text-xs space-y-1.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-extrabold text-gray-900 dark:text-gray-100">
                        {isAr
                          ? 'حالة التحضير الاسترشادي (PEIA): لم يتم طلب مهمة بعد (NotRequested)'
                          : 'PEIA Preparation Status: NotRequested'}
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-mono font-bold text-[10px]">
                        NotRequested
                      </span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400 text-[11px]">
                      {isAr
                        ? 'لم يتم إدراج مهمة تحضير PEIA لهذا السجل بعد. يمكنك طلب تحضير استرشادي باستخدام الزر أعلاه في حال لم يكن السجل مستبعداً.'
                        : 'No PEIA preparation task has been requested for this intake record yet. Authorized curators can request preparation above unless the record is Rejected.'}
                    </p>
                  </div>
                )}

                {/* STATE B: Pending */}
                {peiaStatus.status === AITaskStatus.Pending && (
                  <div
                    data-testid="peia-status-pending"
                    className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 text-xs space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-extrabold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                        <Clock className="h-4 w-4 text-amber-600 shrink-0" />
                        <span>
                          {isAr
                            ? 'حالة مهمة PEIA: قيد الانتظار والمعالجة (Pending)'
                            : 'PEIA Task Status: Pending'}
                        </span>
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200 font-mono font-bold text-[10px]">
                        {AITaskStatus.Pending}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px] font-mono text-amber-900 dark:text-amber-200">
                      <div>Task ID: {peiaStatus.taskId}</div>
                      <div>
                        Target Version: {peiaStatus.taskSourceUpdatedAt ?? peiaStatus.task?.target.sourceUpdatedAt ?? 'N/A'}
                      </div>
                      <div>Requested At: {peiaStatus.task?.createdAt ?? 'N/A'}</div>
                    </div>
                    {peiaStatus.inputBasis && (
                      <div className="text-[11px] font-mono text-amber-800 dark:text-amber-300">
                        Input Basis: {peiaStatus.inputBasis}
                      </div>
                    )}
                    <p className="text-[11px] text-amber-800 dark:text-amber-300">
                      {isAr
                        ? 'المهمة مدرجة في طابور PEIA الموحد؛ يمكنك استخدام زر "تحديث حالة المهمة" للتحقق من اكتمالها يدوياً.'
                        : 'The task is queued in the canonical PEIA task queue; use the manual "Refresh Status" button to check for completion.'}
                    </p>
                  </div>
                )}

                {/* STATE C: Completed */}
                {peiaStatus.status === AITaskStatus.Completed && peiaStatus.libraryPreparation && (
                  <div data-testid="peia-status-completed" className="space-y-4">
                    {/* Mandatory Human-Review / Advisory-Only Warning */}
                    <div
                      data-testid="peia-advisory-only-warning"
                      className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs space-y-1"
                    >
                      <div className="font-extrabold flex items-center justify-between gap-2 flex-wrap">
                        <span className="flex items-center gap-1.5">
                          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                          <span>
                            {isAr
                              ? 'مخرجات PEIA استرشادية غير موثقة — تتطلب مراجعة واعتماداً بشرياً'
                              : 'Unverified PEIA Advisory Output — Requires Human Editorial Verification'}
                          </span>
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-mono text-[10px] font-bold">
                          {AITaskStatus.Completed}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed">
                        {isAr
                          ? 'هذه المقترحات استرشادية فقط ولا تقوم بالموافقة أو الرفض أو الترقية أو النشر التلقائي لأي سجل استقبال أو وثيقة في المكتبة.'
                          : 'This PEIA output is strictly advisory and does NOT automatically approve, reject, promote, or publish any intake record or library document.'}
                      </p>
                      <div className="flex flex-wrap gap-3 pt-1 text-[10px] font-mono text-amber-800 dark:text-amber-300">
                        <span>Task ID: {peiaStatus.taskId}</span>
                        <span>Input Basis: {peiaStatus.libraryPreparation.inputBasis}</span>
                        <span>Target Version: {peiaStatus.taskSourceUpdatedAt ?? 'N/A'}</span>
                        {peiaStatus.task?.createdAt && (
                          <span>Requested At: {peiaStatus.task.createdAt}</span>
                        )}
                      </div>
                    </div>

                    {/* Suggested Bibliographic & Classification Fields */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase">
                          {isAr ? 'العنوان المقترح (عربي)' : 'Suggested Title (Arabic)'}
                        </span>
                        <p className="font-extrabold text-gray-900 dark:text-gray-100 select-all">
                          {peiaStatus.libraryPreparation.suggestedTitleAr}
                        </p>
                      </div>

                      <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase">
                          {isAr ? 'العنوان المقترح (إنجليزي)' : 'Suggested Title (English)'}
                        </span>
                        <p className="font-extrabold text-gray-900 dark:text-gray-100 select-all">
                          {peiaStatus.libraryPreparation.suggestedTitleEn}
                        </p>
                      </div>

                      <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase">
                          {isAr ? 'الجهة المصدرة المقترحة' : 'Suggested Issuing Organization'}
                        </span>
                        <p className="font-bold text-gray-800 dark:text-gray-200 select-all">
                          {peiaStatus.libraryPreparation.suggestedIssuingOrganization}
                        </p>
                      </div>

                      <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1">
                        <span className="text-[10px] font-bold text-gray-500 uppercase">
                          {isAr ? 'نوع الوثيقة المقترح' : 'Suggested Document Type'}
                        </span>
                        <p className="font-extrabold text-emerald-700 dark:text-emerald-400">
                          {peiaStatus.libraryPreparation.suggestedDocumentType}
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
                          {peiaStatus.libraryPreparation.suggestedEnvironmentalDomains.map((dom, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 font-bold text-[11px]"
                            >
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
                          {peiaStatus.libraryPreparation.suggestedTopicsAr.map((t, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 font-bold text-[11px]"
                            >
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
                          {peiaStatus.libraryPreparation.suggestedTopicsEn.map((t, idx) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-300 font-bold text-[11px]"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Conditional Bilingual Summaries vs MetadataOnly Truthfulness Notice */}
                    {peiaStatus.libraryPreparation.inputBasis ===
                      PEIALibraryPreparationInputBasis.SuppliedExcerptAndMetadata &&
                    (peiaStatus.libraryPreparation.suggestedSummaryAr !== null ||
                      peiaStatus.libraryPreparation.suggestedSummaryEn !== null) ? (
                      <div
                        data-testid="peia-completed-summaries"
                        className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs"
                      >
                        <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1">
                          <span className="text-[10px] font-bold text-gray-500 uppercase block">
                            {isAr ? 'الملخص المقترح من المقتطف (عربي)' : 'Suggested Excerpt Summary (Arabic)'}
                          </span>
                          <p className="text-gray-800 dark:text-gray-200 leading-relaxed select-all">
                            {peiaStatus.libraryPreparation.suggestedSummaryAr}
                          </p>
                        </div>
                        <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-1">
                          <span className="text-[10px] font-bold text-gray-500 uppercase block">
                            {isAr ? 'الملخص المقترح من المقتطف (إنجليزي)' : 'Suggested Excerpt Summary (English)'}
                          </span>
                          <p className="text-gray-800 dark:text-gray-200 leading-relaxed select-all">
                            {peiaStatus.libraryPreparation.suggestedSummaryEn}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div
                        data-testid="peia-completed-metadata-only-summary-notice"
                        className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100/70 dark:bg-gray-800/50 text-xs text-gray-700 dark:text-gray-300"
                      >
                        <span className="font-extrabold">
                          {isAr ? 'ملاحظة النزاهة التحريرية للملخص (MetadataOnly): ' : 'MetadataOnly Summary Truthfulness Notice: '}
                        </span>
                        {isAr
                          ? 'قيم الملخص المقترح (suggestedSummaryAr / suggestedSummaryEn) فارغة (null) لأن أساس الإدخال هو البيانات الوصفية فقط (MetadataOnly) ولم يتم قراءة نص الوثيقة الخارجي.'
                          : 'Both suggestedSummaryAr and suggestedSummaryEn are null because inputBasis is MetadataOnly and the unread external document body was not fabricated.'}
                      </div>
                    )}

                    {/* Bilingual Provenance Observations & Uncertainty Notices */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 space-y-2">
                        <span className="text-[10px] font-bold text-gray-500 uppercase block">
                          {isAr
                            ? 'ملاحظات المصدر والأصل المرجعي (عربي / إنجليزي)'
                            : 'Provenance & Source Observations (AR / EN)'}
                        </span>
                        <ul className="list-disc list-inside space-y-1 text-gray-700 dark:text-gray-300">
                          {peiaStatus.libraryPreparation.provenanceObservationsAr.map((obs, idx) => (
                            <li key={`prov-ar-${idx}`}>{obs}</li>
                          ))}
                        </ul>
                        <ul className="list-disc list-inside space-y-1 text-gray-600 dark:text-gray-400 border-t border-gray-200/70 dark:border-gray-700/70 pt-1.5">
                          {peiaStatus.libraryPreparation.provenanceObservationsEn.map((obs, idx) => (
                            <li key={`prov-en-${idx}`}>{obs}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 space-y-2">
                        <span className="text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase block">
                          {isAr
                            ? 'تنبيهات عدم اليقين والتحقق البشري (عربي / إنجليزي)'
                            : 'Uncertainty & Verification Notices (AR / EN)'}
                        </span>
                        <ul className="list-disc list-inside space-y-1 text-amber-900 dark:text-amber-200">
                          {peiaStatus.libraryPreparation.uncertaintyNoticesAr.map((notice, idx) => (
                            <li key={`unc-ar-${idx}`}>{notice}</li>
                          ))}
                        </ul>
                        <ul className="list-disc list-inside space-y-1 text-amber-800 dark:text-amber-300 border-t border-amber-200/70 dark:border-amber-800/60 pt-1.5">
                          {peiaStatus.libraryPreparation.uncertaintyNoticesEn.map((notice, idx) => (
                            <li key={`unc-en-${idx}`}>{notice}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {/* STATE C2: Completed + ABSTAINED */}
                {peiaStatus.status === AITaskStatus.Completed &&
                  !peiaStatus.libraryPreparation &&
                  peiaStatus.nonAdvisoryOutcome?.kind === 'ABSTAINED' && (
                    <div
                      data-testid="peia-status-completed-abstained"
                      className="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/30 text-xs space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-extrabold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                          <span>
                            {isAr
                              ? 'اكتملت معالجة المهمة دون إنتاج مقترحات استشارية — امتناع PEIA'
                              : 'PEIA Processing Completed — No Advisory Produced (Abstained)'}
                          </span>
                        </span>
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-mono font-bold text-[10px]">
                          {AITaskStatus.Completed}
                        </span>
                      </div>

                      <p className="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                        {isAr
                          ? 'اكتملت معالجة المهمة في نظام PEIA دون إصدار مقترحات فهرسة استشارية (امتناع استرشادي). لا يُعد هذا الامتناع فشلاً للمهمة ولا يقوم بالموافقة أو الرفض أو الترقية التلقائية لأي سجل استقبال.'
                          : 'PEIA task processing completed without producing advisory cataloging suggestions (abstained outcome). This is not a task failure and does not automatically approve, reject, or promote any intake record.'}
                      </p>

                      <div className="space-y-1.5 text-amber-900 dark:text-amber-200 pt-1">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-mono">
                          <div>Task ID: {peiaStatus.taskId}</div>
                          <div>Outcome Kind: {peiaStatus.nonAdvisoryOutcome.kind}</div>
                          <div>Reason Code: {peiaStatus.nonAdvisoryOutcome.reason}</div>
                          <div>Completed At: {peiaStatus.nonAdvisoryOutcome.createdAt}</div>
                          <div>Model Attempts: {peiaStatus.nonAdvisoryOutcome.modelAttempts}</div>
                          <div>Target Version: {peiaStatus.taskSourceUpdatedAt ?? 'N/A'}</div>
                        </div>
                        {peiaStatus.nonAdvisoryOutcome.detail && (
                          <p
                            data-testid="peia-abstained-detail"
                            className="text-[11px] text-amber-800 dark:text-amber-300 font-mono break-words"
                          >
                            {peiaStatus.nonAdvisoryOutcome.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                {/* STATE D: Failed */}
                {peiaStatus.status === AITaskStatus.Failed && (
                  <div
                    data-testid="peia-status-failed"
                    className="p-4 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/30 text-xs space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-extrabold text-rose-900 dark:text-rose-200 flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                        <span>
                          {isAr
                            ? 'تعذر إكمال مهمة التحضير الاسترشادي (PEIA Task Failed — غير مكتملة)'
                            : 'PEIA Preparation Task Failed (Non-Advisory Outcome)'}
                        </span>
                      </span>
                      <span className="px-2.5 py-0.5 rounded-full bg-rose-200 dark:bg-rose-900 text-rose-900 dark:text-rose-200 font-mono font-bold text-[10px]">
                        {AITaskStatus.Failed}
                      </span>
                    </div>

                    {peiaStatus.nonAdvisoryOutcome ? (
                      <div className="space-y-1.5 text-rose-900 dark:text-rose-200">
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                          <div>Outcome Kind: {peiaStatus.nonAdvisoryOutcome.kind}</div>
                          <div>Reason Code: {peiaStatus.nonAdvisoryOutcome.reason}</div>
                          <div>Failed At: {peiaStatus.nonAdvisoryOutcome.createdAt}</div>
                          <div>Model Attempts: {peiaStatus.nonAdvisoryOutcome.modelAttempts}</div>
                        </div>
                        {peiaStatus.nonAdvisoryOutcome.detail && (
                          <p className="text-[11px] text-rose-800 dark:text-rose-300 font-mono">
                            {peiaStatus.nonAdvisoryOutcome.detail}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[11px] text-rose-800 dark:text-rose-300">
                        {isAr
                          ? 'فشلت المهمة دون إنتاج مخرجات استرشادية.'
                          : 'The task failed without producing advisory output.'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Read-Only Historical / Legacy Gemini Suggestion Compatibility Section */}
            {aiPrepIntake.aiSuggestion && (
              <div
                data-testid="legacy-gemini-suggestion-readonly"
                className="space-y-3 pt-4 border-t-2 border-dashed border-gray-200 dark:border-gray-800"
              >
                <div className="p-3.5 rounded-xl bg-gray-100 dark:bg-gray-800/80 border border-gray-300 dark:border-gray-700 text-gray-800 dark:text-gray-200 text-xs space-y-1">
                  <div className="font-extrabold flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-gray-600 dark:text-gray-400 shrink-0" />
                      <span>
                        {isAr
                          ? 'سجل تاريخي للقراءة فقط — مقترحات تحضير سابقة (Legacy Gemini AI Suggestion)'
                          : 'Read-Only Historical Record — Legacy Gemini AI Suggestion'}
                      </span>
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-mono text-[10px] font-bold">
                      READ-ONLY LEGACY
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                    {isAr
                      ? 'يُعرض هذا القسم لأغراض الأرشفة والتدقيق فقط للحفاظ على المقترحات السابقة المخزنة في السجل، بينما يتم التحضير القياسي الحالي حصرياً عبر نظام PEIA أعلاه.'
                      : 'This section is preserved strictly as a read-only historical record of earlier stored suggestions. Canonical preparation is now performed exclusively via PEIA above.'}
                  </p>
                  <div className="flex flex-wrap gap-3 pt-1 text-[10px] font-mono text-gray-600 dark:text-gray-400">
                    <span>Legacy Model: {aiPrepIntake.aiSuggestion.modelId}</span>
                    <span>Basis: {aiPrepIntake.aiSuggestion.inputBasis}</span>
                    <span>By: {aiPrepIntake.aiSuggestion.generatedByAdminName}</span>
                    <span>At: {aiPrepIntake.aiSuggestion.generatedAt}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs opacity-90">
                  <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-800/30 space-y-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase">
                      {isAr ? 'العنوان التاريخي المقترح (عربي)' : 'Legacy Suggested Title (Arabic)'}
                    </span>
                    <p className="font-bold text-gray-800 dark:text-gray-200">
                      {aiPrepIntake.aiSuggestion.suggestedTitleAr}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-800/30 space-y-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase">
                      {isAr ? 'العنوان التاريخي المقترح (إنجليزي)' : 'Legacy Suggested Title (English)'}
                    </span>
                    <p className="font-bold text-gray-800 dark:text-gray-200">
                      {aiPrepIntake.aiSuggestion.suggestedTitleEn}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-800/30 space-y-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase">
                      {isAr ? 'الجهة المصدرة التاريخية المقترحة' : 'Legacy Suggested Issuing Organization'}
                    </span>
                    <p className="font-bold text-gray-700 dark:text-gray-300">
                      {aiPrepIntake.aiSuggestion.suggestedIssuingOrganization}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-800/30 space-y-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase">
                      {isAr ? 'نوع الوثيقة التاريخي المقترح' : 'Legacy Suggested Document Type'}
                    </span>
                    <p className="font-bold text-gray-700 dark:text-gray-300">
                      {aiPrepIntake.aiSuggestion.suggestedDocumentType}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex justify-end">
              <button
                type="button"
                onClick={handleClosePeiaPreparationModal}
                className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-xs cursor-pointer"
              >
                {isAr ? 'إغلاق نافذة التحضير' : 'Close Preparation Assistant'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Private Quarantine Document Upload Panel */}
      <LibraryQuarantineUploadPanel
        currentUser={currentUser}
        isOpen={isQuarantineUploadOpen}
        onClose={() => setIsQuarantineUploadOpen(false)}
        isAr={isAr}
        runtimeDependencies={quarantineUploadRuntimeDeps}
        controller={quarantineUploadController}
      />

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

