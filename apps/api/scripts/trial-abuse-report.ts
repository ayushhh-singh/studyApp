/**
 * trial-abuse:report — a coarse, MANUAL-REVIEW-ONLY signal for trial abuse.
 *
 * Surfaces IP-hash clusters: coarse salted hashes shared by 2+ distinct accounts
 * whose trial-starts fall within a short window. This is a lead for a human to
 * look at, NOT an auto-block — a shared hostel/college/CGNAT IP will legitimately
 * host many real aspirants, so nothing here restricts anyone.
 *
 *   pnpm trial-abuse:report [--days N] [--window-hours H] [--min-accounts K]
 *
 *   --days          lookback for trial_starts to consider   (default 30)
 *   --window-hours  max span within a cluster to flag        (default 48)
 *   --min-accounts  distinct accounts on one hash to flag    (default 2)
 */
import { supabase } from "../src/lib/supabase.js";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) {
    const v = Number(process.argv[i + 1]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return fallback;
}

interface Row {
  user_id: string;
  ip_hash: string | null;
  created_at: string;
}

async function main() {
  const days = arg("days", 30);
  const windowHours = arg("window-hours", 48);
  const minAccounts = arg("min-accounts", 2);
  const sinceIso = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const { data, error } = await supabase()
    .from("trial_starts")
    .select("user_id, ip_hash, created_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });
  if (error) {
    console.error(`trial_starts query failed: ${error.message}`);
    process.exit(1);
  }
  const rows = (data ?? []) as Row[];

  const byHash = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.ip_hash) continue; // no IP captured → nothing to cluster on
    (byHash.get(r.ip_hash) ?? byHash.set(r.ip_hash, []).get(r.ip_hash)!).push(r);
  }

  const windowMs = windowHours * 3600 * 1000;
  interface Cluster {
    ipHash: string;
    users: string[];
    spanHours: number;
    first: string;
    last: string;
  }
  const clusters: Cluster[] = [];
  for (const [ipHash, group] of byHash) {
    const users = [...new Set(group.map((g) => g.user_id))];
    if (users.length < minAccounts) continue;
    const times = group.map((g) => Date.parse(g.created_at)).sort((a, b) => a - b);
    const span = times[times.length - 1]! - times[0]!;
    if (span > windowMs) continue; // spread out over months → not a burst
    clusters.push({
      ipHash,
      users,
      spanHours: Math.round((span / 3600000) * 10) / 10,
      first: new Date(times[0]!).toISOString(),
      last: new Date(times[times.length - 1]!).toISOString(),
    });
  }
  clusters.sort((a, b) => b.users.length - a.users.length);

  console.log(
    `\nTrial-abuse report — last ${days}d, clusters of ≥${minAccounts} accounts sharing an IP hash within ${windowHours}h.`,
  );
  console.log(`Reviewed ${rows.length} trial-start rows across ${byHash.size} distinct IP hashes.\n`);

  if (clusters.length === 0) {
    console.log("No clusters flagged. (Manual review only — nothing is auto-blocked.)\n");
    return;
  }

  for (const c of clusters) {
    console.log(`⚑ ip_hash ${c.ipHash} — ${c.users.length} accounts, span ${c.spanHours}h (${c.first} → ${c.last})`);
    for (const u of c.users) console.log(`    ${u}`);
    console.log("");
  }
  console.log(`${clusters.length} cluster(s) flagged for manual review — no action taken automatically.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
