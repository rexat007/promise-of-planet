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
