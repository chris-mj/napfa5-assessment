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
              <li><a href="#whats-new" className="underline">What&apos;s New</a></li>
              <li><a href="#setup" className="underline">Set Up</a></li>
              <li><a href="#run" className="underline">Conduct Assessment</a></li>
              <li><a href="#after" className="underline">After Assessment</a></li>
              <li><a href="#learn" className="underline">Learn & Improve</a></li>
              <li><a href="#faq" className="underline">FAQ</a></li>
            </ul>
          </nav>
        </header>

        <section className="bg-white border rounded-lg p-4 shadow-sm space-y-3" id="whats-new">
          <h2 className="text-lg font-semibold">What&apos;s New</h2>
          <div className="space-y-4 text-sm text-gray-700">
            <div>
              <p className="font-medium">9 Apr</p>
              <ul className="list-disc pl-5 space-y-1 mt-1">
                <li>Session Detail roster tab now includes <span className="font-medium">A4 paper (4 cards per page, write score space)</span> for larger profile cards with handwritten station boxes.</li>
                <li>Session Detail scores tab now supports <span className="font-medium">Import PFT</span> using the standard PFT file format, with preview, overwrite-or-keep-better options, unmatched-student reporting, and duplicate-row merging.</li>
                <li>Challenge Hub now refreshes on a lighter 10-second polling cycle instead of live score subscriptions.</li>
                <li>Award Calculator exports now keep station <span className="font-medium">points</span> without grade columns, fix empty-run scoring, and include <span className="font-medium">Next grade recommendation</span>.</li>
                <li>Award Calculator now includes an <span className="font-medium">Individualised Student Report</span> download as an A5 PDF with test details, station points, award, next-grade recommendation, and training tips.</li>
              </ul>
            </div>
          </div>
        </section>

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
                title="Student Enrollment"
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
            {canManage && (
              <Card
                title="Sessions"
                desc="Create sessions, manage status, and organize class test days."
                to="/sessions"
                tips={["Create a session and set it to Active before score entry.", "Close the session when finished to prevent further edits.", "Use the Houses tab inside a session to assign student clans.", "Open Session Detail to access roster cards, scores import, and print/export tools."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Sessions and click Create Session.",
                  "Fill in title, date, and class; save.",
                  "Set status to Active to allow score entry.",
                ]}
              />
            )}
            {canManage && (
              <Card
                title="Session Houses"
                desc="Assign student clans within a session and manage house CSVs."
                to="/sessions"
                cta="Open Sessions"
                tips={["Open a session and switch to the Houses tab.", "Download the house list, edit, and upload to bulk-assign."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Sessions and select a session.",
                  "Go to the Houses tab.",
                  "Assign houses per student or use the bulk dropdown.",
                  "Download/upload the House CSV for bulk updates.",
                ]}
              />
            )}
            {canManage && (
              <Card
                title="Session Cards"
                desc="Generate profile cards and wristband formats from a specific session page."
                to="/sessions"
                cta="Open Sessions"
                tips={["Open a session then choose Cards to generate PDFs.", "Use the format menu to select the most suitable print layout (including 25mm wristband).", "The profile-card menu now includes a 4-up A4 write-score format for station use."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Sessions and select a session.",
                  "Click Cards and choose the required format.",
                  "For larger handwritten score sheets, choose A4 paper (4 cards per page, write score space).",
                  "Download/print as needed for distribution.",
                ]}
              />
            )}
            {canManage && (
              <Card
                title="StepWise2"
                desc="Create Run Setup tab in Session Detail StepWise2 for station flow, enforcement, and scan timing."
                to="/sessions"
                cta="Open Sessions"
                tips={[
                  "Run Setup is where you create and manage run session configurations for station-based running assessments.",
                  "It defines how stations operate together, including setup flow, laps required, checkpoint rules, and scan timing.",
                  "It also generates the token used by RUN stations to pair and sync for that configured run."
                ]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Sessions, choose the session, and open Run Setup in Session Detail.",
                  "Create the run session configuration: set Config Name, Setup Type, Laps Required, Checkpoint Enforcement, and Time Between Scans.",
                  "Generate token and pair all run stations in the RUN app.",
                  "SECTION: Recommended run session configuration model",
                  "Use 1 run session configuration for each conducted run (for example one class per token).",
                  "For the next class or a new run, create another run session configuration/token even if setup values are the same.",
                  "Use Reset Session Data only to restart the same run; do not use one active run session configuration across different runs."
                ]}
              />
            )}
          </div>
        </section>

        <section className="space-y-3" id="run">
          <h2 className="text-lg font-semibold">2. Run Assessment</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {canRecord && (
              <Card
                title="Score Entry"
                desc="Record students' attempts during an active session."
                to="/add-attempt"
                tips={["Session must be Active.", "Use Station Tools for timer/counter support and quick fill.", "Scanner now supports camera switching on supported devices.", "Repeated saves of the same score are skipped to reduce unnecessary writes."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Go to Score Entry and choose the Active session.",
                  "Choose the correct station before entering values.",
                  "Select the student and test item.",
                  "Optional: open Station Tools to use countdown/counter/stopwatch and fill the field.",
                  "Enter result and save; repeat for each student.",
                ]}
              />
            )}
            {canRecord && (
              <Card
                title="Score Entry (Group)"
                desc="Load a group and enter scores for multiple students in one screen."
                to="/add-attempt-group"
                tips={["Session must be Active.", "Double-check both Session and Station before entering scores.", "You can load a group by list selection, manual code, or scanner.", "Rows with unchanged values are skipped when saving all changes."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Score Entry (Group) and confirm the correct active session.",
                  "Confirm the correct station from the station selector.",
                  "Load a group using the group dropdown, manual code, or camera scan.",
                  "Enter scores row by row and click Save for each row, or use Save All Changes when done.",
                ]}
              />
            )}
            {canManage && (
              <Card
                title="Challenge Hub"
                desc="Track top scorers and gender-split leaderboards for a session."
                to="/gamification"
                tips={["Select a session to view top scorers.", "Group leaderboards by class or house.", "The page refreshes on a timed cycle and also supports manual refresh."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Challenge Hub.",
                  "Choose a session.",
                  "Review top scorers by station and leaderboards by class/house.",
                  "Use Refresh if you need the latest scores immediately between polling cycles.",
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
                title="NAPFA Award Calculator"
                desc="Compute grades and export PFT from uploads or session data."
                to="/pft-calculator"
                tips={["Choose auto/1.6/2.4 km depending on cohort.", "You can compute from uploaded CSVs or directly from a session.", "Exports now include station points and a Next grade recommendation column.", "Use Individualised Student Report for A5 PDF handouts."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open PFT Calculator.",
                  "Choose source: Upload file or From Session.",
                  "Set test date and run mode (auto/1.6/2.4).",
                  "Download the combined CSV, per-class CSVs, or the Individualised Student Report PDF.",
                ]}
              />
            )}
            {canManage && (
              <Card
                title="Charts"
                desc="Quick visual summaries under Insights."
                to="/charts"
                tips={["Charts are under Insights in the navbar."]}
                onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
                howToSteps={[
                  "Open Charts from the Insights menu.",
                  "Review available summary views.",
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

        <section className="space-y-3" id="learn">
          <h2 className="text-lg font-semibold">4. Learn & Improve</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Card
              title="Learning Hub"
              desc="Station-by-station technique, drills, mistakes, and cues."
              to="/learning-hub"
              tips={["Use this to coach students before and after tests."]}
              onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
              howToSteps={[
                "Open Learning Hub from the Learn menu.",
                "Expand a station to see technique and drill ideas.",
              ]}
            />
            <Card
              title="Target Score"
              desc="Estimate targets for a desired grade or award."
              to="/target-score"
              tips={["Use it as a goal-setting tool for students."]}
              onHowTo={(t, s) => { setHowToTitle(t); setHowToSteps(s); setHowToOpen(true); }}
              howToSteps={[
                "Open Target Score from the Learn menu.",
                "Select student details and desired award/grade.",
                "Review the suggested station targets.",
              ]}
            />
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
            <div className="mt-3 space-y-2 text-sm text-gray-800">
              {(() => {
                let stepNo = 0;
                return howToSteps.map((s, i) => {
                  if (String(s).startsWith("SECTION:")) {
                    const heading = String(s).replace("SECTION:", "").trim();
                    return <div key={i} className="pt-1 font-semibold text-gray-900">{heading}</div>;
                  }
                  stepNo += 1;
                  return (
                    <div key={i} className="pl-1">
                      <span className="font-medium">{stepNo}. </span>
                      <span>{s}</span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
