import { AdminPermission } from '../shared/adminContract';

export {
  AdminRole,
  AdminPermission,
  type AdminUser,
  ROLE_PERMISSIONS_MAP,
  isValidAdminRole,
  isValidAdminPermission,
  getPermissionsForRole,
  hasAdminPermission,
} from '../shared/adminContract';

export interface NavigationItem {
  id: string;
  labelAr: string;
  labelEn: string;
  iconName: string;
  requiredPermission?: AdminPermission;
}

export interface PlatformMetrics {
  totalNews: number;
  totalLibraryItems: number;
  totalCourses: number;
  pendingReviewsCount: number;
  awaitingApprovalCount: number;
  activeDraftsCount: number;
  flaggedCommunityItemsCount: number;
}

export interface QueueItem {
  id: string;
  titleAr: string;
  titleEn: string;
  contentType: 'News' | 'LibraryItem' | 'Course' | 'CommunityPost' | 'RightsAudit';
  status: 'PendingReview' | 'Draft' | 'AwaitingApproval' | 'Flagged';
  submittedBy: string;
  submittedAt: string;
  category: string;
}

export interface OperationalAlert {
  id: string;
  type: 'info' | 'warning' | 'critical';
  messageAr: string;
  messageEn: string;
  timestamp: string;
}
