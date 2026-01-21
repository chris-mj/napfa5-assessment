import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState, lazy, Suspense } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { supabase } from "./lib/supabaseClient";
import { isPlatformOwner } from "./lib/roles";
import Nav from "./components/Navbar";
import LoadingOverlay from "./components/LoadingOverlay";
const Home = lazy(() => import("./pages/Home"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Login = lazy(() => import("./pages/Login"));
const ModifyUser = lazy(() => import("./pages/ModifyUser"));
const CreateSchool = lazy(() => import("./pages/CreateSchool"));
const Students = lazy(() => import("./pages/Students"));
const AddAttempt = lazy(() => import("./pages/AddAttempt"));
const AdminGlobal = lazy(() => import("./pages/AdminGlobal"));
const ChangePassword = lazy(() => import("./pages/ChangePassword"));
const Contact = lazy(() => import("./pages/Contact"));
const UserGuide = lazy(() => import("./pages/UserGuide"));
const Sessions = lazy(() => import("./pages/Sessions"));
const SessionDetail = lazy(() => import("./pages/SessionDetail"));
const SessionCards = lazy(() => import("./pages/SessionCards"));
const ViewScore = lazy(() => import("./pages/ViewScore"));
const PftCalculator = lazy(() => import("./pages/PftCalculator"));
const TargetScore = lazy(() => import("./pages/TargetScore"));
const Audit = lazy(() => import("./pages/Audit"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Profile = lazy(() => import("./pages/Profile"));
const ManageStudents = lazy(() => import("./pages/ManageStudents"));

export default function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // Keep user state in sync with Supabase Auth
    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            setUser(data?.session?.user || null);
            setLoading(false);
        });
        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user || null);
        });
        return () => listener.subscription.unsubscribe();
    }, []);

    if (loading) return <LoadingOverlay />;

    return (
        <>
            <Router>
                <AnimatedRoutes user={user} setUser={setUser} />
            </Router>
            <SpeedInsights />
        </>
    );
}

function AdminGuard({ user, children }) {
    const [allowed, setAllowed] = useState(null);
    useEffect(() => {
        let ignore = false;
        async function check() {
            // Platform owner always allowed
            if (isPlatformOwner(user)) { if (!ignore) setAllowed(true); return; }
            if (!user?.id) { if (!ignore) setAllowed(false); return; }
            try {
                const { data } = await supabase
                    .from('memberships')
                    .select('role')
                    .eq('user_id', user.id);
                const roles = (data||[]).map(r => String(r.role||'').toLowerCase());
                if (!ignore) setAllowed(roles.includes('admin') || roles.includes('superadmin'));
            } catch {
                if (!ignore) setAllowed(false);
            }
        }
        check();
        return () => { ignore = true };
    }, [user?.id]);
    if (allowed === null) return <LoadingOverlay />;
    return allowed ? children : <Navigate to="/dashboard" replace />;
}

function AnimatedRoutes({ user, setUser }) {
    const location = useLocation();
    const navigate = useNavigate();

    const handleLogout = async () => {
        try {
            // Clear local session first
            await supabase.auth.signOut({ scope: 'local' });
        } catch {}
        try {
            // Remove any persisted Supabase auth tokens from storage (defensive)
            if (typeof window !== 'undefined') {
                const keys = Object.keys(window.localStorage || {});
                keys.forEach((k) => { if (k.startsWith('sb-') && k.endsWith('-auth-token')) localStorage.removeItem(k); });
            }
        } catch {}
        setUser(null);
        navigate("/", { replace: true });
        // Best-effort global revoke in background; ignore 403/session_not_found
        supabase.auth.signOut({ scope: 'global' }).catch(() => {});
    };

    return (
        <>
            <Nav user={user} onLogout={handleLogout} />
            <AnimatePresence mode="wait" initial={false}><Suspense fallback={<LoadingOverlay />}><Routes location={location} key={location.pathname}>
                    {/* Public pages */}
                    <Route path="/" element={<PageFade><Home /></PageFade>} />
                    <Route
                        path="/login"
                        element={
                            !user ? (
                                <PageFade><Login onLogin={setUser} /></PageFade>
                            ) : (
                                <Navigate to="/dashboard" replace />
                            )
                        }
                    />
                    <Route path="/contact" element={<PageFade><Contact /></PageFade>} />
                    <Route path="/target-score" element={<PageFade><TargetScore /></PageFade>} />
                    <Route
                        path="/view-score"
                        element={
                            user ? (
                                <PageFade><ViewScore user={user} /></PageFade>
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                    />
                    <Route
                        path="/pft-calculator"
                        element={
                            user ? (
                                <PageFade><PftCalculator user={user} /></PageFade>
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                    />

                    {/* Auth-only pages */}
                    <Route
                        path="/dashboard"
                        element={
                            user ? (
                                <PageFade><Dashboard user={user} /></PageFade>
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                    />
                    <Route
                        path="/modify-user"
                        element={
                            user ? (
                                <PageFade><ModifyUser user={user} /></PageFade>
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                    />
                    <Route
                        path="/create-school"
                        element={
                            user ? (
                                <PageFade><CreateSchool user={user} /></PageFade>
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                    />
                    <Route
                        path="/students"
                        element={
                            user ? (
                                <PageFade><Students user={user} /></PageFade>
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                    />
                    <Route
                        path="/manage-students"
                        element={
                            user ? (
                                <PageFade>
                                  <AdminGuard user={user}><ManageStudents user={user} /></AdminGuard>
                                </PageFade>
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                    />
                    <Route
                        path="/audit"
                        element={
                            user ? (
                                <PageFade>
                                  <AdminGuard user={user}><Audit user={user} /></AdminGuard>
                                </PageFade>
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                    />
                    <Route
                        path="/sessions"
                        element={
                            user ? (
                                <PageFade>
                                  <AdminGuard user={user}><Sessions user={user} /></AdminGuard>
                                </PageFade>
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                    />
                     <Route
                         path="/sessions/:id"
                         element={
                             user ? (
                                 <PageFade>
                                   <AdminGuard user={user}><SessionDetail user={user} /></AdminGuard>
                                 </PageFade>
                             ) : (
                                 <Navigate to="/login" replace />
                             )
                         }
                     />
                     <Route
                         path="/sessions/:id/cards"
                        element={
                            user ? (
                                <PageFade>
                                  <AdminGuard user={user}><SessionCards /></AdminGuard>
                                </PageFade>
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                      />
                    <Route
                        path="/profile"
                        element={
                            user ? (
                                <PageFade><Profile user={user} /></PageFade>
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                    />
                    <Route
                        path="/add-attempt"
                        element={
                            user ? (
                                <PageFade><AddAttempt user={user} /></PageFade>
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                    />
                    <Route
                        path="/admin-global"
                        element={
                            user ? (
                                <PageFade><AdminGlobal user={user} /></PageFade>
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                    />
                    <Route
                        path="/change-password"
                        element={
                            user ? (
                                <PageFade><ChangePassword user={user} /></PageFade>
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                    />

                    <Route path="/contact" element={<PageFade><Contact /></PageFade>} />
                    <Route path="/user-guide" element={<PageFade><UserGuide user={user} /></PageFade>} />

                    {/* Catch-all */}
                    <Route path="*" element={<PageFade><NotFound /></PageFade>} />
                </Routes></Suspense></AnimatePresence>
        </>
    );
}

function PageFade({ children }) {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
        >
            {children}
        </motion.div>
    );
}
