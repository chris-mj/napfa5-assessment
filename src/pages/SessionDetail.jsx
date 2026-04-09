import { useCallback, useEffect, useMemo, useState } from "react";
import AttemptEditor from "../components/AttemptEditor";
import { jsPDF } from "jspdf";
import { drawBarcode } from "../utils/barcode";
import { drawQrDataUrl } from "../utils/qrcode";
import { normalizeStudentId } from "../utils/ids";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { isPlatformOwner } from "../lib/roles";
import { supabase } from "../lib/supabaseClient";
import { fmtRun } from "../lib/scores";
import { fetchSessionRosterWithStudents } from "../lib/sessionRoster";
import { evaluateIppt3, awardForTotal } from "../utils/ippt3Standards";
import { evaluateNapfa } from "../utils/napfaStandards";
import { parseNapfaCsv } from "../utils/napfaCsv";
import RosterDualList from "../components/RosterDualList";
import SessionHouses from "../components/SessionHouses";
import SessionGroups from "../components/SessionGroups";

const ROLE_CAN_MANAGE = ["superadmin", "admin"];
const RUN_DISTANCE_PRESETS = [1600, 2400, 3200, 5000, 10000];
const RESET_RUN_ENDPOINT = import.meta.env.DEV
    ? 'http://localhost:3000/api/run/resetConfig'
    : 'https://napfa5-assessment.vercel.app/api/run/resetConfig';
const NAPFA_IMPORT_FIELDS = ['situps', 'broad_jump', 'sit_and_reach', 'pullups', 'shuttle_run', 'run_2400'];
const PFT_IMPORT_PREVIEW_LIMIT = 50;

function normalizeImportedScoreValue(key, value) {
    if (value == null || value === "") return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return key === 'shuttle_run' ? Number(num.toFixed(1)) : Number(num.toFixed(2));
}

function isImportedScoreBetter(key, incoming, existing) {
    if (incoming == null) return false;
    if (existing == null) return true;
    if (key === 'shuttle_run' || key === 'run_2400') return incoming < existing;
    return incoming > existing;
}

function mergeImportedRowsByBest(rows) {
    const byIdentifier = new Map();
    const duplicateCounts = new Map();
    rows.forEach((row) => {
        const id = normalizeStudentId(row?.id || "");
        if (!id) return;
        const existing = byIdentifier.get(id);
        if (!existing) {
            byIdentifier.set(id, { ...row, id });
            duplicateCounts.set(id, 1);
            return;
        }
        duplicateCounts.set(id, (duplicateCounts.get(id) || 1) + 1);
        const merged = { ...existing };
        NAPFA_IMPORT_FIELDS.forEach((key) => {
            const incoming = normalizeImportedScoreValue(key, row[key]);
            const current = normalizeImportedScoreValue(key, merged[key]);
            if (isImportedScoreBetter(key, incoming, current)) merged[key] = incoming;
        });
        byIdentifier.set(id, merged);
    });
    return {
        rows: Array.from(byIdentifier.values()),
        duplicateCount: Array.from(duplicateCounts.values()).filter((count) => count > 1).length,
    };
}

function gradeToRank(g) {
    if (!g) return 0;
    const t = String(g).toUpperCase();
    return t === 'A' ? 5 : t === 'B' ? 4 : t === 'C' ? 3 : t === 'D' ? 2 : t === 'E' ? 1 : 0;
}

function fiveCompleted(res) {
    const st = res?.stations || {};
    return !!(st.situps?.grade && st.broad_jump_cm?.grade && st.sit_and_reach_cm?.grade && st.pullups?.grade && st.shuttle_s?.grade);
}

function sixCompleted(res) {
    const st = res?.stations || {};
    return fiveCompleted(res) && !!st.run?.grade;
}

function sumFivePoints(res) {
    const st = res?.stations || {};
    return (st.situps?.points || 0)
        + (st.broad_jump_cm?.points || 0)
        + (st.sit_and_reach_cm?.points || 0)
        + (st.pullups?.points || 0)
        + (st.shuttle_s?.points || 0);
}

function worstGradeRank(keys, res) {
    const st = res?.stations || {};
    const ranks = keys.map((k) => st[k]?.grade).filter(Boolean).map(gradeToRank);
    return ranks.length ? Math.min(...ranks) : 0;
}

function computeNapfaAward(res) {
    const st = res?.stations || {};
    const grades = [st.situps?.grade, st.broad_jump_cm?.grade, st.sit_and_reach_cm?.grade, st.pullups?.grade, st.shuttle_s?.grade, st.run?.grade];
    if (grades.some((g) => !g)) return { label: 'No Award', reason: 'Incomplete results across all stations.' };

    const total = res?.totalPoints || 0;
    const minRank = Math.min(...grades.map(gradeToRank));

    if (total >= 21 && minRank >= gradeToRank('C')) return { label: 'Gold', reason: `Total ${total} points and at least grade C in all stations.` };
    if (total >= 15 && minRank >= gradeToRank('D')) return { label: 'Silver', reason: `Total ${total} points and at least grade D in all stations.` };
    if (total >= 6 && minRank >= gradeToRank('E')) return { label: 'Bronze', reason: `Total ${total} points and at least grade E in all stations.` };
    return { label: 'No Award', reason: `Total ${total} points or minimum grade conditions not met.` };
}

function computeNapfaProvisionalAward(res) {
    const total = sumFivePoints(res);
    const minRank = worstGradeRank(['situps', 'broad_jump_cm', 'sit_and_reach_cm', 'pullups', 'shuttle_s'], res);
    if (total >= 21 && minRank >= gradeToRank('C')) return { label: 'Gold', reason: `Five-station subtotal ${total} points and all >= C.` };
    if (total >= 15 && minRank >= gradeToRank('D')) return { label: 'Silver', reason: `Five-station subtotal ${total} points and all >= D.` };
    if (total >= 6 && minRank >= gradeToRank('E')) return { label: 'Bronze', reason: `Five-station subtotal ${total} points and all >= E.` };
    return { label: 'No Award', reason: `Five-station subtotal ${total} points or minimum grade conditions not met.` };
}

function getNapfaAwardDisplay(res) {
    if (sixCompleted(res)) {
        const currentAward = computeNapfaAward(res);
        return { label: currentAward.label, reason: currentAward.reason, kind: 'final' };
    }
    if (fiveCompleted(res)) {
        const provisional = computeNapfaProvisionalAward(res);
        return {
            label: provisional.label,
            reason: provisional.reason,
            kind: provisional.label === 'No Award' ? 'final' : 'provisional',
        };
    }
    return { label: 'Incomplete', reason: 'Complete at least the five non-run stations to see an award.', kind: 'incomplete' };
}

function mapIppt3AwardDisplay(award) {
    const label = String(award || '').trim();
    if (!label) return { label: 'No Award', kind: 'none' };
    if (label === 'Pass') return { label: 'Bronze', kind: 'mapped' };
    return { label, kind: label === 'No Award' ? 'none' : 'final' };
}

function AwardBadge({ award }) {
    const label = String(award?.label || '').trim() || 'No Award';
    const kind = award?.kind || 'final';
    const baseClass = label === 'Gold'
        ? 'bg-amber-200 text-amber-950 border-amber-400'
        : label === 'Silver'
            ? 'bg-slate-200 text-slate-900 border-slate-400'
            : label === 'Bronze'
                ? 'bg-orange-100 text-orange-900 border-orange-300'
                : label === 'Incomplete'
                    ? 'bg-sky-100 text-sky-900 border-sky-200'
                    : 'bg-slate-100 text-slate-700 border-slate-200';

    return (
        <div className="space-y-1">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${baseClass}`}>
                {kind === 'provisional' ? `Provisional ${label}` : label}
            </span>
            {kind === 'mapped' && (
                <div className="text-[11px] text-slate-500">IPPT Pass shown as Bronze</div>
            )}
        </div>
    );
}

function toMillis(value) {
    const t = new Date(value || 0).getTime();
    return Number.isFinite(t) ? t : 0;
}

function eventRunnerId(event) {
    return String(event?.payload?.runner_id || "").trim();
}

function deriveRunTagTimings(config, events) {
    const template = String(config?.template_key || "A").toUpperCase();
    const lapsRequired = Math.max(1, Number(config?.laps_required) || 1);
    const enforcement = String(config?.enforcement || "OFF").toUpperCase();
    const checkpoints = template === "B" ? ["A"] : template === "C" ? ["A", "B"] : [];
    const scoped = [...(events || [])]
        .sort((a, b) => toMillis(a.occurred_at) - toMillis(b.occurred_at));

    const lastClearMs = scoped.reduce((m, e) => {
        if (String(e.event_type) === "CLEAR_ALL") return Math.max(m, toMillis(e.occurred_at));
        return m;
    }, 0);
    const activeEvents = lastClearMs
        ? scoped.filter((e) => toMillis(e.occurred_at) >= lastClearMs)
        : scoped;

    const byTag = new Map();
    const ensure = (tag) => {
        if (!byTag.has(tag)) {
            byTag.set(tag, {
                startedAtMs: null,
                finishedAtMs: null,
                lapCount: 0,
                checkpointsSeen: {},
                scanTimeline: []
            });
        }
        return byTag.get(tag);
    };

    for (const event of activeEvents) {
        if (String(event.event_type) !== "PASS") continue;
        const tag = eventRunnerId(event);
        if (!tag) continue;
        const station = String(event.station_id || "");
        const t = toMillis(event.occurred_at);
        const state = ensure(tag);
        if (state.finishedAtMs) continue;

        if (station === "START" && template === "D" && state.startedAtMs == null) {
            state.startedAtMs = t;
            state.scanTimeline.push({ station, t });
            continue;
        }

        if (station === "A" || station === "B") {
            if (checkpoints.includes(station)) state.checkpointsSeen[station] = true;
            if (state.startedAtMs != null) state.scanTimeline.push({ station, t });
            continue;
        }

        if (station === "LAP_END") {
            if (template !== "D" && state.startedAtMs == null) {
                state.startedAtMs = t;
                state.scanTimeline.push({ station, t });
                state.checkpointsSeen = {};
                continue;
            }
            if (template === "D" && state.startedAtMs == null) {
                continue;
            }
            state.scanTimeline.push({ station, t });
            const missing = checkpoints.some((cp) => !state.checkpointsSeen[cp]);
            if (missing && enforcement === "STRICT") {
                state.checkpointsSeen = {};
                continue;
            }
            state.lapCount += 1;
            state.checkpointsSeen = {};
            if (template !== "E" && state.lapCount >= lapsRequired) {
                state.finishedAtMs = t;
            }
            continue;
        }

        if (station === "FINISH" && template === "E" && state.startedAtMs != null) {
            state.scanTimeline.push({ station, t });
            if (state.lapCount >= lapsRequired) {
                state.finishedAtMs = t;
            }
        }
    }

    const out = [];
    for (const [tag, state] of byTag.entries()) {
        if (!state.startedAtMs || !state.finishedAtMs || state.finishedAtMs <= state.startedAtMs) continue;
        const elapsedSec = Math.round((state.finishedAtMs - state.startedAtMs) / 1000);
        if (elapsedSec <= 0) continue;
        const intervals = [];
        const interval_steps = [];
        for (let i = 1; i < state.scanTimeline.length; i += 1) {
            const prev = state.scanTimeline[i - 1];
            const curr = state.scanTimeline[i];
            const sec = Math.max(0, Math.round((curr.t - prev.t) / 1000));
            const mmss = fmtRun(Number((sec / 60).toFixed(2))) || "-";
            intervals.push(`${prev.station}->${curr.station} ${mmss}`);
            interval_steps.push({
                station: curr.station,
                mmss
            });
        }
        out.push({
            tag_id: tag,
            elapsed_seconds: elapsedSec,
            run_2400: Number((elapsedSec / 60).toFixed(2)),
            intervals_text: intervals.join(" | "),
            interval_steps
        });
    }
    return out;
}

function deriveRunTagTimingsForExport(config, events) {
    const template = String(config?.template_key || "A").toUpperCase();
    const lapsRequired = Math.max(1, Number(config?.laps_required) || 1);
    const requiredCheckpoints = template === "B" ? ["A"] : template === "C" ? ["A", "B"] : [];

    const sorted = [...(events || [])].sort((a, b) => toMillis(a.occurred_at) - toMillis(b.occurred_at));
    const lastClearMs = sorted.reduce((m, e) => String(e.event_type) === "CLEAR_ALL" ? Math.max(m, toMillis(e.occurred_at)) : m, 0);
    const active = lastClearMs ? sorted.filter((e) => toMillis(e.occurred_at) >= lastClearMs) : sorted;

    const byTag = new Map();
    const ensure = (tag) => {
        if (!byTag.has(tag)) {
            byTag.set(tag, {
                startedAtMs: null,
                finishedAtMs: null,
                lapCount: 0,
                timeline: [],
                seenCheckpoints: {}
            });
        }
        return byTag.get(tag);
    };

    for (const event of active) {
        if (String(event.event_type) !== "PASS") continue;
        const tag = eventRunnerId(event);
        if (!tag) continue;
        const station = String(event.station_id || "");
        const t = toMillis(event.occurred_at);
        const state = ensure(tag);
        if (state.finishedAtMs) continue;

        if ((station === "A" || station === "B") && requiredCheckpoints.includes(station)) {
            state.seenCheckpoints[station] = true;
            continue;
        }

        if (station === "START" && template === "D" && state.startedAtMs == null) {
            state.startedAtMs = t;
            state.timeline.push({ station, t });
            continue;
        }

        if (station === "LAP_END") {
            if (state.startedAtMs == null) {
                state.startedAtMs = t;
                state.timeline.push({ station, t });
                continue;
            }
            state.timeline.push({ station, t });
            state.lapCount += 1;
            if (template !== "E" && state.lapCount >= lapsRequired) {
                state.finishedAtMs = t;
            }
            continue;
        }

        if (station === "FINISH" && template === "E" && state.startedAtMs != null) {
            state.timeline.push({ station, t });
            if (state.lapCount >= lapsRequired) {
                state.finishedAtMs = t;
            }
        }
    }

    const out = [];
    for (const [tag, state] of byTag.entries()) {
        if (!state.startedAtMs || !state.finishedAtMs || state.finishedAtMs <= state.startedAtMs) continue;
        const elapsedSec = Math.round((state.finishedAtMs - state.startedAtMs) / 1000);
        if (elapsedSec <= 0) continue;
        const interval_steps = [];
        for (let i = 1; i < state.timeline.length; i += 1) {
            const prev = state.timeline[i - 1];
            const curr = state.timeline[i];
            const sec = Math.max(0, Math.round((curr.t - prev.t) / 1000));
            interval_steps.push({
                station: curr.station,
                mmss: fmtRun(Number((sec / 60).toFixed(2))) || "-"
            });
        }
        const missingCheckpoint = requiredCheckpoints.length
            ? requiredCheckpoints.some((cp) => !state.seenCheckpoints[cp])
            : false;
        out.push({
            tag_id: tag,
            elapsed_seconds: elapsedSec,
            run_2400: Number((elapsedSec / 60).toFixed(2)),
            checkpoint_flag: requiredCheckpoints.length ? (missingCheckpoint ? "Missing checkpoint" : "OK") : "",
            interval_steps
        });
    }
    return out;
}

function RosterRow({ s, sessionId, canRecord, onSaved }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <tr>
                <td className="px-3 py-2 border">{normalizeStudentId(s.student_identifier)}</td>
                <td className="px-3 py-2 border">{s.name}</td>
                <td className="px-3 py-2 border">
                    <button onClick={() => canRecord && setOpen(v => !v)} disabled={!canRecord} className="px-3 py-1.5 border rounded hover:bg-gray-100 text-sm">
                        {open ? 'Close' : (canRecord ? 'Record' : 'View')}
                    </button>
                </td>
            </tr>
            {open && (
                <tr>
                    <td colSpan="3" className="px-3 py-3 border bg-gray-50">
                        <AttemptEditor sessionId={sessionId} studentId={s.id} onSaved={onSaved} />
                    </td>
                </tr>
            )}
        </>
    );
}

export default function SessionDetail({ user }) {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

    const [membership, setMembership] = useState(null);
    const [schoolName, setSchoolName] = useState("");
    const [schoolType, setSchoolType] = useState(null);
    const [membershipLoading, setMembershipLoading] = useState(true);
    const [membershipError, setMembershipError] = useState("");

    const [session, setSession] = useState(null);
    const [roster, setRoster] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [editMode, setEditMode] = useState(() => !!(location?.state && location.state.edit));
    const [formState, setFormState] = useState({ title: "", session_date: "" });
    const [formSubmitting, setFormSubmitting] = useState(false);
    const [flash, setFlash] = useState("");
    const [scoresCount, setScoresCount] = useState(0);
    const [scoredSet, setScoredSet] = useState(new Set());
    const [inProgressSet, setInProgressSet] = useState(new Set());
    const [completedSet, setCompletedSet] = useState(new Set());
    const [scoresByStudent, setScoresByStudent] = useState(new Map());
    const isIppt3 = (session?.assessment_type || 'NAPFA5') === 'IPPT3';
    const [scoresPage, setScoresPage] = useState(1);
    const [scoresPageSize, setScoresPageSize] = useState(100);
    const [massEditMode, setMassEditMode] = useState(false);
    const [massEditBusy, setMassEditBusy] = useState(false);
    const [massEditErr, setMassEditErr] = useState("");
    const [massEditNotice, setMassEditNotice] = useState("");
    const [massEdits, setMassEdits] = useState(new Map()); // studentId -> partial score object
    const [massEditCancelOpen, setMassEditCancelOpen] = useState(false);
    const [massEditSaveOpen, setMassEditSaveOpen] = useState(false);
    const [completedScoresDialogOpen, setCompletedScoresDialogOpen] = useState(false);
    const [pftImportOpen, setPftImportOpen] = useState(false);
    const [pftImportBusy, setPftImportBusy] = useState(false);
    const [pftImportErr, setPftImportErr] = useState("");
    const [pftImportPreview, setPftImportPreview] = useState(null);
    const [pftImportFileName, setPftImportFileName] = useState("");
    const [pftImportCsvText, setPftImportCsvText] = useState("");
    const [pftImportMode, setPftImportMode] = useState('keep_better');
    const [statusCompleteConfirmOpen, setStatusCompleteConfirmOpen] = useState(false);
    const [pendingStatusChange, setPendingStatusChange] = useState(null);
    const [filterClass, setFilterClass] = useState("");
    const [filterQuery, setFilterQuery] = useState("");
    const [showCompleted, setShowCompleted] = useState(true);
    const [showIncomplete, setShowIncomplete] = useState(true);
    const [statusUpdating, setStatusUpdating] = useState(false);
    const [summaryOpen, setSummaryOpen] = useState(false);
    const [runConfigs, setRunConfigs] = useState([]);
    const [expandedRunConfigId, setExpandedRunConfigId] = useState(null);
    const [runConfigForm, setRunConfigForm] = useState({
        name: "",
        template_key: "A",
        run_distance_m: 2400,
        laps_required: 3,
        enforcement: "OFF",
        scan_gap_ms: 10000
    });
    const [runConfigSaving, setRunConfigSaving] = useState(false);
    const [runConfigFlash, setRunConfigFlash] = useState("");
    const [showRunDataDeleteModal, setShowRunDataDeleteModal] = useState(false);
    const [pendingRunDataDeleteConfig, setPendingRunDataDeleteConfig] = useState(null);
    const [runDataDeleteBusy, setRunDataDeleteBusy] = useState(false);
    const [showRunConfigDeleteModal, setShowRunConfigDeleteModal] = useState(false);
    const [pendingDeleteRunConfig, setPendingDeleteRunConfig] = useState(null);
    const [runConfigDeleteBusy, setRunConfigDeleteBusy] = useState(false);
    const [runConfigBaselineById, setRunConfigBaselineById] = useState({});
    const [runTagMappingsByConfig, setRunTagMappingsByConfig] = useState({});
    const [runTagDraftByConfig, setRunTagDraftByConfig] = useState({});
    const [runTagBusyByConfig, setRunTagBusyByConfig] = useState({});
    const [runApplyPolicyByConfig, setRunApplyPolicyByConfig] = useState({});
    const [runApplyPreviewByConfig, setRunApplyPreviewByConfig] = useState({});
    const [showRunTagMapModal, setShowRunTagMapModal] = useState(false);
    const [showRunLockModal, setShowRunLockModal] = useState(false);
    const [activeRunConfigForModal, setActiveRunConfigForModal] = useState(null);
    const [runTagClassFilter, setRunTagClassFilter] = useState("");
    const [runTagRule, setRunTagRule] = useState("numeric");
    const [runTagNumericStart, setRunTagNumericStart] = useState("1");
    const [showSessionDeleteModal, setShowSessionDeleteModal] = useState(false);
    const [sessionDeleteBusy, setSessionDeleteBusy] = useState(false);
    const [activeTab, setActiveTab] = useState(() => {
        if (location.hash === '#scores') return 'scores';
        if (location.hash === '#houses') return 'houses';
        if (location.hash === '#groups') return 'groups';
        if (location.hash === '#run-setup') return 'run-setup';
        return 'roster';
    });

    // default scroll behavior; removed inline scroll memory per request

    // scroll-memory removed per request

    const platformOwner = isPlatformOwner(user);
    const canManage = useMemo(() => platformOwner || ROLE_CAN_MANAGE.includes(membership?.role), [platformOwner, membership]);
    const sessionCompleted = session?.status === 'completed';
    const rosterEditable = canManage && !sessionCompleted;
    const checkpointTemplates = new Set(["B", "C"]);
    const defaultRunEnforcement = (templateKey) => (checkpointTemplates.has(templateKey) ? "SOFT" : "OFF");
    const normalizeRunConfigComparable = (cfg) => ({
        name: String(cfg?.name || "").trim(),
        template_key: String(cfg?.template_key || "A"),
        run_distance_m: Number(cfg?.run_distance_m) || 2400,
        laps_required: Number(cfg?.laps_required) || 1,
        enforcement: String(cfg?.enforcement || "OFF"),
        scan_gap_ms: Number(cfg?.scan_gap_ms) || 10000
    });
    const hasUnsavedRunConfig = (cfg) => {
        if (!cfg?.id) return false;
        const baseline = runConfigBaselineById[cfg.id];
        if (!baseline) return false;
        const current = normalizeRunConfigComparable(cfg);
        return JSON.stringify(current) !== JSON.stringify(baseline);
    };

    const formatDDMMYYYY = (iso) => {
        if (!iso) return "";
        const d = new Date(iso);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    };
    const calcAgeAt = (dobISO, when) => {
        if (!dobISO) return null;
        try {
            const birth = new Date(dobISO);
            const d = when instanceof Date ? when : new Date(when);
            let age = d.getFullYear() - birth.getFullYear();
            const m = d.getMonth() - birth.getMonth();
            if (m < 0 || (m === 0 && d.getDate() < birth.getDate())) age--;
            return age;
        } catch { return null; }
    };
    // For input[type=date], value should be YYYY-MM-DD. Avoid timezone shifts by string slicing.
    const toInputDate = (iso) => {
        if (!iso) return "";
        const s = String(iso);
        return s.length >= 10 ? s.slice(0, 10) : "";
    };

    useEffect(() => {
        if (!user?.id) return;
        setMembershipLoading(true);
        supabase
            .from("memberships")
            .select("id, school_id, role")
            .eq("user_id", user.id)
            .maybeSingle()
            .then(({ data, error: err }) => {
                if (err || !data) {
                    setMembershipError("Unable to determine school membership.");
                } else {
                    setMembership(data);
                }
            })
            .finally(() => setMembershipLoading(false));
    }, [user?.id]);

    // Load school name for context (PDF/profile cards)
    useEffect(() => {
        if (!membership?.school_id) return;
        supabase
            .from('schools')
            .select('id,name,type')
            .eq('id', membership.school_id)
            .maybeSingle()
            .then(({ data }) => { setSchoolName(data?.name || ""); setSchoolType(data?.type || null); });
    }, [membership?.school_id]);

    useEffect(() => {
        if (!membership?.school_id || !id) return;
        setLoading(true);
        supabase
            .from("sessions")
            .select("*")
            .eq("id", id)
            .maybeSingle()
            .then(({ data, error: err }) => {
                if (err) {
                    setError(err.message || "Failed to load session.");
                    setSession(null);
                } else if (!data) {
                    setError("Session not found.");
                    setSession(null);
                } else if (data.school_id !== membership.school_id) {
                    setError("Access denied for this session.");
                    setSession(null);
                } else {
                    setSession(data);
                    setFormState({ title: data.title, session_date: toInputDate(data.session_date) });
                    setError("");
                }
            })
            .finally(() => setLoading(false));
    }, [membership?.school_id, id]);

    useEffect(() => {
        if (!id) return;
        loadRoster();
        loadScoresCount();
        loadScoresMap();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, session?.assessment_type]);

    useEffect(() => {
        if (!id) return;
        loadRunConfigs();
        loadRunTagMappings();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    useEffect(() => {
        if (!expandedRunConfigId) return;
        setRunTagDraftByConfig((prev) => {
            if (prev[expandedRunConfigId]) return prev;
            return {
                ...prev,
                [expandedRunConfigId]: buildTagDraftForConfig(expandedRunConfigId)
            };
        });
    }, [expandedRunConfigId, runTagMappingsByConfig]);

    // Recompute counts whenever roster changes to keep progress in sync
    useEffect(() => {
        if (!id) return;
        // When roster updates (often after async fetch), refresh status sets
        loadScoresCount();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roster, id]);

    // Keep tab state in sync with URL hash
    useEffect(() => {
        const fromHash = location.hash === '#scores'
            ? 'scores'
            : (location.hash === '#houses'
                ? 'houses'
                : (location.hash === '#groups'
                    ? 'groups'
                    : (location.hash === '#run-setup' ? 'run-setup' : 'roster')));
        if (fromHash !== activeTab) setActiveTab(fromHash);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.hash]);

    useEffect(() => {
        const desiredHash = activeTab === 'scores'
            ? '#scores'
            : (activeTab === 'houses'
                ? '#houses'
                : (activeTab === 'groups'
                    ? '#groups'
                    : (activeTab === 'run-setup' ? '#run-setup' : '#roster')));
        if (location.hash !== desiredHash) {
            navigate({ hash: desiredHash }, { replace: true });
        }
    }, [activeTab, location.hash, navigate]);

    useEffect(() => {
        if (activeTab !== 'scores') {
            setMassEditMode(false);
            setMassEdits(new Map());
            setMassEditErr('');
            setMassEditNotice('');
            setMassEditCancelOpen(false);
            setMassEditSaveOpen(false);
        }
    }, [activeTab]);

    const runToInput = (runMin) => {
        const n = Number(runMin);
        if (!Number.isFinite(n)) return '';
        const total = Math.round(n * 60);
        const mm = Math.floor(total / 60);
        const ss = total % 60;
        return `${mm}${String(ss).padStart(2, '0')}`;
    };

    const parseRunInput = (raw) => {
        const s = String(raw || '').trim();
        if (!s) return { ok: true, value: null };
        const digits = s.includes(':') ? s.replace(':', '') : s.replace(/[^0-9]/g, '');
        if (!/^\d{3,4}$/.test(digits)) return { ok: false, error: 'Run must be MSS/MMSS digits (e.g. 930 or 1330).' };
        const mm = digits.length === 3 ? parseInt(digits.slice(0, 1), 10) : parseInt(digits.slice(0, 2), 10);
        const ss = parseInt(digits.slice(-2), 10);
        if (!Number.isFinite(mm) || !Number.isFinite(ss) || ss >= 60) return { ok: false, error: 'Run seconds must be 00-59.' };
        return { ok: true, value: Number.parseFloat((mm + ss / 60).toFixed(2)) };
    };

    const parseIntOrNull = (raw, min, max, label) => {
        const s = String(raw ?? '').trim();
        if (!s) return { ok: true, value: null };
        const n = Number.parseInt(s, 10);
        if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number.` };
        if (n < min || n > max) return { ok: false, error: `${label} must be ${min}-${max}.` };
        return { ok: true, value: n };
    };

    const parseFloatOrNull = (raw, min, max, label, dp = 1) => {
        const s = String(raw ?? '').trim();
        if (!s) return { ok: true, value: null };
        const n = Number.parseFloat(s);
        if (!Number.isFinite(n)) return { ok: false, error: `${label} must be a number.` };
        if (n < min || n > max) return { ok: false, error: `${label} must be ${min}-${max}.` };
        return { ok: true, value: Number.parseFloat(n.toFixed(dp)) };
    };

    const openCompletedScoresDialog = () => {
        setCompletedScoresDialogOpen(true);
    };

    const saveMassEditVisible = async () => {
        if (sessionCompleted) {
            openCompletedScoresDialog();
            return;
        }
        const visible = pagedScoresRoster || [];
        if (!visible.length) return;
        setMassEditErr('');
        setMassEditNotice('');

        const payload = [];
        const errors = [];

        visible.forEach((s) => {
            const edits = massEdits.get(s.id);
            if (!edits) return;
            const patch = { session_id: id, student_id: s.id };

            if (isIppt3) {
                if ('situps' in edits) {
                    const r = parseIntOrNull(edits.situps, 0, 60, `${s.name} sit-ups`);
                    if (!r.ok) { errors.push(r.error); return; }
                    patch.situps = r.value;
                }
                if ('pushups' in edits) {
                    const r = parseIntOrNull(edits.pushups, 0, 60, `${s.name} push-ups`);
                    if (!r.ok) { errors.push(r.error); return; }
                    patch.pushups = r.value;
                }
                if ('run_2400' in edits) {
                    const r = parseRunInput(edits.run_2400);
                    if (!r.ok) { errors.push(`${s.name} ${r.error}`); return; }
                    patch.run_2400 = r.value;
                }
            } else {
                if ('situps' in edits) {
                    const r = parseIntOrNull(edits.situps, 0, 60, `${s.name} sit-ups`);
                    if (!r.ok) { errors.push(r.error); return; }
                    patch.situps = r.value;
                }
                if ('shuttle_run' in edits) {
                    const r = parseFloatOrNull(edits.shuttle_run, 0, 20, `${s.name} shuttle run`);
                    if (!r.ok) { errors.push(r.error); return; }
                    patch.shuttle_run = r.value;
                }
                if ('sit_and_reach' in edits) {
                    const r = parseIntOrNull(edits.sit_and_reach, 0, 80, `${s.name} sit & reach`);
                    if (!r.ok) { errors.push(r.error); return; }
                    patch.sit_and_reach = r.value;
                }
                if ('pullups' in edits) {
                    const r = parseIntOrNull(edits.pullups, 0, 60, `${s.name} pull-ups`);
                    if (!r.ok) { errors.push(r.error); return; }
                    patch.pullups = r.value;
                }
                if ('broad_jump' in edits) {
                    const r = parseIntOrNull(edits.broad_jump, 0, 300, `${s.name} broad jump`);
                    if (!r.ok) { errors.push(r.error); return; }
                    patch.broad_jump = r.value;
                }
                if ('run_2400' in edits) {
                    const r = parseRunInput(edits.run_2400);
                    if (!r.ok) { errors.push(`${s.name} ${r.error}`); return; }
                    patch.run_2400 = r.value;
                }
            }

            if (Object.keys(patch).length > 2) payload.push(patch);
        });

        if (errors.length) {
            setMassEditErr(errors[0]);
            return;
        }
        if (!payload.length) {
            setMassEditErr('No visible edits to save.');
            return;
        }

        setMassEditBusy(true);
        try {
            const table = isIppt3 ? 'ippt3_scores' : 'scores';
            const { error: upErr } = await supabase.from(table).upsert(payload, { onConflict: 'session_id,student_id' });
            if (upErr) throw upErr;

            await loadScoresMap();
            await loadScoresCount();

            setMassEdits((prev) => {
                const next = new Map(prev);
                visible.forEach((s) => next.delete(s.id));
                return next;
            });
            setMassEditNotice(`Saved ${payload.length} row(s) from the current table page.`);
            setMassEditMode(false);
            setMassEdits(new Map());
            setMassEditErr('');
        } catch (e) {
            setMassEditErr(e.message || 'Failed to save visible score edits.');
        } finally {
            setMassEditBusy(false);
        }
    };

    const loadRoster = async () => {
        const sessionYear = session?.session_date ? new Date(session.session_date).getFullYear() : null;
        let data;
        try {
            data = await fetchSessionRosterWithStudents(supabase, id, {
                schoolId: membership?.school_id || null,
                sessionYear,
                studentFields: ["id", "student_identifier", "name", "gender", "dob"],
            });
        } catch {
            return;
        }
        const list = (data || []).map((r) => {
            const s = r.students || {};
            return { id: s.id, student_identifier: s.student_identifier, name: s.name, class: r.class || "", gender: s.gender, dob: s.dob };
        });
        setRoster(list);
    };

    const loadRunConfigs = async () => {
        if (!id) return;
        const { data, error: err } = await supabase
            .from('run_configs')
            .select('*')
            .eq('session_id', id)
            .order('created_at', { ascending: false });
        if (err) return;
        const rows = data || [];
        setRunConfigs(rows);
        const baseline = {};
        for (const row of rows) baseline[row.id] = normalizeRunConfigComparable(row);
        setRunConfigBaselineById(baseline);
    };

    const loadRunTagMappings = async () => {
        if (!id) return;
        const { data, error: err } = await supabase
            .from("run_tag_mappings")
            .select("id, run_config_id, session_id, student_id, tag_id, updated_at")
            .eq("session_id", id);
        if (err) return;
        const grouped = {};
        for (const row of (data || [])) {
            const key = row.run_config_id;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(row);
        }
        setRunTagMappingsByConfig(grouped);
    };

    const buildTagDraftForConfig = (configId) => {
        const rows = runTagMappingsByConfig[configId] || [];
        const next = {};
        for (const row of rows) {
            next[row.student_id] = row.tag_id || "";
        }
        return next;
    };

    const setRunTagBusy = (configId, value) => {
        setRunTagBusyByConfig((prev) => ({ ...prev, [configId]: value }));
    };

    const handleRunTagDraftChange = (configId, studentId, value) => {
        setRunTagDraftByConfig((prev) => ({
            ...prev,
            [configId]: {
                ...(prev[configId] || {}),
                [studentId]: value
            }
        }));
    };

    const getRosterForRunTagClassFilter = () => {
        if (!runTagClassFilter) return sortedRoster || [];
        return (sortedRoster || []).filter((s) => String(s.class || "") === runTagClassFilter);
    };

    const autoTagByRule = (configId) => {
        if (!configId) return;
        const target = getRosterForRunTagClassFilter();
        if (!target.length) return;
        const existing = { ...(runTagDraftByConfig[configId] || {}) };
        const CLASS_BLOCK_SIZE = 40;
        if (runTagRule === "numeric") {
            let n = Math.max(1, Number.parseInt(runTagNumericStart || "1", 10) || 1);
            for (const s of target) {
                existing[s.id] = String(n);
                n += 1;
            }
        } else if (runTagRule === "classIndex") {
            for (let i = 0; i < target.length; i += 1) {
                const s = target[i];
                const classOffset = Math.floor(i / CLASS_BLOCK_SIZE);
                const letterCode = 65 + (classOffset % 26);
                const classPrefix = String.fromCharCode(letterCode);
                const indexInClass = (i % CLASS_BLOCK_SIZE) + 1;
                existing[s.id] = `${classPrefix}${String(indexInClass).padStart(2, "0")}`;
            }
        } else {
            // LCII starts at 1101. We increment index 01..40, then class digit 1..9.
            const level = 1;
            for (let i = 0; i < target.length; i += 1) {
                const s = target[i];
                const classOffset = Math.floor(i / CLASS_BLOCK_SIZE);
                const classDigit = 1 + (classOffset % 9);
                const indexInClass = (i % CLASS_BLOCK_SIZE) + 1;
                existing[s.id] = `${level}${classDigit}${String(indexInClass).padStart(2, "0")}`;
            }
        }
        setRunTagDraftByConfig((prev) => ({ ...prev, [configId]: existing }));
    };

    const openRunTagMappingModal = (config) => {
        if (!config?.id) return;
        setActiveRunConfigForModal(config.id);
        setRunTagClassFilter("");
        setRunTagRule("numeric");
        setRunTagNumericStart("1");
        setRunTagDraftByConfig((prev) => ({
            ...prev,
            [config.id]: prev[config.id] || buildTagDraftForConfig(config.id)
        }));
        setShowRunTagMapModal(true);
    };

    const openRunLockModal = async (config) => {
        if (!config?.id) return;
        setActiveRunConfigForModal(config.id);
        setRunApplyPolicyByConfig((prev) => ({ ...prev, [config.id]: prev[config.id] || "best" }));
        setShowRunLockModal(true);
        await handlePreviewRunToScores(config);
    };

    const handleSaveRunTagMappings = async (config) => {
        const configId = config?.id;
        if (!configId || !id) return;
        setRunTagBusy(configId, true);
        setRunConfigFlash("");
        try {
            const draft = runTagDraftByConfig[configId] || {};
            const trimmedByStudent = {};
            for (const student of roster || []) {
                const raw = String(draft[student.id] ?? "").trim();
                if (raw) trimmedByStudent[student.id] = raw;
            }

            const existingRows = runTagMappingsByConfig[configId] || [];
            const toDeleteIds = existingRows
                .filter((r) => !trimmedByStudent[r.student_id])
                .map((r) => r.id);

            const toUpsert = Object.entries(trimmedByStudent).map(([studentId, tagId]) => ({
                run_config_id: configId,
                session_id: id,
                student_id: studentId,
                tag_id: tagId,
                source: "manual"
            }));

            if (toDeleteIds.length) {
                const { error: delErr } = await supabase
                    .from("run_tag_mappings")
                    .delete()
                    .in("id", toDeleteIds);
                if (delErr) throw delErr;
            }

            if (toUpsert.length) {
                const { error: upsertErr } = await supabase
                    .from("run_tag_mappings")
                    .upsert(toUpsert, { onConflict: "run_config_id,student_id" });
                if (upsertErr) throw upsertErr;
            }

            await loadRunTagMappings();
            setRunConfigFlash("Tag mappings saved.");
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to save tag mappings.");
        } finally {
            setRunTagBusy(configId, false);
        }
    };

    const buildRunApplyPreview = async (config) => {
        const configId = config?.id;
        if (!configId || !id) return null;
        const { data: events, error: eventsErr } = await supabase
            .from("run_events")
            .select("station_id, event_type, occurred_at, payload")
            .eq("run_config_id", configId)
            .order("occurred_at", { ascending: true });
        if (eventsErr) throw eventsErr;

        const timingRows = deriveRunTagTimings(config, events || []);
        const tagRows = runTagMappingsByConfig[configId] || [];
        const tagToStudent = new Map(tagRows.map((r) => [String(r.tag_id || "").trim(), r.student_id]));
        const rosterById = new Map((roster || []).map((s) => [s.id, s]));

        const { data: existingScores, error: scoresErr } = await supabase
            .from("scores")
            .select("student_id, run_2400")
            .eq("session_id", id);
        if (scoresErr) throw scoresErr;
        const existingByStudent = new Map((existingScores || []).map((r) => [r.student_id, r.run_2400]));

        const rows = [];
        let matched = 0;
        let unmatchedTags = 0;
        for (const t of timingRows) {
            const studentId = tagToStudent.get(String(t.tag_id || "").trim()) || null;
            if (!studentId) {
                unmatchedTags += 1;
                rows.push({
                    tag_id: t.tag_id,
                    student_id: null,
                    student_name: null,
                    new_run_2400: t.run_2400,
                    existing_run_2400: null,
                    comparison: "unmapped"
                });
                continue;
            }
            matched += 1;
            const existing = existingByStudent.get(studentId);
            const cmp = existing == null
                ? "new"
                : Number(t.run_2400) < Number(existing) ? "better"
                : Number(t.run_2400) > Number(existing) ? "worse"
                : "same";
            rows.push({
                tag_id: t.tag_id,
                student_id: studentId,
                student_name: rosterById.get(studentId)?.name || null,
                new_run_2400: t.run_2400,
                existing_run_2400: existing ?? null,
                comparison: cmp
            });
        }
        return {
            configId,
            totalTimings: timingRows.length,
            mappedRows: tagRows.length,
            matched,
            unmatchedTags,
            rows
        };
    };

    const handlePreviewRunToScores = async (config) => {
        const configId = config?.id;
        if (!configId) return;
        setRunTagBusy(configId, true);
        setRunConfigFlash("");
        try {
            const preview = await buildRunApplyPreview(config);
            setRunApplyPreviewByConfig((prev) => ({ ...prev, [configId]: preview }));
            setRunConfigFlash("Preview generated.");
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to build run preview.");
        } finally {
            setRunTagBusy(configId, false);
        }
    };

    const handleLockTagMapping = async (config) => {
        if (!config?.id || !user?.id) return;
        setRunTagBusy(config.id, true);
        setRunConfigFlash("");
        try {
            const nowIso = new Date().toISOString();
            const { error: err } = await supabase
                .from("run_configs")
                .update({
                    timings_locked_at: nowIso,
                    timings_locked_by: user.id
                })
                .eq("id", config.id);
            if (err) throw err;
            setRunConfigFlash("Tag mapping locked permanently.");
            await loadRunConfigs();
            await loadRunTagMappings();
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to lock tag mapping.");
        } finally {
            setRunTagBusy(config.id, false);
        }
    };

    const handleApplyRunToScores = async (config) => {
        const configId = config?.id;
        if (!configId || !id) return;
        if (!config?.timings_locked_at) {
            setRunConfigFlash("Lock tag mapping first before importing run timings.");
            return;
        }
        const policy = runApplyPolicyByConfig[configId] || "best";
        setRunTagBusy(configId, true);
        setRunConfigFlash("");
        try {
            const preview = await buildRunApplyPreview(config);
            const rows = Array.isArray(preview?.rows) ? preview.rows : [];
            const writeRows = [];
            let skipped = 0;
            for (const row of rows) {
                if (!row.student_id || row.comparison === "unmapped") {
                    skipped += 1;
                    continue;
                }
                const existing = row.existing_run_2400;
                const next = row.new_run_2400;
                let shouldWrite = false;
                if (policy === "overwrite") shouldWrite = true;
                else if (policy === "fill-empty") shouldWrite = existing == null;
                else shouldWrite = existing == null || Number(next) < Number(existing);
                if (!shouldWrite) {
                    skipped += 1;
                    continue;
                }
                writeRows.push({
                    session_id: id,
                    student_id: row.student_id,
                    run_2400: next
                });
            }

            if (writeRows.length) {
                const { error: upsertErr } = await supabase
                    .from("scores")
                    .upsert(writeRows, { onConflict: "session_id,student_id" });
                if (upsertErr) throw upsertErr;
            }

            const summary = {
                policy,
                attempted: rows.length,
                updated: writeRows.length,
                skipped,
                unmatched: preview?.unmatchedTags || 0
            };
            const { error: metaErr } = await supabase
                .from("run_configs")
                .update({
                    timings_applied_at: new Date().toISOString(),
                    timings_applied_by: user?.id || null,
                    timings_apply_summary: summary
                })
                .eq("id", configId);
            if (metaErr) throw metaErr;

            setRunApplyPreviewByConfig((prev) => ({ ...prev, [configId]: preview }));
            setRunConfigFlash(`Applied run timings to scores: ${writeRows.length} updated, ${skipped} skipped.`);
            await loadRunConfigs();
            await loadRunTagMappings();
            await loadScoresMap();
            await loadScoresCount();
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to apply run timings to scores.");
        } finally {
            setRunTagBusy(configId, false);
        }
    };

    // Reload roster when session year becomes available to compute class column
    useEffect(() => {
        if (!id) return;
        loadRoster();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session?.session_date]);

    // Sort scores table by Class (asc, natural) then Name (asc)
    const sortedRoster = useMemo(() => {
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        const copy = Array.isArray(roster) ? [...roster] : [];
        copy.sort((a,b) => {
            const ca = String(a.class || '');
            const cb = String(b.class || '');
            const cCmp = collator.compare(ca, cb);
            if (cCmp !== 0) return cCmp;
            const na = String(a.name || '');
            const nb = String(b.name || '');
            return collator.compare(na, nb);
        });
        return copy;
    }, [roster]);

    // Distinct classes for filter
    const classOptions = useMemo(() => {
        const set = new Set((roster || []).map(r => String(r.class || '').trim()).filter(Boolean));
        return Array.from(set).sort((a,b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    }, [roster]);

    // Apply class and completion filters
    const filteredSortedRoster = useMemo(() => {
        const q = filterQuery.trim().toLowerCase();
        const list = sortedRoster.filter(s => {
            const matchClass = !filterClass || String(s.class||'') === filterClass;
            if (!matchClass) return false;
            const matchQuery = !q || (
                String(s.name || '').toLowerCase().includes(q) ||
                String(s.student_identifier || '').toLowerCase().includes(q) ||
                String(s.class || '').toLowerCase().includes(q)
            );
            if (!matchQuery) return false;
            const isCompleted = completedSet.has(s.id);
            const includeCompleted = showCompleted && isCompleted;
            const includeIncomplete = showIncomplete && !isCompleted;
            return includeCompleted || includeIncomplete;
        });
        return list;
    }, [sortedRoster, filterClass, filterQuery, showCompleted, showIncomplete, completedSet]);

    const pagedScoresRoster = useMemo(() => {
        const total = filteredSortedRoster.length;
        if (total === 0) return [];
        const totalPages = Math.max(1, Math.ceil(total / scoresPageSize));
        const cur = Math.min(scoresPage, totalPages);
        const start = (cur - 1) * scoresPageSize;
        return filteredSortedRoster.slice(start, start + scoresPageSize);
    }, [filteredSortedRoster, scoresPage, scoresPageSize]);

    const readMassEdit = (studentId, key, fallback = '') => {
        const row = massEdits.get(studentId);
        if (!row || !(key in row)) return fallback;
        return row[key];
    };

    const setMassEditValue = (studentId, key, value) => {
        setMassEdits((prev) => {
            const next = new Map(prev);
            const row = { ...(next.get(studentId) || {}) };
            row[key] = value;
            next.set(studentId, row);
            return next;
        });
    };

    const stationMetaByStudent = useMemo(() => {
        const map = new Map();
        const toNum = (v) => (v == null || v === '' ? null : Number(v));
        const toInt = (v) => {
            const n = toNum(v);
            return (n == null || !Number.isFinite(n)) ? null : Math.trunc(n);
        };
        const testDate = session?.session_date ? new Date(session.session_date) : new Date();
        const levelLabel = String(schoolType || '').toLowerCase() === 'primary' ? 'Primary' : 'Secondary';

        (sortedRoster || []).forEach((s) => {
            const row = scoresByStudent.get(s.id) || {};
            const sex = s.gender;
            const age = calcAgeAt(s.dob, testDate);
            if (!sex || age == null) { map.set(s.id, null); return; }

            if (isIppt3) {
                const measures3 = {};
                const su = toInt(row.situps);
                const pu = toInt(row.pushups);
                const runMin = toNum(row.run_2400);
                if (su != null) measures3.situps = su;
                if (pu != null) measures3.pushups = pu;
                if (runMin != null) measures3.run_seconds = Math.round(runMin * 60);
                const res3 = evaluateIppt3({ sex, age }, measures3);
                map.set(s.id, {
                    ippt3: {
                        situpsPoints: res3?.stations?.situps?.points ?? null,
                        pushupsPoints: res3?.stations?.pushups?.points ?? null,
                        runPoints: res3?.stations?.run?.points ?? null,
                        award: mapIppt3AwardDisplay(res3?.award),
                    }
                });
                return;
            }

            const runKm = age >= 14 ? 2.4 : (levelLabel === 'Primary' ? 1.6 : 2.4);
            const measures = {};
            const situps = toInt(row.situps);
            const shuttle = toNum(row.shuttle_run);
            const reach = toNum(row.sit_and_reach);
            const pullups = toInt(row.pullups);
            const broad = toNum(row.broad_jump);
            const runMin = toNum(row.run_2400);
            if (situps != null) measures.situps = situps;
            if (shuttle != null) measures.shuttle_s = shuttle;
            if (reach != null) measures.sit_and_reach_cm = reach;
            if (pullups != null) measures.pullups = pullups;
            if (broad != null) measures.broad_jump_cm = broad;
            if (runMin != null) measures.run_seconds = Math.round(runMin * 60);
            const res = evaluateNapfa({ level: levelLabel, sex, age, run_km: runKm }, measures);
            map.set(s.id, {
                napfa: {
                    situps: res?.stations?.situps?.grade ?? null,
                    shuttle: res?.stations?.shuttle_s?.grade ?? null,
                    reach: res?.stations?.sit_and_reach_cm?.grade ?? null,
                    pullups: res?.stations?.pullups?.grade ?? null,
                    broad: res?.stations?.broad_jump_cm?.grade ?? null,
                    run: res?.stations?.run?.grade ?? null,
                    award: getNapfaAwardDisplay(res),
                }
            });
        });
        return map;
    }, [sortedRoster, scoresByStudent, session?.session_date, schoolType, isIppt3]);

    const loadScoresCount = async () => {
        if ((session?.assessment_type || 'NAPFA5') === 'IPPT3') {
            const { data: rows, error: err } = await supabase
                .from('ippt3_scores')
                .select('student_id, situps, pushups, run_2400')
                .eq('session_id', id);
            if (err) return;
            const byStudent = new Map((rows || []).map(r => [r.student_id, r]));
            const scored = new Set();
            const inprog = new Set();
            const completed = new Set();
            (roster || []).forEach(s => {
                const row = byStudent.get(s.id);
                if (!row) return;
                const required = ['situps','pushups','run_2400'];
                const nonNull = required.reduce((acc,k)=> acc + (row[k] == null ? 0 : 1), 0);
                const hasAny = nonNull > 0;
                if (hasAny) scored.add(s.id);
                if (nonNull === required.length) completed.add(s.id);
                else inprog.add(s.id);
            });
            setScoredSet(scored);
            setInProgressSet(inprog);
            setCompletedSet(completed);
            setScoresCount(completed.size);
            return;
        }
        // NAPFA-5
        const { data: rows, error: err } = await supabase
            .from('scores')
            .select('student_id, situps, shuttle_run, sit_and_reach, pullups, run_2400, broad_jump')
            .eq('session_id', id);
        if (err) return;
        // Completion requires the 5 non-run stations; run is optional for completion
        const requiredMetrics = ['situps','shuttle_run','sit_and_reach','pullups','broad_jump'];
        const byStudent = new Map((rows || []).map(r => [r.student_id, r]));
        const scored = new Set();
        const inprog = new Set();
        const completed = new Set();
        (roster || []).forEach(s => {
            const row = byStudent.get(s.id);
            if (!row) return; // no row yet => not started
            const nonNullCount = requiredMetrics.reduce((acc, k) => acc + (row[k] == null ? 0 : 1), 0);
            const hasAny = (nonNullCount > 0) || (row.run_2400 != null);
            if (hasAny) scored.add(s.id);
            if (nonNullCount === requiredMetrics.length) {
                completed.add(s.id);
            } else if (hasAny) {
                inprog.add(s.id);
            }
        });
        setScoredSet(scored);
        setInProgressSet(inprog);
        setCompletedSet(completed);
        setScoresCount(completed.size);
    };

    const loadScoresMap = async () => {
        if ((session?.assessment_type || 'NAPFA5') === 'IPPT3') {
            const { data: rows, error: err } = await supabase
                .from('ippt3_scores')
                .select('student_id, situps, pushups, run_2400')
                .eq('session_id', id);
            if (err) return;
            const map = new Map();
            (rows || []).forEach(r => { map.set(r.student_id, r); });
            setScoresByStudent(map);
            return;
        }
        const { data: rows, error: err } = await supabase
            .from('scores')
            .select('student_id, situps, shuttle_run, sit_and_reach, pullups, broad_jump, run_2400')
            .eq('session_id', id);
        if (err) return;
        const map = new Map();
        (rows || []).forEach(r => { map.set(r.student_id, r); });
        setScoresByStudent(map);
    };

    const closePftImportModal = () => {
        if (pftImportBusy) return;
        setPftImportOpen(false);
        setPftImportErr("");
        setPftImportPreview(null);
        setPftImportFileName("");
        setPftImportCsvText("");
        setPftImportMode('keep_better');
    };

    const buildPftImportPreview = useCallback((csvText, overwriteAll) => {
        const parsed = parseNapfaCsv(csvText, {
            academicYear: session?.session_date ? new Date(session.session_date).getFullYear() : null,
            schoolId: membership?.school_id || null,
        });
        const merged = mergeImportedRowsByBest(parsed.rows || []);
        const rosterByIdentifier = new Map((sortedRoster || []).map((student) => [normalizeStudentId(student.student_identifier || ""), student]));
        const previewRows = [];
        const applyRows = [];
        let unmatchedCount = 0;
        let unchangedCount = 0;
        let worseCount = 0;

        merged.rows.forEach((row) => {
            const rosterStudent = rosterByIdentifier.get(normalizeStudentId(row.id || ""));
                if (!rosterStudent) {
                    unmatchedCount += 1;
                    if (previewRows.length < PFT_IMPORT_PREVIEW_LIMIT) {
                        previewRows.push({
                            id: row.id,
                            name: row.name || "-",
                            className: row.class || "-",
                            action: "Skip",
                        reason: "Student not in session roster",
                    });
                }
                return;
            }

            const existing = scoresByStudent.get(rosterStudent.id) || {};
            const nextRow = {
                session_id: id,
                student_id: rosterStudent.id,
                situps: normalizeImportedScoreValue('situps', existing.situps),
                broad_jump: normalizeImportedScoreValue('broad_jump', existing.broad_jump),
                sit_and_reach: normalizeImportedScoreValue('sit_and_reach', existing.sit_and_reach),
                pullups: normalizeImportedScoreValue('pullups', existing.pullups),
                shuttle_run: normalizeImportedScoreValue('shuttle_run', existing.shuttle_run),
                run_2400: normalizeImportedScoreValue('run_2400', existing.run_2400),
            };

            const changedStations = [];
            let skippedForWorse = 0;
            let skippedForSame = 0;
            NAPFA_IMPORT_FIELDS.forEach((key) => {
                const incoming = normalizeImportedScoreValue(key, row[key]);
                if (incoming == null) return;
                const current = normalizeImportedScoreValue(key, nextRow[key]);
                if (!overwriteAll && !isImportedScoreBetter(key, incoming, current)) {
                    if (current === incoming) skippedForSame += 1;
                    else skippedForWorse += 1;
                    return;
                }
                if (current === incoming) {
                    skippedForSame += 1;
                    return;
                }
                nextRow[key] = incoming;
                changedStations.push(key);
            });

            if (changedStations.length === 0) {
                unchangedCount += skippedForSame > 0 && skippedForWorse === 0 ? 1 : 0;
                worseCount += skippedForWorse > 0 ? 1 : 0;
                if (previewRows.length < PFT_IMPORT_PREVIEW_LIMIT) {
                    previewRows.push({
                        id: normalizeStudentId(rosterStudent.student_identifier || ""),
                        name: rosterStudent.name || row.name || "-",
                        className: rosterStudent.class || "-",
                        action: "Skip",
                        reason: skippedForWorse > 0 ? "Imported scores were not better" : "No score changes",
                    });
                }
                return;
            }

            applyRows.push(nextRow);
            if (previewRows.length < PFT_IMPORT_PREVIEW_LIMIT) {
                previewRows.push({
                    id: normalizeStudentId(rosterStudent.student_identifier || ""),
                    name: rosterStudent.name || row.name || "-",
                    className: rosterStudent.class || "-",
                    action: "Import",
                    reason: changedStations.join(", "),
                });
            }
        });

        return {
            parsedRows: parsed.rows.length,
            parseErrors: parsed.errors || [],
            duplicateRows: merged.duplicateCount,
            unmatchedCount,
            unchangedCount,
            worseCount,
            rowsToImport: applyRows.length,
            previewRows,
            applyRows,
        };
    }, [id, membership?.school_id, scoresByStudent, sortedRoster, session?.session_date]);

    const downloadPftImportSummary = () => {
        if (!pftImportPreview) return;
        const csvCell = (value) => {
            const text = value == null ? '' : String(value);
            return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        };
        const lines = [
            ['File', pftImportFileName || ''].map(csvCell).join(','),
            ['Mode', pftImportMode === 'overwrite_all' ? 'Overwrite imported scores' : 'Keep better score only'].map(csvCell).join(','),
            ['Parsed rows', pftImportPreview.parsedRows].map(csvCell).join(','),
            ['Rows to import', pftImportPreview.rowsToImport].map(csvCell).join(','),
            ['Unmatched', pftImportPreview.unmatchedCount].map(csvCell).join(','),
            ['Duplicate source IDs', pftImportPreview.duplicateRows].map(csvCell).join(','),
            ['No changes', pftImportPreview.unchangedCount].map(csvCell).join(','),
            ['Worse skipped', pftImportPreview.worseCount].map(csvCell).join(','),
            ['Parse errors', pftImportPreview.parseErrors.length].map(csvCell).join(','),
            '',
            ['Preview rows', `Showing first ${PFT_IMPORT_PREVIEW_LIMIT} only`].map(csvCell).join(','),
            ['ID', 'Name', 'Class', 'Action', 'Detail'].map(csvCell).join(','),
            ...pftImportPreview.previewRows.map((row) => [
                row.id,
                row.name,
                row.className,
                row.action,
                row.reason,
            ].map(csvCell).join(',')),
        ];
        if (pftImportPreview.parseErrors.length) {
            lines.push('');
            lines.push(['Parse error row', 'Message'].map(csvCell).join(','));
            pftImportPreview.parseErrors.forEach((item) => {
                lines.push([item.row, item.message].map(csvCell).join(','));
            });
        }
        const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `pft_import_preview_${Date.now()}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    const handlePftImportFile = async (file) => {
        if (!file) return;
        if (isIppt3) {
            setPftImportErr("PFT CSV import currently supports NAPFA-5 sessions only.");
            return;
        }
        setPftImportErr("");
        setPftImportPreview(null);
        setPftImportFileName(file.name || "");
        try {
            const text = await file.text();
            setPftImportCsvText(text);
            setPftImportPreview(buildPftImportPreview(text, pftImportMode === 'overwrite_all'));
        } catch (err) {
            setPftImportErr(err.message || "Failed to parse PFT CSV.");
        }
    };

    const applyPftImport = async () => {
        if (!pftImportPreview) return;
        if (!pftImportPreview.applyRows.length) {
            setPftImportErr("No score changes to import.");
            return;
        }
        setPftImportBusy(true);
        setPftImportErr("");
        try {
            const chunkSize = 200;
            for (let i = 0; i < pftImportPreview.applyRows.length; i += chunkSize) {
                const chunk = pftImportPreview.applyRows.slice(i, i + chunkSize);
                const { error: upsertErr } = await supabase
                    .from('scores')
                    .upsert(chunk, { onConflict: 'session_id,student_id' });
                if (upsertErr) throw upsertErr;
            }
            await loadScoresMap();
            await loadScoresCount();
            setFlash(`Imported scores for ${pftImportPreview.rowsToImport} roster student(s).`);
            closePftImportModal();
        } catch (err) {
            setPftImportErr(err.message || "Failed to import scores.");
        } finally {
            setPftImportBusy(false);
        }
    };

    // Responsive scores table page size (100 desktop, 40 mobile)
    useEffect(() => {
        const calc = () => setScoresPageSize(window.innerWidth < 768 ? 40 : 100);
        calc();
        window.addEventListener('resize', calc);
        return () => window.removeEventListener('resize', calc);
    }, []);

    useEffect(() => {
        if (!flash) return;
        const timer = setTimeout(() => setFlash(""), 3500);
        return () => clearTimeout(timer);
    }, [flash]);

    useEffect(() => {
        if (!runConfigFlash) return;
        const timer = setTimeout(() => setRunConfigFlash(""), 3500);
        return () => clearTimeout(timer);
    }, [runConfigFlash]);

    useEffect(() => {
        if (!pftImportCsvText) return;
        try {
            setPftImportPreview(buildPftImportPreview(pftImportCsvText, pftImportMode === 'overwrite_all'));
            setPftImportErr("");
        } catch (err) {
            setPftImportErr(err.message || "Failed to rebuild PFT import preview.");
        }
    }, [buildPftImportPreview, pftImportCsvText, pftImportMode]);

    const handleEditToggle = () => {
        if (!session) return;
        setFormState({ title: session.title, session_date: toInputDate(session.session_date) });
        setEditMode((prev) => !prev);
        setFlash("");
    };

    const handleUpdate = async (event) => {
        event.preventDefault();
        if (!session) return;
        setFormSubmitting(true);
        try {
            const isoDate = formState.session_date;
            if (!isoDate) throw new Error('Please select a date');
            const { data, error: err } = await supabase
                .from("sessions")
                .update({ title: formState.title, session_date: isoDate })
                .eq("id", session.id)
                .select()
                .single();
            if (err) throw err;
            setSession(data);
            setEditMode(false);
            setFlash("Session updated successfully.");
        } catch (err) {
            setFlash(err.message || "Unable to update session.");
        } finally {
            setFormSubmitting(false);
        }
    };

    const handleDownloadDataUrl = (dataUrl, fileName) => {
        if (!dataUrl) return;
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = fileName;
        link.click();
    };

    const toSafeFilePart = (value) => String(value || "")
        .trim()
        .replace(/[^a-zA-Z0-9-_ ]+/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 48) || "run-session-config";

    const escapeCsvCell = (value) => {
        if (value == null) return "";
        const text = String(value);
        if (text.includes(",") || text.includes('"') || text.includes("\n")) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    };

    const handleDownloadRunSessionData = async (config) => {
        if (!config?.id) return;
        setRunConfigSaving(true);
        setRunConfigFlash("");
        try {
            const { data, error: err } = await supabase
                .from("run_events")
                .select("run_config_id, session_id, station_id, event_type, occurred_at, payload")
                .eq("run_config_id", config.id)
                .order("occurred_at", { ascending: true });
            if (err) throw err;
            const events = data || [];

            const { data: tagMaps, error: mapErr } = await supabase
                .from("run_tag_mappings")
                .select("tag_id, student_id")
                .eq("run_config_id", config.id);
            if (mapErr) throw mapErr;
            const tagToStudent = new Map((tagMaps || []).map((r) => [String(r.tag_id || "").trim(), r.student_id]));
            const rosterById = new Map((sortedRoster || []).map((s) => [s.id, s]));

            const summaryRows = deriveRunTagTimingsForExport(config, events);
            const intervalHeaders = [];
            const maxSteps = summaryRows.reduce((m, r) => Math.max(m, Array.isArray(r.interval_steps) ? r.interval_steps.length : 0), 0);
            for (let i = 0; i < maxSteps; i += 1) {
                const station = summaryRows.find((r) => Array.isArray(r.interval_steps) && r.interval_steps[i]?.station)?.interval_steps?.[i]?.station;
                intervalHeaders.push(station || `Scan ${i + 2}`);
            }

            const header = [
                "Tag ID",
                "Tag Mapping",
                "Student ID",
                "Student Name",
                "Class",
                "Checkpoint Flag",
                "Total Run Time",
                ...intervalHeaders
            ];

            const metaRows = [
                ["Run Session Name", config.name || ""],
                ["Run Config ID", config.id || ""],
                ["Setup Type", config.template_key || ""],
                ["Run Distance (m)", config.run_distance_m ?? ""],
                ["Laps Required", config.laps_required ?? ""],
                ["Checkpoint Enforcement", config.enforcement || "OFF"],
                ["Time Between Scans (s)", Number(config.scan_gap_ms || 10000) / 1000],
                ["Exported At", new Date().toISOString()],
                []
            ].map((row) => row.map(escapeCsvCell).join(","));

            const csvRows = summaryRows.map((row) => {
                const studentId = tagToStudent.get(String(row.tag_id || "").trim()) || "";
                const st = studentId ? rosterById.get(studentId) : null;
                return [
                    row.tag_id || "",
                    studentId ? "Mapped" : "",
                    studentId ? normalizeStudentId(st?.student_identifier || "") : "",
                    st?.name || "",
                    st?.class || "",
                    row.checkpoint_flag || "",
                    fmtRun(row.run_2400) || "",
                    ...intervalHeaders.map((_, idx) => row.interval_steps?.[idx]?.mmss || "")
                ].map(escapeCsvCell).join(",");
            });
            const csv = [...metaRows, header.join(","), ...csvRows].join("\n");
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const cfgName = toSafeFilePart(config.name || config.id);
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            a.href = url;
            a.download = `${cfgName}-run-session-data-${stamp}.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            setRunConfigFlash(`Downloaded ${summaryRows.length} evaluated run rows.`);
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to download run session data.");
        } finally {
            setRunConfigSaving(false);
        }
    };

    const buildRunConfigWritePayload = (source, base = {}) => {
        return {
            ...base,
            name: source.name || null,
            template_key: source.template_key,
            run_distance_m: Number(source.run_distance_m) || 2400,
            laps_required: Number(source.laps_required) || 1,
            enforcement: source.enforcement,
            scan_gap_ms: Number(source.scan_gap_ms) || 10000
        };
    };

    const handleCreateRunConfig = async () => {
        if (!session) return;
        setRunConfigSaving(true);
        setRunConfigFlash("");
        try {
            const token = crypto.randomUUID();
            const payload = buildRunConfigWritePayload(runConfigForm, {
                session_id: session.id,
                pairing_token: token
            });
            const { data, error: err } = await supabase
                .from('run_configs')
                .insert(payload)
                .select('id')
                .maybeSingle();
            if (err) throw err;
            if (!data) {
                throw new Error("Run config was not returned after create. Check table RLS policies for run_configs.");
            }
            setRunConfigForm({
                name: "",
                template_key: "A",
                run_distance_m: 2400,
                laps_required: 3,
                enforcement: "OFF",
                scan_gap_ms: 10000
            });
            setRunConfigFlash("Run config created. Generate QR/barcode if needed.");
            await loadRunConfigs();
            await loadRunTagMappings();
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to create run session config.");
        } finally {
            setRunConfigSaving(false);
        }
    };

    const updateRunConfigLocal = (configId, patch) => {
        setRunConfigs((prev) => prev.map((c) => {
            if (c.id !== configId) return c;
            const next = { ...c, ...patch };
            if (patch.template_key && !checkpointTemplates.has(patch.template_key)) {
                next.enforcement = "OFF";
            } else if (patch.template_key && checkpointTemplates.has(patch.template_key) && !next.enforcement) {
                next.enforcement = defaultRunEnforcement(patch.template_key);
            }
            return next;
        }));
    };

    const handleSaveRunConfig = async (config) => {
        setRunConfigSaving(true);
        setRunConfigFlash("");
        try {
            const payload = buildRunConfigWritePayload(config);
            const { data, error: err } = await supabase
                .from('run_configs')
                .update(payload)
                .eq('id', config.id)
                .select('id')
                .maybeSingle();
            if (err) throw err;
            if (!data) {
                throw new Error("Run config update returned no row. Check table RLS policies for run_configs.");
            }
            setRunConfigFlash("Run config saved.");
            await loadRunConfigs();
            await loadRunTagMappings();
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to save run session config.");
        } finally {
            setRunConfigSaving(false);
        }
    };

    const handleGenerateRunToken = async (config) => {
        setRunConfigSaving(true);
        setRunConfigFlash("");
        try {
            const token = crypto.randomUUID();
            const { error: err } = await supabase
                .from('run_configs')
                .update({
                    pairing_token: token,
                    pairing_qr_data_url: null,
                    pairing_barcode_data_url: null
                })
                .eq('id', config.id);
            if (err) throw err;
            setRunConfigFlash("New token generated. Create QR/barcode if needed.");
            await loadRunConfigs();
            await loadRunTagMappings();
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to generate token.");
        } finally {
            setRunConfigSaving(false);
        }
    };

    const handleResetRunConfig = async (config) => {
        if (!config?.id) return;
        setPendingRunDataDeleteConfig(config);
        setShowRunDataDeleteModal(true);
    };

    const handleConfirmDeleteCloudRunData = async () => {
        const config = pendingRunDataDeleteConfig;
        if (!config?.id) return;
        setRunDataDeleteBusy(true);
        setRunConfigSaving(true);
        setRunConfigFlash("");
        try {
            const { data } = await supabase.auth.getSession();
            const accessToken = data?.session?.access_token;
            if (!accessToken) throw new Error("Missing login session.");
            const response = await fetch(RESET_RUN_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${accessToken}`
                },
                body: JSON.stringify({ runConfigId: config.id, sessionId: session.id })
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) throw new Error(body?.error || 'Failed to reset run data.');
            setRunConfigFlash("Cloud run data deleted. CLEAR_ALL marker sent. Stations will clear local data on next sync.");
            setShowRunDataDeleteModal(false);
            setPendingRunDataDeleteConfig(null);
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to delete cloud run data.");
        } finally {
            setRunDataDeleteBusy(false);
            setRunConfigSaving(false);
        }
    };

    const handleGenerateRunCodes = async (config) => {
        if (!session?.id || !config?.pairing_token) {
            setRunConfigFlash("Please generate or enter a pairing token first.");
            return;
        }
        try {
            const payload = `napfa5-run://pair?sessionId=${session.id}&runConfigId=${config.id}&token=${config.pairing_token}`;
            const qrUrl = await drawQrDataUrl(payload, 256, 'M', 1);
            const canvas = document.createElement('canvas');
            drawBarcode(canvas, payload, { width: 2, height: 80, margin: 12, displayValue: false });
            const barcodeUrl = canvas.toDataURL('image/png');
            const { error: err } = await supabase
                .from('run_configs')
                .update({ pairing_qr_data_url: qrUrl, pairing_barcode_data_url: barcodeUrl })
                .eq('id', config.id);
            if (err) throw err;
            setRunConfigFlash("QR and barcode generated.");
            await loadRunConfigs();
            await loadRunTagMappings();
        } catch {
            setRunConfigFlash("Failed to generate QR or barcode.");
        }
    };

    const handleCopyRunToken = async (token) => {
        if (!token) return;
        try {
            await navigator.clipboard.writeText(token);
            setRunConfigFlash("Token copied.");
        } catch {
            setRunConfigFlash("Unable to copy token.");
        }
    };

    const handleDeleteRunConfig = async (config) => {
        if (!config?.id) return;
        setPendingDeleteRunConfig(config);
        setShowRunConfigDeleteModal(true);
    };

    const handleDuplicateRunConfig = async (config) => {
        if (!config?.id || !session?.id) return;
        setRunConfigSaving(true);
        setRunConfigFlash("");
        try {
            const token = crypto.randomUUID();
            const payload = {
                session_id: session.id,
                name: config.name ? `${config.name} (Copy)` : null,
                template_key: config.template_key,
                run_distance_m: Number(config.run_distance_m) || 2400,
                laps_required: Number(config.laps_required) || 1,
                enforcement: config.enforcement || defaultRunEnforcement(config.template_key),
                scan_gap_ms: Number(config.scan_gap_ms) || 10000,
                pairing_token: token,
                pairing_qr_data_url: null,
                pairing_barcode_data_url: null,
                timings_locked_at: null,
                timings_locked_by: null,
                timings_applied_at: null,
                timings_applied_by: null,
                timings_apply_summary: null
            };
            const { error: err } = await supabase
                .from("run_configs")
                .insert(payload);
            if (err) throw err;
            setRunConfigFlash("Run session config duplicated.");
            await loadRunConfigs();
            await loadRunTagMappings();
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to duplicate run session config.");
        } finally {
            setRunConfigSaving(false);
        }
    };

    const handleConfirmDeleteRunConfig = async () => {
        const config = pendingDeleteRunConfig;
        if (!config?.id) return;
        setRunConfigDeleteBusy(true);
        setRunConfigSaving(true);
        setRunConfigFlash("");
        try {
            const { error: eventsErr } = await supabase
                .from("run_events")
                .delete()
                .eq("run_config_id", config.id);
            if (eventsErr) throw eventsErr;
            const { error: err } = await supabase
                .from('run_configs')
                .delete()
                .eq('id', config.id);
            if (err) throw err;
            setRunConfigFlash("Run session config deleted. Related cloud run data was deleted.");
            setShowRunConfigDeleteModal(false);
            setPendingDeleteRunConfig(null);
            await loadRunConfigs();
            await loadRunTagMappings();
        } catch (err) {
            setRunConfigFlash(err.message || "Failed to delete run session config.");
        } finally {
            setRunConfigDeleteBusy(false);
            setRunConfigSaving(false);
        }
    };

    const isMissingRelationError = (err) => {
        const msg = String(err?.message || "").toLowerCase();
        return msg.includes("relation") && msg.includes("does not exist");
    };

    const handleDelete = async () => {
        setShowSessionDeleteModal(true);
    };

    const handleConfirmDeleteSession = async () => {
        if (!session) return;
        setSessionDeleteBusy(true);
        setFlash("");
        try {
            // Best-effort cleanup for IPPT-3 rows if table exists in this deployment.
            const { error: ipErr } = await supabase
                .from("ippt3_scores")
                .delete()
                .eq("session_id", session.id);
            if (ipErr && !isMissingRelationError(ipErr)) throw ipErr;

            const { error: err } = await supabase
                .from("sessions")
                .delete()
                .eq("id", session.id);
            if (err) throw err;

            setShowSessionDeleteModal(false);
            navigate("/sessions");
        } catch (err) {
            setFlash(err.message || "Failed to delete session.");
        } finally {
            setSessionDeleteBusy(false);
        }
    };

    const handleRemoveFromRoster = async (studentId) => {
        try {
            const { error: err } = await supabase
                .from('session_roster')
                .delete()
                .match({ session_id: id, student_id: studentId });
            if (err) throw err;
            setFlash('Removed from roster.');
            await loadRoster();
            await loadScoresCount();
        } catch (err) {
            setFlash(err.message || 'Failed to remove from roster.');
        }
    };

    
    // Build PFT-shaped rows with attendance/date logic
    const buildPftRows = async () => {
        try {
            if ((session?.assessment_type || 'NAPFA5') === 'IPPT3') {
                const headers = ['S/N','Name','ID','Class','Gender','DOB','Attendance Status','Sit Up reps','Push-ups reps','2.4 Km Run MMSS','PFT Test Date','Sit Up score','Push-ups score','2.4 Km Run score','Total Points','Award'];
                const prefix = headers.join(',') + '\n';
                const rosterRows = await fetchSessionRosterWithStudents(supabase, id, {
                    schoolId: membership?.school_id || null,
                    sessionYear: session?.session_date ? new Date(session.session_date).getFullYear() : null,
                    studentFields: ['id', 'student_identifier', 'name', 'gender', 'dob'],
                    orderByStudentId: false,
                });
                const list = (rosterRows || []).map(rr => {
                    const st = rr.students || {};
                    return { id: st.id, name: st.name || '', sid: st.student_identifier || '', gender: st.gender || '', dob: st.dob || '', class: rr.class || '' };
                });
                const { data: sRows } = await supabase
                    .from('ippt3_scores')
                    .select('student_id, situps, pushups, run_2400')
                    .eq('session_id', id);
                const byStu = new Map((sRows || []).map(r => [r.student_id, r]));
                const testDate = session?.session_date ? new Date(session.session_date) : new Date();
                const shaped = list.map((st, i) => {
                    const row = byStu.get(st.id) || {};
                    const hasAny = row.situps != null || row.pushups != null || row.run_2400 != null;
                    const age = calcAgeAt(st.dob, testDate);
                    const measures = {};
                    if (row.situps != null) measures.situps = Number(row.situps);
                    if (row.pushups != null) measures.pushups = Number(row.pushups);
                    if (row.run_2400 != null) measures.run_seconds = Math.round(Number(row.run_2400) * 60);
                    const hasRun = row.run_2400 != null;
                    const res = (st.gender && age != null) ? evaluateIppt3({ sex: st.gender, age }, measures) : null;
                    const sitPts = res?.stations?.situps?.points ?? 0;
                    const pushPts = res?.stations?.pushups?.points ?? 0;
                    const runPts = hasRun ? (res?.stations?.run?.points ?? 0) : 0;
                    const totalPts = hasRun ? (res?.totalPoints ?? (sitPts + pushPts + runPts)) : (sitPts + pushPts + runPts);
                    const awardRaw = st.gender ? awardForTotal(totalPts, st.gender) : '';
                    const awardLabel = awardRaw === 'Pass' ? 'Bronze' : (awardRaw || '');
                    return {
                        'S/N': i + 1,
                        'Name': st.name,
                        'ID': normalizeStudentId(st.sid),
                        'Class': st.class,
                        'Gender': st.gender,
                        'DOB': st.dob,
                        'Attendance Status': hasAny ? 'P' : '',
                        'Sit Up reps': row.situps ?? '',
                        'Push-ups reps': row.pushups ?? '',
                        '2.4 Km Run MMSS': (row.run_2400 != null ? (fmtRun(row.run_2400) || '') : ''),
                        'PFT Test Date': hasAny ? (function(){ try { return formatDDMMYYYY(session?.session_date); } catch { return ''; } })() : '',
                        'Sit Up score': sitPts || '',
                        'Push-ups score': pushPts || '',
                        '2.4 Km Run score': runPts || '',
                        'Total Points': Number.isFinite(totalPts) ? totalPts : '',
                        'Award': awardLabel
                    };
                });
                return { headers, prefix, shaped };
            }
            const templateRes = await fetch('/pft_template.csv', { cache: 'no-store' });
            if (!templateRes.ok) throw new Error('Failed to load PFT template.');
            let templateText = await templateRes.text();
            // Keep only the first 21 rows of the template (row 21 is header)
            const tmplLines = templateText.replace(/\r\n/g, '\n').split('\n');
            const first21 = tmplLines.slice(0, 21).join('\n');
            const prefix = first21.endsWith('\n') ? first21 : (first21 + '\n');

            const headers = [
                'Sl.No','Name','ID','Class','Gender','DOB','Attendance',
                'Sit-ups','Standing Broad Jump (cm)','Sit & Reach (cm)','Pull-ups','Shuttle Run (sec)','1.6/2.4 Km Run MMSS','PFT Test Date'
            ];

            let shaped = [];
            let pftError = null;
            try {
                const { data: rows, error } = await supabase
                    .rpc('export_session_scores_pft', { p_session_id: id });
                if (error) throw error;
                shaped = (rows || []).map(r => {
                    const hasAny = (
                        r['Sit-ups'] != null ||
                        r['Standing Broad Jump (cm)'] != null ||
                        r['Sit & Reach (cm)'] != null ||
                        r['Pull-ups'] != null ||
                        r['Shuttle Run (sec)'] != null
                    );
                    return {
                        'Sl.No': r['Sl.No'],
                        'Name': r['Name'],
                        'ID': normalizeStudentId(r['ID']),
                        'Class': r['Class'],
                        'Gender': r['Gender'],
                        'DOB': r['DOB'],
                        'Attendance': hasAny ? 'P' : '',
                        'Sit-ups': r['Sit-ups'],
                        'Standing Broad Jump (cm)': r['Standing Broad Jump (cm)'],
                        'Sit & Reach (cm)': r['Sit & Reach (cm)'],
                        'Pull-ups': r['Pull-ups'],
                        'Shuttle Run (sec)': r['Shuttle Run (sec)'],
                        '1.6/2.4 Km Run MMSS': r['1.6/2.4 Km Run MMSS'] || '',
                        'PFT Test Date': hasAny ? (function(){ try { return formatDDMMYYYY(session?.session_date); } catch { return ''; } })() : ''
                    };
                });
            } catch (e) {
                pftError = e;
            }

            if (pftError || shaped.length === 0) {
                // Fallback to generic export and shape client-side
                const { data: raw, error } = await supabase
                    .rpc('export_session_scores', { p_session_id: id });
                if (error) throw error;
                shaped = (raw || []).map((r, i) => {
                    const hasAny = (
                        r.situps != null ||
                        r.broad_jump != null ||
                        r.sit_and_reach != null ||
                        r.pullups != null ||
                        r.shuttle_run != null
                    );
                    return {
                        'Sl.No': i + 1,
                        'Name': r.name || '',
                        'ID': normalizeStudentId(r.student_identifier || ''),
                        'Class': r.class || '',
                        'Gender': r.gender || '',
                        'DOB': r.dob || '',
                        'Attendance': hasAny ? 'P' : '',
                        'Sit-ups': r.situps,
                        'Standing Broad Jump (cm)': r.broad_jump,
                        'Sit & Reach (cm)': r.sit_and_reach,
                        'Pull-ups': r.pullups,
                        'Shuttle Run (sec)': r.shuttle_run,
                        '1.6/2.4 Km Run MMSS': '',
                        'PFT Test Date': hasAny ? (function(){ try { return formatDDMMYYYY(session?.session_date); } catch { return ''; } })() : ''
                    };
                });
            }

            return { headers, prefix, shaped };
        } catch (err) {
            setFlash(err.message || 'Failed to export results.');
            return null;
        }
    };

    const exportPftAllClasses = async () => {
        const res = await buildPftRows();
        if (!res) return;
        const { headers, prefix, shaped } = res;
        const dataRows = shaped.map(row => {
            const cols = headers.map(h => {
                const v = row[h];
                return v == null ? '' : (typeof v === 'string' ? '"' + v.replace(/"/g,'""') + '"' : v);
            });
            cols.push('*END*');
            return cols.join(',');
        });
        const finalCsv = "\uFEFF" + prefix + dataRows.join('\n');
        const blob = new Blob([finalCsv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const title = String(session?.title || 'Session');
        const safeTitle = title.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
        const d = new Date(session?.session_date);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        const ddmmyyyy = `${dd}${mm}${yyyy}`;
        const fileName = `PFT_${safeTitle}_${ddmmyyyy}.csv`;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        try {
            const validUuid = (v) => typeof v === 'string' && /[0-9a-fA-F-]{36}/.test(v);
            const sid = validUuid(id) ? id : null;
            const sch = validUuid(membership?.school_id) ? membership.school_id : null;
            await supabase.rpc('audit_log_event', {
                p_entity_type: 'export_pft',
                p_action: 'download',
                p_entity_id: null,
                p_school_id: sch,
                p_session_id: sid,
                p_details: { mode: 'all_classes', file: fileName, rows: shaped.length }
            });
        } catch {}
    };

    const exportPftPerClass = async () => {
        const res = await buildPftRows();
        if (!res) return;
        const { headers, prefix, shaped } = res;
        // Group by class and generate one file per class, with Sl.No reset per class
        const byClass = new Map();
        shaped.forEach(r => {
            const k = (r['Class'] || '').toString().trim() || 'Unassigned';
            if (!byClass.has(k)) byClass.set(k, []);
            byClass.get(k).push(r);
        });
        const title = String(session?.title || 'Session');
        const safeTitle = title.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
        const d = new Date(session?.session_date);
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        const ddmmyyyy = `${dd}${mm}${yyyy}`;
        for (const [klass, rowsForClass] of byClass.entries()) {
            const rowsWithReset = rowsForClass.map((row, idx) => ({ ...row, 'Sl.No': idx + 1 }));
            const dataRows = rowsWithReset.map(row => {
                const cols = headers.map(h => {
                    const v = row[h];
                    return v == null ? '' : (typeof v === 'string' ? '"' + v.replace(/"/g,'""') + '"' : v);
                });
                cols.push('*END*');
                return cols.join(',');
            });
            const finalCsv = "\uFEFF" + prefix + dataRows.join('\n');
            const blob = new Blob([finalCsv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const safeClass = klass.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'Unassigned';
            const fileName = `PFT_${safeTitle}_${ddmmyyyy}_${safeClass}.csv`;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            try {
                const validUuid = (v) => typeof v === 'string' && /[0-9a-fA-F-]{36}/.test(v);
                const sid = validUuid(id) ? id : null;
                const sch = validUuid(membership?.school_id) ? membership.school_id : null;
                await supabase.rpc('audit_log_event', {
                    p_entity_type: 'export_pft',
                    p_action: 'download',
                    p_entity_id: null,
                    p_school_id: sch,
                    p_session_id: sid,
                    p_details: { mode: 'per_class', class: klass, file: fileName, rows: rowsForClass.length }
                });
            } catch {}
        }
    };
    const applyStatusChange = async (nextStatus) => {
        if (!session || session.status === nextStatus) return;
        setStatusUpdating(true);
        try {
            const { data, error: err } = await supabase
                .from('sessions')
                .update({ status: nextStatus })
                .eq('id', session.id)
                .select()
                .single();
            if (err) throw err;
            setSession(data);
            if (nextStatus === 'completed') {
                setMassEditMode(false);
                setMassEdits(new Map());
                setMassEditErr('');
                setMassEditNotice('');
                setMassEditCancelOpen(false);
                setMassEditSaveOpen(false);
            }
            setFlash(`Status set to ${nextStatus}.`);
        } catch (err) {
            setFlash(err.message || 'Failed to update status.');
        } finally {
            setStatusUpdating(false);
        }
    };

    const handleStatusChange = async (nextStatus) => {
        if (!session || session.status === nextStatus) return;
        if (nextStatus === 'completed') {
            setPendingStatusChange(nextStatus);
            setStatusCompleteConfirmOpen(true);
            return;
        }
        await applyStatusChange(nextStatus);
    };

    const downloadProfileCardsPdf = async (format = 'a4') => {
        try {
            const data = await fetchSessionRosterWithStudents(supabase, id, {
                schoolId: membership?.school_id || null,
                sessionYear: session?.session_date ? new Date(session.session_date).getFullYear() : null,
                studentFields: ['id', 'student_identifier', 'name'],
            });
            const list = (data || []).map(r => {
                return { id: r.students.id, student_identifier: r.students.student_identifier, name: r.students.name, class: r.class || '' };
            }).sort((a, b) => (String(a.class||'').localeCompare(String(b.class||''), undefined, { numeric: true, sensitivity: 'base' })
                || String(a.name||'').localeCompare(String(b.name||''), undefined, { sensitivity: 'base' })));
            if (!list.length) { setFlash('No students in roster.'); return; }

            if (format === 'wristband_25' || format === 'wristband_19') {
                // Paper dimensions specified in cm by user; convert to mm for jsPDF.
                const pageWcm = 25;
                const pageHcm = 21;
                const pageW = pageWcm * 10;
                const pageH = pageHcm * 10;
                const wbDoc = new jsPDF({ unit: 'mm', format: [pageW, pageH], orientation: 'landscape' });
                const is19 = format === 'wristband_19';
                const stripsPerPage = is19 ? 10 : 8;
                const stripH = is19 ? 19 : 25;
                const stripBlockH = stripsPerPage * stripH;
                const topBottomMargin = ((pageH - stripBlockH) / 2) + (is19 ? 0 : 2.0); // 25mm shifts down by 2.0mm
                const leftNoPrint = is19 ? 30 : 20; // 25mm reduces left padding by 10mm
                const rightNoPrint = 30; // required blank zone at trailing right side
                const rightPad = 4;
                const stripYStart = (stripIdx) => topBottomMargin + (stripIdx * stripH);
                const centerYForStrip = (stripIdx) => stripYStart(stripIdx) + (stripH / 2);
                const bcCanvas = document.createElement('canvas');

                const truncateToWidth = (text, maxW, fontSize) => {
                    const raw = String(text || '');
                    if (!raw) return '';
                    wbDoc.setFontSize(fontSize);
                    const ellipsis = '...';
                    if (wbDoc.getTextWidth(raw) <= maxW) return raw;
                    let out = raw;
                    while (out.length > 0 && wbDoc.getTextWidth(out + ellipsis) > maxW) {
                        out = out.slice(0, -1);
                    }
                    return out ? (out + ellipsis) : ellipsis;
                };
                const splitNameForWristband = (name, maxW) => {
                    const raw = String(name || '').trim();
                    if (!raw) return { line1: '', line2: '' };
                    if (raw.length <= 25) {
                        return { line1: truncateToWidth(raw, maxW, is19 ? 12.0 : 18.8), line2: '' };
                    }
                    let cut = raw.lastIndexOf(' ', 25);
                    if (cut < 12) cut = 25;
                    const first = truncateToWidth(raw.slice(0, cut).trim(), maxW, is19 ? 12.0 : 18.8);
                    const secondRaw = raw.slice(cut).trim();
                    const second = truncateToWidth(secondRaw, maxW, is19 ? 12.0 : 18.8);
                    return { line1: first, line2: second };
                };

                const drawSheetGuides = () => {
                    wbDoc.setDrawColor(225);
                    wbDoc.setLineWidth(0.2);
                    wbDoc.line(leftNoPrint, 0, leftNoPrint, pageH);
                    wbDoc.line(pageW - rightNoPrint, 0, pageW - rightNoPrint, pageH);
                    for (let i = 0; i <= stripsPerPage; i++) {
                        const y = topBottomMargin + (i * stripH);
                        wbDoc.line(0, y, pageW, y);
                    }
                };

                for (let idx = 0; idx < list.length; idx++) {
                    const stripIdx = idx % stripsPerPage;
                    if (idx > 0 && stripIdx === 0) wbDoc.addPage([pageW, pageH], 'landscape');
                    if (stripIdx === 0) drawSheetGuides();

                    const s = list[idx];
                    const idNorm = normalizeStudentId(s.student_identifier);
                    const y0 = stripYStart(stripIdx);
                    const cy = centerYForStrip(stripIdx);

                    const qrSize = is19 ? 15 : 21;
                    const qrX = leftNoPrint + (is19 ? 1.5 : 2);
                    const qrY = cy - (qrSize / 2) - (is19 ? 0 : 1.5);

                    const barX = qrX + qrSize + (is19 ? 2 : 3);
                    const barW = is19 ? 44 : 54;
                    const barH = is19 ? 6.5 : 9;
                    const barY = y0 + (is19 ? 3 : 4);

                    const idY = barY + barH + (is19 ? 3.2 : 4.8);

                    const textX = barX + barW + (is19 ? 4 : 6);
                    const textW = Math.max(20, (pageW - rightNoPrint - rightPad) - textX);
                    const nameY = y0 + (is19 ? 8.2 : 10.8);
                    const nameLineGap = is19 ? 4.6 : 6.4;
                    const { line1: nameLine1, line2: nameLine2 } = splitNameForWristband(s.name || '', textW);
                    const classY = nameLine2 ? (nameY + nameLineGap + (is19 ? 3.6 : 5.0)) : (nameY + (is19 ? 6.8 : 9.5));

                    const classLine = truncateToWidth(s.class || '', textW, is19 ? 6.4 : 8.8);
                    const idLine = truncateToWidth(idNorm, barW, is19 ? 6.8 : 9.4);

                    // 1) QR
                    try {
                        const qrUrl = await drawQrDataUrl(idNorm, 220, 'M', 1);
                        wbDoc.addImage(qrUrl, 'PNG', qrX, qrY, qrSize, qrSize);
                    } catch {}

                    // 2) Barcode
                    try {
                        drawBarcode(bcCanvas, idNorm, {
                            format: 'CODE128',
                            width: is19 ? 1.0 : 1.2,
                            height: is19 ? 28 : 36,
                            margin: is19 ? 4 : 6,
                            displayValue: false
                        });
                        const bcUrl = bcCanvas.toDataURL('image/png');
                        wbDoc.addImage(bcUrl, 'PNG', barX, barY, barW, barH);
                    } catch {}

                    // 3) ID below barcode, then Name + Class
                    wbDoc.setFontSize(is19 ? 6.8 : 9.4);
                    if (idLine) wbDoc.text(idLine, barX + (barW / 2), idY, { align: 'center' });
                    wbDoc.setFontSize(is19 ? 12.0 : 18.8);
                    if (nameLine1) wbDoc.text(nameLine1, textX, nameY);
                    if (nameLine2) wbDoc.text(nameLine2, textX, nameY + nameLineGap);
                    wbDoc.setFontSize(is19 ? 6.4 : 8.8);
                    if (classLine) wbDoc.text(classLine, textX, classY);
                }

                const d = new Date(session.session_date);
                const dd = String(d.getDate()).padStart(2, '0');
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const yyyy = d.getFullYear();
                const ddmmyyyy = `${dd}${mm}${yyyy}`;
                const safeTitle = String(session?.title || 'session')
                    .trim()
                    .replace(/[\\/:*?"<>|]+/g, '')
                    .replace(/\s+/g, '_');
                const wbFile = `${safeTitle}_${ddmmyyyy}_${is19 ? 'wristband19' : 'wristband25'}.pdf`;
                wbDoc.save(wbFile);
                try {
                    const validUuid = (v) => typeof v === 'string' && /[0-9a-fA-F-]{36}/.test(v);
                    const sid = validUuid(id) ? id : null;
                    const sch = validUuid(membership?.school_id) ? membership.school_id : null;
                    await supabase.rpc('audit_log_event', {
                        p_entity_type: 'profile_cards',
                        p_action: 'download',
                        p_entity_id: null,
                        p_school_id: sch,
                        p_session_id: sid,
                        p_details: { file: wbFile, count: list.length, format }
                    });
                } catch {}
                return;
            }

            if (format === 'a4_sticker_105x74') {
                const stDoc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
                const pageW = 210;
                const pageH = 297;
                const cols = 2;
                const rows = 4;
                const stickerW = 105;
                const stickerH = 74;
                const perPage = cols * rows; // 8
                const safeInset = 5; // printer non-printable margin safety inside each sticker
                const qrSize = 32;
                const bcCanvas = document.createElement('canvas');
                const titleLine = String(session?.title || "");
                const schoolLine = String(schoolName || "");

                const truncateToWidth = (text, maxW, fontSize) => {
                    if (!text) return '';
                    stDoc.setFontSize(fontSize);
                    const ellipsis = '...';
                    let t = String(text);
                    if (stDoc.getTextWidth(t) <= maxW) return t;
                    while (t.length > 0 && stDoc.getTextWidth(t + ellipsis) > maxW) t = t.slice(0, -1);
                    return t.length ? (t + ellipsis) : ellipsis;
                };
                const wrapNameTwoLines = (text, maxW, fontSize) => {
                    const raw = String(text || '').trim();
                    if (!raw) return ['', ''];
                    stDoc.setFontSize(fontSize);
                    const words = raw.split(/\s+/).filter(Boolean);
                    if (!words.length) return ['', ''];
                    let line1 = '';
                    let i = 0;
                    for (; i < words.length; i++) {
                        const candidate = line1 ? `${line1} ${words[i]}` : words[i];
                        if (stDoc.getTextWidth(candidate) <= maxW) line1 = candidate;
                        else break;
                    }
                    if (!line1) {
                        line1 = truncateToWidth(words[0], maxW, fontSize);
                        i = 1;
                    }
                    const rest = words.slice(i).join(' ');
                    const line2 = rest ? truncateToWidth(rest, maxW, fontSize) : '';
                    return [line1, line2];
                };

                const drawSheetGuides = () => {
                    stDoc.setDrawColor(230);
                    stDoc.setLineWidth(0.15);
                    for (let c = 0; c <= cols; c++) {
                        const x = c * stickerW;
                        stDoc.line(x, 0, x, pageH);
                    }
                    for (let r = 0; r <= rows; r++) {
                        const y = r * stickerH;
                        stDoc.line(0, y, pageW, y);
                    }
                };

                for (let i = 0; i < list.length; i++) {
                    const idxInPage = i % perPage;
                    if (i > 0 && idxInPage === 0) stDoc.addPage('a4', 'portrait');
                    if (idxInPage === 0) drawSheetGuides();

                    const s = list[i];
                    const idNorm = normalizeStudentId(s.student_identifier);
                    const col = idxInPage % cols;
                    const row = Math.floor(idxInPage / cols);
                    const x0 = col * stickerW;
                    const y0 = row * stickerH;

                    const innerX = x0 + safeInset;
                    const innerY = y0 + safeInset;
                    const innerW = stickerW - (safeInset * 2);
                    const innerH = stickerH - (safeInset * 2);

                    const qrX = innerX + innerW - qrSize;
                    const qrY = innerY + 1;
                    const textX = innerX + 2;
                    const textMaxW = Math.max(24, (qrX - textX - 3));
                    const idLabel = truncateToWidth(idNorm, textMaxW, 15);
                    const [nameLine1, nameLine2] = wrapNameTwoLines(s.name || '', textMaxW, 12.5);
                    const classLabel = truncateToWidth(s.class || '', textMaxW, 11.5);
                    const schoolLabel = truncateToWidth(schoolLine, textMaxW, 8.5);
                    const sessionLabel = truncateToWidth(titleLine, textMaxW, 8.5);
                    const bcW = innerW - 4;
                    const bcH = 17;
                    const bcX = innerX + 2;
                    const bcY = innerY + innerH - bcH - 6;

                    // QR
                    try {
                        const qrUrl = await drawQrDataUrl(idNorm, 240, 'M', 1);
                        stDoc.addImage(qrUrl, 'PNG', qrX, qrY, qrSize, qrSize);
                    } catch {}

                    // Text block
                    stDoc.setFontSize(15);
                    if (idLabel) stDoc.text(idLabel, textX, innerY + 9);
                    stDoc.setFontSize(12.5);
                    if (nameLine1) stDoc.text(nameLine1, textX, innerY + 17);
                    if (nameLine2) stDoc.text(nameLine2, textX, innerY + 23);
                    stDoc.setFontSize(11.5);
                    if (classLabel) stDoc.text(classLabel, textX, innerY + (nameLine2 ? 29 : 25));
                    stDoc.setFontSize(8.5);
                    if (schoolLabel) stDoc.text(schoolLabel, textX, bcY - 4.5);
                    if (sessionLabel) stDoc.text(sessionLabel, textX, bcY - 1.2);

                    // Barcode + caption
                    try {
                        drawBarcode(bcCanvas, idNorm, { format: 'CODE128', width: 1.6, height: 46, margin: 10, displayValue: false });
                        const bcUrl = bcCanvas.toDataURL('image/png');
                        stDoc.addImage(bcUrl, 'PNG', bcX, bcY, bcW, bcH);
                        stDoc.setFontSize(10.5);
                        stDoc.text(truncateToWidth(idNorm, bcW, 10.5), bcX + (bcW / 2), bcY + bcH + 4, { align: 'center' });
                    } catch {}
                }

                const d = new Date(session.session_date);
                const dd = String(d.getDate()).padStart(2, '0');
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const yyyy = d.getFullYear();
                const ddmmyyyy = `${dd}${mm}${yyyy}`;
                const safeTitle = String(session?.title || 'session')
                    .trim()
                    .replace(/[\\/:*?"<>|]+/g, '')
                    .replace(/\s+/g, '_');
                const outFile = `${safeTitle}_${ddmmyyyy}_a4_sticker_105x74.pdf`;
                stDoc.save(outFile);
                try {
                    const validUuid = (v) => typeof v === 'string' && /[0-9a-fA-F-]{36}/.test(v);
                    const sid = validUuid(id) ? id : null;
                    const sch = validUuid(membership?.school_id) ? membership.school_id : null;
                    await supabase.rpc('audit_log_event', {
                        p_entity_type: 'profile_cards',
                        p_action: 'download',
                        p_entity_id: null,
                        p_school_id: sch,
                        p_session_id: sid,
                        p_details: { file: outFile, count: list.length, format: 'a4_sticker_105x74' }
                    });
                } catch {}
                return;
            }

            if (format === 'a4_score_sheet_4up') {
                const scoreDoc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
                const pageW = 210;
                const pageH = 297;
                const margin = 10;
                const cols = 2;
                const rows = 2;
                const cellW = (pageW - margin * 2) / cols;
                const cellH = (pageH - margin * 2) / rows;
                const perPage = cols * rows;
                const qrSize = 20;
                const bcCanvas = document.createElement('canvas');
                const titleLine = String(session?.title || "");
                const schoolLine = String(schoolName || "");
                const stationLines = (session?.assessment_type || 'NAPFA5') === 'IPPT3'
                    ? ['Sit-ups', 'Push-ups', 'Run']
                    : ['Sit-ups', 'Broad Jump', 'Sit & Reach', 'Pull-ups', 'Shuttle Run', 'Run'];

                const truncateToWidth = (text, maxW, fontSize) => {
                    if (!text) return '';
                    scoreDoc.setFontSize(fontSize);
                    const ellipsis = '...';
                    let t = String(text);
                    if (scoreDoc.getTextWidth(t) <= maxW) return t;
                    while (t.length > 0 && scoreDoc.getTextWidth(t + ellipsis) > maxW) t = t.slice(0, -1);
                    return t.length ? (t + ellipsis) : ellipsis;
                };

                const wrapNameTwoLines = (text, maxW, fontSize) => {
                    const raw = String(text || '').trim();
                    if (!raw) return ['', ''];
                    scoreDoc.setFontSize(fontSize);
                    const words = raw.split(/\s+/).filter(Boolean);
                    let line1 = '';
                    let i = 0;
                    for (; i < words.length; i++) {
                        const candidate = line1 ? `${line1} ${words[i]}` : words[i];
                        if (scoreDoc.getTextWidth(candidate) <= maxW) line1 = candidate;
                        else break;
                    }
                    if (!line1) {
                        line1 = truncateToWidth(words[0], maxW, fontSize);
                        i = 1;
                    }
                    const rest = words.slice(i).join(' ');
                    const line2 = rest ? truncateToWidth(rest, maxW, fontSize) : '';
                    return [line1, line2];
                };

                const drawPageGuides = () => {
                    scoreDoc.setDrawColor(232);
                    scoreDoc.setLineWidth(0.15);
                    for (let c = 0; c <= cols; c++) {
                        const x = margin + c * cellW;
                        scoreDoc.line(x, margin, x, pageH - margin);
                    }
                    for (let r = 0; r <= rows; r++) {
                        const y = margin + r * cellH;
                        scoreDoc.line(margin, y, pageW - margin, y);
                    }
                };

                for (let i = 0; i < list.length; i++) {
                    const idxInPage = i % perPage;
                    if (i > 0 && idxInPage === 0) scoreDoc.addPage('a4', 'portrait');
                    if (idxInPage === 0) drawPageGuides();

                    const s = list[i];
                    const idNorm = normalizeStudentId(s.student_identifier);
                    const col = idxInPage % cols;
                    const row = Math.floor(idxInPage / cols);
                    const x0 = margin + col * cellW;
                    const y0 = margin + row * cellH;

                    const cardX = x0 + 4;
                    const cardY = y0 + 4;
                    const cardW = cellW - 8;
                    const cardH = cellH - 8;

                    scoreDoc.setDrawColor(170);
                    scoreDoc.setLineWidth(0.3);
                    scoreDoc.rect(cardX, cardY, cardW, cardH);

                    const qrX = cardX + cardW - qrSize - 5;
                    const qrY = cardY + 5;
                    const textX = cardX + 5;
                    const textW = qrX - textX - 4;

                    const schoolLabel = truncateToWidth(schoolLine, textW, 8.5);
                    const sessionLabel = truncateToWidth(titleLine, textW, 8.5);
                    const idLabel = truncateToWidth(idNorm, textW, 13);
                    const [nameLine1, nameLine2] = wrapNameTwoLines(s.name || '', textW, 11.5);
                    const classLabel = truncateToWidth(s.class || '', textW, 10.5);

                    scoreDoc.setFontSize(8.5);
                    if (schoolLabel) scoreDoc.text(schoolLabel, textX, cardY + 8);
                    if (sessionLabel) scoreDoc.text(sessionLabel, textX, cardY + 12);
                    scoreDoc.setFontSize(13);
                    if (idLabel) scoreDoc.text(idLabel, textX, cardY + 20);
                    scoreDoc.setFontSize(11.5);
                    if (nameLine1) scoreDoc.text(nameLine1, textX, cardY + 28);
                    if (nameLine2) scoreDoc.text(nameLine2, textX, cardY + 33);
                    scoreDoc.setFontSize(10.5);
                    if (classLabel) scoreDoc.text(classLabel, textX, cardY + (nameLine2 ? 40 : 35));

                    try {
                        const qrUrl = await drawQrDataUrl(idNorm, 220, 'M', 1);
                        scoreDoc.addImage(qrUrl, 'PNG', qrX, qrY, qrSize, qrSize);
                    } catch {}

                    const bcX = cardX + 5;
                    const bcY = cardY + 47;
                    const bcW = cardW - 10;
                    const bcH = 13;
                    try {
                        drawBarcode(bcCanvas, idNorm, {
                            format: 'CODE128',
                            width: 1.5,
                            height: 40,
                            margin: 8,
                            displayValue: false,
                        });
                        const bcUrl = bcCanvas.toDataURL('image/png');
                        scoreDoc.addImage(bcUrl, 'PNG', bcX, bcY, bcW, bcH);
                    } catch {}
                    scoreDoc.setFontSize(9.5);
                    scoreDoc.text(truncateToWidth(idNorm, bcW, 9.5), bcX + (bcW / 2), bcY + bcH + 4, { align: 'center' });

                    const scoreAreaTop = bcY + bcH + 10;
                    const rowGap = 10.5;
                    const labelW = 30;
                    const boxX = cardX + labelW + 10;
                    const boxW = cardW - labelW - 15;
                    scoreDoc.setFontSize(10);
                    stationLines.forEach((label, idx) => {
                        const y = scoreAreaTop + idx * rowGap;
                        scoreDoc.text(label, textX, y);
                        scoreDoc.rect(boxX, y - 5, boxW, 7);
                    });
                }

                const d = new Date(session.session_date);
                const dd = String(d.getDate()).padStart(2, '0');
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const yyyy = d.getFullYear();
                const ddmmyyyy = `${dd}${mm}${yyyy}`;
                const safeTitle = String(session?.title || 'session')
                    .trim()
                    .replace(/[\\/:*?"<>|]+/g, '')
                    .replace(/\s+/g, '_');
                const outFile = `${safeTitle}_${ddmmyyyy}_a4_score_sheet_4up.pdf`;
                scoreDoc.save(outFile);
                try {
                    const validUuid = (v) => typeof v === 'string' && /[0-9a-fA-F-]{36}/.test(v);
                    const sid = validUuid(id) ? id : null;
                    const sch = validUuid(membership?.school_id) ? membership.school_id : null;
                    await supabase.rpc('audit_log_event', {
                        p_entity_type: 'profile_cards',
                        p_action: 'download',
                        p_entity_id: null,
                        p_school_id: sch,
                        p_session_id: sid,
                        p_details: { file: outFile, count: list.length, format: 'a4_score_sheet_4up' }
                    });
                } catch {}
                return;
            }

            const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
            const pageW = 210, pageH = 297;
            const margin = 8; // add small printer-safe margins
            const cols = 2, rows = 4;
            const usableW = pageW - margin * 2;
            const usableH = pageH - margin * 2;
            const cellW = usableW / cols;
            const cellH = usableH / rows;
            const qrSize = 28; // mm

            // Helper canvases for barcode and QR
            const bcCanvas = document.createElement('canvas');
            const qrCanvas = document.createElement('canvas');

            const titleLine = String(session?.title || "");
            const schoolLine = String(schoolName || "");

            // Helper: truncate text to fit max width (mm) without wrapping
            const truncateToWidth = (text, maxW, fontSize) => {
                if (!text) return '';
                doc.setFontSize(fontSize);
                const ellipsis = '...';
                let t = String(text);
                // Fast path: fits
                if (doc.getTextWidth(t) <= maxW) return t;
                // Trim until fits, then add ellipsis if room
                while (t.length > 0 && doc.getTextWidth(t + ellipsis) > maxW) {
                    t = t.slice(0, -1);
                }
                return t.length ? (t + ellipsis) : '';
            };
            const wrapToMaxLines = (text, maxW, fontSize, maxLines = 2) => {
                const raw = String(text || '').trim();
                if (!raw) return [];
                const words = raw.split(/\s+/).filter(Boolean);
                const lines = [];
                let cur = '';
                doc.setFontSize(fontSize);
                for (const w of words) {
                    if (!cur) {
                        if (doc.getTextWidth(w) <= maxW) {
                            cur = w;
                        } else {
                            lines.push(truncateToWidth(w, maxW, fontSize));
                            cur = '';
                        }
                    } else {
                        const candidate = `${cur} ${w}`;
                        if (doc.getTextWidth(candidate) <= maxW) {
                            cur = candidate;
                        } else {
                            lines.push(cur);
                            cur = (doc.getTextWidth(w) <= maxW) ? w : truncateToWidth(w, maxW, fontSize);
                        }
                    }
                    if (lines.length >= maxLines) break;
                }
                if (lines.length < maxLines && cur) lines.push(cur);
                if (lines.length > maxLines) lines.length = maxLines;
                if (words.length && lines.length === maxLines) {
                    const consumed = lines.join(' ').split(/\s+/).filter(Boolean).length;
                    if (consumed < words.length) {
                        doc.setFontSize(fontSize);
                        let last = String(lines[maxLines - 1] || '');
                        const ellipsis = '...';
                        while (last.length > 0 && doc.getTextWidth(last + ellipsis) > maxW) {
                            last = last.slice(0, -1);
                        }
                        lines[maxLines - 1] = last ? (last + ellipsis) : ellipsis;
                    }
                }
                return lines;
            };

            // Group by class so each class starts on a fresh page
            const groups = [];
            let curClass = null;
            list.forEach((s) => {
                const k = s.class || '';
                if (k !== curClass) { groups.push({ klass: k, items: [] }); curClass = k; }
                groups[groups.length - 1].items.push(s);
            });

            let idxInPage = 0;
            const capacity = cols * rows;
            const ensureNewPage = () => { if (idxInPage !== 0) { doc.addPage(); idxInPage = 0; } };

            for (const grp of groups) {
                // start new class on a new page
                ensureNewPage();
                for (const s of grp.items) {
                    const col = idxInPage % cols;
                    const row = Math.floor(idxInPage / cols);
                    const x0 = margin + col * cellW;
                    const y0 = margin + row * cellH;

                // Draw barcode and QR to canvases with high resolution for print
                const pxPerMm = 300 / 25.4; // 300 DPI target
                const targetQrPx = Math.round(qrSize * pxPerMm);
                // Compute intended barcode width in mm to match layout then convert to px
                const intendedBcWmm = cellW - qrSize - 12;
                const targetBcWpx = Math.max(300, Math.round(intendedBcWmm * pxPerMm));
                const targetBcHpx = Math.round(14 * pxPerMm); // slightly taller for better reads
                // Render CODE128 with generous quiet zone
                const idNorm = normalizeStudentId(s.student_identifier)
                drawBarcode(bcCanvas, idNorm, { format: 'CODE128', width: 2, height: targetBcHpx, margin: 24 });
                // If generated width is smaller/larger than target, it's OK; PDF scales the image retaining resolution
                const bcUrl = bcCanvas.toDataURL('image/png');
                const qrUrl = await drawQrDataUrl(idNorm, targetQrPx, 'M', 1);

                // Card border
                doc.setDrawColor(180);
                doc.setLineWidth(0.3);
                doc.rect(x0 + 2, y0 + 2, cellW - 4, cellH - 4);

                // Text area is constrained to the left of the QR to prevent overflow into QR/next card
                const cardPadX = 6;
                const qrX = x0 + cellW - qrSize - cardPadX;
                const textStartX = x0 + cardPadX;
                const textMaxW = Math.max(20, qrX - textStartX - 4);
                const idLabel = truncateToWidth(String(idNorm), textMaxW, 14);
                const nameLines = wrapToMaxLines(s.name || '', textMaxW, 12, 2);
                const classLabel = truncateToWidth((s.class || ''), textMaxW, 11);

                doc.setFontSize(14);
                doc.text(idLabel, textStartX, y0 + 12);
                doc.setFontSize(12);
                nameLines.forEach((line, i) => {
                    doc.text(line, textStartX, y0 + 20 + (i * 4.5));
                });
                doc.setFontSize(11);
                const classY = y0 + 20 + (Math.max(nameLines.length, 1) * 4.5) + 2;
                doc.text(classLabel, textStartX, classY);

                // Images
                // QR on right
                doc.addImage(qrUrl, 'PNG', x0 + cellW - qrSize - 6, y0 + 8, qrSize, qrSize);
                // Barcode bottom spans width minus QR area
                const bcW = cellW - qrSize - 12;
                // Reserve a footer band above barcode for school and session title
                const footerH = 10; // mm (two small text lines)
                const gap = 2;      // mm gap between footer and barcode
                const bottomPad = 4; // bottom padding
                const bcH = 12;     // reduce slightly to make space
                const bcY = y0 + cellH - bottomPad - bcH; // barcode sits above bottom padding

                // Footer band (draw text, not a filled rect). Centered text, truncated to fit cell width - paddings
                const footerTextPadX = 6; // left/right text padding inside cell
                const maxTextW = cellW - footerTextPadX * 2;
                const line1 = truncateToWidth(schoolLine, maxTextW, 9);
                const line2 = truncateToWidth(titleLine, maxTextW, 9);
                const footerBottomY = bcY - gap; // band sits directly above barcode
                const line2Y = footerBottomY - 1; // small inner padding
                const line1Y = line2Y - 4; // line spacing ~4mm
                doc.setFontSize(9);
                if (line1) doc.text(line1, x0 + cellW / 2, line1Y, { align: 'center' });
                if (line2) doc.text(line2, x0 + cellW / 2, line2Y, { align: 'center' });

                // Draw barcode
                doc.addImage(bcUrl, 'PNG', x0 + 6, bcY, bcW, bcH);
                idxInPage++;
                if (idxInPage >= capacity) { doc.addPage(); idxInPage = 0; }
            }
            }

            // Filename: (session_title)_(ddmmyyyy)_profilecards.pdf
            const d = new Date(session.session_date);
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            const ddmmyyyy = `${dd}${mm}${yyyy}`;
            const safeTitle = String(session?.title || 'session')
                .trim()
                .replace(/[\\/:*?"<>|]+/g, '')
                .replace(/\s+/g, '_');
            doc.save(`${safeTitle}_${ddmmyyyy}_profilecards.pdf`);
            try {
                const validUuid = (v) => typeof v === 'string' && /[0-9a-fA-F-]{36}/.test(v);
                const sid = validUuid(id) ? id : null;
                const sch = validUuid(membership?.school_id) ? membership.school_id : null;
                await supabase.rpc('audit_log_event', {
                    p_entity_type: 'profile_cards',
                    p_action: 'download',
                    p_entity_id: null,
                    p_school_id: sch,
                    p_session_id: sid,
                    p_details: { file: `${safeTitle}_${ddmmyyyy}_profilecards.pdf`, count: list.length }
                });
            } catch {}
        } catch (err) {
            setFlash(err.message || 'Failed to generate cards PDF.');
        }
    };

    if (!user) {
        return <div className="p-6">Please login.</div>;
    }

    if (membershipLoading || loading) {
        return <div className="p-6">Loading session...</div>;
    }

    if (membershipError || error) {
        return <div className="p-6 text-red-600">{membershipError || error}</div>;
    }

    if (!session) {
        return <div className="p-6">Session not available.</div>;
    }

    return (
        <div className="p-6 space-y-6">
            <button onClick={() => navigate(-1)} className="text-sm text-blue-600 hover:underline">
                Back
            </button>
            <div className="sticky top-0 z-30 -mx-6 px-6 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-b">
                <header className="py-3 space-y-2">
                    <div className="flex items-center gap-3 flex-wrap">
                        <h1 className="text-3xl font-semibold text-gray-800">{session.title}</h1>
                        <span className="text-sm text-gray-600">
                            {(() => { const d = new Date(session.session_date); const dd=String(d.getDate()).padStart(2,'0'); const mm=String(d.getMonth()+1).padStart(2,'0'); const yyyy=d.getFullYear(); return `${dd}/${mm}/${yyyy}`; })()}
                        </span>
                        <span className={"text-xs px-2 py-1 rounded border " + (session.status === "completed" ? "bg-gray-200 text-gray-700" : (session.status === "active" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-800"))}>
                            {session.status}
                        </span>
                        <div className="ml-auto flex items-center gap-3 flex-wrap">
                            <div className="text-xs text-gray-600 flex items-center gap-1">
                                <span>Change status</span>
                                <select
                                    className="text-xs border rounded px-2 py-1 bg-white w-auto"
                                    disabled={!canManage || statusUpdating}
                                    value={session.status}
                                    onChange={(e) => handleStatusChange(e.target.value)}
                                >
                                    <option value="draft">draft</option>
                                    <option value="active">active</option>
                                    <option value="completed">completed</option>
                                </select>
                            </div>
                            <div className="text-xs text-gray-600 flex items-center gap-1">
                                <span>Type</span>
                                {canManage ? (
                                  <select
                                    className="text-xs border rounded px-2 py-1 bg-white w-auto"
                                    disabled={!canManage || statusUpdating}
                                    value={session.assessment_type || 'NAPFA5'}
                                    onChange={async (e) => {
                                      const next = e.target.value;
                                      try {
                                        const [s1, s2] = await Promise.all([
                                          supabase.from('scores').select('id', { count: 'exact', head: true }).eq('session_id', id),
                                          supabase.from('ippt3_scores').select('id', { count: 'exact', head: true }).eq('session_id', id),
                                        ]);
                                        const total = (s1?.count || 0) + (s2?.count || 0);
                                        if (total > 0) { setFlash('Cannot change assessment type after scores are recorded.'); return; }
                                        const { data, error } = await supabase
                                          .from('sessions')
                                          .update({ assessment_type: next })
                                          .eq('id', id)
                                          .select()
                                          .single();
                                        if (error) throw error;
                                        setSession(data);
                                        setFlash('Assessment type updated.');
                                      } catch (err) {
                                        setFlash(err.message || 'Failed to update type.');
                                      }
                                    }}
                                  >
                                    <option value="NAPFA5">NAPFA-5</option>
                                    <option value="IPPT3">IPPT-3</option>
                                  </select>
                                ) : (
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded border ${ (session.assessment_type||'NAPFA5') === 'IPPT3' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-teal-50 text-teal-700 border-teal-200' }`}>
                                    {(session.assessment_type||'NAPFA5') === 'IPPT3' ? 'IPPT-3' : 'NAPFA-5'}
                                  </span>
                                )}
                            </div>

                            {/* header actions intentionally minimal; profile cards moved to roster tab */}
                        </div>
                    </div>
                </header>
                {/* Mobile summary toggle */}
                <div className="sm:hidden pb-1 flex items-center justify-between">
                    <button onClick={() => setSummaryOpen(v => !v)} className="text-xs px-2 py-1 border rounded bg-white hover:bg-gray-50">
                        {summaryOpen ? 'Hide summary' : 'Show summary'}
                    </button>
                </div>
                {/* Summary (sticky). Visible on sm+, toggle on mobile */}
                <div className={(summaryOpen ? '' : 'hidden ') + 'sm:block pb-3 space-y-2'}>
                    {(() => {
                        const total = roster?.length || 0;
                        const completed = completedSet.size;
                        const inProgress = inProgressSet.size;
                        const notStarted = Math.max(0, total - completed - inProgress);
                        const pct = (n) => total ? Math.round((n * 100) / total) : 0;
                        const pctCompleted = pct(completed);
                        return (
                            <>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                    <div className="border rounded-lg bg-white px-3 py-2">
                                        <div className="text-gray-500">Total</div>
                                        <div className="text-base font-semibold">{total}</div>
                                    </div>
                                    <div className="border rounded-lg bg-white px-3 py-2">
                                        <div className="text-gray-500">Not started</div>
                                        <div className="text-base font-semibold">{notStarted}</div>
                                    </div>
                                    <div className="border rounded-lg bg-white px-3 py-2">
                                        <div className="text-gray-500">In progress</div>
                                        <div className="text-base font-semibold">{inProgress}</div>
                                    </div>
                                    <div className="border rounded-lg bg-white px-3 py-2">
                                        <div className="text-gray-500">Completed</div>
                                        <div className="text-base font-semibold">{completed}</div>
                                    </div>
                                </div>
                                {/* Stacked progress bar: Not started | In progress | Completed */}
                                <div className="mt-2">
                                    {(() => {
                                        const pctInProgress = pct(inProgress);
                                        const pctNotStarted = pct(notStarted);
                                        return (
                                            <>
                                                <div className="flex h-2 w-full rounded overflow-hidden bg-gray-200">
                                                    {/* Not started */}
                                                    <div className="bg-gray-300" style={{ width: `${pctNotStarted}%` }} aria-label={`Not started ${pctNotStarted}%`} />
                                                    {/* In progress */}
                                                    <div className="bg-amber-400" style={{ width: `${pctInProgress}%` }} aria-label={`In progress ${pctInProgress}%`} />
                                                    {/* Completed */}
                                                    <div className="bg-green-500" style={{ width: `${pctCompleted}%` }} aria-label={`Completed ${pctCompleted}%`} />
                                                </div>
                                                <div className="mt-1 text-[11px] text-gray-600 flex gap-4 flex-wrap">
                                                    <span>
                                                        <span className="inline-block w-2 h-2 rounded-sm bg-gray-300 mr-1 align-middle" />
                                                        {notStarted}/{total} ({pctNotStarted}%) not started
                                                    </span>
                                                    <span>
                                                        <span className="inline-block w-2 h-2 rounded-sm bg-amber-400 mr-1 align-middle" />
                                                        {inProgress}/{total} ({pctInProgress}%) in progress
                                                    </span>
                                                    <span>
                                                        <span className="inline-block w-2 h-2 rounded-sm bg-green-500 mr-1 align-middle" />
                                                        {completed}/{total} ({pctCompleted}%) completed
                                                    </span>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            </>
                        );
                    })()}
                    {/* Tabs moved out of sticky header */}
                </div>
            </div>

            {/* Animated flash */}
            <div>
                {flash && <div className="text-sm text-blue-600 transition-all duration-200">{flash}</div>}
            </div>


            {/* Status/role banner */}
            <div className="text-sm">
                {session.status === "completed" && (
                    <div className="mb-3 px-3 py-2 rounded border bg-gray-50 text-gray-700">
                        Session is completed. Scores and roster are read-only.
                    </div>
                )}
                {session.status !== "completed" && membership?.role === "score_taker" && (
                    <div className="mb-3 px-3 py-2 rounded border bg-yellow-50 text-yellow-800">
                        You are a score_taker. You can record scores while the session is Active. Session settings and roster are admin-only.
                    </div>
                )}
            </div>

            <section className="space-y-4">
                {canManage ? (
                    editMode ? (
                        <form className="space-y-3 max-w-md" onSubmit={handleUpdate}>
                            <div>
                                <label className="block text-sm mb-1">Title</label>
                                <input
                                    value={formState.title}
                                    onChange={(e) => setFormState((prev) => ({ ...prev, title: e.target.value }))}
                                    className="border rounded p-2 w-full"
                                    required
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1">Session Date</label>
                                <input
                                    type="date"
                                    value={formState.session_date}
                                    onChange={(e) => setFormState((prev) => ({ ...prev, session_date: e.target.value }))}
                                    className="border rounded p-2 w-full"
                                    required
                                />
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={handleEditToggle}
                                    className="px-4 py-2 border rounded hover:bg-gray-100"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={formSubmitting}
                                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60"
                                >
                                    {formSubmitting ? "Saving..." : "Save"}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={handleEditToggle}
                                className="px-4 py-2 border rounded hover:bg-gray-100"
                            >
                                Edit Session
                            </button>
                            <button
                                onClick={handleDelete}
                                className="px-4 py-2 border border-red-300 text-red-600 rounded hover:bg-red-50"
                            >
                                Delete Session
                            </button>
                        </div>
                    )
                ) : (
                    <p className="text-sm text-gray-500">You have view-only access to this session.</p>
                )}
            </section>

            
            {/* Tabs (outside sticky header) */}
            <nav className="pb-2 overflow-x-auto">
                <div role="tablist" aria-label="Session sections" className="inline-flex rounded-lg bg-gray-100 p-1 text-sm">
                    <button
                        role="tab"
                        aria-selected={activeTab === 'roster'}
                        className={(activeTab === 'roster'
                            ? 'bg-white text-blue-700 shadow border border-gray-200'
                            : 'text-gray-600 hover:text-gray-800') + ' px-3 py-1.5 rounded-md transition-colors'}
                        onClick={() => setActiveTab('roster')}
                    >
                        Roster
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeTab === 'scores'}
                        className={(activeTab === 'scores'
                            ? 'bg-white text-blue-700 shadow border border-gray-200'
                            : 'text-gray-600 hover:text-gray-800') + ' px-3 py-1.5 rounded-md transition-colors'}
                        onClick={() => setActiveTab('scores')}
                    >
                        Scores
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeTab === 'houses'}
                        className={(activeTab === 'houses'
                            ? 'bg-white text-blue-700 shadow border border-gray-200'
                            : 'text-gray-600 hover:text-gray-800') + ' px-3 py-1.5 rounded-md transition-colors'}
                        onClick={() => setActiveTab('houses')}
                    >
                        Houses
                    </button>
                    <button
                        role="tab"
                        aria-selected={activeTab === 'groups'}
                        className={(activeTab === 'groups'
                            ? 'bg-white text-blue-700 shadow border border-gray-200'
                            : 'text-gray-600 hover:text-gray-800') + ' px-3 py-1.5 rounded-md transition-colors'}
                        onClick={() => setActiveTab('groups')}
                    >
                        Groups
                    </button>
                    {canManage && (
                        <button
                            role="tab"
                            aria-selected={activeTab === 'run-setup'}
                            className={(activeTab === 'run-setup'
                                ? 'bg-white text-blue-700 shadow border border-gray-200'
                                : 'text-gray-600 hover:text-gray-800') + ' px-3 py-1.5 rounded-md transition-colors'}
                            onClick={() => setActiveTab('run-setup')}
                        >
                            Run Setup
                        </button>
                    )}
                </div>
            </nav>

            {/* old tabs markup removed */}

            {activeTab === 'roster' ? (
                <RosterDualList
                  user={user}
                  session={session}
                  canManage={rosterEditable}
                  membership={membership}
                  onProfileCards={downloadProfileCardsPdf}
                />
            ) : activeTab === 'houses' ? (
                <SessionHouses
                  session={session}
                  membership={membership}
                  canManage={rosterEditable}
                />
            ) : activeTab === 'groups' ? (
                <SessionGroups
                  session={session}
                  membership={membership}
                  canManage={rosterEditable}
                />
            ) : activeTab === 'run-setup' ? (
                <section className="space-y-4">
                    <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-4">
                        <div className="border rounded-lg bg-white p-4">
                            <div className="text-sm font-semibold text-gray-800 mb-2">How it works</div>
                            <div className="text-xs text-gray-600 space-y-2">
                                <div>1. Create a run session config for a specific setup.</div>
                                <div>2. Generate the pairing token + QR/barcode.</div>
                                <div>3. Scan the token on each run device to join.</div>
                            </div>
                            <div className="text-sm font-semibold text-gray-800 mt-4 mb-3">Create Run Session Config</div>
                            <div className="text-xs text-gray-600 mb-3">
                                Create a run session configuration and share its pairing token with run devices.
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3">
                                {['A','B','C','D','E'].map((k) => (
                                    <button
                                        key={k}
                                        type="button"
                                        onClick={() => setRunConfigForm((prev) => ({
                                            ...prev,
                                            template_key: k,
                                            enforcement: defaultRunEnforcement(k)
                                        }))}
                                        className={`border rounded-lg p-0 text-left hover:border-blue-300 ${runConfigForm.template_key === k ? 'border-blue-500 bg-blue-50/40' : 'border-gray-200'}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <img src={`/setup${k}.svg`} alt={`Setup ${k}`} className="w-64 h-auto object-contain" />
                                            <div className="max-w-[160px]">
                                                <div className="text-sm font-semibold">Setup {k}</div>
                                                <div className="text-xs text-gray-600">
                                                    {k === 'A' && 'Single scan (lap start/end)'}
                                                    {k === 'B' && 'Lap scan + Checkpoint A'}
                                                    {k === 'C' && 'Lap scan + Checkpoints A & B'}
                                                    {k === 'D' && 'Start + Lap scan'}
                                                    {k === 'E' && 'Lap scan + Finish'}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <div className="text-xs text-gray-500 mt-2">
                                Setups B/C include checkpoint scans; others are single-lap scan points.
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3 mt-4">
                                <div>
                                    <label className="block text-sm mb-1">Config Name</label>
                                    <input
                                        value={runConfigForm.name}
                                        onChange={(e) => setRunConfigForm((prev) => ({ ...prev, name: e.target.value }))}
                                        className="border rounded p-2 w-full"
                                        placeholder="e.g., P5 Run Setup"
                                    />
                                    <div className="text-xs text-gray-500 mt-1">Shown to staff only.</div>
                                </div>
                                <div>
                                    <label className="block text-sm mb-1">Laps Required</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={runConfigForm.laps_required}
                                        onChange={(e) => setRunConfigForm((prev) => ({ ...prev, laps_required: e.target.value }))}
                                        className="border rounded p-2 w-full"
                                    />
                                    <div className="text-xs text-gray-500 mt-1">Total laps needed to finish.</div>
                                </div>
                                <div>
                                    <label className="block text-sm mb-1">Run Distance (m)</label>
                                    <select
                                        value={RUN_DISTANCE_PRESETS.includes(Number(runConfigForm.run_distance_m)) ? String(runConfigForm.run_distance_m) : "other"}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            if (v === "other") {
                                                if (RUN_DISTANCE_PRESETS.includes(Number(runConfigForm.run_distance_m))) {
                                                    setRunConfigForm((prev) => ({ ...prev, run_distance_m: "" }));
                                                }
                                                return;
                                            }
                                            setRunConfigForm((prev) => ({ ...prev, run_distance_m: Number(v) }));
                                        }}
                                        className="border rounded p-2 w-full"
                                    >
                                        {RUN_DISTANCE_PRESETS.map((d) => (
                                            <option key={d} value={d}>{d} m</option>
                                        ))}
                                        <option value="other">Other (key in)</option>
                                    </select>
                                    {!RUN_DISTANCE_PRESETS.includes(Number(runConfigForm.run_distance_m)) && (
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            value={runConfigForm.run_distance_m}
                                            onChange={(e) => setRunConfigForm((prev) => ({ ...prev, run_distance_m: e.target.value }))}
                                            className="border rounded p-2 w-full mt-2"
                                            placeholder="Enter distance in meters"
                                        />
                                    )}
                                    <div className="text-xs text-gray-500 mt-1">Used for run analytics. You can key in other distances.</div>
                                </div>
                                <div>
                                    <label className="block text-sm mb-1">Checkpoint Enforcement</label>
                                    <select
                                        value={runConfigForm.enforcement}
                                        onChange={(e) => setRunConfigForm((prev) => ({ ...prev, enforcement: e.target.value }))}
                                        className="border rounded p-2 w-full"
                                        disabled={!checkpointTemplates.has(runConfigForm.template_key)}
                                    >
                                        {['OFF','SOFT','STRICT'].map((k) => (
                                            <option key={k} value={k}>{k}</option>
                                        ))}
                                    </select>
                                    <div className="text-xs text-gray-500 mt-1">
                                        Used only in Setup B/C. Default OFF for A/D/E, SOFT for B/C.
                                    </div>
                                    <div className="text-xs text-gray-500">OFF: ignore missing checkpoints.</div>
                                    <div className="text-xs text-gray-500">SOFT: allow but flag.</div>
                                    <div className="text-xs text-gray-500">STRICT: block lap if checkpoints missing.</div>
                                </div>
                                <div>
                                    <label className="block text-sm mb-1">Time Between Scans</label>
                                    <select
                                        value={runConfigForm.scan_gap_ms}
                                        onChange={(e) => setRunConfigForm((prev) => ({ ...prev, scan_gap_ms: e.target.value }))}
                                        className="border rounded p-2 w-full"
                                    >
                                        {[5,10,15,20,25,30].map((s) => (
                                            <option key={s} value={s * 1000}>{s} seconds</option>
                                        ))}
                                    </select>
                                    <div className="text-xs text-gray-500 mt-1">Debounce window per runner.</div>
                                </div>
                                <div className="sm:col-span-2">
                                    <div className="text-xs text-gray-600">
                                        Runner ID format and accepted range are configured on each run station device.
                                    </div>
                                </div>
                            </div>
                            <div className="pt-3 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={handleCreateRunConfig}
                                    disabled={runConfigSaving}
                                    className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60"
                                >
                                    {runConfigSaving ? 'Saving...' : 'Create Run Session Config'}
                                </button>
                            </div>
                        </div>

                        <div className="border rounded-lg bg-white p-4">
                            <div className="text-sm font-semibold text-gray-800 mb-2">Run Session Configs</div>
                            {runConfigs.length === 0 && (
                                <div className="text-sm text-gray-600">No run session configurations yet.</div>
                            )}
                            <div className="space-y-2">
                                {runConfigs.map((config) => {
                                const expanded = expandedRunConfigId === config.id;
                                return (
                                    <div key={config.id} className="border rounded-lg">
                                        <div className="flex items-center justify-between gap-3 px-3 py-2">
                                            <div className="flex items-center gap-3">
                                                <img src={`/setup${config.template_key}.svg`} alt={`Setup ${config.template_key}`} className="w-12 h-12 object-contain" />
                                                <div>
                                                    <div className="text-sm font-semibold text-gray-800">
                                                        {config.name || `Run Session Config ${config.id?.slice(0, 6)}`}
                                                    </div>
                                                    <div className="text-xs text-gray-600">
                                                        Setup {config.template_key} - Distance {config.run_distance_m || 2400}m - Laps {config.laps_required} - Enforcement {config.enforcement || 'OFF'}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const nextId = expanded ? null : config.id;
                                                        setExpandedRunConfigId(nextId);
                                                        if (nextId) {
                                                            setRunTagDraftByConfig((prev) => ({
                                                                ...prev,
                                                                [nextId]: prev[nextId] || buildTagDraftForConfig(nextId)
                                                            }));
                                                            setRunApplyPolicyByConfig((prev) => ({
                                                                ...prev,
                                                                [nextId]: prev[nextId] || "best"
                                                            }));
                                                        }
                                                    }}
                                                    className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                >
                                                    {expanded ? 'Hide' : 'Edit'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDuplicateRunConfig(config)}
                                                    className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                    disabled={runConfigSaving}
                                                >
                                                    Duplicate
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteRunConfig(config)}
                                                    className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                        {expanded && (
                                            <div className="border-t px-3 py-3 space-y-3">
                                                <div className="grid sm:grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="block text-xs mb-1">Config Name</label>
                                                        <input
                                                            value={config.name || ''}
                                                            onChange={(e) => updateRunConfigLocal(config.id, { name: e.target.value })}
                                                            className="border rounded p-2 w-full"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs mb-1">Template</label>
                                                        <select
                                                            value={config.template_key}
                                                            onChange={(e) => updateRunConfigLocal(config.id, { template_key: e.target.value })}
                                                            className="border rounded p-2 w-full"
                                                        >
                                                            {['A','B','C','D','E'].map((k) => (
                                                                <option key={k} value={k}>Setup {k}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs mb-1">Laps Required</label>
                                                        <input
                                                            type="number"
                                                            min="1"
                                                            value={config.laps_required}
                                                            onChange={(e) => updateRunConfigLocal(config.id, { laps_required: e.target.value })}
                                                            className="border rounded p-2 w-full"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs mb-1">Run Distance (m)</label>
                                                        <select
                                                            value={RUN_DISTANCE_PRESETS.includes(Number(config.run_distance_m)) ? String(config.run_distance_m) : "other"}
                                                            onChange={(e) => {
                                                                const v = e.target.value;
                                                                if (v === "other") {
                                                                    if (RUN_DISTANCE_PRESETS.includes(Number(config.run_distance_m))) {
                                                                        updateRunConfigLocal(config.id, { run_distance_m: "" });
                                                                    }
                                                                    return;
                                                                }
                                                                updateRunConfigLocal(config.id, { run_distance_m: Number(v) });
                                                            }}
                                                            className="border rounded p-2 w-full"
                                                        >
                                                            {RUN_DISTANCE_PRESETS.map((d) => (
                                                                <option key={d} value={d}>{d} m</option>
                                                            ))}
                                                            <option value="other">Other (key in)</option>
                                                        </select>
                                                        {!RUN_DISTANCE_PRESETS.includes(Number(config.run_distance_m)) && (
                                                            <input
                                                                type="text"
                                                                inputMode="numeric"
                                                                pattern="[0-9]*"
                                                                value={config.run_distance_m ?? ""}
                                                                onChange={(e) => updateRunConfigLocal(config.id, { run_distance_m: e.target.value })}
                                                                className="border rounded p-2 w-full mt-2"
                                                                placeholder="Enter distance in meters"
                                                            />
                                                        )}
                                                        <div className="text-xs text-gray-500 mt-1">Used for run analytics.</div>
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs mb-1">Checkpoint Enforcement</label>
                                                        <select
                                                            value={config.enforcement || 'OFF'}
                                                            onChange={(e) => updateRunConfigLocal(config.id, { enforcement: e.target.value })}
                                                            className="border rounded p-2 w-full"
                                                            disabled={!checkpointTemplates.has(config.template_key)}
                                                        >
                                                            {['OFF','SOFT','STRICT'].map((k) => (
                                                                <option key={k} value={k}>{k}</option>
                                                            ))}
                                                        </select>
                                                        <div className="text-xs text-gray-500 mt-1">
                                                            Used only in Setup B/C.
                                                        </div>
                                                        <div className="text-xs text-gray-500">OFF: ignore missing checkpoints.</div>
                                                        <div className="text-xs text-gray-500">SOFT: allow but flag.</div>
                                                        <div className="text-xs text-gray-500">STRICT: block lap if checkpoints missing.</div>
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs mb-1">Time Between Scans</label>
                                                        <select
                                                            value={config.scan_gap_ms || 10000}
                                                            onChange={(e) => updateRunConfigLocal(config.id, { scan_gap_ms: e.target.value })}
                                                            className="border rounded p-2 w-full"
                                                        >
                                                            {[5,10,15,20,25,30].map((s) => (
                                                                <option key={s} value={s * 1000}>{s} seconds</option>
                                                            ))}
                                                        </select>
                                                        <div className="text-xs text-gray-500 mt-1">Debounce window per runner.</div>
                                                    </div>
                                                    <div className="sm:col-span-2">
                                                        <div className="text-xs text-gray-600">
                                                            Runner ID format and accepted range are configured on each run station device.
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs mb-1">Pairing Token</label>
                                                        <input
                                                            value={config.pairing_token || ''}
                                                            readOnly
                                                            className="border rounded p-2 w-full bg-gray-50"
                                                        />
                                                        <div className="text-xs text-gray-500 mt-1">Use this token in the run app.</div>
                                                    </div>
                                                    <div className="sm:col-span-2 text-[11px] text-gray-600">
                                                        Tag mapping and lock-in timing workflow are managed in dialogs.
                                                    </div>
                                                </div>
                                                <div className="flex justify-start">
                                                    {(() => {
                                                        const unsaved = hasUnsavedRunConfig(config);
                                                        return (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSaveRunConfig(config)}
                                                        className={
                                                            (unsaved
                                                                ? "px-6 py-3 text-sm bg-blue-600 text-white border border-blue-700 rounded hover:bg-blue-700"
                                                                : "px-6 py-3 text-sm border rounded hover:bg-gray-50")
                                                        }
                                                    >
                                                        Save
                                                    </button>
                                                        );
                                                    })()}
                                                </div>
                                                <div className="grid sm:grid-cols-3 gap-3">
                                                    <div className="border rounded p-2 bg-gray-50/60">
                                                        <div className="text-[11px] font-semibold text-gray-700 mb-2">Runners</div>
                                                        <div className="flex flex-wrap gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => openRunTagMappingModal(config)}
                                                                className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                            >
                                                                Tag Mapping
                                                            </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => openRunLockModal(config)}
                                                        className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                    >
                                                        Import Run Timings
                                                    </button>
                                                        </div>
                                                    </div>
                                                    <div className="border rounded p-2 bg-gray-50/60">
                                                        <div className="text-[11px] font-semibold text-gray-700 mb-2">Run App Pairing</div>
                                                        <div className="flex flex-wrap gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleGenerateRunToken(config)}
                                                                className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                            >
                                                                Generate Token
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleGenerateRunCodes(config)}
                                                                className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                            >
                                                                Create QR + Barcode
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleCopyRunToken(config.pairing_token)}
                                                                className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                                disabled={!config.pairing_token}
                                                            >
                                                                Copy Token
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="border rounded p-2 bg-amber-50/70 border-amber-200">
                                                        <div className="text-[11px] font-semibold text-amber-800 mb-2">Data ops</div>
                                                        <div className="flex flex-wrap gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleResetRunConfig(config)}
                                                                className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                            >
                                                                Delete cloud run data
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDownloadRunSessionData(config)}
                                                                className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
                                                            >
                                                                Download All Run Session Data
                                                            </button>
                                                        </div>
                                                        <div className="text-[11px] text-amber-700 mt-2">
                                                            Deletes cloud run events and sends CLEAR_ALL for station sync reset.
                                                        </div>
                                                    </div>
                                                </div>
                                                {runConfigFlash && <div className="text-xs text-blue-600">{runConfigFlash}</div>}
                                                {(config.pairing_qr_data_url || config.pairing_barcode_data_url) && (
                                                    <div className="grid sm:grid-cols-2 gap-3 pt-2">
                                                        <div className="border rounded-lg bg-gray-50 p-2 flex flex-col items-center gap-2">
                                                            {config.pairing_qr_data_url ? (
                                                                <img src={config.pairing_qr_data_url} alt="Pairing QR" className="w-40 h-40 object-contain" />
                                                            ) : (
                                                                <div className="text-xs text-gray-500">No QR generated yet.</div>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDownloadDataUrl(config.pairing_qr_data_url, `pairing-${config.id}-qr.png`)}
                                                                className="text-xs px-3 py-1 border rounded hover:bg-gray-100"
                                                                disabled={!config.pairing_qr_data_url}
                                                            >
                                                                Download QR
                                                            </button>
                                                        </div>
                                                        <div className="border rounded-lg bg-gray-50 p-2 flex flex-col items-center gap-2">
                                                            {config.pairing_barcode_data_url ? (
                                                                <img src={config.pairing_barcode_data_url} alt="Pairing Barcode" className="w-full max-w-[240px] object-contain" />
                                                            ) : (
                                                                <div className="text-xs text-gray-500">No barcode generated yet.</div>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDownloadDataUrl(config.pairing_barcode_data_url, `pairing-${config.id}-barcode.png`)}
                                                                className="text-xs px-3 py-1 border rounded hover:bg-gray-100"
                                                                disabled={!config.pairing_barcode_data_url}
                                                            >
                                                                Download Barcode
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
                </section>
            ) : (
                <section className="space-y-4">
                    <div className="border rounded-lg overflow-x-auto bg-white">
                        <div className="px-3 py-2 border-b bg-gray-50 text-sm font-medium flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 flex-wrap">
                                <span>Scores</span>
                                <div className="flex items-center gap-2">
                                    <label className="text-xs text-gray-600">Class</label>
                                    <select value={filterClass} onChange={e => { setScoresPage(1); setFilterClass(e.target.value) }} className="text-xs border rounded px-2 py-1 bg-white">
                                        <option value="">All</option>
                                        {classOptions.map(c => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="flex items-center gap-2">
                                    <label className="text-xs text-gray-600">Search</label>
                                    <input
                                        type="text"
                                        value={filterQuery}
                                        onChange={e => { setScoresPage(1); setFilterQuery(e.target.value) }}
                                        placeholder="Name or ID"
                                        className="text-xs border rounded px-2 py-1 bg-white"
                                    />
                                </div>
                                <div className="flex items-center gap-3 text-xs">
                                    <label className="inline-flex items-center gap-1">
                                        <input type="checkbox" className="align-middle" checked={showCompleted} onChange={e => { setScoresPage(1); setShowCompleted(e.target.checked) }} />
                                        <span>Show completed</span>
                                    </label>
                                    <label className="inline-flex items-center gap-1">
                                        <input type="checkbox" className="align-middle" checked={showIncomplete} onChange={e => { setScoresPage(1); setShowIncomplete(e.target.checked) }} />
                                        <span>Show incomplete</span>
                                    </label>
                                </div>
                                <div className="text-xs text-gray-500">Sorting: Class (A-Z), Name (A-Z)</div>
                            </div>
                            {canManage && (
                                <div className="flex gap-2">
                                    {!isIppt3 && (
                                        <button
                                            onClick={() => {
                                                setPftImportOpen(true);
                                                setPftImportErr("");
                                            }}
                                            className="text-xs px-3 py-1.5 border rounded bg-white hover:bg-gray-50"
                                        >
                                            Import PFT
                                        </button>
                                    )}
                                    {!massEditMode ? (
                                        <button
                                            onClick={() => {
                                                if (sessionCompleted) {
                                                    openCompletedScoresDialog();
                                                    return;
                                                }
                                                setMassEditMode(true);
                                                setMassEditErr('');
                                                setMassEditNotice('');
                                            }}
                                            className="text-xs px-3 py-1.5 border rounded bg-white hover:bg-gray-50"
                                        >
                                            Mass Edit
                                        </button>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => {
                                                    if (sessionCompleted) {
                                                        openCompletedScoresDialog();
                                                        return;
                                                    }
                                                    setMassEditSaveOpen(true);
                                                }}
                                                disabled={massEditBusy}
                                                className="text-xs px-3 py-1.5 border rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                                            >
                                                {massEditBusy ? 'Saving...' : 'Save Mass Edit'}
                                            </button>
                                            <button
                                                onClick={() => setMassEditCancelOpen(true)}
                                                disabled={massEditBusy}
                                                className="text-xs px-3 py-1.5 border rounded bg-white hover:bg-gray-50 disabled:opacity-60"
                                            >
                                                Cancel
                                            </button>
                                        </>
                                    )}
                                    <button
                                        onClick={exportPftAllClasses}
                                        className="text-xs px-3 py-1.5 border rounded bg-white hover:bg-gray-50"
                                    >
                                        Export PFT (All classes in 1 sheet)
                                    </button>
                                    <button
                                        onClick={exportPftPerClass}
                                        className="text-xs px-3 py-1.5 border rounded bg-white hover:bg-gray-50"
                                    >
                                        Export PFT (Per Class)
                                    </button>
                                </div>
                            )}
                        </div>
                        {massEditMode && (
                            <div className="px-3 py-2 border-b bg-blue-50 text-xs text-blue-800 flex items-center justify-between gap-2">
                                <span>Mass edit is ON for the rows currently displayed in this table page.</span>
                                {massEditErr ? <span className="text-red-700">{massEditErr}</span> : (massEditNotice ? <span className="text-green-700">{massEditNotice}</span> : null)}
                            </div>
                        )}
                        <table className="w-full">
                            <thead>
                            {((session?.assessment_type || 'NAPFA5') === 'IPPT3') ? (
                                <tr className="bg-gray-100 text-left">
                                    <th className="px-3 py-2 border">Student ID</th>
                                    <th className="px-3 py-2 border">Name</th>
                                    <th className="px-3 py-2 border">Class</th>
                                    <th className="px-3 py-2 border">Sit-ups</th>
                                    <th className="px-3 py-2 border">Push-ups</th>
                                    <th className="px-3 py-2 border">2.4km Run (mm:ss)</th>
                                    <th className="px-3 py-2 border">Award</th>
                                    <th className="px-3 py-2 border w-40">Actions</th>
                                </tr>
                            ) : (
                                <tr className="bg-gray-100 text-left">
                                    <th className="px-3 py-2 border">Student ID</th>
                                    <th className="px-3 py-2 border">Name</th>
                                    <th className="px-3 py-2 border">Class</th>
                                    <th className="px-3 py-2 border">Sit-ups</th>
                                    <th className="px-3 py-2 border">Shuttle Run</th>
                                    <th className="px-3 py-2 border">Sit & Reach</th>
                                    <th className="px-3 py-2 border">Pull-ups</th>
                                    <th className="px-3 py-2 border">Broad Jump</th>
                                    <th className="px-3 py-2 border">Run (mm:ss)</th>
                                    <th className="px-3 py-2 border">Award</th>
                                    <th className="px-3 py-2 border w-40">Actions</th>
                                </tr>
                            )}
                        </thead>
                            <tbody>
                            {(() => {
                                const total = filteredSortedRoster.length;
                                const emptyColSpan = ((session?.assessment_type || 'NAPFA5') === 'IPPT3') ? 8 : 11;
                                if (total === 0) return (
                                    <tr><td colSpan={emptyColSpan} className="px-3 py-4 text-center text-gray-500">No students in this session yet.</td></tr>
                                );
                                const pageItems = pagedScoresRoster;
                                    return pageItems.flatMap((s) => {
                                        const row = scoresByStudent.get(s.id) || {};
                                        const meta = stationMetaByStudent.get(s.id) || {};
                                        const napfaGrades = meta?.napfa || {};
                                        const ippt3 = meta?.ippt3 || {};
                                        const withGrade = (val, grade, formatter) => {
                                            if (val == null) return '-';
                                            const shown = formatter ? formatter(val) : String(val);
                                            return `${shown} (${grade || '-'})`;
                                        };
                                        const withPoints = (val, pts, formatter) => {
                                            if (val == null) return '-';
                                            const shown = formatter ? formatter(val) : String(val);
                                            return Number.isFinite(pts) ? `${shown} | ${pts} pts` : shown;
                                        };
                                    const canRecord = true;
                                        const isCompleted = completedSet.has(s.id);
                                        const isInProgress = inProgressSet.has(s.id);
                                        const statusLeft = isCompleted
                                            ? 'border-l-4 border-l-green-500'
                                            : (isInProgress ? 'border-l-4 border-l-amber-500' : 'border-l-4 border-l-gray-300');
                                        if ((session?.assessment_type || 'NAPFA5') === 'IPPT3') {
                                          return [
                                            <tr key={s.id}>
                                              <td className={`px-3 py-2 border align-top ${statusLeft}`}>{normalizeStudentId(s.student_identifier)}</td>
                                              <td className="px-3 py-2 border align-top">{s.name}</td>
                                              <td className="px-3 py-2 border align-top">{s.class || '-'}</td>
                                              <td className="px-3 py-2 border align-top">
                                                {massEditMode && canManage ? (
                                                    <input
                                                        value={readMassEdit(s.id, 'situps', row.situps == null ? '' : String(row.situps))}
                                                        onChange={(e) => setMassEditValue(s.id, 'situps', e.target.value)}
                                                        className="w-24 border rounded px-2 py-1 text-sm"
                                                        inputMode="numeric"
                                                        placeholder="0-60"
                                                    />
                                                ) : withPoints(row.situps, ippt3.situpsPoints)}
                                              </td>
                                              <td className="px-3 py-2 border align-top">
                                                {massEditMode && canManage ? (
                                                    <input
                                                        value={readMassEdit(s.id, 'pushups', row.pushups == null ? '' : String(row.pushups))}
                                                        onChange={(e) => setMassEditValue(s.id, 'pushups', e.target.value)}
                                                        className="w-24 border rounded px-2 py-1 text-sm"
                                                        inputMode="numeric"
                                                        placeholder="0-60"
                                                    />
                                                ) : withPoints(row.pushups, ippt3.pushupsPoints)}
                                              </td>
                                              <td className="px-3 py-2 border align-top">
                                                {massEditMode && canManage ? (
                                                    <input
                                                        value={readMassEdit(s.id, 'run_2400', runToInput(row.run_2400))}
                                                        onChange={(e) => setMassEditValue(s.id, 'run_2400', e.target.value)}
                                                        className="w-28 border rounded px-2 py-1 text-sm"
                                                        inputMode="numeric"
                                                        placeholder="MSS/MMSS"
                                                    />
                                                ) : withPoints(row.run_2400, ippt3.runPoints, (v) => fmtRun(v) || '-')}
                                              </td>
                                              <td className="px-3 py-2 border align-top">
                                                <AwardBadge award={ippt3.award} />
                                              </td>
                                                <td className="px-3 py-2 border align-top">
                                                    {massEditMode && canManage
                                                        ? <span className="text-xs text-gray-400">-</span>
                                                        : <ScoreRowActions student={s} canRecord={canRecord} sessionCompleted={sessionCompleted} onBlocked={openCompletedScoresDialog} onSaved={async () => { await loadScoresMap(); await loadScoresCount(); }} sessionId={id} isIppt3={isIppt3} />
                                                    }
                                              </td>
                                            </tr>
                                          ];
                                        }
                                        return [
                                            <tr key={s.id}>
                                                <td className={`px-3 py-2 border align-top ${statusLeft}`}>{normalizeStudentId(s.student_identifier)}</td>
                                                <td className="px-3 py-2 border align-top">{s.name}</td>
                                                <td className="px-3 py-2 border align-top">{s.class || '-'}</td>
                                                <td className="px-3 py-2 border align-top">
                                                    {massEditMode && canManage ? (
                                                        <input
                                                            value={readMassEdit(s.id, 'situps', row.situps == null ? '' : String(row.situps))}
                                                            onChange={(e) => setMassEditValue(s.id, 'situps', e.target.value)}
                                                            className="w-24 border rounded px-2 py-1 text-sm"
                                                            inputMode="numeric"
                                                            placeholder="0-60"
                                                        />
                                                    ) : withGrade(row.situps, napfaGrades.situps)}
                                                </td>
                                                <td className="px-3 py-2 border align-top">
                                                    {massEditMode && canManage ? (
                                                        <input
                                                            value={readMassEdit(s.id, 'shuttle_run', row.shuttle_run == null ? '' : String(row.shuttle_run))}
                                                            onChange={(e) => setMassEditValue(s.id, 'shuttle_run', e.target.value)}
                                                            className="w-28 border rounded px-2 py-1 text-sm"
                                                            inputMode="decimal"
                                                            placeholder="0.0-20.0"
                                                        />
                                                    ) : withGrade(row.shuttle_run, napfaGrades.shuttle)}
                                                </td>
                                                <td className="px-3 py-2 border align-top">
                                                    {massEditMode && canManage ? (
                                                        <input
                                                            value={readMassEdit(s.id, 'sit_and_reach', row.sit_and_reach == null ? '' : String(row.sit_and_reach))}
                                                            onChange={(e) => setMassEditValue(s.id, 'sit_and_reach', e.target.value)}
                                                            className="w-24 border rounded px-2 py-1 text-sm"
                                                            inputMode="numeric"
                                                            placeholder="0-80"
                                                        />
                                                    ) : withGrade(row.sit_and_reach, napfaGrades.reach)}
                                                </td>
                                                <td className="px-3 py-2 border align-top">
                                                    {massEditMode && canManage ? (
                                                        <input
                                                            value={readMassEdit(s.id, 'pullups', row.pullups == null ? '' : String(row.pullups))}
                                                            onChange={(e) => setMassEditValue(s.id, 'pullups', e.target.value)}
                                                            className="w-24 border rounded px-2 py-1 text-sm"
                                                            inputMode="numeric"
                                                            placeholder="0-60"
                                                        />
                                                    ) : withGrade(row.pullups, napfaGrades.pullups)}
                                                </td>
                                                <td className="px-3 py-2 border align-top">
                                                    {massEditMode && canManage ? (
                                                        <input
                                                            value={readMassEdit(s.id, 'broad_jump', row.broad_jump == null ? '' : String(row.broad_jump))}
                                                            onChange={(e) => setMassEditValue(s.id, 'broad_jump', e.target.value)}
                                                            className="w-24 border rounded px-2 py-1 text-sm"
                                                            inputMode="numeric"
                                                            placeholder="0-300"
                                                        />
                                                    ) : withGrade(row.broad_jump, napfaGrades.broad)}
                                                </td>
                                                <td className="px-3 py-2 border align-top">
                                                    {massEditMode && canManage ? (
                                                        <input
                                                            value={readMassEdit(s.id, 'run_2400', runToInput(row.run_2400))}
                                                            onChange={(e) => setMassEditValue(s.id, 'run_2400', e.target.value)}
                                                            className="w-28 border rounded px-2 py-1 text-sm"
                                                            inputMode="numeric"
                                                            placeholder="MSS/MMSS"
                                                        />
                                                    ) : withGrade(row.run_2400, napfaGrades.run, (v) => fmtRun(v) || '-')}
                                                </td>
                                                <td className="px-3 py-2 border align-top">
                                                    <AwardBadge award={napfaGrades.award} />
                                                </td>
                                                <td className="px-3 py-2 border align-top">
                                                    {massEditMode && canManage
                                                        ? <span className="text-xs text-gray-400">-</span>
                                                        : <ScoreRowActions student={s} canRecord={canRecord} sessionCompleted={sessionCompleted} onBlocked={openCompletedScoresDialog} onSaved={async () => { await loadScoresMap(); await loadScoresCount(); }} sessionId={id} isIppt3={isIppt3} />
                                                    }
                                                </td>
                                            </tr>
                                        ];
                                    });
                                })()}
                            </tbody>
                        </table>
                        {/* Pagination footer */}
                        <ScoresPager
                            total={filteredSortedRoster.length}
                            page={scoresPage}
                            pageSize={scoresPageSize}
                            onPageChange={setScoresPage}
                        />
                    </div>
                </section>
            )}
            {pftImportOpen && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                    <div className="bg-white rounded-lg w-full max-w-5xl border shadow-xl max-h-[90vh] flex flex-col">
                        <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
                            <div className="font-medium">Import PFT Scores</div>
                            <button
                                type="button"
                                className="px-2 py-1 border rounded hover:bg-gray-50 text-sm"
                                onClick={closePftImportModal}
                                disabled={pftImportBusy}
                            >
                                Close
                            </button>
                        </div>
                        <div className="p-4 space-y-4 overflow-y-auto">
                            <div className="text-sm text-gray-600">
                                Use the cockpit PFT CSV in the same format as the export. Students not already in this session roster will be skipped.
                            </div>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <input
                                        type="file"
                                        accept=".csv,text/csv"
                                        onChange={(e) => handlePftImportFile(e.target.files?.[0] || null)}
                                        disabled={pftImportBusy}
                                    />
                                    {pftImportFileName && (
                                        <span className="text-xs text-gray-500">{pftImportFileName}</span>
                                    )}
                                </div>
                            </div>
                            <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 space-y-3">
                                <div className="text-sm font-medium text-slate-900">Import Rules</div>
                                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                                    <div className="space-y-2 text-sm text-slate-700">
                                        <label className="flex items-start gap-2">
                                            <input
                                                type="radio"
                                                name="pft-import-mode"
                                                value="keep_better"
                                                checked={pftImportMode === 'keep_better'}
                                                onChange={(e) => setPftImportMode(e.target.value)}
                                                disabled={pftImportBusy || !pftImportCsvText}
                                                className="mt-0.5"
                                            />
                                            <span>
                                                Keep better score only <span className="text-xs text-green-700">(Recommended)</span>
                                                <div className="text-xs text-slate-500">Higher is better for reps/distance. Lower is better for shuttle/run.</div>
                                            </span>
                                        </label>
                                        <label className="flex items-start gap-2">
                                            <input
                                                type="radio"
                                                name="pft-import-mode"
                                                value="overwrite_all"
                                                checked={pftImportMode === 'overwrite_all'}
                                                onChange={(e) => setPftImportMode(e.target.value)}
                                                disabled={pftImportBusy || !pftImportCsvText}
                                                className="mt-0.5"
                                            />
                                            <span>
                                                Uploaded PFT will fully overwrite all scores
                                                <div className="text-xs text-slate-500">Imported values replace existing scores for stations that have values in the CSV.</div>
                                            </span>
                                        </label>
                                    </div>
                                    <div>
                                        <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500 mb-2">Notes</div>
                                        <ul className="list-disc pl-4 space-y-1 text-[11px] leading-4 text-slate-600">
                                            <li>Students not in session roster will be skipped.</li>
                                            <li>Blank CSV cells do not clear existing scores.</li>
                                            <li>Duplicate CSV rows are merged by best station result.</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                            {pftImportErr && <div className="text-sm text-red-600">{pftImportErr}</div>}
                            {pftImportPreview && (
                                <div className="space-y-3">
                                    <div className="sticky top-0 z-10 bg-white pb-2">
                                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
                                        <div className="border rounded-lg bg-gray-50 px-3 py-2">
                                            <div className="text-gray-500">Parsed</div>
                                            <div className="text-base font-semibold">{pftImportPreview.parsedRows}</div>
                                        </div>
                                        <div className="border rounded-lg bg-gray-50 px-3 py-2">
                                            <div className="text-gray-500">Import rows</div>
                                            <div className="text-base font-semibold">{pftImportPreview.rowsToImport}</div>
                                        </div>
                                        <div className="border rounded-lg bg-gray-50 px-3 py-2">
                                            <div className="text-gray-500">Unmatched</div>
                                            <div className="text-base font-semibold">{pftImportPreview.unmatchedCount}</div>
                                        </div>
                                        <div className="border rounded-lg bg-gray-50 px-3 py-2">
                                            <div className="text-gray-500">Duplicates</div>
                                            <div className="text-base font-semibold">{pftImportPreview.duplicateRows}</div>
                                        </div>
                                        <div className="border rounded-lg bg-gray-50 px-3 py-2">
                                            <div className="text-gray-500">No changes</div>
                                            <div className="text-base font-semibold">{pftImportPreview.unchangedCount}</div>
                                        </div>
                                        <div className="border rounded-lg bg-gray-50 px-3 py-2">
                                            <div className="text-gray-500">Worse skipped</div>
                                            <div className="text-base font-semibold">{pftImportPreview.worseCount}</div>
                                        </div>
                                    </div>
                                    </div>
                                    {pftImportPreview.parseErrors.length > 0 && (
                                        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                            <div className="font-medium mb-1">Parse issues</div>
                                            <div className="space-y-1 max-h-24 overflow-auto">
                                                {pftImportPreview.parseErrors.slice(0, 10).map((item, idx) => (
                                                    <div key={`${item.row}-${idx}`}>Row {item.row}: {item.message}</div>
                                                ))}
                                                {pftImportPreview.parseErrors.length > 10 && (
                                                    <div>...and {pftImportPreview.parseErrors.length - 10} more</div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between gap-3 flex-wrap">
                                        <div>
                                            <div className="text-sm font-medium text-slate-900">Preview rows (first {PFT_IMPORT_PREVIEW_LIMIT} only)</div>
                                            <div className="text-xs text-slate-500">All matched rows will still be imported. This table is only a preview.</div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={downloadPftImportSummary}
                                            className="text-xs px-3 py-1.5 border rounded bg-white hover:bg-gray-50"
                                        >
                                            Download Preview Summary CSV
                                        </button>
                                    </div>
                                    <div className="border rounded overflow-auto max-h-[48vh]">
                                        <table className="w-full text-sm">
                                            <thead className="bg-gray-100 sticky top-0 z-10">
                                                <tr>
                                                    <th className="text-left px-3 py-2 border-b">ID</th>
                                                    <th className="text-left px-3 py-2 border-b">Name</th>
                                                    <th className="text-left px-3 py-2 border-b">Class</th>
                                                    <th className="text-left px-3 py-2 border-b">Action</th>
                                                    <th className="text-left px-3 py-2 border-b">Detail</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {pftImportPreview.previewRows.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={5} className="px-3 py-4 text-center text-gray-500">No preview rows.</td>
                                                    </tr>
                                                ) : pftImportPreview.previewRows.map((row, idx) => (
                                                    <tr key={`${row.id}-${idx}`}>
                                                        <td className="px-3 py-2 border-b">{row.id}</td>
                                                        <td className="px-3 py-2 border-b">{row.name}</td>
                                                        <td className="px-3 py-2 border-b">{row.className}</td>
                                                        <td className="px-3 py-2 border-b">
                                                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${row.action === 'Import' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-700'}`}>
                                                                {row.action}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2 border-b text-xs text-gray-600">{row.reason}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="px-4 py-3 border-t flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={closePftImportModal}
                                disabled={pftImportBusy}
                                className="px-3 py-1.5 border rounded hover:bg-gray-50 text-sm disabled:opacity-60"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={applyPftImport}
                                disabled={pftImportBusy || !pftImportPreview || pftImportPreview.rowsToImport === 0}
                                className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60 text-sm"
                            >
                                {pftImportBusy ? 'Importing...' : 'Apply Import'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <ConfirmDialog
                open={massEditSaveOpen}
                title="Save Mass Edit?"
                message="Apply all mass edits for the rows shown in this table page?"
                confirmText="Save Changes"
                tone="primary"
                onCancel={() => setMassEditSaveOpen(false)}
                onConfirm={async () => {
                    setMassEditSaveOpen(false);
                    await saveMassEditVisible();
                }}
            />
            <ConfirmDialog
                open={massEditCancelOpen}
                title="Cancel Mass Edit?"
                message="Discard all unsaved mass edits in this table page?"
                confirmText="Discard Changes"
                tone="danger"
                onCancel={() => setMassEditCancelOpen(false)}
                onConfirm={() => {
                    setMassEditCancelOpen(false);
                    setMassEditMode(false);
                    setMassEdits(new Map());
                    setMassEditErr('');
                    setMassEditNotice('');
                }}
            />
            <NoticeDialog
                open={completedScoresDialogOpen}
                title="Session Completed"
                message="Scores cannot be changed after a session has been completed."
                onClose={() => setCompletedScoresDialogOpen(false)}
            />
            <ConfirmDialog
                open={statusCompleteConfirmOpen}
                title="Mark Session Completed?"
                message={(
                    <div className="space-y-2">
                        <p>After this session is marked completed, scores can no longer be changed.</p>
                        {massEditMode && massEdits.size > 0 && (
                            <p className="text-amber-700">Any unsaved mass edits on this page will be discarded.</p>
                        )}
                    </div>
                )}
                confirmText="Mark Completed"
                cancelText="Keep Active"
                tone="danger"
                onCancel={() => {
                    setStatusCompleteConfirmOpen(false);
                    setPendingStatusChange(null);
                }}
                onConfirm={async () => {
                    const nextStatus = pendingStatusChange;
                    setStatusCompleteConfirmOpen(false);
                    setPendingStatusChange(null);
                    if (nextStatus) await applyStatusChange(nextStatus);
                }}
            />
            {showRunTagMapModal && activeRunConfigForModal && (() => {
                const modalConfig = runConfigs.find((c) => c.id === activeRunConfigForModal);
                if (!modalConfig) return null;
                const draft = runTagDraftByConfig[modalConfig.id] || {};
                const rosterForDialog = runTagClassFilter
                    ? (sortedRoster || []).filter((s) => String(s.class || "") === runTagClassFilter)
                    : (sortedRoster || []);
                return (
                    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                        <div className="bg-white rounded-lg w-full max-w-5xl border shadow-xl">
                            <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
                                <div className="font-medium">Tag Mapping - {modalConfig.name || `Run Session Config ${modalConfig.id?.slice(0, 6)}`}</div>
                                <button
                                    type="button"
                                    className="px-2 py-1 border rounded hover:bg-gray-50 text-sm"
                                    onClick={() => setShowRunTagMapModal(false)}
                                >
                                    Close
                                </button>
                            </div>
                            <div className="p-4 space-y-3">
                                <div className="flex flex-wrap items-end gap-2">
                                    <div>
                                        <label className="block text-xs mb-1">Class</label>
                                        <select value={runTagClassFilter} onChange={(e) => setRunTagClassFilter(e.target.value)} className="border rounded p-2 text-sm min-w-[160px]">
                                            <option value="">All classes</option>
                                            {classOptions.map((cls) => (
                                                <option key={cls} value={cls}>{cls}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs mb-1">Auto-tag rule</label>
                                        <select value={runTagRule} onChange={(e) => setRunTagRule(e.target.value)} className="border rounded p-2 text-sm min-w-[180px]">
                                            <option value="numeric">Numbers only</option>
                                            <option value="classIndex">Class + index (A01)</option>
                                            <option value="structured4">4-digit (LCII)</option>
                                        </select>
                                    </div>
                                    {runTagRule === "numeric" && (
                                        <div className="flex items-end gap-2">
                                            <div>
                                                <label className="block text-xs mb-1">Numeric start</label>
                                                <input value={runTagNumericStart} onChange={(e) => setRunTagNumericStart(e.target.value)} className="border rounded p-2 text-sm w-28" />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => autoTagByRule(modalConfig.id)}
                                                disabled={Boolean(runTagBusyByConfig[modalConfig.id]) || Boolean(modalConfig.timings_locked_at)}
                                                className="px-3 py-2 border rounded hover:bg-gray-50 text-sm disabled:opacity-60"
                                            >
                                                AutoTag
                                            </button>
                                        </div>
                                    )}
                                    {runTagRule !== "numeric" && (
                                        <button
                                            type="button"
                                            onClick={() => autoTagByRule(modalConfig.id)}
                                            disabled={Boolean(runTagBusyByConfig[modalConfig.id]) || Boolean(modalConfig.timings_locked_at)}
                                            className="px-3 py-2 border rounded hover:bg-gray-50 text-sm disabled:opacity-60"
                                        >
                                            AutoTag
                                        </button>
                                    )}
                                </div>
                                <div className="text-xs text-gray-600">
                                    You can auto-tag by the selected rule, then manually override any row before saving.
                                </div>
                                <div className="max-h-[52vh] overflow-auto border rounded">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-100">
                                            <tr>
                                                <th className="text-left px-2 py-1 border-b">Class</th>
                                                <th className="text-left px-2 py-1 border-b">Student</th>
                                                <th className="text-left px-2 py-1 border-b">Student ID</th>
                                                <th className="text-left px-2 py-1 border-b">Tag ID</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rosterForDialog.map((s) => (
                                                <tr key={`${modalConfig.id}-map-${s.id}`}>
                                                    <td className="px-2 py-1 border-b">{s.class || "-"}</td>
                                                    <td className="px-2 py-1 border-b">{s.name || "-"}</td>
                                                    <td className="px-2 py-1 border-b">{normalizeStudentId(s.student_identifier) || "-"}</td>
                                                    <td className="px-2 py-1 border-b">
                                                        <input
                                                            value={String(draft[s.id] ?? "")}
                                                            onChange={(e) => handleRunTagDraftChange(modalConfig.id, s.id, e.target.value)}
                                                            placeholder="Tag ID"
                                                            className="border rounded px-2 py-1 w-full"
                                                            disabled={Boolean(modalConfig.timings_locked_at)}
                                                        />
                                                    </td>
                                                </tr>
                                            ))}
                                            {rosterForDialog.length === 0 && (
                                                <tr>
                                                    <td colSpan={4} className="px-2 py-2 text-gray-500">No students for selected filter.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                            <div className="px-4 py-3 border-t flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowRunTagMapModal(false)}
                                    className="px-3 py-1.5 border rounded hover:bg-gray-50 text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleLockTagMapping(modalConfig)}
                                    disabled={Boolean(runTagBusyByConfig[modalConfig.id]) || Boolean(modalConfig.timings_locked_at)}
                                    className="px-3 py-1.5 border rounded hover:bg-gray-50 text-sm disabled:opacity-60"
                                >
                                    {modalConfig.timings_locked_at ? "Tag Mapping Locked" : "Lock Tag Mapping Permanently"}
                                </button>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        await handleSaveRunTagMappings(modalConfig);
                                        setShowRunTagMapModal(false);
                                    }}
                                    disabled={Boolean(runTagBusyByConfig[modalConfig.id]) || Boolean(modalConfig.timings_locked_at)}
                                    className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60 text-sm"
                                >
                                    Save Tag Mapping
                                </button>
                            </div>
                            <div className="px-4 pb-3 text-[11px] text-amber-700 text-right">
                                After locking tag mapping, tag changes are no longer allowed for this run session config.
                            </div>
                        </div>
                    </div>
                );
            })()}

            {showRunLockModal && activeRunConfigForModal && (() => {
                const modalConfig = runConfigs.find((c) => c.id === activeRunConfigForModal);
                if (!modalConfig) return null;
                const preview = runApplyPreviewByConfig[modalConfig.id];
                const mappedRows = (runTagMappingsByConfig[modalConfig.id] || []).length;
                const rosterCount = (sortedRoster || []).length;
                return (
                    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                        <div className="bg-white rounded-lg w-full max-w-5xl border shadow-xl">
                            <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
                                <div className="font-medium">Import Run Timings - {modalConfig.name || `Run Session Config ${modalConfig.id?.slice(0, 6)}`}</div>
                                <button
                                    type="button"
                                    className="px-2 py-1 border rounded hover:bg-gray-50 text-sm"
                                    onClick={() => setShowRunLockModal(false)}
                                >
                                    Close
                                </button>
                            </div>
                            <div className="p-4 space-y-3">
                                <div className="text-sm text-gray-700">
                                    Tag mapping overview: mapped {mappedRows} / roster {rosterCount}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <label className="text-xs text-gray-600">Apply policy</label>
                                    <select
                                        value={runApplyPolicyByConfig[modalConfig.id] || "best"}
                                        onChange={(e) => setRunApplyPolicyByConfig((prev) => ({ ...prev, [modalConfig.id]: e.target.value }))}
                                        className="border rounded px-2 py-1 text-xs"
                                    >
                                        <option value="best">Best timing only (recommended)</option>
                                        <option value="overwrite">Force overwrite existing</option>
                                        <option value="fill-empty">Fill blanks only</option>
                                    </select>
                                    <button
                                        type="button"
                                        onClick={() => handlePreviewRunToScores(modalConfig)}
                                        disabled={Boolean(runTagBusyByConfig[modalConfig.id])}
                                        className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50 disabled:opacity-60"
                                    >
                                        Refresh preview
                                    </button>
                                </div>
                                <div className="max-h-[52vh] overflow-auto border rounded">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-100">
                                            <tr>
                                                <th className="text-left px-2 py-1 border-b">Tag</th>
                                                <th className="text-left px-2 py-1 border-b">Student</th>
                                                <th className="text-left px-2 py-1 border-b">New timing</th>
                                                <th className="text-left px-2 py-1 border-b">Old timing</th>
                                                <th className="text-left px-2 py-1 border-b">Comparison</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(preview?.rows || []).slice(0, 240).map((row, idx) => (
                                                <tr key={`${modalConfig.id}-lock-${idx}`}>
                                                    <td className="px-2 py-1 border-b">{row.tag_id || "-"}</td>
                                                    <td className="px-2 py-1 border-b">{row.student_name || "-"}</td>
                                                    <td className="px-2 py-1 border-b">{row.new_run_2400 != null ? (fmtRun(row.new_run_2400) || row.new_run_2400) : "-"}</td>
                                                    <td className="px-2 py-1 border-b">{row.existing_run_2400 != null ? (fmtRun(row.existing_run_2400) || row.existing_run_2400) : "-"}</td>
                                                    <td className="px-2 py-1 border-b">{row.comparison}</td>
                                                </tr>
                                            ))}
                                            {!(preview?.rows || []).length && (
                                                <tr>
                                                    <td colSpan={5} className="px-2 py-2 text-gray-500">No preview rows yet. Click Refresh preview.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {preview && (
                                    <div className="text-xs text-gray-600">
                                        Timings detected: {preview.totalTimings} | Matched: {preview.matched} | Unmatched tags: {preview.unmatchedTags}
                                    </div>
                                )}
                            </div>
                            <div className="px-4 py-3 border-t flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowRunLockModal(false)}
                                    className="px-3 py-1.5 border rounded hover:bg-gray-50 text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={async () => {
                                        await handleApplyRunToScores(modalConfig);
                                        setShowRunLockModal(false);
                                    }}
                                    disabled={Boolean(runTagBusyByConfig[modalConfig.id]) || !modalConfig.timings_locked_at}
                                    className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-60 text-sm"
                                >
                                    Apply to Scores
                                </button>
                            </div>
                            {!modalConfig.timings_locked_at && (
                                <div className="px-4 pb-3 text-xs text-amber-700 text-right">
                                    Lock tag mapping in the Tag Mapping dialog before importing run timings.
                                </div>
                            )}
                        </div>
                    </div>
                );
            })()}

            {showRunConfigDeleteModal && pendingDeleteRunConfig && (
                <div className="fixed inset-0 z-50">
                    <div
                        className="absolute inset-0 bg-black/35"
                        onClick={() => {
                            if (runConfigDeleteBusy) return;
                            setShowRunConfigDeleteModal(false);
                            setPendingDeleteRunConfig(null);
                        }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                        <div role="dialog" aria-modal="true" className="w-full max-w-lg bg-white rounded-lg shadow-lg border">
                            <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
                                <div className="font-medium">Delete Run Session Config</div>
                                <button
                                    type="button"
                                    className="px-2 py-1 border rounded hover:bg-gray-50 text-sm"
                                    onClick={() => {
                                        setShowRunConfigDeleteModal(false);
                                        setPendingDeleteRunConfig(null);
                                    }}
                                    disabled={runConfigDeleteBusy}
                                >
                                    Close
                                </button>
                            </div>
                            <div className="p-4 space-y-3">
                                <div className="text-sm text-gray-700">
                                    You are deleting: <span className="font-semibold">{pendingDeleteRunConfig.name || `Run Session Config ${pendingDeleteRunConfig.id?.slice(0, 6)}`}</span>
                                </div>
                                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
                                    Warning: deleting this run session config will delete all related run session data and tag mappings in the database.
                                    Download all run session data first.
                                </div>
                            </div>
                            <div className="px-4 py-3 border-t flex flex-wrap justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleDownloadRunSessionData(pendingDeleteRunConfig)}
                                    className="px-3 py-1.5 border rounded hover:bg-gray-50 text-sm"
                                    disabled={runConfigDeleteBusy}
                                >
                                    Download All Run Session Data
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowRunConfigDeleteModal(false);
                                        setPendingDeleteRunConfig(null);
                                    }}
                                    className="px-3 py-1.5 border rounded hover:bg-gray-50 text-sm"
                                    disabled={runConfigDeleteBusy}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleConfirmDeleteRunConfig}
                                    className="px-3 py-1.5 border rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 text-sm"
                                    disabled={runConfigDeleteBusy}
                                >
                                    {runConfigDeleteBusy ? "Deleting..." : "Delete Run Session Config"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {showRunDataDeleteModal && pendingRunDataDeleteConfig && (
                <div className="fixed inset-0 z-50">
                    <div
                        className="absolute inset-0 bg-black/35"
                        onClick={() => {
                            if (runDataDeleteBusy) return;
                            setShowRunDataDeleteModal(false);
                            setPendingRunDataDeleteConfig(null);
                        }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                        <div role="dialog" aria-modal="true" className="w-full max-w-lg bg-white rounded-lg shadow-lg border">
                            <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
                                <div className="font-medium">Delete Cloud Run Data</div>
                                <button
                                    type="button"
                                    className="px-2 py-1 border rounded hover:bg-gray-50 text-sm"
                                    onClick={() => {
                                        setShowRunDataDeleteModal(false);
                                        setPendingRunDataDeleteConfig(null);
                                    }}
                                    disabled={runDataDeleteBusy}
                                >
                                    Close
                                </button>
                            </div>
                            <div className="p-4 space-y-3">
                                <div className="text-sm text-gray-700">
                                    Target: <span className="font-semibold">{pendingRunDataDeleteConfig.name || `Run Session Config ${pendingRunDataDeleteConfig.id?.slice(0, 6)}`}</span>
                                </div>
                                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
                                    Warning: this will delete all run session cloud data for this config in the database.
                                    Download all run session data first.
                                    A CLEAR_ALL marker will be sent so stations clear local data on next sync.
                                </div>
                            </div>
                            <div className="px-4 py-3 border-t flex flex-wrap justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleDownloadRunSessionData(pendingRunDataDeleteConfig)}
                                    className="px-3 py-1.5 border rounded hover:bg-gray-50 text-sm"
                                    disabled={runDataDeleteBusy}
                                >
                                    Download All Run Session Data
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowRunDataDeleteModal(false);
                                        setPendingRunDataDeleteConfig(null);
                                    }}
                                    className="px-3 py-1.5 border rounded hover:bg-gray-50 text-sm"
                                    disabled={runDataDeleteBusy}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleConfirmDeleteCloudRunData}
                                    className="px-3 py-1.5 border rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 text-sm"
                                    disabled={runDataDeleteBusy}
                                >
                                    {runDataDeleteBusy ? "Deleting..." : "Delete cloud run data"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {showSessionDeleteModal && session && (
                <div className="fixed inset-0 z-50">
                    <div
                        className="absolute inset-0 bg-black/35"
                        onClick={() => {
                            if (sessionDeleteBusy) return;
                            setShowSessionDeleteModal(false);
                        }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                        <div role="dialog" aria-modal="true" className="w-full max-w-lg bg-white rounded-lg shadow-lg border">
                            <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
                                <div className="font-medium">Delete Session</div>
                                <button
                                    type="button"
                                    className="px-2 py-1 border rounded hover:bg-gray-50 text-sm"
                                    onClick={() => setShowSessionDeleteModal(false)}
                                    disabled={sessionDeleteBusy}
                                >
                                    Close
                                </button>
                            </div>
                            <div className="p-4 space-y-3">
                                <div className="text-sm text-gray-700">
                                    You are deleting: <span className="font-semibold">{session.title}</span>
                                </div>
                                <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
                                    This will permanently delete this session and related session data in the database.
                                </div>
                                <div className="text-sm text-gray-700">Data that will be deleted:</div>
                                <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
                                    <li>Run session configs and run events.</li>
                                    <li>Session roster, including house allocations.</li>
                                    <li>Session groups and group member allocations.</li>
                                    <li>NAPFA/IPPT score rows linked to this session.</li>
                                </ul>
                            </div>
                            <div className="px-4 py-3 border-t flex flex-wrap justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowSessionDeleteModal(false)}
                                    className="px-3 py-1.5 border rounded hover:bg-gray-50 text-sm"
                                    disabled={sessionDeleteBusy}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleConfirmDeleteSession}
                                    className="px-3 py-1.5 border rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 text-sm"
                                    disabled={sessionDeleteBusy}
                                >
                                    {sessionDeleteBusy ? "Deleting..." : "Delete Session"}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function ScoresPager({ total, page, pageSize, onPageChange }) {
    const totalPages = Math.max(1, Math.ceil((total || 0) / (pageSize || 1)));
    const cur = Math.min(page, totalPages);
    const start = total ? (cur - 1) * pageSize + 1 : 0;
    const end = Math.min(cur * pageSize, total);
    if (!total) return null;
    return (
        <div className="flex items-center justify-between px-3 py-2 border-t bg-gray-50 text-sm">
            <div>Showing {start}-{end} of {total}</div>
            <div className="flex items-center gap-2">
                <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={cur <= 1} onClick={() => onPageChange(cur - 1)}>Prev</button>
                <span className="text-gray-600">Page {cur} of {totalPages}</span>
                <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={cur >= totalPages} onClick={() => onPageChange(cur + 1)}>Next</button>
            </div>
        </div>
    );
}

function ScoreRowActions({ student, sessionId, canRecord, sessionCompleted, onBlocked, onSaved, isIppt3 }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button
                onClick={() => {
                    if (sessionCompleted) {
                        onBlocked && onBlocked();
                        return;
                    }
                    if (!canRecord) return;
                    setOpen(true);
                }}
                disabled={!canRecord && !sessionCompleted}
                className="px-3 py-1.5 border rounded hover:bg-gray-100 text-sm disabled:opacity-60"
            >
                Edit
            </button>
            {open && (
                <div className="fixed inset-0 z-40">
                    <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} aria-hidden="true" />
                    <div className="absolute inset-0 flex items-center justify-center p-4">
                        <div role="dialog" aria-modal="true" className="w-full max-w-2xl bg-white rounded-xl shadow-lg">
                            <div className="px-4 py-3 border-b flex items-center justify-between">
                                <div className="font-medium">Edit Scores - {student.name}</div>
                                <button className="text-gray-500 hover:text-gray-800" aria-label="Close" onClick={() => setOpen(false)}>Close</button>
                            </div>
                            <div className="p-4">
                                <AttemptEditor sessionId={sessionId} studentId={student.id} isIppt3={isIppt3} onSaved={() => { setOpen(false); onSaved && onSaved(); }} />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function ConfirmDialog({ open, title, message, confirmText, cancelText, tone, onCancel, onConfirm }) {
    if (!open) return null;
    const confirmClass = tone === "danger"
        ? "px-3 py-1.5 border rounded bg-red-600 text-white hover:bg-red-700"
        : "px-3 py-1.5 border rounded bg-blue-600 text-white hover:bg-blue-700";
    return (
        <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/35" onClick={onCancel} />
            <div className="absolute inset-0 flex items-center justify-center p-4">
                <div role="dialog" aria-modal="true" className="w-full max-w-md bg-white rounded-lg shadow-lg border">
                    <div className="px-4 py-3 border-b">
                        <div className="font-medium">{title}</div>
                    </div>
                    <div className="p-4 text-sm text-gray-700">{message}</div>
                    <div className="px-4 py-3 border-t flex justify-end gap-2">
                        <button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded hover:bg-gray-50">{cancelText || "Keep Editing"}</button>
                        <button type="button" onClick={onConfirm} className={confirmClass}>{confirmText || "Confirm"}</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function NoticeDialog({ open, title, message, onClose }) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50">
            <div className="absolute inset-0 bg-black/35" onClick={onClose} />
            <div className="absolute inset-0 flex items-center justify-center p-4">
                <div role="dialog" aria-modal="true" className="w-full max-w-md bg-white rounded-lg shadow-lg border">
                    <div className="px-4 py-3 border-b">
                        <div className="font-medium">{title}</div>
                    </div>
                    <div className="p-4 text-sm text-gray-700">{message}</div>
                    <div className="px-4 py-3 border-t flex justify-end">
                        <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded bg-blue-600 text-white hover:bg-blue-700">OK</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

 





















