/**
 * Thin client for the mdm-backend records that back the desktop UI.
 *
 * Supabase is the record of truth for the parent's single schedule and enrolled device:
 * USB debugging is sealed after enrolment, so the schedule cannot be read back off the
 * phone, and the app would otherwise forget everything on restart.
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!accessToken) throw new Error("Not signed in. Please sign out and back in.");

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
    throw new Error(detail);
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
