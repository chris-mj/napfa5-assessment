import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import Nav from "./components/Navbar";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import ModifyUser from "./pages/ModifyUser";
import CreateSchool from "./pages/CreateSchool";
import Students from "./pages/Students";
import AddAttempt from "./pages/AddAttempt";
import AdminGlobal from "./pages/AdminGlobal";
import ChangePassword from "./pages/ChangePassword";

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

    if (loading) return <div className="p-4">Loading...</div>;

    // Handles logout + redirect
    async function handleLogout() {
        await supabase.auth.signOut();
        window.location.href = "/"; // redirect to public home
    }

    return (
        <Router>
            <Nav user={user} onLogout={handleLogout} />
            <Routes>
                {/* dYO? Public pages */}
                <Route path="/" element={<Home user={user} />} />
                <Route path="/login" element={!user ? <Login /> : <Navigate to="/dashboard" />} />

                {/* dY"? Auth-only pages */}
                <Route
                    path="/dashboard"
                    element={user ? <Dashboard user={user} /> : <Navigate to="/login" />}
                />
                <Route
                    path="/modify-user"
                    element={user ? <ModifyUser user={user} /> : <Navigate to="/login" />}
                />
                <Route
                    path="/create-school"
                    element={user ? <CreateSchool user={user} /> : <Navigate to="/login" />}
                />
                <Route
                    path="/students"
                    element={user ? <Students user={user} /> : <Navigate to="/login" />}
                />
                <Route
                    path="/add-attempt"
                    element={user ? <AddAttempt user={user} /> : <Navigate to="/login" />}
                />
                <Route
                    path="/admin-global"
                    element={user ? <AdminGlobal user={user} /> : <Navigate to="/login" />}
                />
                <Route
                    path="/change-password"
                    element={user ? <ChangePassword user={user} /> : <Navigate to="/login" />}
                />

                {/* Catch-all */}
                <Route path="*" element={<Navigate to="/" />} />
            </Routes>
        </Router>
    );
}
