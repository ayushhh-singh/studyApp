import type { ZodTypeAny, z } from "zod";
import { getAccessToken, handleUnauthorized } from "./auth";

const API_URL = import.meta.env.VITE_API_URL as string;

/** Build request headers, attaching the current access token when signed in. */
async function authHeaders(hasBody: boolean): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (hasBody) headers["Content-Type"] = "application/json";
  const token = await getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export class ApiError extends Error {
  status: number;
  /** For 402 paywalls: which feature was gated (e.g. "evaluation", "handwritten_ocr"). */
  feature?: string;
  constructor(status: number, message: string, feature?: string) {
    super(message);
    this.status = status;
    this.feature = feature;
  }
}

type Query = Record<string, string | number | boolean | undefined>;

function buildUrl(path: string, query?: Query): string {
  const url = new URL(path, API_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function request<T extends ZodTypeAny>(
  path: string,
  envelopeSchema: T,
  opts: { method: string; query?: Query; body?: unknown },
): Promise<NonNullable<z.infer<T>["data"]>> {
  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method,
    headers: await authHeaders(opts.body !== undefined),
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401) {
    handleUnauthorized();
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, `Invalid JSON response (HTTP ${res.status})`);
  }

  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(res.status, `Response failed schema validation: ${parsed.error.message}`);
  }

  const envelope = parsed.data as { data: unknown; error: string | null };
  if (!res.ok || envelope.error) {
    // `feature` is an out-of-schema field the API adds to 402 paywall errors; read
    // it from the raw JSON since the envelope schema strips unknown keys.
    const feature = (json as { feature?: string }).feature;
    throw new ApiError(res.status, envelope.error ?? `Request failed (HTTP ${res.status})`, feature);
  }
  return envelope.data as NonNullable<z.infer<T>["data"]>;
}

export const api = {
  get<T extends ZodTypeAny>(path: string, envelopeSchema: T, query?: Query) {
    return request(path, envelopeSchema, { method: "GET", query });
  },
  post<T extends ZodTypeAny>(path: string, envelopeSchema: T, body?: unknown) {
    return request(path, envelopeSchema, { method: "POST", body });
  },
  patch<T extends ZodTypeAny>(path: string, envelopeSchema: T, body?: unknown) {
    return request(path, envelopeSchema, { method: "PATCH", body });
  },
  async delete(path: string): Promise<void> {
    const res = await fetch(buildUrl(path), { method: "DELETE", headers: await authHeaders(false) });
    if (res.status === 401) {
      handleUnauthorized();
      throw new ApiError(401, "Your session has expired. Please sign in again.");
    }
    if (!res.ok) throw new ApiError(res.status, `Request failed (HTTP ${res.status})`);
  },
};
