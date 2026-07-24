/**
 * F6 offline: lets a user "pin" up to 5 exercise/meditation audios so they
 * play with no network at all — a signed URL is useless offline (and expires
 * within the hour anyway), so pinned audio is downloaded ONCE into the Cache
 * Storage API under a stable synthetic key (not the signed URL, which changes
 * every mint), with a small IndexedDB record tracking pin order for LRU
 * eviction at the 5-item cap. Config/catalog offline support is separate (see
 * sw.ts's StaleWhileRevalidate route for GET /api/sukoon/exercises) — this
 * module is only for the audio bytes themselves.
 */
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "sukoon-audio-pins";
const STORE = "pins";
const CACHE_NAME = "sukoon-pinned-audio-v1";
export const MAX_PINNED_AUDIOS = 5;

export interface PinRecord {
  key: string;
  label: string;
  pinnedAt: number;
}

function virtualUrl(key: string): string {
  return `https://sukoon-pinned.invalid/${encodeURIComponent(key)}`;
}

export function pinKey(exerciseId: string, lang: "hi" | "en"): string {
  return `${exerciseId}:${lang}`;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
      },
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export async function listPins(): Promise<PinRecord[]> {
  const db = await getDb();
  const rows = (await db.getAll(STORE)) as PinRecord[];
  return rows.sort((a, b) => b.pinnedAt - a.pinnedAt);
}

export async function isPinned(key: string): Promise<boolean> {
  const db = await getDb();
  return (await db.get(STORE, key)) != null;
}

/** Downloads `url` and stores it offline under `key`, evicting the oldest pin at the cap. */
export async function pinAudio(key: string, label: string, url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download audio (HTTP ${response.status})`);
  const cache = await caches.open(CACHE_NAME);
  await cache.put(virtualUrl(key), response);

  const existing = await listPins();
  if (existing.length >= MAX_PINNED_AUDIOS && !existing.some((p) => p.key === key)) {
    const oldest = existing[existing.length - 1];
    if (oldest) await unpinAudio(oldest.key);
  }
  const db = await getDb();
  await db.put(STORE, { key, label, pinnedAt: Date.now() });
}

export async function unpinAudio(key: string): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(virtualUrl(key));
  const db = await getDb();
  await db.delete(STORE, key);
}

/** A playable object URL for a pinned audio, or null if it isn't pinned. Caller must revoke it when done. */
export async function getPinnedAudioObjectUrl(key: string): Promise<string | null> {
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(virtualUrl(key));
  if (!response) return null;
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
