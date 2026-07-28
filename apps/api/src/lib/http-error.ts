export class HttpError extends Error {
  /** Optional machine code the client can branch on (e.g. a paywall feature). */
  public feature?: string;
  /**
   * Set on a 402 that a GUEST hit: the client shows a "create your free account
   * + 7-day trial" signup prompt instead of the Pro upgrade paywall.
   */
  public requiresSignup?: boolean;
  constructor(
    public status: number,
    message: string,
    options?: { feature?: string; requiresSignup?: boolean },
  ) {
    super(message);
    this.feature = options?.feature;
    this.requiresSignup = options?.requiresSignup;
  }
}

export function notFound(message = "Not found"): HttpError {
  return new HttpError(404, message);
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message);
}

export function conflict(message: string): HttpError {
  return new HttpError(409, message);
}
