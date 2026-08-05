/**
 * Thin client for the mdm-backend records that back the desktop UI.
 *
 * Supabase is the record of truth for the parent's single schedule and enrolled device —
 * the schedule can't be read back off the phone, so the app would otherwise forget
 * everything on restart.
 */

const BASE_URL = "https://mdm-backend-i4b0.onrender.com/api";
const API_KEY = "api_3d9a7c1f5b824e9aa4d6f7c8b1e2a3d4";

export interface Schedule {
  id: string;
  lock_start_hour: number;
  lock_start_minute: number;
  lock_end_hour: number;
  lock_end_minute: number;
  days_mask: number;
  active_from: string;
  active_until: string;
  timezone_id: string;
  status: "created" | "pushed";
  pushed_at: string | null;
  created_at: string;
}

export interface EnrolledDevice {
  id: string;
  serial: string;
  model: string | null;
  enrolled_at: string;
}

export interface Me {
  email: string | null;
  subscriptionStatus: string | null;
  removeEnabled: boolean;
  schedule: Schedule | null;
  device: EnrolledDevice | null;
}

export interface ScheduleDraft {
  lock_start_hour: number;
  lock_start_minute: number;
  lock_end_hour: number;
  lock_end_minute: number;
  days_mask: number;
  active_from: string;
  active_until: string;
  timezone_id: string;
}

/** Session token from /setup-auth, held in memory for the life of the process only. */
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function hasAccessToken(): boolean {
  return accessToken !== null;
}

/**
 * Thrown when the backend rejects the bearer token — expired or otherwise dead. Supabase
 * access tokens last ~1 hour and this app does not renew them, so this is the normal way a
 * long-lived session ends. Callers that catch it should sign the user out rather than just
 * showing an inline error, since retrying with the same token will never succeed.
 */
export class SessionExpiredError extends Error {}

/** Any other non-2xx response. Carries the status so callers can act on specific ones —
 *  notably 409, which `POST /schedule` and `POST /devices` return for "already exists". */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Normalise an unknown thrown value into something displayable. */
export function errorMessage(err: unknown): string {
  return String(err instanceof Error ? err.message : err);
}

/**
 * Retry `fn` with a fixed delay between attempts.
 *
 * Gives up immediately on SessionExpiredError: a dead token fails identically on every
 * attempt, so retrying only postpones the sign-out.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, delayMs = 1500 }: { attempts?: number; delayMs?: number } = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (err instanceof SessionExpiredError) break;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!accessToken) throw new SessionExpiredError("Not signed in. Please sign in again.");

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    // FastAPI puts the human-readable reason in `detail`; surface that rather than a
    // bare status code, since these carry the support-facing messages.
    let detail = `Request failed (HTTP ${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      // Non-JSON error body — keep the status-code fallback.
    }
    if (res.status === 401) throw new SessionExpiredError(detail);
    throw new ApiError(detail, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function fetchMe(): Promise<Me> {
  return request<Me>("/me");
}

export function createSchedule(draft: ScheduleDraft): Promise<Schedule> {
  return request<Schedule>("/schedule", {
    method: "POST",
    body: JSON.stringify(draft),
  });
}

export function markSchedulePushed(scheduleId: string): Promise<Schedule> {
  return request<Schedule>(`/schedule/${scheduleId}/pushed`, { method: "POST" });
}

export function registerDevice(serial: string, model: string | null): Promise<EnrolledDevice> {
  return request<EnrolledDevice>("/devices", {
    method: "POST",
    body: JSON.stringify({ serial, model }),
  });
}

export function unregisterDevice(serial: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/devices/${encodeURIComponent(serial)}`, {
    method: "DELETE",
  });
}
