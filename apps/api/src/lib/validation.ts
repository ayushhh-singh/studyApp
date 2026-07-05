import type { z, ZodTypeAny } from "zod";
import { badRequest } from "./http-error.js";

/** Parse `data` against `schema`, throwing a 400 HttpError on failure. */
export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw badRequest(result.error.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; "));
  }
  return result.data;
}
