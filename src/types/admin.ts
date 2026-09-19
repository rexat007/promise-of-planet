export const AdminRole = {
  Owner: 'Owner',
  ContentEditor: 'ContentEditor',
  LibraryCurator: 'LibraryCurator',
  RightsReviewer: 'RightsReviewer',
  TrainingManager: 'TrainingManager',
  Trainer: 'Trainer',
  CitizenModerator: 'CitizenModerator',
  AIAssistant: 'AIAssistant',
  Viewer: 'Viewer',
} as const;

export type AdminRole = typeof AdminRole[keyof typeof AdminRole];

export const AdminPermission = {
  View: 'view',
  Create: 'create',
  Edit: 'edit',
  Review: 'review',
  Approve: 'approve',
  Publish: 'publish',
  ManageRights: 'manageRights',
  ManageUsers: 'manageUsers',
  ManageSettings: 'manageSettings',
  ViewReports: 'viewReports',
} as const;

export type AdminPermission = typeof AdminPermission[keyof typeof AdminPermission];

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  isActive: boolean;
  firebaseUid?: string;
}

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
