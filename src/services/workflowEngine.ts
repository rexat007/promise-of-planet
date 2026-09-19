import { AdminPermission } from '../types/admin';
import type { AdminUser } from '../types/admin';
import { WorkflowState, WorkflowAction } from '../types/workflow';
import type { 
  ContentWorkflowItem, 
  WorkflowTransitionConfig, 
  WorkflowTransitionRecord 
} from '../types/workflow';
import { AdminAccessService } from './adminAccess';

/**
 * Master list of valid state transitions in the system.
 */
export const ALLOWED_TRANSITIONS: WorkflowTransitionConfig[] = [
  {
    action: WorkflowAction.SubmitForReview,
    fromState: WorkflowState.Draft,
    toState: WorkflowState.InReview,
    requiredPermission: AdminPermission.Create,
    labelAr: 'تقديم للمراجعة',
    labelEn: 'Submit for Review',
    requiresComment: false,
  },
  {
    action: WorkflowAction.RequestChanges,
    fromState: WorkflowState.InReview,
    toState: WorkflowState.ChangesRequested,
    requiredPermission: AdminPermission.Review,
    labelAr: 'طلب تعديلات',
    labelEn: 'Request Changes',
    requiresComment: true,
  },
  {
    action: WorkflowAction.Approve,
    fromState: WorkflowState.InReview,
    toState: WorkflowState.Approved,
    requiredPermission: AdminPermission.Approve,
    labelAr: 'اعتماد المادة',
    labelEn: 'Approve Content',
    requiresComment: false,
  },
  {
    action: WorkflowAction.ReviseDraft,
    fromState: WorkflowState.ChangesRequested,
    toState: WorkflowState.Draft,
    requiredPermission: AdminPermission.Edit,
    labelAr: 'تعديل وإعادة المسودة',
    labelEn: 'Revise & Redraft',
    requiresComment: false,
  },
  {
    action: WorkflowAction.Publish,
    fromState: WorkflowState.Approved,
    toState: WorkflowState.Published,
    requiredPermission: AdminPermission.Publish,
    labelAr: 'نشر للمحل والجمهور',
    labelEn: 'Publish Content',
    requiresComment: false,
  },
];

export class WorkflowEngine {
  /**
   * Returns all valid transitions possible from a given state, regardless of user permissions.
   */
  public static getValidTransitionsFromState(currentState: WorkflowState): WorkflowTransitionConfig[] {
    return ALLOWED_TRANSITIONS.filter(t => t.fromState === currentState);
  }

  /**
   * Returns transitions that are valid for the state AND authorized for the given user.
   */
  public static getAuthorizedTransitions(currentState: WorkflowState, user: AdminUser): WorkflowTransitionConfig[] {
    const valid = this.getValidTransitionsFromState(currentState);
    return valid.filter(t => {
      // Check if user has the specific required permission for this action
      if (t.action === WorkflowAction.SubmitForReview) {
        return AdminAccessService.hasPermission(user, AdminPermission.Create) || 
               AdminAccessService.hasPermission(user, AdminPermission.Edit);
      }
      if (t.action === WorkflowAction.ReviseDraft) {
        return AdminAccessService.hasPermission(user, AdminPermission.Edit) || 
               AdminAccessService.hasPermission(user, AdminPermission.Create);
      }
      return AdminAccessService.hasPermission(user, t.requiredPermission);
    });
  }

  /**
   * Evaluates if a specific transition from `fromState` to `toState` is valid and authorized for `user`.
   */
  public static canExecuteTransition(
    fromState: WorkflowState, 
    toState: WorkflowState, 
    user: AdminUser
  ): { allowed: boolean; reason?: string } {
    // 1. Check if state machine allows this step
    const transition = ALLOWED_TRANSITIONS.find(t => t.fromState === fromState && t.toState === toState);
    if (!transition) {
      return { 
        allowed: false, 
        reason: `State transition from [${fromState}] to [${toState}] is not permitted by the workflow lifecycle rules.` 
      };
    }

    // 2. Check RBAC authority
    const isAuthorized = this.getAuthorizedTransitions(fromState, user).some(t => t.toState === toState);
    if (!isAuthorized) {
      return { 
        allowed: false, 
        reason: `Role (${user.role}) lacks the required permission [${transition.requiredPermission}] to execute action "${transition.labelEn}".` 
      };
    }

    return { allowed: true };
  }

  /**
   * Executes a state transition on an item, recording an audit log entry.
   */
  public static executeTransition(
    item: ContentWorkflowItem,
    toState: WorkflowState,
    actor: AdminUser,
    comment?: string
  ): ContentWorkflowItem {
    const check = this.canExecuteTransition(item.currentState, toState, actor);
    if (!check.allowed) {
      throw new Error(check.reason || 'Unauthorized transition attempt.');
    }

    const transitionConfig = ALLOWED_TRANSITIONS.find(t => t.fromState === item.currentState && t.toState === toState)!;

    const transitionRecord: WorkflowTransitionRecord = {
      id: `tr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      fromState: item.currentState,
      toState,
      action: transitionConfig.action,
      actorName: actor.name,
      actorRole: actor.role,
      timestamp: new Date().toISOString(),
      comment: comment?.trim() || undefined,
    };

    return {
      ...item,
      currentState: toState,
      updatedAt: new Date().toISOString(),
      history: [transitionRecord, ...item.history],
    };
  }

  /**
   * Seed mock content items demonstrating all 5 states in the lifecycle.
   */
  public static getSeedWorkflowItems(): ContentWorkflowItem[] {
    const now = new Date().toISOString();
    return [
      {
        id: 'item-101',
        titleAr: 'تقرير رصد الجفاف في ولاية القضارف ومخاطر المحاصيل',
        titleEn: 'Gadarif Drought Observation & Crop Vulnerability Report',
        contentType: 'Report',
        currentState: WorkflowState.InReview,
        authorName: 'Sarah Ahmed',
        createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        updatedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
        category: 'Climate Impact',
        history: [
          {
            id: 'tr-001',
            fromState: WorkflowState.Draft,
            toState: WorkflowState.InReview,
            action: WorkflowAction.SubmitForReview,
            actorName: 'Sarah Ahmed',
            actorRole: 'ContentEditor',
            timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
          }
        ]
      },
      {
        id: 'item-102',
        titleAr: 'دليل الإرشاد الحقلي للحد من تلوث مياه البحر الأحمر',
        titleEn: 'Field Guidance for Red Sea Marine Pollution Control',
        contentType: 'LibraryItem',
        currentState: WorkflowState.ChangesRequested,
        authorName: 'Khalid Yousif',
        createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
        updatedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
        category: 'Marine Ecosystems',
        history: [
          {
            id: 'tr-002',
            fromState: WorkflowState.InReview,
            toState: WorkflowState.ChangesRequested,
            action: WorkflowAction.RequestChanges,
            actorName: 'Amna Al-Bashir',
            actorRole: 'RightsReviewer',
            timestamp: new Date(Date.now() - 3600000 * 12).toISOString(),
            comment: 'يرجى تزويد قائمة المراجع العلمية بدراسات جامعة الخرطوم لعام 2025 واعتمد التوثيق الرسمي.'
          },
          {
            id: 'tr-003',
            fromState: WorkflowState.Draft,
            toState: WorkflowState.InReview,
            action: WorkflowAction.SubmitForReview,
            actorName: 'Khalid Yousif',
            actorRole: 'LibraryCurator',
            timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
          }
        ]
      },
      {
        id: 'item-103',
        titleAr: 'حقيبة التدريب الاستقصائي على تحليل بيانات المناخ بالـ GIS',
        titleEn: 'Investigative Climate Data Analysis via GIS Training Kit',
        contentType: 'Course',
        currentState: WorkflowState.Approved,
        authorName: 'Mustafa Hassan',
        createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
        updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
        category: 'Capacity Building',
        history: [
          {
            id: 'tr-004',
            fromState: WorkflowState.InReview,
            toState: WorkflowState.Approved,
            action: WorkflowAction.Approve,
            actorName: 'Mustafa Hassan',
            actorRole: 'TrainingManager',
            timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
          },
          {
            id: 'tr-005',
            fromState: WorkflowState.Draft,
            toState: WorkflowState.InReview,
            action: WorkflowAction.SubmitForReview,
            actorName: 'Dr. Tariq Ali',
            actorRole: 'Trainer',
            timestamp: new Date(Date.now() - 86400000 * 4).toISOString(),
          }
        ]
      },
      {
        id: 'item-104',
        titleAr: 'تغطية ميدانية: مبادرات التشجير المجتمعي بولاية سنار',
        titleEn: 'Field Coverage: Community Reforestation in Sennar State',
        contentType: 'News',
        currentState: WorkflowState.Published,
        authorName: 'Abbass Abdelhalim',
        createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
        updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
        category: 'Community News',
        history: [
          {
            id: 'tr-006',
            fromState: WorkflowState.Approved,
            toState: WorkflowState.Published,
            action: WorkflowAction.Publish,
            actorName: 'Abbass Abdelhalim',
            actorRole: 'Owner',
            timestamp: new Date(Date.now() - 86400000 * 1).toISOString(),
          },
          {
            id: 'tr-007',
            fromState: WorkflowState.InReview,
            toState: WorkflowState.Approved,
            action: WorkflowAction.Approve,
            actorName: 'Abbass Abdelhalim',
            actorRole: 'Owner',
            timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
          },
          {
            id: 'tr-008',
            fromState: WorkflowState.Draft,
            toState: WorkflowState.InReview,
            action: WorkflowAction.SubmitForReview,
            actorName: 'Sarah Ahmed',
            actorRole: 'ContentEditor',
            timestamp: new Date(Date.now() - 86400000 * 6).toISOString(),
          }
        ]
      },
      {
        id: 'item-105',
        titleAr: 'مسودة أولية: تقييم الأثر البيئي للفيضانات الموسمية بالنيل الأزرق',
        titleEn: 'Initial Draft: Blue Nile Seasonal Flood Environmental Assessment',
        contentType: 'News',
        currentState: WorkflowState.Draft,
        authorName: 'Sarah Ahmed',
        createdAt: now,
        updatedAt: now,
        category: 'Environmental Disasters',
        history: []
      }
    ];
  }
}
