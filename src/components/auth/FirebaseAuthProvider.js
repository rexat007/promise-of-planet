"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FirebaseAuthProvider = FirebaseAuthProvider;
exports.useFirebaseAuth = useFirebaseAuth;
const react_1 = require("react");
const firebase_1 = require("../../services/firebase");
const adminAccess_1 = require("../../services/adminAccess");
const FirebaseAuthContext = (0, react_1.createContext)(undefined);
function FirebaseAuthProvider({ children }) {
    const [firebaseUser, setFirebaseUser] = (0, react_1.useState)(null);
    const [canonicalAdminUser, setCanonicalAdminUser] = (0, react_1.useState)(null);
    const [isAuthLoading, setIsAuthLoading] = (0, react_1.useState)(true);
    // Default fallback mock users list for lookup
    const [allAdmins] = (0, react_1.useState)(() => adminAccess_1.AdminAccessService.getMockUsers());
    (0, react_1.useEffect)(() => {
        // Standard Firebase Auth listener (Identity/Session gate)
        const unsubscribe = (0, firebase_1.onAuthStateChanged)(firebase_1.auth, (user) => {
            setFirebaseUser(user);
            if (user) {
                // BRIDGE: Map authenticated identity to a canonical AdminUser
                // Fallback search by ID or email
                const matchedAdmin = allAdmins.find(admin => admin.id === user.uid || admin.email.toLowerCase() === user.email?.toLowerCase());
                if (matchedAdmin) {
                    setCanonicalAdminUser({ ...matchedAdmin });
                }
                else {
                    // Authenticated but has no administrative profile - defaults to guest viewer safety
                    setCanonicalAdminUser(null);
                }
            }
            else {
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
        await (0, firebase_1.signOut)(firebase_1.auth);
        setCanonicalAdminUser(null);
        setIsAuthLoading(false);
    };
    // Helper function to allow simulating administrative sessions safely in local dev/demo
    const simulateSignIn = (email) => {
        const matchedAdmin = allAdmins.find(admin => admin.email.toLowerCase() === email.toLowerCase());
        if (matchedAdmin) {
            setCanonicalAdminUser({ ...matchedAdmin });
        }
        else {
            setCanonicalAdminUser(null);
        }
    };
    return (<FirebaseAuthContext.Provider value={{
            firebaseUser,
            canonicalAdminUser,
            isAuthLoading,
            signOut,
            simulateSignIn,
        }}>
      {children}
    </FirebaseAuthContext.Provider>);
}
function useFirebaseAuth() {
    const context = (0, react_1.useContext)(FirebaseAuthContext);
    if (!context) {
        throw new Error('useFirebaseAuth must be used within a FirebaseAuthProvider');
    }
    return context;
}
//# sourceMappingURL=FirebaseAuthProvider.js.map