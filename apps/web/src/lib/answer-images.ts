import imageCompression from "browser-image-compression";
import { ANSWER_IMAGES_BUCKET, supabaseBrowser } from "@/lib/supabase";

/** Load a File/Blob into an <img> for canvas drawing. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

/**
 * Bakes a rotation (in degrees, multiple of 90) into the pixels via canvas —
 * OCR reads raw bytes, not CSS transforms, so a user's "rotate" click has to
 * actually re-encode the file. Also normalizes every input into a plain JPEG,
 * which incidentally strips any EXIF orientation tag that could otherwise
 * double-apply a rotation in some browsers.
 */
async function bakeRotation(file: File | Blob, rotationDeg: number): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const swapped = rotationDeg % 180 !== 0;
    const canvas = document.createElement("canvas");
    canvas.width = swapped ? img.naturalHeight : img.naturalWidth;
    canvas.height = swapped ? img.naturalWidth : img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not supported in this browser");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode image"))), "image/jpeg", 0.92);
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Rotate (if needed) then compress a captured page photo before upload. */
export async function prepareAnswerImage(file: File, rotationDeg: number): Promise<Blob> {
  const rotated = await bakeRotation(file, ((rotationDeg % 360) + 360) % 360);
  return imageCompression(new File([rotated], "page.jpg", { type: "image/jpeg" }), {
    maxSizeMB: 1.5,
    maxWidthOrHeight: 2200,
    useWebWorker: true,
    fileType: "image/jpeg",
  });
}

/**
 * Uploads one prepared page image directly to the answer-images bucket; returns
 * its storage path. The key is prefixed with the signed-in user's id
 * (`<uid>/<draftId>/page-N-<uuid>.jpg`) so the per-user-folder Storage RLS policy
 * (migration 0053) admits it — a user can only write under their own uid prefix.
 */
export async function uploadAnswerImage(blob: Blob, draftId: string, index: number): Promise<string> {
  const client = supabaseBrowser();
  const { data: sessionData } = await client.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) throw new Error("Not signed in — cannot upload answer image.");
  const path = `${uid}/${draftId}/page-${index + 1}-${crypto.randomUUID()}.jpg`;
  const { error } = await client
    .storage.from(ANSWER_IMAGES_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}

/** A short-lived signed URL for displaying a private-bucket thumbnail client-side. */
export async function getAnswerImageUrl(path: string): Promise<string> {
  const { data, error } = await supabaseBrowser().storage.from(ANSWER_IMAGES_BUCKET).createSignedUrl(path, 3600);
  if (error || !data) throw new Error(`Could not load image: ${error?.message ?? "unknown error"}`);
  return data.signedUrl;
}
