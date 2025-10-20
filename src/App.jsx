
import React, {useEffect, useState} from 'react'
import { supabase } from './lib/supabaseClient'
import Navbar from './components/Navbar'
import ScoreForm from './components/ScoreForm'
import Charts from './components/Charts'
import { computeTotalScore } from './utils/scoring'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { isPlatformOwner, getUserRoles } from "./lib/roles";

import Students from './pages/Students'
import AddAttempt from './pages/AddAttempt'
import Login from "./pages/Login";
import AdminGlobal from "./pages/AdminGlobal";
import CreateSchool from "./pages/CreateSchool";
import ModifyUser from "./pages/ModifyUser";
import ChangePassword from "./pages/ChangePassword";


function Nav({ user, onLogout }) {
    const link = "px-3 py-2 rounded hover:bg-gray-100";
    const active = "bg-gray-200";

    const [roles, setRoles] = useState([]); // holds {role, school_id, school_name}
    const isOwner = isPlatformOwner(user);
    const isSchoolSuperadmin = roles.some((r) => r.role === "superadmin");

    // fetch memberships for the current user
    useEffect(() => {
        if (user && !isOwner) {
            getUserRoles(user, supabase).then(setRoles);
        } else {
            setRoles([]);
        }
    }, [user, isOwner]);

    return (
        <nav className="flex items-center justify-between p-3 border-b bg-white">
            {/* LEFT SIDE NAV LINKS */}
            <div className="flex gap-2 flex-wrap">
                <NavLink
                    to="/"
                    end
                    className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                >
                    Home
                </NavLink>

                <NavLink
                    to="/students"
                    className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                >
                    Students
                </NavLink>

                <NavLink
                    to="/add-attempt"
                    className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                >
                    Add Attempt
                </NavLink>

                {/* 🌍 GLOBAL ADMIN CONTROLS — only for your MOE email */}
                {isOwner && (
                    <>
                        <NavLink
                            to="/admin/global"
                            className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                        >
                            Global Admin
                        </NavLink>
                        <NavLink
                            to="/admin/create-school"
                            className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                        >
                            Create School
                        </NavLink>
                        <NavLink
                            to="/admin/modify-user"
                            className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                        >
                            Modify Users
                        </NavLink>
                    </>
                )}

                {/* 🏫 SCHOOL SUPERADMIN CONTROLS */}
                {!isOwner && isSchoolSuperadmin && (
                    <>
                        <NavLink
                            to="/admin/modify-user"
                            className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                        >
                            Modify Users
                        </NavLink>
                        <NavLink
                            to="/admin/school"
                            className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                        >
                            School Admin
                        </NavLink>
                    </>
                )}
            </div>

            {/* RIGHT SIDE USER SECTION */}
            <div className="flex gap-2 items-center">
                {user ? (
                    <>
                        <span className="text-sm text-gray-600">{user.email}</span>
                        <NavLink
                            to="/change-password"
                            className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                        >
                            Change Password
                        </NavLink>
                        <button
                            onClick={onLogout}
                            className="text-sm px-3 py-1 rounded bg-red-500 text-white hover:bg-red-600"
                        >
                            Logout
                        </button>
                    </>
                ) : (
                    <NavLink
                        to="/login"
                        className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                    >
                        Login
                    </NavLink>
                )}
            </div>
        </nav>
    );
}


function Home() {
    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-2">NAPFA5 Assessment</h1>
            <p className="text-gray-600">
                Welcome to your NAPFA tracking system.<br />
                Use the navigation above to access different sections.
            </p>
        </div>
    );
}
export default function App(){
  const [user, setUser] = useState(null)
  const [students, setStudents] = useState([])
  const [selected, setSelected] = useState(null)
  const [scores, setScores] = useState([])

    // Check auth on mount
    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => setUser(data.session?.user || null));
        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
            setUser(session?.user || null);
        });
        return () => listener.subscription.unsubscribe();
    }, [])

  useEffect(()=>{ if(user) loadStudents() }, [user])

  async function loadStudents(){
    const { data, error } = await supabase.from('students').select('*').order('name')
    if(error) return alert(error.message)
    setStudents(data)
    if(data?.length) setSelected(data[0])
  }

  async function loadScoresFor(studentId){
    const { data, error } = await supabase.from('scores').select('*').eq('student_id', studentId).order('test_date')
    if(error) return alert(error.message)
    setScores(data)
  }

    async function handleLogin() {
        const method = window.prompt(
            'Type "1" for Magic Link login, or "2" for Email & Password login:'
        )
        if (!method) return

        const email = window.prompt('Enter your email:')
        if (!email) return

        if (method === '1') {
            // existing magic link sign-in
            const { error } = await supabase.auth.signInWithOtp({ email })
            if (error) return alert(error.message)
            alert('✅ Magic link sent — check your email!')
            return
        }

        if (method === '2') {
            const password = window.prompt('Enter your password:')
            if (!password) return

            // try sign-in with password
            const { data, error } = await supabase.auth.signInWithPassword({ email, password })

            if (error?.message?.includes('Invalid login credentials')) {
                // offer to sign up
                if (window.confirm('No account found. Create one?')) {
                    const { error: signupErr } = await supabase.auth.signUp({ email, password })
                    if (signupErr) return alert(signupErr.message)
                    alert('✅ Account created! You can now log in.')
                }
            } else if (error) {
                alert('Error: ' + error.message)
            } else {
                alert('✅ Signed in successfully!')
                setUser(data?.user || null)
            }
        }
    }


    const handleLogout = async () => {
        await supabase.auth.signOut();
        setUser(null);
    };

  function onStudentSelect(s){
    setSelected(s)
    loadScoresFor(s.id)
  }

  function onNewScore(score){
    loadScoresFor(selected.id)
  }

    return (
        <BrowserRouter>
            <Nav user={user} onLogout={handleLogout} />
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/students" element={<Students />} />
                <Route path="/add-attempt" element={<AddAttempt />} />
                <Route path="/login" element={<Login onLogin={setUser} />} />

                <Route path="/admin/global" element={<AdminGlobal user={user} />} />
                <Route path="/admin/create-school" element={<CreateSchool user={user} />} />
                <Route path="/admin/modify-user" element={<ModifyUser user={user} />} />

                <Route path="/change-password" element={<ChangePassword />} />

            </Routes>
        </BrowserRouter>
    );
}
