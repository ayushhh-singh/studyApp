/**
 * RLS / auth security check.
 *
 * Proves — against the REAL cloud database — that the strict RLS policies from
 * migration 0053 actually isolate users. It creates two throwaway auth users,
 * seeds one row for each in the user-scoped tables, then, using the ANON key +
 * each user's real JWT (exactly what the browser holds), asserts that:
 *
 *   1. A signed-in user sees ONLY their own rows in attempts, answer_submissions,
 *      srs_cards, and mentor_insights — never the other user's, anywhere.
 *   2. A signed-in user cannot INSERT a row owned by someone else.
 *   3. An anon (no session) client cannot read any user rows, but CAN read
 *      published content (syllabus) — the intended public-read surface.
 *   4. Storage: a user can write/read only under their own `<uid>/` folder in
 *      the private answer-images bucket, and cannot upload into or sign another
 *      user's folder.
 *   5. The API rejects requests with a missing/garbage JWT (401) and accepts a
 *      valid one, and the issued token carries the `authenticated` audience and
 *      an expiry that jwt.ts verifies. (Best-effort: skipped if the API on
 *      VITE_API_URL isn't running.)
 *
 * Run:  pnpm --filter api security:rls
 * Cleans up both users (cascade removes every seeded row) + storage objects.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = must("SUPABASE_URL", process.env.SUPABASE_URL);
const serviceKey = must("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
const anonKey = must(
  "VITE_SUPABASE_ANON_KEY",
  process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY,
);
const apiUrl = (process.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

function must(name: string, v: string | undefined): string {
  if (!v) throw new Error(`Missing ${name} in env (run via the security:rls pnpm script so both env files load)`);
  return v;
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

interface TestUser {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient; // anon-key client, signed in as this user
}

async function createUser(tag: string): Promise<TestUser> {
  const email = `rls-check-${tag}-${Date.now()}-${Math.floor(performance.now())}@example.test`;
  const password = `Pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser(${tag}) failed: ${error?.message}`);
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session) throw new Error(`signIn(${tag}) failed: ${signIn.error?.message}`);
  return { id: data.user.id, email, password, client };
}

/** Seed one row per user-scoped table for a user, via the service role (bypasses RLS). */
async function seed(userId: string) {
  const rows = [
    admin.from("attempts").insert({ user_id: userId }),
    admin.from("answer_submissions").insert({
      user_id: userId,
      mode: "typed",
      language: "en",
      typed_text: "rls probe",
      custom_question_text_i18n: { hi: "", en: "probe question" },
    }),
    admin.from("srs_cards").insert({
      user_id: userId,
      front_i18n: { hi: "", en: "front" },
      back_i18n: { hi: "", en: "back" },
      source_type: "manual",
    }),
    admin.from("mentor_insights").insert({
      user_id: userId,
      kind: "test",
      insight_i18n: { hi: "", en: "insight" },
      dedupe_key: `rls-probe-${crypto.randomUUID()}`,
    }),
  ];
  for (const r of rows) {
    const { error } = await r;
    if (error) throw new Error(`seed failed for ${userId}: ${error.message}`);
  }
}

const USER_TABLES = ["attempts", "answer_submissions", "srs_cards", "mentor_insights"] as const;

async function main() {
  console.log("\n=== RLS / auth security check (two users, anon key + real JWTs) ===\n");

  const a = await createUser("a");
  const b = await createUser("b");
  const uploaded: string[] = [];
  try {
    await seed(a.id);
    await seed(b.id);

    // ---- 1. Cross-user read isolation --------------------------------------
    console.log("1. A cannot read B's rows; sees only its own:");
    for (const table of USER_TABLES) {
      // Unfiltered select as user A — RLS must restrict to A's rows.
      const all = await a.client.from(table).select("id,user_id");
      const rowsA = all.data ?? [];
      const sawB = rowsA.some((r) => (r as { user_id: string }).user_id === b.id);
      const sawOwn = rowsA.some((r) => (r as { user_id: string }).user_id === a.id);
      check(`${table}: A's unfiltered select excludes B's rows`, !all.error && !sawB, all.error?.message);
      check(`${table}: A can see its own row`, sawOwn);

      // Explicitly target B's id — RLS must still return nothing.
      const targeted = await a.client.from(table).select("id").eq("user_id", b.id);
      check(`${table}: A querying B's user_id returns 0 rows`, !targeted.error && (targeted.data?.length ?? 0) === 0);
    }

    // ---- 2. Cannot insert rows owned by another user -----------------------
    console.log("2. A cannot insert a row owned by B:");
    const badInsert = await a.client.from("srs_cards").insert({
      user_id: b.id,
      front_i18n: { hi: "", en: "x" },
      back_i18n: { hi: "", en: "y" },
      source_type: "manual",
    });
    check("srs_cards: insert with user_id=B is rejected by RLS", badInsert.error !== null, "insert unexpectedly succeeded");

    // ---- 3. Anon (no session) is blocked from user data, allowed content ----
    console.log("3. Anon (no JWT) cannot read user data but can read content:");
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    for (const table of USER_TABLES) {
      const res = await anon.from(table).select("id");
      check(`${table}: anon select returns 0 rows`, !res.error && (res.data?.length ?? 0) === 0, res.error?.message);
    }
    const syllabus = await anon.from("syllabus_nodes").select("id").limit(1);
    check("syllabus_nodes: anon CAN read public content", !syllabus.error && (syllabus.data?.length ?? 0) > 0, syllabus.error?.message);

    // ---- 4. Storage per-user folder isolation ------------------------------
    console.log("4. Storage answer-images per-user folder:");
    const bucket = "answer-images";
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    const ownPath = `${a.id}/probe-${crypto.randomUUID()}.png`;
    const ownUpload = await a.client.storage.from(bucket).upload(ownPath, png, { contentType: "image/png" });
    check("A can upload into its own folder", ownUpload.error === null, ownUpload.error?.message);
    if (ownUpload.error === null) uploaded.push(ownPath);

    const crossPath = `${b.id}/probe-${crypto.randomUUID()}.png`;
    const crossUpload = await a.client.storage.from(bucket).upload(crossPath, png, { contentType: "image/png" });
    check("A CANNOT upload into B's folder", crossUpload.error !== null, "cross-folder upload unexpectedly succeeded");
    if (crossUpload.error === null) uploaded.push(crossPath);

    // Seed an object in B's folder via service role, then confirm A can't sign it.
    const bObject = `${b.id}/owned-${crypto.randomUUID()}.png`;
    const bUp = await admin.storage.from(bucket).upload(bObject, png, { contentType: "image/png" });
    if (bUp.error === null) uploaded.push(bObject);
    const crossSign = await a.client.storage.from(bucket).createSignedUrl(bObject, 60);
    check("A CANNOT create a signed URL for B's object", crossSign.error !== null || !crossSign.data, "cross-folder sign unexpectedly succeeded");

    // ---- 5. API JWT enforcement (best-effort) ------------------------------
    console.log("5. API JWT audience/expiry enforcement:");
    const token = (await a.client.auth.getSession()).data.session?.access_token ?? "";
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64").toString("utf8"));
    check("issued token audience is 'authenticated'", claims.aud === "authenticated", `aud=${claims.aud}`);
    check("issued token has a future expiry", typeof claims.exp === "number" && claims.exp * 1000 > Date.now());

    const reachable = await fetch(`${apiUrl}/api/v1/health`).then((r) => r.ok).catch(() => false);
    if (!reachable) {
      console.log(`  … API not reachable at ${apiUrl} — skipping live 401/200 checks (jwt.ts enforces aud+exp via jose).`);
    } else {
      const noTok = await fetch(`${apiUrl}/api/v1/profile`);
      check("API rejects missing token with 401", noTok.status === 401, `got ${noTok.status}`);
      const badTok = await fetch(`${apiUrl}/api/v1/profile`, { headers: { authorization: "Bearer not.a.jwt" } });
      check("API rejects garbage token with 401", badTok.status === 401, `got ${badTok.status}`);
      const goodTok = await fetch(`${apiUrl}/api/v1/profile`, { headers: { authorization: `Bearer ${token}` } });
      check("API accepts a valid token (2xx)", goodTok.ok, `got ${goodTok.status}`);
    }
  } finally {
    // Cleanup: remove uploaded objects, then delete both auth users (cascade
    // removes their profile + every seeded row).
    if (uploaded.length) await admin.storage.from("answer-images").remove(uploaded).catch(() => {});
    await admin.auth.admin.deleteUser(a.id).catch(() => {});
    await admin.auth.admin.deleteUser(b.id).catch(() => {});
  }

  console.log(`\n=== ${passes} passed, ${failures} failed ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nsecurity check crashed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
