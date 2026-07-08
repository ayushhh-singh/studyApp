import type { ZodTypeAny, z } from "zod";

const API_URL = import.meta.env.VITE_API_URL as string;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

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
    throw new ApiError(res.status, envelope.error ?? `Request failed (HTTP ${res.status})`);
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
    const res = await fetch(buildUrl(path), { method: "DELETE" });
    if (!res.ok) throw new ApiError(res.status, `Request failed (HTTP ${res.status})`);
  },
};
