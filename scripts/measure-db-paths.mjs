#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith("--")) {
      out[key] = "true";
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

const cliArgs = parseArgs(process.argv.slice(2));

function env(name, fallback = null) {
  const cliKey = name
    .toLowerCase()
    .replace(/^perf_/, "")
    .replace(/_/g, "-");
  if (cliArgs[cliKey] != null) return cliArgs[cliKey];
  return process.env[name] ?? fallback;
}

function requiredEnv(name) {
  const value = env(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function numberEnv(name, fallback) {
  const raw = env(name);
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function boolEnv(name, fallback = false) {
  const raw = String(env(name, fallback ? "true" : "false")).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] == null) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function summarizeDurations(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    count: sorted.length,
    min_ms: sorted[0] ?? null,
    mean_ms: sorted.length ? sum / sorted.length : null,
    p50_ms: quantile(sorted, 0.5),
    p95_ms: quantile(sorted, 0.95),
    max_ms: sorted[sorted.length - 1] ?? null,
  };
}

function formatError(error) {
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.stack || error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const parts = [];
    if (error.message) parts.push(String(error.message));
    if (error.code) parts.push(`code=${error.code}`);
    if (error.details) parts.push(`details=${error.details}`);
    if (error.hint) parts.push(`hint=${error.hint}`);
    if (error.error_description) parts.push(`description=${error.error_description}`);
    if (parts.length) return parts.join(" | ");
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function repoRoot() {
  return process.cwd();
}

function timestampSlug() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

async function timed(name, fn) {
  const started = nowMs();
  try {
    const result = await fn();
    return {
      name,
      ok: true,
      duration_ms: nowMs() - started,
      result,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      duration_ms: nowMs() - started,
      error: formatError(error),
    };
  }
}

function makeSupabaseClient() {
  const url = requiredEnv("PERF_SUPABASE_URL") || env("VITE_SUPABASE_URL");
  const anonKey = requiredEnv("PERF_SUPABASE_ANON_KEY") || env("VITE_SUPABASE_ANON_KEY");
  const accessToken = requiredEnv("PERF_ACCESS_TOKEN");

  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

async function maybeSingleOrThrow(queryPromise) {
  const { data, error } = await queryPromise;
  if (error) throw error;
  return data;
}

async function runConcurrent(times, concurrency, worker) {
  const results = [];
  let cursor = 0;

  async function runner() {
    while (cursor < times) {
      const current = cursor++;
      // eslint-disable-next-line no-await-in-loop
      results[current] = await worker(current);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, times) }, () => runner());
  await Promise.all(runners);
  return results;
}

async function benchmarkAddAttemptRead(client, sessionId, studentId) {
  return timed("add_attempt_read_score_row", async () => {
    const { data, error } = await client
      .from("scores")
      .select("situps,pullups,broad_jump,sit_and_reach,shuttle_run,run_2400")
      .eq("session_id", sessionId)
      .eq("student_id", studentId)
      .maybeSingle();
    if (error) throw error;
    return { has_row: !!data };
  });
}

async function benchmarkAddAttemptWrite(client, sessionId, studentId, iteration) {
  const situps = 20 + (iteration % 10);
  return timed("add_attempt_write_situps", async () => {
    const { error } = await client
      .from("scores")
      .upsert([{ session_id: sessionId, student_id: studentId, situps }], { onConflict: "session_id,student_id" });
    if (error) throw error;
    return { situps };
  });
}

async function benchmarkAddAttemptReadback(client, sessionId, studentId) {
  return timed("add_attempt_readback_score_row", async () => {
    const { data, error } = await client
      .from("scores")
      .select("situps,pullups,broad_jump,sit_and_reach,shuttle_run,run_2400")
      .eq("session_id", sessionId)
      .eq("student_id", studentId)
      .maybeSingle();
    if (error) throw error;
    return { has_row: !!data };
  });
}

async function benchmarkGroupSave(client, sessionId, studentIds, stationKey, iteration) {
  const payload = studentIds.map((studentId, index) => ({
    session_id: sessionId,
    student_id: studentId,
    [stationKey]: 10 + ((iteration + index) % 15),
  }));
  return timed(`group_save_${stationKey}`, async () => {
    const { error } = await client
      .from("scores")
      .upsert(payload, { onConflict: "session_id,student_id" });
    if (error) throw error;
    return { rows: payload.length };
  });
}

async function benchmarkGroupExistingScoresRead(client, sessionId, studentIds) {
  return timed("group_read_existing_scores", async () => {
    const { data, error } = await client
      .from("scores")
      .select("student_id,situps,broad_jump,sit_and_reach,pullups,shuttle_run,run_2400")
      .eq("session_id", sessionId)
      .in("student_id", studentIds);
    if (error) throw error;
    return { rows: (data || []).length };
  });
}

async function benchmarkChallengeHubRefresh(client, sessionId) {
  return timed("challenge_hub_refresh_scores_map", async () => {
    const { data, error } = await client
      .from("scores")
      .select("student_id,situps,broad_jump,sit_and_reach,pullups,shuttle_run,run_2400")
      .eq("session_id", sessionId);
    if (error) throw error;
    return { rows: (data || []).length };
  });
}

async function benchmarkViewScore(client, studentIdentifier) {
  return timed("view_score_search", async () => {
    const student = await maybeSingleOrThrow(
      client
        .from("students")
        .select("id,student_identifier,name,gender,dob")
        .eq("student_identifier", studentIdentifier)
        .maybeSingle()
    );

    if (!student?.id) return { found: false, napfa_rows: 0, ippt3_rows: 0 };

    const [{ data: scoreRows, error: scoreErr }, { data: ipptRows, error: ipptErr }] = await Promise.all([
      client
        .from("scores")
        .select("id,test_date,created_at,situps,shuttle_run,sit_and_reach,pullups,run_2400,broad_jump,sessions!fk_scores_session!inner(session_date,schools:school_id(type))")
        .eq("student_id", student.id)
        .eq("sessions.status", "active")
        .order("test_date", { ascending: false }),
      client
        .from("ippt3_scores")
        .select("id,situps,pushups,run_2400,inserted_at,updated_at,sessions:session_id!inner(session_date,schools:school_id(type))")
        .eq("student_id", student.id)
        .eq("sessions.status", "active"),
    ]);

    if (scoreErr) throw scoreErr;
    if (ipptErr) throw ipptErr;

    return {
      found: true,
      napfa_rows: (scoreRows || []).length,
      ippt3_rows: (ipptRows || []).length,
    };
  });
}

async function main() {
  const client = makeSupabaseClient();
  const sessionId = requiredEnv("PERF_SESSION_ID");
  const writeStudentId = requiredEnv("PERF_WRITE_STUDENT_ID");
  const viewScoreIdentifiers = splitCsv(requiredEnv("PERF_VIEW_SCORE_IDENTIFIERS"));
  const groupStudentIds = splitCsv(requiredEnv("PERF_GROUP_STUDENT_IDS"));
  const writeOk = boolEnv("PERF_ENABLE_WRITES", false);
  const concurrency = numberEnv("PERF_CONCURRENCY", 1);
  const addAttemptWriteCount = numberEnv("PERF_ADD_ATTEMPT_WRITES", 20);
  const groupSaveCount = numberEnv("PERF_GROUP_SAVE_ROUNDS", 10);
  const challengeRefreshCount = numberEnv("PERF_CHALLENGE_REFRESHES", 10);
  const viewScoreCount = numberEnv("PERF_VIEW_SCORE_COUNT", viewScoreIdentifiers.length);

  const report = {
    captured_at: new Date().toISOString(),
    config: {
      session_id: sessionId,
      write_student_id: writeStudentId,
      group_student_count: groupStudentIds.length,
      view_score_identifiers: viewScoreIdentifiers,
      writes_enabled: writeOk,
      concurrency,
      add_attempt_writes: addAttemptWriteCount,
      group_save_rounds: groupSaveCount,
      challenge_refreshes: challengeRefreshCount,
      view_score_count: viewScoreCount,
    },
    operations: {},
  };

  const addAttemptRead = await benchmarkAddAttemptRead(client, sessionId, writeStudentId);
  report.operations.add_attempt_read = addAttemptRead;

  if (writeOk) {
    const writeResults = await runConcurrent(addAttemptWriteCount, concurrency, async (iteration) => {
      const write = await benchmarkAddAttemptWrite(client, sessionId, writeStudentId, iteration);
      const readback = await benchmarkAddAttemptReadback(client, sessionId, writeStudentId);
      return { write, readback };
    });

    const writeDurations = writeResults.filter((x) => x.write.ok).map((x) => x.write.duration_ms);
    const readbackDurations = writeResults.filter((x) => x.readback.ok).map((x) => x.readback.duration_ms);
    report.operations.add_attempt_write = {
      samples: writeResults,
      write_summary: summarizeDurations(writeDurations),
      readback_summary: summarizeDurations(readbackDurations),
      failures: writeResults.filter((x) => !x.write.ok || !x.readback.ok).length,
    };

    if (groupStudentIds.length) {
      const groupReadSamples = [];
      const groupWriteSamples = [];
      for (let i = 0; i < groupSaveCount; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        groupReadSamples.push(await benchmarkGroupExistingScoresRead(client, sessionId, groupStudentIds));
        // eslint-disable-next-line no-await-in-loop
        groupWriteSamples.push(await benchmarkGroupSave(client, sessionId, groupStudentIds, "situps", i));
      }
      report.operations.group_save = {
        read_samples: groupReadSamples,
        write_samples: groupWriteSamples,
        read_summary: summarizeDurations(groupReadSamples.filter((x) => x.ok).map((x) => x.duration_ms)),
        write_summary: summarizeDurations(groupWriteSamples.filter((x) => x.ok).map((x) => x.duration_ms)),
      };
    }
  }

  const challengeSamples = [];
  for (let i = 0; i < challengeRefreshCount; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    challengeSamples.push(await benchmarkChallengeHubRefresh(client, sessionId));
  }
  report.operations.challenge_hub_refresh = {
    samples: challengeSamples,
    summary: summarizeDurations(challengeSamples.filter((x) => x.ok).map((x) => x.duration_ms)),
  };

  const targetIdentifiers = viewScoreIdentifiers.slice(0, viewScoreCount);
  const viewSamples = [];
  for (const identifier of targetIdentifiers) {
    // eslint-disable-next-line no-await-in-loop
    viewSamples.push(await benchmarkViewScore(client, identifier));
  }
  report.operations.view_score = {
    samples: viewSamples,
    summary: summarizeDurations(viewSamples.filter((x) => x.ok).map((x) => x.duration_ms)),
  };

  const outDir = path.join(repoRoot(), "scripts", "perf-results");
  ensureDir(outDir);
  const outFile = path.join(outDir, `db-perf-${timestampSlug()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");

  const concise = {
    output_file: outFile,
    add_attempt_read_ms: report.operations.add_attempt_read.duration_ms,
    add_attempt_write_summary: report.operations.add_attempt_write?.write_summary || null,
    group_save_summary: report.operations.group_save?.write_summary || null,
    challenge_hub_refresh_summary: report.operations.challenge_hub_refresh.summary,
    view_score_summary: report.operations.view_score.summary,
  };

  console.log(JSON.stringify(concise, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
