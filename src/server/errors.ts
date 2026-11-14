import type { ApiError } from "@/lib/api-types";

export type ErrorCode = ApiError["error"]["code"];

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  confirmation_required: 409,
  validation_failed: 422,
  rate_limited: 429,
  quota_exceeded: 429,
  provider_error: 502,
  internal: 500,
};

export class HttpError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
  get status() {
    return STATUS[this.code];
  }
}

export const notFound = (what = "Resource") => new HttpError("not_found", `${what} not found`);

