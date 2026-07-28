/**
 * Guest/anonymous-session RLS proof — `pnpm --filter api guest:rls`.
 *
 * Complements rls-security-check.ts (which covers real authenticated users) by
 * exercising a Supabase NATIVE ANONYMOUS session against PostgREST with the anon
 * key + the guest's real JWT — exactly the credentials a guest browser holds.
 * Confirms the CLAUDE.md claim that "no policy references is_anonymous, so the
 * existing authenticated-role policies apply to guests uniformly" is TRUE in
 * practice, not just by inspection.
 *
 * Requires anonymous sign-ins enabled on the project. If they're off, it prints
 * a clear notice and exits 0 (so it never blocks CI before the toggle is on).
 *
 * Cleanup deletes ONLY the exact rows/users this run created, by captured id.
 */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function must(name: string, v: string | undefined): string {
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}
const url = must("SUPABASE_URL", process.env.SUPABASE_URL);
const serviceKey = must("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
const anonKey = must("VITE_SUPABASE_ANON_KEY", process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY);
const apiUrl = (process.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let passes = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

async function main() {
  // 1. Create a real anonymous (guest) session — the toggle gate.
  const guestClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: anonData, error: anonErr } = await guestClient.auth.signInAnonymously();
  if (anonErr || !anonData.user || !anonData.session) {
    console.log(
      `\n[SKIP] Anonymous sign-ins are not enabled on this project (${anonErr?.message ?? "no session"}).\n` +
        `       Enable Authentication → Sign In / Providers → Anonymous Sign-Ins, then re-run.\n`,
    );
    process.exit(0);
  }
  const guestId = anonData.user.id;
  const guestToken = anonData.session.access_token;
  console.log(`\nGuest session created: ${guestId} (is_anonymous=${anonData.user.is_anonymous})\n`);

  // A throwaway REAL user B + a seeded attempt row we assert the guest cannot see.
  const bEmail = `guest-rls-b-${crypto.randomUUID()}@example.com`;
  const { data: bData, error: bErr } = await admin.auth.admin.createUser({
    email: bEmail,
    password: `Pw-${crypto.randomUUID()}`,
    email_confirm: true,
  });
  if (bErr || !bData.user) throw new Error(`create user B failed: ${bErr?.message}`);
  const bId = bData.user.id;
  const { data: bAttempt, error: bAttErr } = await admin
    .from("attempts")
    .insert({ user_id: bId })
    .select("id")
    .single();
  if (bAttErr || !bAttempt) throw new Error(`seed B attempt failed: ${bAttErr?.message}`);
  const bAttemptId = bAttempt.id as string;

  let guestAttemptId: string | null = null;
  try {
    // 2. The trigger (0104) provisioned a FREE, no-trial profile for this guest.
    const prof = await guestClient
      .from("users_profile")
      .select("plan, has_used_trial, plan_expires_at")
      .eq("id", guestId)
      .maybeSingle();
    check(
      "guest profile is free / no-trial (0104 trigger fired on a real anon signup)",
      prof.data?.plan === "free" && prof.data?.has_used_trial === false && prof.data?.plan_expires_at === null,
      JSON.stringify(prof.data),
    );

    // 3. Content read — a guest can read public/published content.
    const nodes = await guestClient.from("syllabus_nodes").select("id").limit(1);
    check("guest CAN read public content (syllabus_nodes)", !nodes.error && (nodes.data?.length ?? 0) >= 1, nodes.error?.message);
    const q = await guestClient.from("questions").select("id").limit(1);
    check("guest CAN read published questions", !q.error, q.error?.message);

    // 4. Own-row insert + read (owner policies apply to the guest's authenticated role).
    const ins = await guestClient.from("attempts").insert({ user_id: guestId }).select("id").single();
    check("guest CAN insert its OWN attempt", !ins.error && !!ins.data, ins.error?.message);
    guestAttemptId = (ins.data?.id as string) ?? null;
    if (guestAttemptId) {
      const own = await guestClient.from("attempts").select("id").eq("id", guestAttemptId);
      check("guest CAN read back its own attempt", !own.error && own.data?.length === 1, own.error?.message);
    }

    // 5. Isolation — the guest cannot see or write another user's rows.
    const cross = await guestClient.from("attempts").select("id").eq("id", bAttemptId);
    check("guest CANNOT read user B's attempt (explicit id)", !cross.error && (cross.data?.length ?? 0) === 0);
    const all = await guestClient.from("attempts").select("id");
    check(
      "guest's unfiltered attempts select excludes B's row",
      !all.error && !(all.data ?? []).some((r) => r.id === bAttemptId),
    );
    const forge = await guestClient.from("attempts").insert({ user_id: bId }).select("id");
    check("guest CANNOT insert a row owned by user B (with_check)", !!forge.error, forge.error ? "" : "insert unexpectedly succeeded");

    // 6. Content is read-only for the guest (no write policy → RLS denies).
    const write = await guestClient
      .from("syllabus_nodes")
      .insert({ paper_code: "PRE_GS1", path: `guest-rls-${crypto.randomUUID()}`, depth: 0, title_i18n: { hi: "x", en: "x" } })
      .select("id");
    check("guest CANNOT write content tables (RLS-denied)", !!write.error, write.error ? "" : "write unexpectedly succeeded");

    // 7. The API path treats the guest as a guest (JWT verified, is_guest true).
    const res = await fetch(`${apiUrl}/api/v1/entitlements`, { headers: { Authorization: `Bearer ${guestToken}` } });
    const body = (await res.json()) as { data?: { is_guest?: boolean; plan?: string; is_on_trial?: boolean } };
    check(
      "API /entitlements: guest token → is_guest true, free, no trial",
      res.ok && body.data?.is_guest === true && body.data?.plan === "free" && body.data?.is_on_trial === false,
      JSON.stringify(body.data),
    );
  } finally {
    // Cleanup by explicit captured ids only. (PostgREST builders are thenable
    // but have no .catch — await them inside try/catch, don't chain .catch.)
    try {
      if (guestAttemptId) await admin.from("attempts").delete().eq("id", guestAttemptId);
      await admin.from("attempts").delete().eq("id", bAttemptId);
      // deleteUser does not cascade users_profile (known gotcha) — remove both.
      await admin.from("users_profile").delete().in("id", [guestId, bId]);
      await admin.auth.admin.deleteUser(guestId);
      await admin.auth.admin.deleteUser(bId);
    } catch (e) {
      console.error("cleanup warning:", e instanceof Error ? e.message : e);
    }
  }

  console.log(`\n=== ${passes} passed, ${failures} failed ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
