import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { isPlatformOwner } from "../lib/roles";
import { supabase } from "../lib/supabaseClient";

export default function Navbar({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const link = "px-3 py-2 rounded hover:bg-gray-100";
  const active = "bg-gray-200";
  const isOwner = isPlatformOwner(user);
  const [canManageUsers, setCanManageUsers] = useState(false);
  const [roleLabel, setRoleLabel] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [schoolOpen, setSchoolOpen] = useState(false);
  const [scoringOpen, setScoringOpen] = useState(false);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        if (!user?.id) { if (!ignore) setCanManageUsers(false); return; }
        const { data } = await supabase
          .from('memberships')
          .select('role')
          .eq('user_id', user.id);
        const roles = (data||[]).map(r => String(r.role||'').toLowerCase());
        if (!ignore) {
          setCanManageUsers(roles.includes('admin') || roles.includes('superadmin'));
          const label = roles.includes('superadmin') ? 'superadmin'
                       : roles.includes('admin') ? 'admin'
                       : roles.includes('score_taker') ? 'score_taker'
                       : roles.includes('viewer') ? 'viewer'
                       : '';
          setRoleLabel(label);
        }
      } catch { if (!ignore) setCanManageUsers(false); }
    };
    load();
    return () => { ignore = true };
  }, [user?.id]);

  return (
    <header className="bg-white shadow">
      <nav className="p-3 flex items-center justify-between">
        <NavLink to="/" className="flex items-center gap-2">
          <img src="/icon.png" alt="NAPFA5" className="w-6 h-6" />
          <span className="font-bold">NAPFA5</span>
        </NavLink>
        <div className="flex items-center gap-2">
          <button
            className="md:hidden inline-flex items-center justify-center p-2 rounded hover:bg-gray-100"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <svg className="w-6 h-6 text-gray-800" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
            <div className="hidden md:flex gap-3">
              {!user && (
                <NavLink to="/" end className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                  Home
                </NavLink>
              )}
              {user && (
                <>
                  {/* Dashboard */}
                  <NavLink to="/dashboard" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                    Dashboard
                  </NavLink>
                  {/* NAPFA Sessions */}
                  {canManageUsers && (
                    <NavLink to="/sessions" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                      NAPFA Sessions
                    </NavLink>
                  )}
                  {/* School Admin dropdown (mirrors Contact Us behavior) */}
                  {(canManageUsers || isOwner) && (
                    <div
                      className="relative"
                      onMouseEnter={() => setSchoolOpen(true)}
                      onMouseLeave={() => setSchoolOpen(false)}
                    >
                      <button
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={schoolOpen}
                        className={`${link} flex items-center gap-1`}
                      >
                        <span>School Admin</span>
                        <svg
                          className={`w-4 h-4 text-gray-700 transition-transform ${schoolOpen ? 'rotate-180' : ''}`}
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.065l3.71-3.835a.75.75 0 111.08 1.04l-4.24 4.385a.75.75 0 01-1.08 0L5.25 8.27a.75.75 0 01-.02-1.06z" clipRule="evenodd" />
                        </svg>
                      </button>
                      {schoolOpen && (
                        <div
                          className="absolute right-0 top-full mt-0 w-48 bg-white border rounded shadow z-50"
                          role="menu"
                          aria-label="School Admin menu"
                        >
                          {canManageUsers && (
                            <NavLink
                              to="/manage-students"
                              onClick={() => setSchoolOpen(false)}
                              className={({ isActive }) => `block px-3 py-2 hover:bg-gray-100 ${isActive ? 'bg-gray-100' : ''}`}
                              role="menuitem"
                            >
                              Student Enrollment
                            </NavLink>
                          )}
                          {canManageUsers && (
                            <NavLink
                              to="/modify-user"
                              onClick={() => setSchoolOpen(false)}
                              className={({ isActive }) => `block px-3 py-2 hover:bg-gray-100 ${isActive ? 'bg-gray-100' : ''}`}
                              role="menuitem"
                            >
                              Manage Users
                            </NavLink>
                          )}
                          {isOwner && (
                            <NavLink
                              to="/create-school"
                              onClick={() => setSchoolOpen(false)}
                              className={({ isActive }) => `block px-3 py-2 hover:bg-gray-100 ${isActive ? 'bg-gray-100' : ''}`}
                              role="menuitem"
                            >
                              Manage Schools
                            </NavLink>
                          )}
                          {isOwner && (
                            <NavLink
                              to="/admin-global"
                              onClick={() => setSchoolOpen(false)}
                              className={({ isActive }) => `block px-3 py-2 hover:bg-gray-100 ${isActive ? 'bg-gray-100' : ''}`}
                              role="menuitem"
                            >
                              Global Admin
                            </NavLink>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {/* Scoring Admin dropdown */}
                  <div
                    className="relative"
                    onMouseEnter={() => setScoringOpen(true)}
                    onMouseLeave={() => setScoringOpen(false)}
                  >
                    <button
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={scoringOpen}
                      className={`${link} flex items-center gap-1`}
                    >
                      <span>Scoring Admin</span>
                      <svg
                        className={`w-4 h-4 text-gray-700 transition-transform ${scoringOpen ? 'rotate-180' : ''}`}
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.065l3.71-3.835a.75.75 0 111.08 1.04l-4.24 4.385a.75.75 0 01-1.08 0L5.25 8.27a.75.75 0 01-.02-1.06z" clipRule="evenodd" />
                      </svg>
                    </button>
                    {scoringOpen && (
                      <div className="absolute right-0 top-full mt-0 w-56 bg-white border rounded shadow z-50" role="menu" aria-label="Scoring Admin menu">
                        <NavLink to="/add-attempt" onClick={() => setScoringOpen(false)} className={({ isActive }) => `block px-3 py-2 hover:bg-gray-100 ${isActive ? 'bg-gray-100' : ''}`} role="menuitem">Score Entry</NavLink>
                        <NavLink to="/view-score" onClick={() => setScoringOpen(false)} className={({ isActive }) => `block px-3 py-2 hover:bg-gray-100 ${isActive ? 'bg-gray-100' : ''}`} role="menuitem">View Score</NavLink>
                        <NavLink to="/pft-calculator" onClick={() => setScoringOpen(false)} className={({ isActive }) => `block px-3 py-2 hover:bg-gray-100 ${isActive ? 'bg-gray-100' : ''}`} role="menuitem">Award Calculator</NavLink>
                      </div>
                    )}
                  </div>
                </>
              )}
            {/* Public quick link: Target Score */}
            <NavLink to="/target-score" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
              Target Score
            </NavLink>
            <div
              className="relative"
              onMouseEnter={() => setContactOpen(true)}
              onMouseLeave={() => setContactOpen(false)}
            >
              <NavLink
                to="/contact"
                aria-haspopup="menu"
                aria-expanded={contactOpen}
                className={({ isActive }) => `${link} ${isActive ? active : ""} flex items-center gap-1`}
              >
                <span>Contact Us</span>
                <svg
                  className={`w-4 h-4 text-gray-700 transition-transform ${contactOpen ? 'rotate-180' : ''}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.065l3.71-3.835a.75.75 0 111.08 1.04l-4.24 4.385a.75.75 0 01-1.08 0L5.25 8.27a.75.75 0 01-.02-1.06z" clipRule="evenodd" />
                </svg>
              </NavLink>
              {contactOpen && (
                <div className="absolute right-0 top-full mt-0 w-48 bg-white border rounded shadow z-50" role="menu" aria-label="Contact menu">
                  <NavLink to="/contact" onClick={() => setContactOpen(false)} className={({ isActive }) => `block px-3 py-2 hover:bg-gray-100 ${isActive ? 'bg-gray-100' : ''}`} role="menuitem">
                    Contact Us
                  </NavLink>
                  {user && (
                    <NavLink to="/user-guide" onClick={() => setContactOpen(false)} className={({ isActive }) => `block px-3 py-2 hover:bg-gray-100 ${isActive ? 'bg-gray-100' : ''}`} role="menuitem">
                      User Guide & FAQ
                    </NavLink>
                  )}
                </div>
              )}
            </div>
            {user ? (
              <>
                <div className="text-sm text-gray-600 whitespace-nowrap text-right">
                  <div>
                    <NavLink to="/profile" className="hover:underline" title="Edit profile">
                      {user.email}
                    </NavLink>
                  </div>
                  {roleLabel && (<div className="text-xs text-gray-400">{roleLabel}</div>)}
                </div>
                <button onClick={onLogout} className="text-sm px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">Logout</button>
              </>
            ) : (
              <NavLink to="/login" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                Login
              </NavLink>
            )}
          </div>
        </div>
      </nav>
            {/* Animated mobile panel */}
            <div className="md:hidden px-3">
                <div className={open ? "border-t pb-3 space-y-2 transition-all duration-200" : "border-t pb-0 h-0 overflow-hidden transition-all duration-200"}>
                  {!user && (
                    <NavLink to="/" end className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Home</NavLink>
                  )}
                  {user && (
                    <>
                      {/* Dashboard */}
                      <NavLink to="/dashboard" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Dashboard</NavLink>
                      {/* NAPFA Sessions */}
                      {canManageUsers && (<NavLink to="/sessions" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>NAPFA Sessions</NavLink>)}
                      {/* School Admin group */}
                      {(canManageUsers || isOwner) && (
                        <div className="pt-1">
                          <div className="text-xs uppercase tracking-wide text-gray-400 px-1">School Admin</div>
                          {canManageUsers && (
                            <NavLink to="/manage-students" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Student Enrollment</NavLink>
                          )}
                          {canManageUsers && (
                            <NavLink to="/modify-user" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Manage Users</NavLink>
                          )}
                          {isOwner && (
                            <NavLink to="/create-school" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Manage Schools</NavLink>
                          )}
                          {isOwner && (
                            <NavLink to="/admin-global" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Global Admin</NavLink>
                          )}
                        </div>
                      )}
                      {/* Scoring Admin group */}
                      <div className="pt-1">
                        <div className="text-xs uppercase tracking-wide text-gray-400 px-1">Scoring Admin</div>
                        <NavLink to="/add-attempt" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Score Entry</NavLink>
                        <NavLink to="/view-score" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>View Score</NavLink>
                        {(canManageUsers || isOwner) && (
                          <NavLink to="/pft-calculator" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Award Calculator</NavLink>
                        )}
                      </div>
                    </>
                  )}
                  <NavLink to="/target-score" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Target Score</NavLink>
                  <NavLink to="/contact" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Contact Us</NavLink>
                  {user && (
                    <NavLink to="/user-guide" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>User Guide & FAQ</NavLink>
                  )}
                  <div className="pt-2 flex items-center justify-between gap-2">
                    {user ? (
                      <>
                        <div className="text-sm text-gray-600 truncate">
                          <div><NavLink to="/profile" onClick={() => setOpen(false)} className="hover:underline" title="Edit profile">{user.email}</NavLink></div>
                          {roleLabel && (<div className="text-xs text-gray-400">{roleLabel}</div>)}
                        </div>
                        <button onClick={onLogout} className="text-sm px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">Logout</button>
                      </>
                    ) : (
                      <NavLink to="/login" className={({ isActive }) => `${link} ${isActive ? active : ""}`} onClick={() => setOpen(false)}>Login</NavLink>
                    )}
                  </div>
                </div>
            </div>
    </header>
  );
}
