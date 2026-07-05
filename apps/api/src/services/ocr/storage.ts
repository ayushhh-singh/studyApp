/**
 * Fetches handwritten-mode page photos out of the `answer-images` Supabase
 * Storage bucket for vision calls. The client uploads directly to this bucket
 * with the anon key (see the dev-permissive policy in migration 0030); the
 * API only ever reads it back with the service-role client, which bypasses
 * RLS regardless of the bucket's policies.
 */
import { supabase } from "../../lib/supabase.js";
import { HttpError } from "../../lib/http-error.js";

export const ANSWER_IMAGES_BUCKET = "answer-images";

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp";

export interface ImageBase64 {
  base64: string;
  mediaType: ImageMediaType;
}

const ALLOWED_MEDIA_TYPES: ImageMediaType[] = ["image/jpeg", "image/png", "image/webp"];

function guessMediaType(path: string, blobType: string): ImageMediaType {
  if (ALLOWED_MEDIA_TYPES.includes(blobType as ImageMediaType)) return blobType as ImageMediaType;
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

export async function downloadImageAsBase64(path: string): Promise<ImageBase64> {
  const { data, error } = await supabase().storage.from(ANSWER_IMAGES_BUCKET).download(path);
  if (error || !data) {
    throw new HttpError(500, `failed to download page image from storage: ${error?.message ?? "no data"}`);
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  return { base64: buffer.toString("base64"), mediaType: guessMediaType(path, data.type) };
}
