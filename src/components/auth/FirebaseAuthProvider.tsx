import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { auth, onAuthStateChanged, signOut as firebaseSignOut } from '../../services/firebase';
import { AdminAccessService } from '../../services/adminAccess';
import type { AdminUser } from '../../types/admin';

interface FirebaseAuthContextType {
  firebaseUser: User | null;
  canonicalAdminUser: AdminUser | null;
  isAuthLoading: boolean;
  signOut: () => Promise<void>;
  simulateSignIn: (email: string) => void;
}

const FirebaseAuthContext = createContext<FirebaseAuthContextType | undefined>(undefined);

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [canonicalAdminUser, setCanonicalAdminUser] = useState<AdminUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Default fallback mock users list for lookup
  const [allAdmins, setAllAdmins] = useState<AdminUser[]>(() => AdminAccessService.getMockUsers());

  useEffect(() => {
    // Standard Firebase Auth listener (Identity/Session gate)
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      
      if (user) {
        // BRIDGE: Map authenticated identity to a canonical AdminUser
        // Fallback search by email, then link the Firebase UID as the stable reference
        const matchedAdmin = allAdmins.find(
          admin => admin.firebaseUid === user.uid || admin.email.toLowerCase() === user.email?.toLowerCase()
        );

        if (matchedAdmin) {
          // Bind the Firebase UID if not yet populated
          if (!matchedAdmin.firebaseUid) {
            matchedAdmin.firebaseUid = user.uid;
            setAllAdmins(prev => prev.map(a => a.id === matchedAdmin.id ? matchedAdmin : a));
          }
          setCanonicalAdminUser({ ...matchedAdmin });
        } else {
          // Authenticated but has no administrative profile - defaults to guest viewer safety
          setCanonicalAdminUser(null);
        }
      } else {
        setCanonicalAdminUser(null);
      }
      setIsAuthLoading(false);
    }, (error) => {
      console.error("Firebase Auth State Change Error:", error);
      setIsAuthLoading(false);
    });

    return unsubscribe;
  }, [allAdmins]);

  const signOut = async () => {
    setIsAuthLoading(true);
    await firebaseSignOut(auth);
    setCanonicalAdminUser(null);
    setIsAuthLoading(false);
  };

  // Helper function to allow simulating administrative sessions safely in local dev/demo
  const simulateSignIn = (email: string) => {
    const matchedAdmin = allAdmins.find(admin => admin.email.toLowerCase() === email.toLowerCase());
    if (matchedAdmin) {
      setCanonicalAdminUser({ ...matchedAdmin });
    } else {
      setCanonicalAdminUser(null);
    }
  };

  return (
    <FirebaseAuthContext.Provider
      value={{
        firebaseUser,
        canonicalAdminUser,
        isAuthLoading,
        signOut,
        simulateSignIn,
      }}
    >
      {children}
    </FirebaseAuthContext.Provider>
  );
}

export function useFirebaseAuth() {
  const context = useContext(FirebaseAuthContext);
  if (!context) {
    throw new Error('useFirebaseAuth must be used within a FirebaseAuthProvider');
  }
  return context;
}
