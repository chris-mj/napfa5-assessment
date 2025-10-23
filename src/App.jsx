import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "./lib/supabaseClient";
import Nav from "./components/Navbar";
import LoadingOverlay from "./components/LoadingOverlay";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import ModifyUser from "./pages/ModifyUser";
import CreateSchool from "./pages/CreateSchool";
import Students from "./pages/Students";
import AddAttempt from "./pages/AddAttempt";
import AdminGlobal from "./pages/AdminGlobal";
import ChangePassword from "./pages/ChangePassword";
import Contact from "./pages/Contact";
import Sessions from "./pages/Sessions";
import SessionDetail from "./pages/SessionDetail";
import NotFound from "./pages/NotFound";

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
        <Router>
            <AnimatedRoutes user={user} setUser={setUser} />
        </Router>
    );
}

function AnimatedRoutes({ user, setUser }) {
    const location = useLocation();
    const navigate = useNavigate();

    const handleLogout = async () => {
        await supabase.auth.signOut();
        setUser(null);
        navigate("/", { replace: true });
    };

    return (
        <>
            <Nav user={user} onLogout={handleLogout} />
            <AnimatePresence mode="wait" initial={false}>
                <Routes location={location} key={location.pathname}>
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
                        path="/sessions"
                        element={
                            user ? (
                                <PageFade><Sessions user={user} /></PageFade>
                            ) : (
                                <Navigate to="/login" replace />
                            )
                        }
                    />
                    <Route
                        path="/sessions/:id"
                        element={
                            user ? (
                                <PageFade><SessionDetail user={user} /></PageFade>
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

                    {/* Catch-all */}
                    <Route path="*" element={<PageFade><NotFound /></PageFade>} />
                </Routes>
            </AnimatePresence>
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
