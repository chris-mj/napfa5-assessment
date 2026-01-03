import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { isPlatformOwner } from "../lib/roles";

function Card({ title, desc, to, cta, tips = [], onHowTo, howToSteps = [] }) {
  return (
    <div className="border rounded-lg bg-white shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-gray-500">*</span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="text-sm text-gray-700 flex-1">{desc}</p>
      {Array.isArray(tips) && tips.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-gray-600 space-y-1">
          {tips.map((t, i) => (<li key={i}>{t}</li>))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        {to && (
          <NavLink to={to} className="inline-block text-sm px-3 py-1.5 border rounded hover:bg-gray-50">{cta || `Open ${title}`}</NavLink>
        )}
        {Array.isArray(howToSteps) && howToSteps.length > 0 && (
          <button
            type="button"
            onClick={() => onHowTo && onHowTo(title, howToSteps)}
            className="inline-block text-sm px-3 py-1.5 border rounded bg-white hover:bg-gray-50"
          >
            How to
          </button>
        )}
      </div>
    </div>
  );
}

export default function UserGuide({ user }) {
  const [roles, setRoles] = useState([]);
  const owner = isPlatformOwner(user);
  const [howToOpen, setHowToOpen] = useState(false);
  const [howToTitle, setHowToTitle] = useState("");
  const [howToSteps, setHowToSteps] = useState([]);
  const [howToEntered, setHowToEntered] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!user?.id) { setRoles([]); return; }
      const { data } = await supabase
        .from('memberships')
        .select('role')
        .eq('user_id', user.id);
      const r = (data||[]).map(x => String(x.role||'').toLowerCase());
      if (!ignore) setRoles(r);
    }
    load();
    return () => { ignore = true };
  }, [user?.id]);

  const roleSet = useMemo(() => new Set(roles), [roles]);
  const canManage = owner || roleSet.has('superadmin') || roleSet.has('admin');
  const canManageStrict = roleSet.has('superadmin') || roleSet.has('admin');
  const canRecord = canManage || roleSet.has('score_taker');
  const canView = canRecord || roleSet.has('viewer') || !!user;
  const canAudit = owner || roleSet.has('superadmin');

  useEffect(() => {
    if (howToOpen) {
      // allow paint, then animate in
      const id = requestAnimationFrame(() => setHowToEntered(true));
      return () => cancelAnimationFrame(id);
    } else {
      setHowToEntered(false);
    }
  }, [howToOpen]);

  const closeHowTo = () => {
    // animate out then unmount
    setHowToEntered(false);
    setTimeout(() => setHowToOpen(false), 160);
  };

  return (
    <main className="w-full">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">User Guide & FAQ</h1>
          <p className="text-sm text-gray-600">Guided workflow for NAPFA assessments. Cards show based on your access.</p>
          <nav aria-label="On this page" className="text-sm">
            <ul className="flex flex-wrap gap-3 text-blue-700">
              <li><a href="#setup" className="underline">Set Up</a></li>
              <li><a href="#run" className="underline">Conduct Assessment</a></li>
              <li><a href="#after" className="underline">After Assessment</a></li>
              <li><a href="#faq" className="underline">FAQ</a></li>
            </ul>
          </nav>
        </header>

        <section className="space-y-3" id="setup">
          <h2 className="text-lg font-semibold">1. Set Up</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {!user && (
              <Card
                title="Log In"
                desc="Use your school email to log in to access features."
                to="/login"
                cta="Login"
                tips={["If you cannot log in, contact your school superadmin to check your membership."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Go to Login from the navbar.",
                  "Enter your school-provided email and password.",
                  "If login fails, verify that your account has a membership and try resetting your password or contact a superadmin.",
                ]}
              />
            )}
            {owner && (
              <Card
                title="Manage Schools"
                desc="Create and manage schools, and global settings (platform owner)."
                to="/create-school"
                tips={["Create the school first before adding users.", "School type determines standards in calculators."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Manage Schools.",
                  "Click Create School and fill in name and type.",
                  "Save and confirm it appears in the list.",
                ]}
              />
            )}
            {owner && (
              <Card
                title="Global Admin"
                desc="Audit and maintenance tools for the entire platform."
                to="/admin-global"
                tips={["For platform maintenance and data-wide operations only."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Global Admin from the navbar (owner only).",
                  "Use tools cautiously; changes may affect multiple schools.",
                ]}
              />
            )}
            {canManage && (
              <Card
                title="Manage Users"
                desc="Add or link users to your school and assign roles."
                to="/modify-user"
                tips={["Assign roles: superadmin, admin, score_taker, viewer.", "Users need membership to see classes and sessions."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Manage Users.",
                  "Select school and enter the user's email.",
                  "Choose the role (e.g., score_taker) and submit to link.",
                ]}
              />
            )}
            {canManage && (
              <Card
                title="Manage Students"
                desc="Import students in bulk, update details, and manage enrollments."
                to="/manage-students"
                tips={["Use CSV import for bulk updates.", "Ensure class/enrollment is up to date before sessions."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Manage Students.",
                  "Download or prepare the CSV template.",
                  "Import the file and review the summary of created/updated records.",
                ]}
              />
            )}
            {canView && (
              <Card
                title="Profile & Memberships"
                desc="Update your name and manage your school memberships."
                to="/profile"
                tips={["Only superadmins can see Audit per-school links in memberships."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Profile from the top-right email menu.",
                  "Edit your full name and save.",
                  "In Memberships, deactivate access you no longer need.",
                ]}
              />
            )}
          </div>
        </section>

        <section className="space-y-3" id="run">
          <h2 className="text-lg font-semibold">2. Run Assessment</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {canManage && (
              <Card
                title="Sessions"
                desc="Create sessions, manage status, and organize class test days."
                to="/sessions"
                tips={["Create a session and set it to Active before score entry.", "Close the session when finished to prevent further edits."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Sessions and click Create Session.",
                  "Fill in title, date, and class; save.",
                  "Set status to Active to allow score entry.",
                ]}
              />
            )}
            {canRecord && (
              <Card
                title="Score Entry"
                desc="Record students' attempts during an active session."
                to="/add-attempt"
                tips={["Session must be Active.", "Select the correct class and verify student identifiers before recording."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Go to Score Entry and choose the Active session.",
                  "Select the student and test item.",
                  "Enter result and save; repeat for each student.",
                ]}
              />
            )}
            {canView && (
              <Card
                title="View Score"
                desc="Search and verify recorded results across sessions."
                to="/view-score"
                tips={["Filter by class/session/date to narrow results."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open View Score.",
                  "Scan the student ID barcode or type it in to locate the student.",
                ]}
              />
            )}
          </div>
        </section>

        <section className="space-y-3" id="after">
          <h2 className="text-lg font-semibold">3. After Assessment</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {canManage && (
              <Card
                title="PFT Calculator"
                desc="Compute grades and export PFT from uploads or session data."
                to="/pft-calculator"
                tips={["Choose auto/1.6/2.4 km depending on cohort.", "You can compute from uploaded CSVs or directly from a session."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open PFT Calculator.",
                  "Choose source: Upload file or From Session.",
                  "Set test date and run mode (auto/1.6/2.4).",
                  "Compute and export the results file.",
                ]}
              />
            )}
            {canAudit && (
              <Card
                title="Audit Log"
                desc="Review recent changes and actions for your school."
                to="/audit"
                tips={["Superadmins can open per-school audit from Profile memberships.", "Use filters to narrow by type (e.g., scores, sessions)."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Audit and select school (if applicable).",
                  "Filter by type (scores, sessions, enrollments) or search.",
                  "Click session links to drilldown into details.",
                ]}
              />
            )}
            {canManage && (
              <Card
                title="Session Cards"
                desc="Generate profile cards from a specific session page."
                to="/sessions"
                cta="Open Sessions"
                tips={["Open a session then choose Cards to generate PDFs."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Sessions and select a session.",
                  "Click Cards to generate profile PDFs.",
                  "Download/print as needed for distribution.",
                ]}
              />
            )}
            {canManageStrict && (
              <Card
                title="Remove or Delete a Student"
                desc="Understand when to remove from school vs delete globally, with safeguards."
                to="/students"
                cta="Open Manage Students"
                tips={[
                  "Remove from school deletes this school's enrollments, roster, and scores only.",
                  "Delete globally requires superadmin and deletes ALL data for the student across schools.",
                  "A small 'Other school' pill indicates the student has enrollments in other schools.",
                ]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Manage Students.",
                  "Use the vertical triple-dot to reveal actions.",
                  "Choose 'Remove from school' to remove ONLY this school's enrollments, roster rows, and scores. The student record remains if enrolled elsewhere.",
                  "As a superadmin, choose 'Delete globally' to delete all scores, all roster rows, all enrollments, and the student identity across all schools.",
                  "Both actions prompt for confirmation and are logged in the audit log (if enabled).",
                  "Tip: Use 'Other school' pill as a visual cue that the student also exists in another school.",
                ]}
              />
            )}
          </div>
        </section>

        <section className="bg-white border rounded-lg p-4 shadow-sm space-y-4" id="faq">
          <h2 className="text-lg font-semibold">FAQ</h2>
          <div className="space-y-3 text-sm text-gray-700">
            <div>
              <p className="font-medium">Who can create sessions?</p>
              <p>Admins and superadmins can create/manage sessions. Score takers can record attempts while a session is active.</p>
            </div>
            <div>
              <p className="font-medium">I cannot see a class or student.</p>
              <p>You may not have a membership for that school or the student isn’t enrolled. Ask your school superadmin to confirm membership and enrollment.</p>
            </div>
            <div>
              <p className="font-medium">How do I correct a score?</p>
              <p>Open the session, locate the attempt in the roster, and update or remove it. Changes appear in the audit log.</p>
            </div>
            <div>
              <p className="font-medium">Where do I get help?</p>
              <p>Use <NavLink to="/contact" className="underline text-blue-700">Contact Us</NavLink> to reach the team.</p>
            </div>
          </div>
        </section>
      </div>

      {howToOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className={`absolute inset-0 bg-black/40 transition-opacity duration-150 ${howToEntered ? 'opacity-100' : 'opacity-0'}`} onClick={closeHowTo} />
          <div className={`relative bg-white border rounded-lg shadow-lg max-w-md w-full mx-4 p-5 transform transition-all duration-150 ${howToEntered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{howToTitle}: Step-by-step</h3>
              </div>
              <button className="text-sm px-2 py-1 border rounded hover:bg-gray-50" onClick={closeHowTo}>Close</button>
            </div>
            <ol className="mt-3 space-y-2 list-decimal pl-5 text-sm text-gray-800">
              {howToSteps.map((s, i) => (<li key={i}>{s}</li>))}
            </ol>
          </div>
        </div>
      )}
    </main>
  );
}
