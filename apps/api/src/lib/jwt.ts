/**
 * Supabase access-token verification.
 *
 * Primary path: verify the JWT's signature against the project's JWKS endpoint
 * with `jose` (this project signs with ES256 — asymmetric — so the public keys
 * are fetched once and cached by createRemoteJWKSet, refreshed on key rotation).
 * We validate the signature, `exp`, issuer, and the `authenticated` audience,
 * then take the user id from `sub`.
 *
 * Fallback path: if the JWKS verify fails in a way that looks like a legacy
 * symmetric (HS256) project — where there are no public keys to verify against —
 * we ask Supabase's Auth API to validate the token via `auth.getUser(token)`.
 * That's a network round-trip per request, so it's strictly a fallback.
 */
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose";
import { supabase } from "./supabase.js";

const SUPABASE_URL = () => {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL is not set (apps/api/.env)");
  return url.replace(/\/$/, "");
};

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${SUPABASE_URL()}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

export class AuthError extends Error {}

/**
 * Verify a Supabase access token and return its user id (`sub`). Throws
 * AuthError on any invalid/expired/mis-audienced token.
 */
export async function verifyAccessToken(token: string): Promise<string> {
  const issuer = `${SUPABASE_URL()}/auth/v1`;
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer,
      audience: "authenticated",
    });
    if (!payload.sub) throw new AuthError("Token has no subject claim");
    return payload.sub;
  } catch (err) {
    // A signature-algorithm/key mismatch means this is very likely a legacy
    // HS256 (symmetric) project with no JWKS to verify against — fall back to
    // the Auth API. Anything else (expired, bad audience, tampered) is a hard
    // failure and must NOT silently fall through to a second validation.
    const isKeyMismatch =
      err instanceof joseErrors.JOSENotSupported ||
      err instanceof joseErrors.JWKSNoMatchingKey ||
      err instanceof joseErrors.JWSSignatureVerificationFailed;
    if (!isKeyMismatch) {
      if (err instanceof AuthError) throw err;
      throw new AuthError(err instanceof Error ? err.message : "Token verification failed");
    }
    return verifyViaAuthApi(token);
  }
}

/** Legacy-symmetric fallback: validate the token by asking Supabase Auth. */
async function verifyViaAuthApi(token: string): Promise<string> {
  const { data, error } = await supabase().auth.getUser(token);
  if (error || !data.user) {
    throw new AuthError(error?.message ?? "Token rejected by Auth API");
  }
  return data.user.id;
}
