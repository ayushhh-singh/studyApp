export class HttpError extends Error {
  /** Optional machine code the client can branch on (e.g. a paywall feature). */
  public feature?: string;
  constructor(
    public status: number,
    message: string,
    options?: { feature?: string },
  ) {
    super(message);
    this.feature = options?.feature;
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
