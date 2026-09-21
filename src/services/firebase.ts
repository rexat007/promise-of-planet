import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, onAuthStateChanged as realOnAuthStateChanged, signOut as realSignOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';

// Multi-environment safe reference to prevent Node-based CLI test crashes (where import.meta.env is undefined)
const env = (typeof import.meta !== 'undefined' && import.meta.env)
  ? import.meta.env
  : (typeof globalThis !== 'undefined' && 'process' in globalThis)
    ? (globalThis as any).process.env || {}
    : {};

// Authoritative client configuration: environment variables only to guarantee a single runtime configuration authority.
// All keys are browser-safe.
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "",
  appId: env.VITE_FIREBASE_APP_ID || "",
};

// Detect whether a valid, non-blank configuration exists
export const isFirebaseConfigured = !!(
  firebaseConfig.apiKey &&
  firebaseConfig.apiKey.trim() !== "" &&
  firebaseConfig.projectId &&
  firebaseConfig.projectId.trim() !== ""
);

export let app: any = null;
export let db: any = null;
export let auth: any = null;

if (isFirebaseConfigured) {
  // Safe client-side initialization
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  db = getFirestore(app);
  auth = getAuth(app);
} else {
  // UNCONFIGURED FIREBASE = INACTIVE INTEGRATION (NO FAKES/MOCKS)
  // We leave app, db, and auth as null. No simulated database or fake authentication is supplied.
  console.warn("Firebase Backend Foundation: Unconfigured. Integration remains inactive.");
}

// Wrapped onAuthStateChanged that handles safe fallback
export function onAuthStateChanged(
  authInstance: any,
  next: (user: User | null) => void,
  error?: (err: any) => void
): () => void {
  if (isFirebaseConfigured && authInstance) {
    return realOnAuthStateChanged(authInstance, next, error);
  } else {
    // Unconfigured Firebase = Inactive integration.
    // Trigger callback with null immediately to ensure the app doesn't hang in a "loading" state,
    // but do NOT emit any fake simulated user.
    next(null);
    return () => {}; // Return no-op unsubscribe function
  }
}

// Wrapped signOut that handles safe fallback
export async function signOut(authInstance: any): Promise<void> {
  if (isFirebaseConfigured && authInstance) {
    await realSignOut(authInstance);
  } else {
    // No-op for inactive integration
  }
}

// Test connection on application boot (Critical Constraint)
export async function testConnection() {
  if (!isFirebaseConfigured) {
    console.warn("Firebase configuration is blank. Remote database connection skipped.");
    return;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}

// -----------------------------------------------------------------------------
// SECURE FIRESTORE ERROR HANDLING GATEWAY
// -----------------------------------------------------------------------------
export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
} as const;

export type OperationType = typeof OperationType[keyof typeof OperationType];

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid || null,
    },
    operationType,
    path
  };
  // Internal diagnostic logging retains full details safely for server/console inspection
  console.error('Firestore Error: ', JSON.stringify(errInfo));

  // The outward thrown Error is strictly bounded and stripped of internal path, UID, or raw error string
  throw new Error('FIRESTORE_ACCESS_ERROR: Database operation failed. Details redacted for security.');
}
