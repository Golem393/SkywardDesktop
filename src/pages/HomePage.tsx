import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import CreateSchedulePage from "./CreateSchedulePage";
import { errorMessage, markSchedulePushed, Me, Schedule, SessionExpiredError } from "../lib/api";
import { formatDate, formatDays, formatEndDate, formatTime, spansMidnight } from "../lib/schedule";
import DeviceDisconnectedModal, {
  checkDeviceConnected,
  DeviceConnectionStatus,
} from "../components/DeviceDisconnectedModal";

const SUPPORT_EMAIL = "support@skywardos.com";

interface HomePageProps {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Ends the session and returns to login. Called directly (not just via refresh()) when
   *  a user-initiated action hits a dead token, so it fails as clearly as the Refresh button
   *  does rather than sitting on an inline error the user can't recover from. */
  signOut: (reason?: string) => void;
  onGoToDevices: () => void;
}

export default function HomePage({ me, loading, refresh, signOut, onGoToDevices }: HomePageProps) {
  const [creating, setCreating] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  /** The phone got the schedule but recording it failed — cosmetic, and deliberately not
   *  shown as an error, because re-pushing costs another Developer Mode window. */
  const [pushWarning, setPushWarning] = useState<string | null>(null);
  const [pushed, setPushed] = useState(false);
  const [showPushWarning, setShowPushWarning] = useState(false);
  const [disconnected, setDisconnected] = useState<DeviceConnectionStatus | null>(null);

  if (creating) {
    return (
      <CreateSchedulePage
        onCreated={async () => {
          await refresh();
          setCreating(false);
        }}
        onCancel={() => setCreating(false)}
        signOut={signOut}
      />
    );
  }

  if (loading && !me) {
    return (
      <div className="card">
        <div className="card-content" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="spinner" /> Loading your account…
        </div>
      </div>
    );
  }

  const schedule = me?.schedule ?? null;
  const device = me?.device ?? null;

  async function handlePushConfirmed() {
    setShowPushWarning(false);
    if (!schedule || !device) return;

    setPushing(true);
    setPushError(null);
    setPushWarning(null);
    setPushed(false);

    const connection = await checkDeviceConnected(device.serial);
    if (!connection.connected) {
      setDisconnected(connection);
      setPushing(false);
      return;
    }

    try {
      try {
        await invoke<string>("push_schedule", {
          deviceId: device.serial,
          lockStartHour: schedule.lock_start_hour,
          lockStartMinute: schedule.lock_start_minute,
          lockEndHour: schedule.lock_end_hour,
          lockEndMinute: schedule.lock_end_minute,
          daysMask: schedule.days_mask,
          activeFrom: new Date(schedule.active_from).getTime(),
          activeUntil: new Date(schedule.active_until).getTime(),
          timezoneId: schedule.timezone_id,
        });
      } catch (err) {
        setPushError(
          `The schedule could not be sent to the phone (${errorMessage(err)}). Check that ` +
            `the 10-minute Developer Mode window is still open, then try again.`
        );
        return;
      }

      // The phone has the schedule from here on. Everything below is bookkeeping, and a
      // failure must not read as "the push failed" — re-pushing costs the parent another
      // Developer Mode window, so it is not a free retry.
      try {
        await markSchedulePushed(schedule.id);
      } catch (err) {
        if (err instanceof SessionExpiredError) {
          signOut(
            "Your session expired. The schedule was applied to the phone and is being " +
              'enforced, but we couldn\'t record it — it will still show as "Not pushed ' +
              'yet" after you sign in. You do not need to push again.'
          );
          return;
        }
        setPushed(true);
        setPushWarning(
          `The schedule is on the phone and is being enforced, but we couldn't record that ` +
            `(${errorMessage(err)}). It will keep showing as "Not pushed yet" — that's ` +
            `cosmetic only, and pushing again is safe if you'd rather clear it.`
        );
        return;
      }

      await refresh();
      setPushed(true);
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="space-y-4">
      {schedule ? (
        <ScheduleCard schedule={schedule} />
      ) : (
        <EmptyScheduleCard onCreate={() => setCreating(true)} hasDevice={!!device} />
      )}

      {schedule && (
        <div className="card">
          <div className="card-content">
            <div className="push-row">
              <div>
                <div className="step-title" style={{ marginBottom: 6 }}>
                  Push schedule to device
                </div>
                <p className="text-sm text-muted" style={{ margin: 0, lineHeight: 1.5 }}>
                  {!device
                    ? "You need to add a device before the schedule can be pushed."
                    : schedule.status === "pushed"
                    ? `Last pushed to ${device.model || device.serial}. You can push again if needed.`
                    : `Ready to push to ${device.model || device.serial}.`}
                </p>
              </div>
              {device ? (
                <button
                  className="btn btn-primary"
                  onClick={() => setShowPushWarning(true)}
                  disabled={pushing}
                >
                  {pushing ? (
                    <>
                      <span className="spinner" /> Pushing…
                    </>
                  ) : (
                    "Push Schedule"
                  )}
                </button>
              ) : (
                <button className="btn btn-outline" onClick={onGoToDevices}>
                  Add a device
                </button>
              )}
            </div>

            {pushed && (
              <div className="alert alert-success" style={{ marginTop: 16 }}>
                <p style={{ margin: 0, fontWeight: 600 }}>✓ Schedule pushed to the device.</p>
              </div>
            )}

            {pushWarning && (
              <div className="alert alert-warning" style={{ marginTop: 16 }}>
                <p style={{ margin: 0, lineHeight: 1.5 }}>⚠️ {pushWarning}</p>
              </div>
            )}

            {pushError && (
              <div className="alert alert-error" style={{ marginTop: 16 }}>
                <p style={{ margin: 0 }}>{pushError}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {showPushWarning && (
        <div className="modal-backdrop">
          <div className="card" style={{ maxWidth: 480, width: "100%", margin: 0 }}>
            <div className="card-header">
              <h3 style={{ margin: 0, color: "var(--foreground)", fontSize: 18 }}>
                Before you push
              </h3>
            </div>
            <div className="card-content">
              <div className="alert alert-warning" style={{ marginBottom: 16 }}>
                ⚠️ <strong>Requirement:</strong> USB Debugging is locked down once a device is
                protected. Open SkywardBlocker on the phone, log in, and activate the{" "}
                <strong>10-minute Developer Mode window</strong> before continuing.
              </div>
              <p className="text-sm text-muted" style={{ marginTop: 0 }}>
                If you just finished setting the device up, the schedule was already pushed for
                you and you can skip this.
              </p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button className="btn btn-outline" onClick={() => setShowPushWarning(false)}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handlePushConfirmed}>
                  Push now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {disconnected && (
        <DeviceDisconnectedModal
          status={disconnected}
          onBackToDevices={onGoToDevices}
          onClose={() => setDisconnected(null)}
        />
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function EmptyScheduleCard({ onCreate, hasDevice }: { onCreate: () => void; hasDevice: boolean }) {
  return (
    <div className="card">
      <div className="card-content" style={{ textAlign: "center", padding: "40px 24px" }}>
        <div style={{ fontSize: 34, marginBottom: 12 }}>🕒</div>
        <div className="step-title" style={{ marginBottom: 8 }}>
          No schedule yet
        </div>
        <p className="text-sm text-muted" style={{ maxWidth: 420, margin: "0 auto 20px", lineHeight: 1.6 }}>
          Create the blocking schedule that decides when the phone is locked down — the hours,
          the days of the week, and how long the block runs for.
        </p>
        <button className="btn btn-primary" onClick={onCreate}>
          Create Schedule
        </button>
        {!hasDevice && (
          <p className="text-xs text-muted" style={{ marginTop: 16 }}>
            Tip: create the schedule before adding your device and it will be applied
            automatically during setup — no Developer Mode window needed.
          </p>
        )}
      </div>
    </div>
  );
}

function ScheduleCard({ schedule }: { schedule: Schedule }) {
  const overnight = spansMidnight(
    schedule.lock_start_hour,
    schedule.lock_start_minute,
    schedule.lock_end_hour,
    schedule.lock_end_minute
  );
  const fullDay =
    schedule.lock_start_hour === schedule.lock_end_hour &&
    schedule.lock_start_minute === schedule.lock_end_minute;

  return (
    <div className="card">
      <div className="card-header">
        <div className="step-header">
          <div className="step-number active">🕒</div>
          <div style={{ flex: 1 }}>
            <div className="step-title">Your schedule</div>
          </div>
          <span className={`badge ${schedule.status === "pushed" ? "badge-success" : "badge-warning"}`}>
            {schedule.status === "pushed" ? "Active on device" : "Not pushed yet"}
          </span>
        </div>
      </div>
      <div className="card-content">
        <dl className="detail-grid">
          <div>
            <dt>Locked hours</dt>
            <dd>
              {fullDay
                ? "All day"
                : `${formatTime(schedule.lock_start_hour, schedule.lock_start_minute)} – ${formatTime(
                    schedule.lock_end_hour,
                    schedule.lock_end_minute
                  )}`}
              {overnight && !fullDay && (
                <span className="text-xs text-muted"> (spans midnight)</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Days</dt>
            <dd>{formatDays(schedule.days_mask)}</dd>
          </div>
          <div>
            <dt>Runs from</dt>
            <dd>{formatDate(schedule.active_from)}</dd>
          </div>
          <div>
            <dt>Ends after</dt>
            <dd>{formatEndDate(schedule.active_until)}</dd>
          </div>
        </dl>

        <div className="alert alert-info" style={{ marginTop: 20 }}>
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            <strong>This schedule is locked.</strong> It can't be edited or deleted from here —
            that's the point of committing to it. If you genuinely need it changed, email{" "}
            <strong>{SUPPORT_EMAIL}</strong> and we'll sort it out with you.
          </p>
        </div>

        <p className="text-xs text-muted" style={{ marginTop: 12, marginBottom: 0 }}>
          When the end date passes, the phone unblocks on its own — nothing further to do.
        </p>
      </div>
    </div>
  );
}
