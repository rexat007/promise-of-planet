import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, isFirebaseConfigured } from './firebase';
import {
  AdminRole,
  AdminPermission,
  type AdminUser,
} from '../types/admin';
import { AdminAccessService } from './adminAccess';
import {
  isLibraryQuarantineReviewWorkbenchEnabled,
} from './libraryQuarantineReviewWorkbenchClient';
import {
  isLibraryQuarantineHumanReviewEnabled,
} from './libraryQuarantineHumanReviewClient';
import {
  isLibraryQuarantineCatalogHandoffEnabled,
} from './libraryQuarantineCatalogHandoffClient';
import type {
  LibraryQuarantineReadinessIndicatorsDto,
  SaveLibraryQuarantineBinarySafetyCaseInput,
  SanitizedLibraryQuarantineBinarySafetyCaseDto,
} from '../../functions/src/library/libraryQuarantineBinarySafetyCaseContract';
import {
  QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
} from '../../functions/src/library/libraryQuarantineBinarySafetyCaseContract';

export const LIBRARY_BINARY_SAFETY_CASE_UI_ENV_VAR =
  'VITE_LIBRARY_BINARY_SAFETY_CASE_ENABLED' as const;

export function isLibraryQuarantineBinarySafetyCaseEnabled(
  envOverride?: Record<string, unknown>
): boolean {
  if (!isLibraryQuarantineReviewWorkbenchEnabled(envOverride)) {
    return false;
  }
  if (!isLibraryQuarantineHumanReviewEnabled(envOverride)) {
    return false;
  }
  if (!isLibraryQuarantineCatalogHandoffEnabled(envOverride)) {
    return false;
  }
  if (envOverride !== undefined) {
    if (!isPlainRecord(envOverride)) {
      return false;
    }
    return envOverride[LIBRARY_BINARY_SAFETY_CASE_UI_ENV_VAR] === 'true';
  }
  const viteEnv = (
    import.meta as unknown as { readonly env?: Record<string, unknown> }
  )?.env;
  if (!viteEnv || typeof viteEnv !== 'object') {
    return false;
  }
  return viteEnv[LIBRARY_BINARY_SAFETY_CASE_UI_ENV_VAR] === 'true';
}

export function canUserManageBinarySafetyCases(
  user: AdminUser | null | undefined
): boolean {
  if (!user || typeof user !== 'object') {
    return false;
  }
  if (user.isActive !== true) {
    return false;
  }
  if (user.role !== AdminRole.Owner) {
    return false;
  }
  return AdminAccessService.hasPermission(user, AdminPermission.Review);
}

const QUARANTINE_RECEIPT_ID_REGEX = /^[0-9a-f]{32}$/;

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === 'object' && !Array.isArray(val) && Object.getOwnPropertySymbols(val).length === 0;
}

export interface BinarySafetyCaseHoldState {
  readonly errorCode: string;
  readonly errorMessage: string;
}

export interface BinarySafetyCaseConflictState {
  readonly currentRevision: number;
  readonly currentBinarySafetyCase: SanitizedLibraryQuarantineBinarySafetyCaseDto | null;
  readonly errorMessage: string;
}

export interface BinarySafetyCaseUncertainState {
  readonly errorMessage: string;
}

export interface LibraryQuarantineBinarySafetyCaseControllerState {
  readonly phase: 'idle' | 'loading' | 'ready' | 'saving' | 'hold' | 'conflict' | 'uncertain' | 'error';
  readonly receiptId: string;
  readonly snapshot: {
    readonly currentRevision: number;
    readonly isCaseCurrent: boolean;
    readonly requiresFreshEvidence: boolean;
    readonly sourceFormat: string;
    readonly deepInspectionStatus: string;
    readonly readiness: LibraryQuarantineReadinessIndicatorsDto;
    readonly binarySafetyCase: SanitizedLibraryQuarantineBinarySafetyCaseDto | null;
  } | null;
  readonly inFlight: boolean;
  readonly errorMessage: string | null;
  readonly holdState: BinarySafetyCaseHoldState | null;
  readonly conflictState: BinarySafetyCaseConflictState | null;
  readonly uncertainState: BinarySafetyCaseUncertainState | null;
}

export class LibraryQuarantineBinarySafetyCaseController {
  private readonly receiptId: string;
  private readonly runtimeOverrides?: {
    readonly invokeCallable?: (action: string, data: Record<string, unknown>) => Promise<any>;
    readonly envOverride?: Record<string, unknown>;
  };

  private state: LibraryQuarantineBinarySafetyCaseControllerState = {
    phase: 'idle',
    receiptId: '',
    snapshot: null,
    inFlight: false,
    errorMessage: null,
    holdState: null,
    conflictState: null,
    uncertainState: null,
  };

  private listeners: Array<(state: LibraryQuarantineBinarySafetyCaseControllerState) => void> = [];

  constructor(
    receiptId: string,
    runtimeOverrides?: {
      readonly invokeCallable?: (action: string, data: Record<string, unknown>) => Promise<any>;
      readonly envOverride?: Record<string, unknown>;
    }
  ) {
    if (!QUARANTINE_RECEIPT_ID_REGEX.test(receiptId)) {
      throw new Error('INVALID_RECEIPT_ID: receiptId must be a 32-character lowercase hex string.');
    }
    this.receiptId = receiptId;
    this.runtimeOverrides = runtimeOverrides;
    this.state = {
      ...this.state,
      receiptId,
    };
  }

  public getState(): LibraryQuarantineBinarySafetyCaseControllerState {
    return this.state;
  }

  public subscribe(listener: (state: LibraryQuarantineBinarySafetyCaseControllerState) => void): () => void {
    this.listeners.push(listener);
    listener(this.state);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private setState(updater: Partial<LibraryQuarantineBinarySafetyCaseControllerState>): void {
    this.state = Object.freeze({
      ...this.state,
      ...updater,
    });
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private async invokeBackend(action: string, data: Record<string, unknown>): Promise<any> {
    if (this.runtimeOverrides?.invokeCallable) {
      return this.runtimeOverrides.invokeCallable(action, data);
    }
    if (!isFirebaseConfigured || !app) {
      throw new Error('FIREBASE_UNCONFIGURED: Firebase is not initialized.');
    }
    const functions = getFunctions(app);
    const fn = httpsCallable(functions, 'manageLibraryDocuments');
    const result = await fn({
      action,
      receiptId: this.receiptId,
      ...data,
    });
    return result.data;
  }

  public async loadCase(): Promise<void> {
    if (!isLibraryQuarantineBinarySafetyCaseEnabled(this.runtimeOverrides?.envOverride)) {
      this.setState({
        phase: 'hold',
        holdState: {
          errorCode: 'BINARY_SAFETY_CASE_NOT_RELEASED',
          errorMessage: 'Library binary safety case feature flag is disabled.',
        },
      });
      return;
    }

    this.setState({ phase: 'loading', inFlight: true, errorMessage: null });

    try {
      const response = await this.invokeBackend('getQuarantineBinarySafetyCase', {});
      if (!isPlainRecord(response)) {
        throw new Error('INVALID_RESPONSE: Response must be a plain object.');
      }

      if (response.ok === false) {
        if (response.outcome === 'HOLD') {
          this.setState({
            phase: 'hold',
            inFlight: false,
            holdState: {
              errorCode: String(response.errorCode || 'HOLD'),
              errorMessage: String(response.errorMessage || 'Binary safety case on hold.'),
            },
          });
          return;
        }
        throw new Error(String(response.errorMessage || 'Failed to load binary safety case.'));
      }

      this.setState({
        phase: 'ready',
        inFlight: false,
        snapshot: {
          currentRevision: Number(response.currentRevision || 0),
          isCaseCurrent: Boolean(response.isCaseCurrent),
          requiresFreshEvidence: Boolean(response.requiresFreshEvidence),
          sourceFormat: String(response.sourceFormat || 'unknown'),
          deepInspectionStatus: String(response.deepInspectionStatus || 'PENDING'),
          readiness: QUARANTINE_BINARY_SAFETY_READINESS_INDICATORS,
          binarySafetyCase: response.binarySafetyCase ? (response.binarySafetyCase as SanitizedLibraryQuarantineBinarySafetyCaseDto) : null,
        },
        holdState: null,
        conflictState: null,
        uncertainState: null,
      });
    } catch (err: any) {
      this.setState({
        phase: 'error',
        inFlight: false,
        errorMessage: err?.message || String(err),
      });
    }
  }

  public async saveCase(
    expectedRevision: number,
    input: SaveLibraryQuarantineBinarySafetyCaseInput
  ): Promise<any> {
    if (!isLibraryQuarantineBinarySafetyCaseEnabled(this.runtimeOverrides?.envOverride)) {
      throw new Error('BINARY_SAFETY_CASE_NOT_RELEASED');
    }

    this.setState({ phase: 'saving', inFlight: true, errorMessage: null });

    try {
      const response = await this.invokeBackend('saveQuarantineBinarySafetyCase', {
        expectedRevision,
        input,
      });

      if (!isPlainRecord(response)) {
        throw new Error('INVALID_RESPONSE: Response must be a plain object.');
      }

      if (response.ok === false) {
        if (response.outcome === 'CONFLICT') {
          this.setState({
            phase: 'conflict',
            inFlight: false,
            conflictState: {
              currentRevision: Number(response.currentRevision || 0),
              currentBinarySafetyCase: response.currentBinarySafetyCase ? (response.currentBinarySafetyCase as SanitizedLibraryQuarantineBinarySafetyCaseDto) : null,
              errorMessage: String(response.errorMessage || 'Revision conflict detected.'),
            },
          });
          return response;
        }
        if (response.outcome === 'HOLD') {
          this.setState({
            phase: 'hold',
            inFlight: false,
            holdState: {
              errorCode: String(response.errorCode || 'HOLD'),
              errorMessage: String(response.errorMessage || 'Save on hold.'),
            },
          });
          return response;
        }
        if (response.outcome === 'UNKNOWN') {
          this.setState({
            phase: 'uncertain',
            inFlight: false,
            uncertainState: {
              errorMessage: String(response.errorMessage || 'Commit uncertainty (UNKNOWN).'),
            },
          });
          return response;
        }
        throw new Error(String(response.errorMessage || 'Failed to save binary safety case.'));
      }

      // Success
      await this.loadCase();
      return response;
    } catch (err: any) {
      this.setState({
        phase: 'uncertain',
        inFlight: false,
        uncertainState: {
          errorMessage: err?.message || String(err),
        },
      });
      return {
        ok: false,
        outcome: 'UNKNOWN',
        errorCode: 'TRANSACTION_COMMIT_UNCERTAIN',
        errorMessage: err?.message || String(err),
        caseSaved: null,
      };
    }
  }
}
