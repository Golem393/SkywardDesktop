import { useMemo, useState } from "react";

import { createSchedule } from "../lib/api";
import {
  DAYS,
  HOURS,
  MINUTES,
  endOfLocalDay,
  formatDate,
  formatDays,
  formatEndDate,
  formatHourLabel,
  formatTime,
  hasDay,
  spansMidnight,
  startOfLocalDay,
  toDateInputValue,
  toggleDay,
} from "../lib/schedule";

const SUPPORT_EMAIL = "support@skywardos.com";

type Duration = "week" | "custom";

interface CreateSchedulePageProps {
  onCreated: () => Promise<void> | void;
  onCancel: () => void;
}

export default function CreateSchedulePage({ onCreated, onCancel }: CreateSchedulePageProps) {
  const [startHour, setStartHour] = useState(21);
  const [startMinute, setStartMinute] = useState(0);
  const [endHour, setEndHour] = useState(7);
  const [endMinute, setEndMinute] = useState(0);
  const [daysMask, setDaysMask] = useState(0b1111111);

  const [duration, setDuration] = useState<Duration>("week");
  const today = useMemo(() => toDateInputValue(new Date()), []);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 6);
    return toDateInputValue(d);
  });

  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Resolve the duration choice into the concrete instants the phone enforces against. */
  const period = useMemo(() => {
    if (duration === "week") {
      const from = startOfLocalDay(today);
      const until = new Date(from);
      until.setDate(until.getDate() + 7);
      return { from, until };
    }
    return { from: startOfLocalDay(startDate), until: endOfLocalDay(endDate) };
  }, [duration, today, startDate, endDate]);

  const validationError = useMemo(() => {
    if (daysMask === 0) return "Pick at least one day of the week.";
    if (period.until <= period.from) return "The end date must be after the start date.";
    return null;
  }, [daysMask, period]);

  const overnight = spansMidnight(startHour, startMinute, endHour, endMinute);
  const fullDay = startHour === endHour && startMinute === endMinute;

  async function handleConfirmed() {
    setShowConfirm(false);
    setSaving(true);
    setError(null);
    try {
      await createSchedule({
        lock_start_hour: startHour,
        lock_start_minute: startMinute,
        lock_end_hour: endHour,
        lock_end_minute: endMinute,
        days_mask: daysMask,
        active_from: period.from.toISOString(),
        active_until: period.until.toISOString(),
        timezone_id: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      await onCreated();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header">
          <div className="step-header">
            <div className="step-number active">🕒</div>
            <div>
              <div className="step-title">Create your schedule</div>
            </div>
          </div>
        </div>
        <div className="card-content">
          <p className="card-description" style={{ marginTop: 0, marginBottom: 24 }}>
            The phone is locked down during these hours, on these days, until the block period
            ends. You get one schedule, and it can't be changed afterwards — so take a moment
            with it.
          </p>

          {/* Hours */}
          <section style={{ marginBottom: 28 }}>
            <label className="label">Locked hours</label>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
              <div style={{ flex: "1 1 200px" }}>
                <span className="field-hint">From</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <select className="input" style={{ flex: 1 }} value={startHour} onChange={(e) => setStartHour(Number(e.target.value))}>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>{formatHourLabel(h)}</option>
                    ))}
                  </select>
                  <select className="input" style={{ flex: 1 }} value={startMinute} onChange={(e) => setStartMinute(Number(e.target.value))}>
                    {MINUTES.map((m) => (
                      <option key={m} value={m}>:{String(m).padStart(2, "0")}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ flex: "1 1 200px" }}>
                <span className="field-hint">Until</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <select className="input" style={{ flex: 1 }} value={endHour} onChange={(e) => setEndHour(Number(e.target.value))}>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>{formatHourLabel(h)}</option>
                    ))}
                  </select>
                  <select className="input" style={{ flex: 1 }} value={endMinute} onChange={(e) => setEndMinute(Number(e.target.value))}>
                    {MINUTES.map((m) => (
                      <option key={m} value={m}>:{String(m).padStart(2, "0")}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <p className="text-sm text-muted" style={{ marginTop: 10, marginBottom: 0 }}>
              {fullDay ? (
                <>Locked <strong>all day</strong> on every selected day.</>
              ) : (
                <>
                  Locked from <strong>{formatTime(startHour, startMinute)}</strong> to{" "}
                  <strong>{formatTime(endHour, endMinute)}</strong>
                  {overnight && " — this runs overnight into the next morning."}
                </>
              )}
            </p>
          </section>

          {/* Days */}
          <section style={{ marginBottom: 28 }}>
            <label className="label">Days of the week</label>
            <div className="day-toggle-row" style={{ marginTop: 8 }}>
              {DAYS.map((day) => (
                <button
                  key={day.bit}
                  type="button"
                  className={`day-toggle ${hasDay(daysMask, day.bit) ? "selected" : ""}`}
                  onClick={() => setDaysMask((m) => toggleDay(m, day.bit))}
                  aria-pressed={hasDay(daysMask, day.bit)}
                  title={day.long}
                >
                  {day.short}
                </button>
              ))}
            </div>
            <p className="text-sm text-muted" style={{ marginTop: 10, marginBottom: 0 }}>
              {formatDays(daysMask)}
              {overnight && !fullDay && daysMask !== 0 && (
                <> — a night that starts on a selected day carries through to the next morning.</>
              )}
            </p>
          </section>

          {/* Duration */}
          <section>
            <label className="label">How long this block lasts</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
              <label className={`radio-card ${duration === "week" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="duration"
                  checked={duration === "week"}
                  onChange={() => setDuration("week")}
                />
                <span>
                  <strong>One week</strong>
                  <span className="text-sm text-muted"> — starting today, ending in 7 days.</span>
                </span>
              </label>
              <label className={`radio-card ${duration === "custom" ? "selected" : ""}`}>
                <input
                  type="radio"
                  name="duration"
                  checked={duration === "custom"}
                  onChange={() => setDuration("custom")}
                />
                <span>
                  <strong>Custom date range</strong>
                  <span className="text-sm text-muted"> — pick your own start and end date.</span>
                </span>
              </label>
            </div>

            {duration === "custom" && (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 14 }}>
                <div style={{ flex: "1 1 200px" }}>
                  <span className="field-hint">Start date</span>
                  <input
                    className="input"
                    type="date"
                    min={today}
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div style={{ flex: "1 1 200px" }}>
                  <span className="field-hint">End date (inclusive)</span>
                  <input
                    className="input"
                    type="date"
                    min={startDate}
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            )}
          </section>

          {(validationError || error) && (
            <div className="alert alert-error" style={{ marginTop: 20 }}>
              <p style={{ margin: 0 }}>{error || validationError}</p>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={() => setShowConfirm(true)}
          disabled={saving || validationError !== null}
        >
          {saving ? (
            <>
              <span className="spinner" /> Creating…
            </>
          ) : (
            "Create Schedule"
          )}
        </button>
      </div>

      {showConfirm && (
        <div className="modal-backdrop">
          <div className="card" style={{ maxWidth: 500, width: "100%", margin: 0 }}>
            <div className="card-header">
              <h3 style={{ margin: 0, color: "var(--foreground)", fontSize: 18 }}>
                This can't be undone
              </h3>
            </div>
            <div className="card-content">
              <div className="alert alert-warning" style={{ marginBottom: 16 }}>
                <p style={{ margin: 0, lineHeight: 1.6 }}>
                  ⚠️ Once you create this schedule you <strong>can't edit or delete it</strong>.
                  That's deliberate — it's what makes the commitment stick. If you later need it
                  changed, you'll have to email <strong>{SUPPORT_EMAIL}</strong> and ask us.
                </p>
              </div>

              <dl className="detail-grid" style={{ marginBottom: 20 }}>
                <div>
                  <dt>Locked hours</dt>
                  <dd>
                    {fullDay
                      ? "All day"
                      : `${formatTime(startHour, startMinute)} – ${formatTime(endHour, endMinute)}`}
                  </dd>
                </div>
                <div>
                  <dt>Days</dt>
                  <dd>{formatDays(daysMask)}</dd>
                </div>
                <div>
                  <dt>Runs from</dt>
                  <dd>{formatDate(period.from)}</dd>
                </div>
                <div>
                  <dt>Ends after</dt>
                  <dd>{formatEndDate(period.until)}</dd>
                </div>
              </dl>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button className="btn btn-outline" onClick={() => setShowConfirm(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleConfirmed}>
                  Yes, create schedule
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
