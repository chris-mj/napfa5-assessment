import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { isPlatformOwner } from "../lib/roles";
import { supabase } from "../lib/supabaseClient";

export default function Navbar({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const link = "px-3 py-2 rounded-md border border-slate-200 bg-white/80 text-slate-700 hover:text-blue-900 hover:bg-blue-50/70 hover:border-blue-200 transition";
  const active = "bg-blue-100/70 text-blue-900 border-blue-300 shadow-sm";
  const isOwner = isPlatformOwner(user);
  const location = useLocation();
  const [canManageUsers, setCanManageUsers] = useState(false);
  const [canScoreEntry, setCanScoreEntry] = useState(false);
  const [canViewScore, setCanViewScore] = useState(false);
  const [roleLabel, setRoleLabel] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [assessOpen, setAssessOpen] = useState(false);
  const [learnOpen, setLearnOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const showAssess = canManageUsers || canScoreEntry;
  const showManage = canManageUsers || isOwner;
  const showInsights = canManageUsers || isOwner;
  const pathname = location?.pathname || "";
  const isAssessActive = ["/sessions", "/add-attempt", "/pft-calculator"].some(p => pathname.startsWith(p));
  const isManageActive = ["/manage-students", "/modify-user"].some(p => pathname.startsWith(p));
  const isLearnActive = ["/view-score", "/target-score", "/learning-hub"].some(p => pathname.startsWith(p));
  const isInsightsActive = ["/charts", "/audit", "/gamification"].some(p => pathname.startsWith(p));
  const isContactActive = ["/contact", "/user-guide"].some(p => pathname.startsWith(p));

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        if (!user?.id) {
          if (!ignore) {
            setCanManageUsers(false);
            setCanScoreEntry(false);
            setCanViewScore(false);
          }
          return;
        }
        const { data } = await supabase
          .from('memberships')
          .select('role')
          .eq('user_id', user.id);
        const roles = (data||[]).map(r => String(r.role||'').toLowerCase());
        const isAdmin = roles.includes('admin') || roles.includes('superadmin');
        const isScoreTaker = roles.includes('score_taker');
        const isViewer = roles.includes('viewer');
        if (!ignore) {
          setCanManageUsers(isAdmin || isOwner);
          setCanScoreEntry(isScoreTaker || isAdmin || isOwner);
          setCanViewScore(isViewer || isScoreTaker || isAdmin || isOwner);
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
    <header className="bg-white/85 backdrop-blur border-b border-slate-200 shadow-sm">
      <nav className="px-4 py-3 flex items-center justify-between">
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
            <div className="hidden md:flex gap-2">
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
                  {/* Assess */}
                  {showAssess && (
                    <div
                      className="relative"
                      onMouseEnter={() => setAssessOpen(true)}
                      onMouseLeave={() => setAssessOpen(false)}
                    >
                      <button
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={assessOpen}
                      className={`${link} ${isAssessActive ? active : ""} flex items-center gap-1`}
                      >
                        <span>Assess</span>
                        <svg
                          className={`w-4 h-4 text-gray-700 transition-transform ${assessOpen ? 'rotate-180' : ''}`}
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.065l3.71-3.835a.75.75 0 111.08 1.04l-4.24 4.385a.75.75 0 01-1.08 0L5.25 8.27a.75.75 0 01-.02-1.06z" clipRule="evenodd" />
                        </svg>
                      </button>
                      {assessOpen && (
                        <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-md shadow-lg ring-1 ring-black/5 z-50" role="menu" aria-label="Assess menu">
                          {(canManageUsers || isOwner) && (
                            <NavLink to="/sessions" onClick={() => setAssessOpen(false)} className={({ isActive }) => `block px-3 py-2 text-slate-700 hover:bg-blue-50 ${isActive ? 'bg-blue-100/70 text-blue-900' : ''}`} role="menuitem">NAPFA Sessions</NavLink>
                          )}
                          {canScoreEntry && (
                            <NavLink to="/add-attempt" onClick={() => setAssessOpen(false)} className={({ isActive }) => `block px-3 py-2 text-slate-700 hover:bg-blue-50 ${isActive ? 'bg-blue-100/70 text-blue-900' : ''}`} role="menuitem">Score Entry</NavLink>
                          )}
                          {(canManageUsers || isOwner) && (
                            <NavLink to="/pft-calculator" onClick={() => setAssessOpen(false)} className={({ isActive }) => `block px-3 py-2 text-slate-700 hover:bg-blue-50 ${isActive ? 'bg-blue-100/70 text-blue-900' : ''}`} role="menuitem">Award Calculator</NavLink>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Manage */}
                  {showManage && (
                    <div
                      className="relative"
                      onMouseEnter={() => setManageOpen(true)}
                      onMouseLeave={() => setManageOpen(false)}
                    >
                      <button
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={manageOpen}
                      className={`${link} ${isManageActive ? active : ""} flex items-center gap-1`}
                      >
                        <span>Manage</span>
                        <svg
                          className={`w-4 h-4 text-gray-700 transition-transform ${manageOpen ? 'rotate-180' : ''}`}
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.065l3.71-3.835a.75.75 0 111.08 1.04l-4.24 4.385a.75.75 0 01-1.08 0L5.25 8.27a.75.75 0 01-.02-1.06z" clipRule="evenodd" />
                        </svg>
                      </button>
                      {manageOpen && (
                        <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-md shadow-lg ring-1 ring-black/5 z-50" role="menu" aria-label="Manage menu">
                          {(canManageUsers || isOwner) && (
                            <NavLink to="/manage-students" onClick={() => setManageOpen(false)} className={({ isActive }) => `block px-3 py-2 text-slate-700 hover:bg-blue-50 ${isActive ? 'bg-blue-100/70 text-blue-900' : ''}`} role="menuitem">Student Enrollment</NavLink>
                          )}
                          {(canManageUsers || isOwner) && (
                            <NavLink to="/modify-user" onClick={() => setManageOpen(false)} className={({ isActive }) => `block px-3 py-2 text-slate-700 hover:bg-blue-50 ${isActive ? 'bg-blue-100/70 text-blue-900' : ''}`} role="menuitem">Manage Users</NavLink>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Insights */}
                  {showInsights && (
                    <div
                      className="relative"
                      onMouseEnter={() => setInsightsOpen(true)}
                      onMouseLeave={() => setInsightsOpen(false)}
                    >
                      <button
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={insightsOpen}
                        className={`${link} ${isInsightsActive ? active : ""} flex items-center gap-1`}
                      >
                        <span>Insights</span>
                        <svg
                          className={`w-4 h-4 text-gray-700 transition-transform ${insightsOpen ? 'rotate-180' : ''}`}
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.065l3.71-3.835a.75.75 0 111.08 1.04l-4.24 4.385a.75.75 0 01-1.08 0L5.25 8.27a.75.75 0 01-.02-1.06z" clipRule="evenodd" />
                        </svg>
                      </button>
                      {insightsOpen && (
                        <div className="absolute left-0 top-full mt-1 w-44 bg-white border border-slate-200 rounded-md shadow-lg ring-1 ring-black/5 z-50" role="menu" aria-label="Insights menu">
                          <NavLink to="/gamification" onClick={() => setInsightsOpen(false)} className={({ isActive }) => `block px-3 py-2 text-slate-700 hover:bg-blue-50 ${isActive ? 'bg-blue-100/70 text-blue-900' : ''}`} role="menuitem">Challenge Hub</NavLink>
                          <NavLink to="/charts" onClick={() => setInsightsOpen(false)} className={({ isActive }) => `block px-3 py-2 text-slate-700 hover:bg-blue-50 ${isActive ? 'bg-blue-100/70 text-blue-900' : ''}`} role="menuitem">Charts</NavLink>
                          <NavLink to="/audit" onClick={() => setInsightsOpen(false)} className={({ isActive }) => `block px-3 py-2 text-slate-700 hover:bg-blue-50 ${isActive ? 'bg-blue-100/70 text-blue-900' : ''}`} role="menuitem">Audit</NavLink>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
              {/* Learn */}
              <div
                className="relative"
                onMouseEnter={() => setLearnOpen(true)}
                onMouseLeave={() => setLearnOpen(false)}
              >
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={learnOpen}
                  className={`${link} ${isLearnActive ? active : ""} flex items-center gap-1`}
                >
                  <span>Learn</span>
                  <svg
                    className={`w-4 h-4 text-gray-700 transition-transform ${learnOpen ? 'rotate-180' : ''}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.065l3.71-3.835a.75.75 0 111.08 1.04l-4.24 4.385a.75.75 0 01-1.08 0L5.25 8.27a.75.75 0 01-.02-1.06z" clipRule="evenodd" />
                  </svg>
                </button>
                {learnOpen && (
                  <div className="absolute left-0 top-full mt-1 w-52 bg-white border border-slate-200 rounded-md shadow-lg ring-1 ring-black/5 z-50" role="menu" aria-label="Learn menu">
                    {canViewScore && (
                      <NavLink to="/view-score" onClick={() => setLearnOpen(false)} className={({ isActive }) => `block px-3 py-2 text-slate-700 hover:bg-blue-50 ${isActive ? 'bg-blue-100/70 text-blue-900' : ''}`} role="menuitem">View Score</NavLink>
                    )}
                    <NavLink to="/target-score" onClick={() => setLearnOpen(false)} className={({ isActive }) => `block px-3 py-2 text-slate-700 hover:bg-blue-50 ${isActive ? 'bg-blue-100/70 text-blue-900' : ''}`} role="menuitem">Target Score</NavLink>
                    <NavLink to="/learning-hub" onClick={() => setLearnOpen(false)} className={({ isActive }) => `block px-3 py-2 text-slate-700 hover:bg-blue-50 ${isActive ? 'bg-blue-100/70 text-blue-900' : ''}`} role="menuitem">Learning Hub</NavLink>
                  </div>
                )}
              </div>
            <div
              className="relative"
              onMouseEnter={() => setContactOpen(true)}
              onMouseLeave={() => setContactOpen(false)}
            >
              <NavLink
                to="/contact"
                aria-haspopup="menu"
                aria-expanded={contactOpen}
                className={() => `${link} ${isContactActive ? active : ""} flex items-center gap-1`}
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
                <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-md shadow-lg ring-1 ring-black/5 z-50" role="menu" aria-label="Contact menu">
                  <NavLink to="/contact" onClick={() => setContactOpen(false)} className={({ isActive }) => `block px-3 py-2 text-slate-700 hover:bg-blue-50 ${isActive ? 'bg-blue-100/70 text-blue-900' : ''}`} role="menuitem">
                    Contact Us
                  </NavLink>
                  <NavLink to="/user-guide" onClick={() => setContactOpen(false)} className={({ isActive }) => `block px-3 py-2 text-slate-700 hover:bg-blue-50 ${isActive ? 'bg-blue-100/70 text-blue-900' : ''}`} role="menuitem">
                    User Guide & FAQ
                  </NavLink>
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
                      <div className="pt-1">
                        <div className="text-xs uppercase tracking-wide text-gray-400 px-1">Dashboard</div>
                        <NavLink to="/dashboard" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Dashboard</NavLink>
                      </div>
                      {showAssess && (
                        <div className="pt-1">
                          <div className="text-xs uppercase tracking-wide text-gray-400 px-1">Assess</div>
                          {(canManageUsers || isOwner) && (
                            <NavLink to="/sessions" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>NAPFA Sessions</NavLink>
                          )}
                          {canScoreEntry && (
                            <NavLink to="/add-attempt" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Score Entry</NavLink>
                          )}
                          {(canManageUsers || isOwner) && (
                            <NavLink to="/pft-calculator" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Award Calculator</NavLink>
                          )}
                        </div>
                      )}
                      {showManage && (
                        <div className="pt-1">
                          <div className="text-xs uppercase tracking-wide text-gray-400 px-1">Manage</div>
                          {(canManageUsers || isOwner) && (
                            <NavLink to="/manage-students" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Student Enrollment</NavLink>
                          )}
                          {(canManageUsers || isOwner) && (
                            <NavLink to="/modify-user" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Manage Users</NavLink>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  <div className="pt-1">
                    <div className="text-xs uppercase tracking-wide text-gray-400 px-1">Learn</div>
                    {canViewScore && (
                      <NavLink to="/view-score" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>View Score</NavLink>
                    )}
                    <NavLink to="/target-score" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Target Score</NavLink>
                    <NavLink to="/learning-hub" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Learning Hub</NavLink>
                  </div>
                  {showInsights && (
                    <div className="pt-1">
                      <div className="text-xs uppercase tracking-wide text-gray-400 px-1">Insights</div>
                      <NavLink to="/gamification" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Challenge Hub</NavLink>
                      <NavLink to="/charts" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Charts</NavLink>
                      <NavLink to="/audit" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Audit</NavLink>
                    </div>
                  )}
                  <NavLink to="/contact" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Contact Us</NavLink>
                  <NavLink to="/user-guide" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>User Guide & FAQ</NavLink>
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
