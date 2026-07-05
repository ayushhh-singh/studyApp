/**
 * Content acquisition for PrayasUP.
 *
 *   pnpm content:fetch
 *
 * Reads /content-sources.yaml and downloads every listed source into
 * /content-raw/<section>/<id>.pdf, maintaining /content-raw/manifest.json.
 *
 * Design goals (see /docs/content-pipeline.md):
 *  - Polite: one request per 2s, realistic User-Agent, 3 retries w/ backoff.
 *  - Session-aware: many uppsc.up.nic.in URLs 302 to the homepage unless a
 *    session cookie exists. Entries can declare `warmup`/`referer`/`needs_cookie`
 *    so we do the ASP.NET cookie handshake first, per host.
 *  - Validated: %PDF magic bytes + a real page count via pdf-parse. HTML error
 *    pages saved as .pdf are rejected.
 *  - Idempotent + resumable: an unchanged sha256 (file already on disk, still
 *    valid, matching the manifest) is skipped, so a re-run only fetches the
 *    missing/failed ones.
 *  - Hand-dropped files are first-class: any PDF you drop into /content-raw is
 *    validated + checksummed into the manifest on the next run.
 *
 * No network secrets required — this only touches public URLs.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import yaml from "js-yaml";
import { PDFParse } from "pdf-parse";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
// Paths are overridable via env so the pipeline can be exercised in isolation
// (edge-case tests, alternate content roots) without touching committed data.
const SOURCES_YAML = process.env.CONTENT_SOURCES_YAML
  ? resolve(process.env.CONTENT_SOURCES_YAML)
  : join(ROOT, "content-sources.yaml");
const CONTENT_RAW = process.env.CONTENT_RAW_DIR
  ? resolve(process.env.CONTENT_RAW_DIR)
  : join(ROOT, "content-raw");
const MANIFEST_PATH = join(CONTENT_RAW, "manifest.json");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const REQUEST_SPACING_MS = Number(process.env.CONTENT_SPACING_MS ?? 2000); // 1 req / 2s
const REQUEST_TIMEOUT_MS = Number(process.env.CONTENT_TIMEOUT_MS ?? 60_000);
const MAX_RETRIES = 3;
const FETCHABLE_SECTIONS = new Set([
  "syllabus",
  "pyq_prelims",
  "pyq_mains",
  "answer_key",
]);

// ---------- types ----------
interface Source {
  id: string;
  section: string;
  url: string;
  lang?: "hi" | "en" | "both";
  year?: number | null;
  paper?: string | null;
  notes?: string;
  /** URL to GET first (same cookie jar) to establish a session before `url`. */
  warmup?: string;
  /** Referer header to send when fetching `url`. */
  referer?: string;
  /** If true, ensure the host is warmed up before fetching. */
  needs_cookie?: boolean;
}

interface SourcesFile {
  verified?: Source[];
  needs_my_approval?: unknown[];
}

interface ManifestEntry {
  id: string;
  section: string;
  url: string;
  path: string; // relative to repo root
  sha256: string | null;
  bytes: number | null;
  pages: number | null;
  fetched_at: string;
  status: "ok" | "failed" | "manual" | "orphan";
  origin: "download" | "manual";
  error?: string;
}

// ---------- small utils ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

/** fetch() with a hard timeout so a hanging server can't stall the whole run. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function isPdf(buf: Buffer): boolean {
  // %PDF magic bytes, allowing a small leading BOM/whitespace some servers add.
  const head = buf.subarray(0, 1024).toString("latin1");
  return head.includes("%PDF-");
}

async function pdfPageCount(buf: Buffer): Promise<number> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const info = await parser.getInfo();
    return info.total;
  } finally {
    await parser.destroy().catch(() => {});
  }
}

// ---------- cookie jar (per host) ----------
const cookieJar = new Map<string, Map<string, string>>();

function hostOf(url: string): string {
  return new URL(url).host;
}

function storeSetCookies(url: string, res: Response): void {
  const host = hostOf(url);
  // undici (Node fetch) exposes getSetCookie(); fall back to single header.
  const raw: string[] =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] })
      .getSetCookie === "function"
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie") as string]
        : [];
  if (raw.length === 0) return;
  const jar = cookieJar.get(host) ?? new Map<string, string>();
  for (const line of raw) {
    const pair = line.split(";", 1)[0]?.trim();
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  cookieJar.set(host, jar);
}

function cookieHeader(url: string): string | undefined {
  const jar = cookieJar.get(hostOf(url));
  if (!jar || jar.size === 0) return undefined;
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

const warmedHosts = new Set<string>();

/** Establish a session cookie by GETting the warmup URL (or host homepage). */
async function warmup(source: Source): Promise<void> {
  const target = source.warmup ?? new URL(source.url).origin + "/";
  const host = hostOf(target);
  const key = `${host}|${source.warmup ?? ""}`;
  if (warmedHosts.has(key)) return;
  try {
    const res = await fetchWithTimeout(target, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
      redirect: "follow",
    });
    storeSetCookies(target, res);
    await res.arrayBuffer().catch(() => {}); // drain
    warmedHosts.add(key);
    await sleep(REQUEST_SPACING_MS);
  } catch (err) {
    // Non-fatal: the real fetch may still work; record nothing here.
    warmedHosts.add(key);
  }
}

// ---------- download with retries ----------
async function downloadOnce(source: Source): Promise<Buffer> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/pdf,*/*",
  };
  const cookie = cookieHeader(source.url);
  if (cookie) headers["Cookie"] = cookie;
  if (source.referer) headers["Referer"] = source.referer;

  const res = await fetchWithTimeout(source.url, { headers, redirect: "follow" });
  storeSetCookies(source.url, res);

  const ct = res.headers.get("content-type") ?? "";
  const buf = Buffer.from(await res.arrayBuffer());

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} (${buf.length} bytes)`);
  }
  if (buf.length === 0) throw new Error("empty response body");
  if (!isPdf(buf)) {
    const looksHtml = /text\/html|<html|<!doctype/i.test(
      ct + buf.subarray(0, 256).toString("latin1"),
    );
    throw new Error(
      looksHtml
        ? `served HTML, not a PDF (content-type: ${ct || "?"}) — likely a session redirect`
        : `not a PDF (content-type: ${ct || "?"}, first bytes: ${JSON.stringify(
            buf.subarray(0, 8).toString("latin1"),
          )})`,
    );
  }
  return buf;
}

async function downloadWithRetries(source: Source): Promise<Buffer> {
  if (source.needs_cookie || source.warmup) await warmup(source);

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await downloadOnce(source);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        const backoff = REQUEST_SPACING_MS * 2 ** (attempt - 1); // 2s, 4s, 8s
        console.log(
          `    retry ${attempt}/${MAX_RETRIES - 1} after ${backoff}ms — ${
            (err as Error).message
          }`,
        );
        // A session redirect often clears after re-warming.
        if (
          /session redirect|HTML/i.test((err as Error).message) &&
          (source.needs_cookie || source.warmup)
        ) {
          warmedHosts.clear();
          cookieJar.delete(hostOf(source.url));
          await warmup(source);
        }
        await sleep(backoff);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---------- manifest ----------
async function loadManifest(): Promise<Map<string, ManifestEntry>> {
  if (!existsSync(MANIFEST_PATH)) return new Map();
  try {
    const raw = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as ManifestEntry[];
    return new Map(raw.map((e) => [e.id, e]));
  } catch {
    return new Map();
  }
}

async function saveManifest(entries: Map<string, ManifestEntry>): Promise<void> {
  const sorted = [...entries.values()].sort((a, b) => {
    if (a.section !== b.section) return a.section.localeCompare(b.section);
    return a.id.localeCompare(b.id);
  });
  await writeFile(MANIFEST_PATH, JSON.stringify(sorted, null, 2) + "\n");
}

/** Validate an on-disk file and return a fresh manifest entry, or null if invalid. */
async function inspectFile(
  path: string,
): Promise<{ sha256: string; bytes: number; pages: number } | null> {
  const buf = await readFile(path);
  if (!isPdf(buf)) return null;
  try {
    const pages = await pdfPageCount(buf);
    return { sha256: sha256(buf), bytes: buf.length, pages };
  } catch {
    return null;
  }
}

// ---------- main ----------
async function main() {
  if (!existsSync(SOURCES_YAML)) {
    console.error(`Missing ${relative(ROOT, SOURCES_YAML)}`);
    process.exit(1);
  }
  let doc: SourcesFile;
  try {
    doc = (yaml.load(await readFile(SOURCES_YAML, "utf8")) ?? {}) as SourcesFile;
  } catch (err) {
    console.error(`Malformed YAML in ${relative(ROOT, SOURCES_YAML)}: ${(err as Error).message}`);
    process.exit(1);
  }
  const verified = doc.verified ?? [];
  if (!Array.isArray(verified)) {
    console.error(`\`verified:\` must be a list in ${relative(ROOT, SOURCES_YAML)}`);
    process.exit(1);
  }

  // Validate each entry's required fields up front, with a clear pointer to the
  // offending entry, rather than throwing cryptically mid-download.
  const problems: string[] = [];
  verified.forEach((s, i) => {
    const where = s?.id ? `id "${s.id}"` : `entry #${i + 1}`;
    if (!s || typeof s !== "object") problems.push(`${where}: not a mapping`);
    else {
      if (!s.id || typeof s.id !== "string") problems.push(`${where}: missing/invalid \`id\``);
      if (!s.url || typeof s.url !== "string") problems.push(`${where}: missing/invalid \`url\``);
      else {
        try {
          new URL(s.url);
        } catch {
          problems.push(`${where}: \`url\` is not a valid URL (${s.url})`);
        }
      }
      if (!s.section || typeof s.section !== "string") problems.push(`${where}: missing \`section\``);
      else if (!FETCHABLE_SECTIONS.has(s.section))
        problems.push(
          `${where}: unknown section "${s.section}" (expected ${[...FETCHABLE_SECTIONS].join("|")})`,
        );
    }
  });
  if (problems.length) {
    console.error(`Invalid entries in ${relative(ROOT, SOURCES_YAML)}:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const sources = verified.filter((s) => FETCHABLE_SECTIONS.has(s.section));

  // Guard: duplicate ids collide on disk and in the manifest.
  const seen = new Set<string>();
  for (const s of sources) {
    if (seen.has(s.id)) {
      console.error(`Duplicate id in yaml: ${s.id}`);
      process.exit(1);
    }
    seen.add(s.id);
  }

  await mkdir(CONTENT_RAW, { recursive: true });
  const manifest = await loadManifest();

  console.log(
    `Fetching ${sources.length} source(s) → ${relative(ROOT, CONTENT_RAW)}\n`,
  );

  const failures: { id: string; url: string; error: string }[] = [];
  let downloaded = 0;
  let skipped = 0;
  let firstRequest = true;

  for (const source of sources) {
    const dir = join(CONTENT_RAW, source.section);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, `${source.id}.pdf`);
    const relPath = relative(ROOT, outPath);
    const prior = manifest.get(source.id);

    // Idempotent skip: file present, still a valid PDF, sha matches manifest.
    if (existsSync(outPath) && prior?.status === "ok" && prior.sha256) {
      const info = await inspectFile(outPath);
      if (info && info.sha256 === prior.sha256) {
        console.log(`⏭  ${source.id.padEnd(34)} unchanged (${info.pages}p)`);
        skipped++;
        continue;
      }
    }

    // Space out live requests (not the skips above).
    if (!firstRequest) await sleep(REQUEST_SPACING_MS);
    firstRequest = false;

    process.stdout.write(`⬇  ${source.id.padEnd(34)} `);
    try {
      const buf = await downloadWithRetries(source);
      const pages = await pdfPageCount(buf); // throws if unparseable
      await writeFile(outPath, buf);
      manifest.set(source.id, {
        id: source.id,
        section: source.section,
        url: source.url,
        path: relPath,
        sha256: sha256(buf),
        bytes: buf.length,
        pages,
        fetched_at: nowIso(),
        status: "ok",
        origin: "download",
      });
      downloaded++;
      console.log(`ok (${(buf.length / 1024).toFixed(0)}KB, ${pages}p)`);
    } catch (err) {
      const message = (err as Error).message;
      failures.push({ id: source.id, url: source.url, error: message });
      manifest.set(source.id, {
        id: source.id,
        section: source.section,
        url: source.url,
        path: relPath,
        sha256: prior?.sha256 ?? null,
        bytes: prior?.bytes ?? null,
        pages: prior?.pages ?? null,
        fetched_at: nowIso(),
        status: "failed",
        origin: "download",
        error: message,
      });
      console.log(`FAILED — ${message}`);
    }
    // Persist progress after every item so the run is crash-resumable.
    await saveManifest(manifest);
  }

  // ---------- hand-dropped + orphan files ----------
  const knownPaths = new Map<string, Source>(); // absolute path -> source
  for (const s of sources)
    knownPaths.set(join(CONTENT_RAW, s.section, `${s.id}.pdf`), s);

  const walked = await walkPdfs(CONTENT_RAW);
  let manualAdopted = 0;
  for (const abs of walked) {
    const src = knownPaths.get(abs);
    const cur = src ? manifest.get(src.id) : undefined;
    // If this path belongs to a yaml source and the manifest already has a
    // healthy "ok" download for it, nothing to do.
    if (src && cur?.status === "ok" && cur.origin === "download") continue;

    const info = await inspectFile(abs);
    const relPath = relative(ROOT, abs);
    if (src) {
      // A file exists for a known source that we did NOT successfully download
      // this run (e.g. user grabbed it in a browser after a script block).
      if (info) {
        manifest.set(src.id, {
          id: src.id,
          section: src.section,
          url: src.url,
          path: relPath,
          sha256: info.sha256,
          bytes: info.bytes,
          pages: info.pages,
          fetched_at: nowIso(),
          status: "manual",
          origin: "manual",
        });
        // It's no longer a failure if the user supplied it by hand.
        const i = failures.findIndex((f) => f.id === src.id);
        if (i >= 0) failures.splice(i, 1);
        manualAdopted++;
        console.log(`📎 ${src.id.padEnd(34)} adopted hand-dropped file (${info.pages}p)`);
      }
    } else {
      // Orphan: a PDF with no yaml entry. Record it so it's a first-class
      // citizen (checksummed), but flag it as an orphan for visibility.
      const id = orphanId(abs);
      if (manifest.get(id)?.origin === "manual" && info && manifest.get(id)?.sha256 === info.sha256)
        continue;
      if (info) {
        manifest.set(id, {
          id,
          section: sectionOf(abs),
          url: "(hand-dropped)",
          path: relPath,
          sha256: info.sha256,
          bytes: info.bytes,
          pages: info.pages,
          fetched_at: nowIso(),
          status: "orphan",
          origin: "manual",
        });
        manualAdopted++;
        console.log(`📎 ${id.padEnd(34)} orphan hand-dropped file (${info.pages}p)`);
      }
    }
  }
  if (manualAdopted) await saveManifest(manifest);

  // ---------- summary ----------
  printSummary(manifest, { downloaded, skipped, manualAdopted });

  if (failures.length) {
    console.log(`\n${"=".repeat(72)}`);
    console.log(`FAILURES (${failures.length}) — grab these in a browser into the same path:`);
    console.log("=".repeat(72));
    for (const f of failures) {
      console.log(`\n  id:    ${f.id}`);
      console.log(`  save:  content-raw/${sectionForId(f.id, sources)}/${f.id}.pdf`);
      console.log(`  url:   ${f.url}`);
      console.log(`  why:   ${f.error}`);
    }
    console.log("");
    process.exitCode = 1; // non-zero so CI/callers notice, but manifest is saved
  } else {
    console.log(`\nAll sources present. ✔`);
  }
}

function sectionForId(id: string, sources: Source[]): string {
  return sources.find((s) => s.id === id)?.section ?? "unknown";
}

function sectionOf(abs: string): string {
  const rel = relative(CONTENT_RAW, abs);
  const seg = rel.split(/[\\/]/)[0];
  return FETCHABLE_SECTIONS.has(seg) ? seg : "unknown";
}

function orphanId(abs: string): string {
  const rel = relative(CONTENT_RAW, abs).replace(/\.pdf$/i, "");
  return rel.replace(/[\\/]/g, "__");
}

async function walkPdfs(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkPdfs(p)));
    else if (e.isFile() && e.name.toLowerCase().endsWith(".pdf")) out.push(p);
  }
  return out;
}

function printSummary(
  manifest: Map<string, ManifestEntry>,
  counts: { downloaded: number; skipped: number; manualAdopted: number },
) {
  const bySection = new Map<
    string,
    { files: number; bytes: number; pages: number; failed: number }
  >();
  for (const e of manifest.values()) {
    const s = bySection.get(e.section) ?? { files: 0, bytes: 0, pages: 0, failed: 0 };
    if (e.status === "failed") {
      s.failed++;
    } else {
      s.files++;
      s.bytes += e.bytes ?? 0;
      s.pages += e.pages ?? 0;
    }
    bySection.set(e.section, s);
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log("MANIFEST SUMMARY");
  console.log("=".repeat(72));
  console.log(
    `${"section".padEnd(16)}${"files".padStart(7)}${"MB".padStart(10)}${"pages".padStart(9)}${"failed".padStart(9)}`,
  );
  console.log("-".repeat(72));
  let tFiles = 0, tBytes = 0, tPages = 0, tFailed = 0;
  for (const [section, s] of [...bySection.entries()].sort()) {
    console.log(
      `${section.padEnd(16)}${String(s.files).padStart(7)}${(s.bytes / 1_048_576)
        .toFixed(1)
        .padStart(10)}${String(s.pages).padStart(9)}${String(s.failed).padStart(9)}`,
    );
    tFiles += s.files; tBytes += s.bytes; tPages += s.pages; tFailed += s.failed;
  }
  console.log("-".repeat(72));
  console.log(
    `${"TOTAL".padEnd(16)}${String(tFiles).padStart(7)}${(tBytes / 1_048_576)
      .toFixed(1)
      .padStart(10)}${String(tPages).padStart(9)}${String(tFailed).padStart(9)}`,
  );
  console.log(
    `\ndownloaded: ${counts.downloaded}   skipped(unchanged): ${counts.skipped}   hand-dropped: ${counts.manualAdopted}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
