"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountAuthWidget = AccountAuthWidget;
const react_1 = require("react");
const lucide_react_1 = require("lucide-react");
const accountService_1 = require("../../services/accountService");
const firebase_1 = require("../../services/firebase");
function AccountAuthWidget({ isAr = false }) {
    const [firebaseUser, setFirebaseUser] = (0, react_1.useState)(null);
    const [account, setAccount] = (0, react_1.useState)(null);
    const [loading, setLoading] = (0, react_1.useState)(true);
    const [mode, setMode] = (0, react_1.useState)('signin');
    const [email, setEmail] = (0, react_1.useState)('');
    const [password, setPassword] = (0, react_1.useState)('');
    const [displayName, setDisplayName] = (0, react_1.useState)('');
    const [error, setError] = (0, react_1.useState)(null);
    const [success, setSuccess] = (0, react_1.useState)(null);
    const [submitting, setSubmitting] = (0, react_1.useState)(false);
    // Observe auth state and load account profile
    (0, react_1.useEffect)(() => {
        const unsubscribe = accountService_1.AccountService.observeAuthState(async (user) => {
            setFirebaseUser(user);
            if (user) {
                try {
                    const acc = await accountService_1.AccountService.getAccount(user.uid);
                    setAccount(acc);
                    setMode('profile');
                }
                catch (err) {
                    console.error('Failed to load account profile:', err);
                    setError(err?.message || 'Failed to load account profile');
                }
            }
            else {
                setAccount(null);
                setMode('signin');
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);
    const handleSignIn = async (e) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        setSubmitting(true);
        try {
            await accountService_1.AccountService.signIn(email, password);
            setSuccess(isAr ? 'تم تسجيل الدخول بنجاح' : 'Signed in successfully');
            setEmail('');
            setPassword('');
        }
        catch (err) {
            setError(err?.message || (isAr ? 'فشل تسجيل الدخول' : 'Sign in failed'));
        }
        finally {
            setSubmitting(false);
        }
    };
    const handleRegister = async (e) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        setSubmitting(true);
        try {
            const res = await accountService_1.AccountService.register(email, password, displayName);
            if (res.account) {
                setAccount(res.account);
                setSuccess(isAr ? 'تم إنشاء الحساب بنجاح' : 'Account created successfully');
                setEmail('');
                setPassword('');
                setDisplayName('');
            }
            else {
                setAccount(null);
                setError(res.error || (isAr ? 'فشل إنشاء مستند الحساب' : 'Account profile document provisioning failed'));
            }
        }
        catch (err) {
            setError(err?.message || (isAr ? 'فشل إنشاء الحساب' : 'Registration failed'));
        }
        finally {
            setSubmitting(false);
        }
    };
    const handleSignOut = async () => {
        setError(null);
        try {
            await accountService_1.AccountService.signOut();
            setAccount(null);
            setSuccess(isAr ? 'تم تسجيل الخروج بنجاح' : 'Signed out successfully');
        }
        catch (err) {
            setError(err?.message || (isAr ? 'فشل تسجيل الخروج' : 'Sign out failed'));
        }
    };
    if (loading) {
        return (<div className="p-4 bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm text-center text-xs text-gray-500">
        {isAr ? 'جاري التحقق من حالة المصادقة...' : 'Verifying authentication state...'}
      </div>);
    }
    if (!firebase_1.isFirebaseConfigured) {
        return (<div className="p-4 bg-amber-50 dark:bg-amber-950/20 rounded-2xl border border-amber-200 dark:border-amber-900/60 text-xs text-amber-900 dark:text-amber-300 space-y-2">
        <div className="flex items-center gap-2 font-bold">
          <lucide_react_1.ShieldAlert className="w-4 h-4 text-amber-600 shrink-0"/>
          <span>{isAr ? 'خدمة المصادقة غير مكوّنة' : 'Authentication Service Unconfigured'}</span>
        </div>
        <p className="leading-relaxed">
          {isAr
                ? 'متغيرات بيئة Firebase غير متوفرة. تعمل المنصة في وضع التصفح العام الآمن (بدون حسابات نشطة حالياً).'
                : 'Firebase environment variables are unconfigured. The platform is running in secure public browsing mode (no active accounts).'}
        </p>
      </div>);
    }
    return (<div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 shadow-sm p-4 sm:p-6 w-full max-w-md mx-auto" dir={isAr ? 'rtl' : 'ltr'}>
      {!firebaseUser ? (<div className="space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
            <div className="flex items-center gap-2">
              <lucide_react_1.User className="w-5 h-5 text-emerald-600"/>
              <h3 className="text-sm font-extrabold text-gray-900 dark:text-white">
                {mode === 'signin'
                ? (isAr ? 'تسجيل دخول الحساب' : 'Platform Account Sign In')
                : (isAr ? 'إنشاء حساب منصة جديد' : 'Create Platform Account')}
              </h3>
            </div>
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl text-xs font-bold">
              <button type="button" onClick={() => setMode('signin')} className={`px-3 py-1 rounded-lg transition-colors ${mode === 'signin' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'}`}>
                {isAr ? 'دخول' : 'Sign In'}
              </button>
              <button type="button" onClick={() => setMode('register')} className={`px-3 py-1 rounded-lg transition-colors ${mode === 'register' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'}`}>
                {isAr ? 'تسجيل جديد' : 'Register'}
              </button>
            </div>
          </div>

          {error && (<div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/60 rounded-xl text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
              <lucide_react_1.AlertCircle className="w-4 h-4 shrink-0 mt-0.5"/>
              <span>{error}</span>
            </div>)}

          {success && (<div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/60 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
              <lucide_react_1.CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5"/>
              <span>{success}</span>
            </div>)}

          {mode === 'signin' ? (<form onSubmit={handleSignIn} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  {isAr ? 'البريد الإلكتروني' : 'Email Address'}
                </label>
                <div className="relative">
                  <lucide_react_1.Mail className={`w-4 h-4 text-gray-400 absolute top-3 ${isAr ? 'right-3' : 'left-3'}`}/>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className={`w-full py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 ${isAr ? 'pr-9 pl-3 text-right' : 'pl-9 pr-3 text-left'}`}/>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  {isAr ? 'كلمة المرور' : 'Password'}
                </label>
                <div className="relative">
                  <lucide_react_1.Lock className={`w-4 h-4 text-gray-400 absolute top-3 ${isAr ? 'right-3' : 'left-3'}`}/>
                  <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={`w-full py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 ${isAr ? 'pr-9 pl-3 text-right' : 'pl-9 pr-3 text-left'}`}/>
                </div>
              </div>

              <button type="submit" disabled={submitting} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer disabled:opacity-50">
                <lucide_react_1.LogIn className="w-4 h-4"/>
                <span>{submitting ? (isAr ? 'جاري الدخول...' : 'Signing In...') : (isAr ? 'تسجيل الدخول' : 'Sign In')}</span>
              </button>
            </form>) : (<form onSubmit={handleRegister} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  {isAr ? 'الاسم المعروض' : 'Display Name'}
                </label>
                <div className="relative">
                  <lucide_react_1.User className={`w-4 h-4 text-gray-400 absolute top-3 ${isAr ? 'right-3' : 'left-3'}`}/>
                  <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={isAr ? 'اسم المستخدم' : 'Your Name'} className={`w-full py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 ${isAr ? 'pr-9 pl-3 text-right' : 'pl-9 pr-3 text-left'}`}/>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  {isAr ? 'البريد الإلكتروني' : 'Email Address'}
                </label>
                <div className="relative">
                  <lucide_react_1.Mail className={`w-4 h-4 text-gray-400 absolute top-3 ${isAr ? 'right-3' : 'left-3'}`}/>
                  <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className={`w-full py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 ${isAr ? 'pr-9 pl-3 text-right' : 'pl-9 pr-3 text-left'}`}/>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  {isAr ? 'كلمة المرور (6 أحرف على الأقل)' : 'Password (min 6 chars)'}
                </label>
                <div className="relative">
                  <lucide_react_1.Lock className={`w-4 h-4 text-gray-400 absolute top-3 ${isAr ? 'right-3' : 'left-3'}`}/>
                  <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className={`w-full py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs text-gray-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 ${isAr ? 'pr-9 pl-3 text-right' : 'pl-9 pr-3 text-left'}`}/>
                </div>
              </div>

              <button type="submit" disabled={submitting} className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer disabled:opacity-50">
                <lucide_react_1.UserPlus className="w-4 h-4"/>
                <span>{submitting ? (isAr ? 'جاري إنشاء الحساب...' : 'Creating Account...') : (isAr ? 'إنشاء حساب جديد' : 'Create Account')}</span>
              </button>
            </form>)}
        </div>) : (<div className="space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-700 dark:text-emerald-300 font-black text-xs">
                {(account?.displayName || firebaseUser.email || 'U')[0].toUpperCase()}
              </div>
              <div>
                <h4 className="text-xs font-extrabold text-gray-900 dark:text-white">
                  {account?.displayName || firebaseUser.displayName || (isAr ? 'مستخدم المنصة' : 'Platform User')}
                </h4>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                  {firebaseUser.email}
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 rounded-full text-[10px] font-bold">
              {isAr ? 'حساب نشط' : 'Active Account'}
            </span>
          </div>

          <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl text-[11px] text-gray-600 dark:text-gray-400 space-y-1">
            <div className="flex justify-between">
              <span className="font-semibold">UID:</span>
              <span className="font-mono text-[10px] truncate max-w-[180px]">{firebaseUser.uid}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-semibold">{isAr ? 'تاريخ الإنشاء:' : 'Created:'}</span>
              <span>{account?.createdAt ? new Date(account.createdAt).toLocaleDateString() : 'N/A'}</span>
            </div>
          </div>

          <button type="button" onClick={handleSignOut} className="w-full py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer">
            <lucide_react_1.LogOut className="w-4 h-4"/>
            <span>{isAr ? 'تسجيل الخروج' : 'Sign Out'}</span>
          </button>
        </div>)}
    </div>);
}
//# sourceMappingURL=AccountAuthWidget.js.map