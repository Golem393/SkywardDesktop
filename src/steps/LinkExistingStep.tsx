import { useState } from "react";

import { errorMessage, registerDevice, SessionExpiredError } from "../lib/api";

const SUPPORT_EMAIL = "support@skywardos.com";

interface LinkExistingStepProps {
  deviceId: string;
  deviceModel: string;
  onLinked: () => Promise<void> | void;
  onCancel: () => void;
  signOut: (reason?: string) => void;
}

/**
 * Recovery path for a phone that is already fully provisioned (SkywardBlocker installed and
 * active as Device Owner) but has no matching record on the account.
 *
 * That state is reachable whenever `registerDevice()` fails after a successful install — an
 * expired session, a network blip, backend downtime. It used to be a dead end: Remove App is
 * gated on the device record existing, and re-running Add Device is refused by the
 * prerequisite check (which requires *no* existing install and *no* existing Device Owner).
 * This screen closes that loop by attaching the phone to the account without touching the
 * phone itself.
 */
export default function LinkExistingStep({
  deviceId,
  deviceModel,
  onLinked,
  onCancel,
  signOut,
}: LinkExistingStepProps) {
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLink() {
    setLinking(true);
    setError(null);
    try {
      await registerDevice(deviceId, deviceModel);
      await onLinked();
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        signOut("Your session expired. Please sign in again.");
        return;
      }
      setError(errorMessage(err));
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header">
          <div className="step-header">
            <div className="step-number active">🔗</div>
            <div>
              <div className="step-title">This phone is already set up</div>
            </div>
          </div>
        </div>
        <div className="card-content">
          <p className="card-description" style={{ marginTop: 0, marginBottom: 20 }}>
            <strong>{deviceModel}</strong> ({deviceId}) already has Skyward installed and
            active as an admin — it just isn't linked to your account yet. That usually
            means the last setup finished on the phone but couldn't reach our servers at the
            final step.
          </p>

          <div className="alert alert-info" style={{ marginBottom: 16 }}>
            <p style={{ margin: 0, lineHeight: 1.6 }}>
              Linking only attaches this phone to your account. <strong>Nothing on the phone
                changes</strong> — no reinstall, no reset, and the protection currently running
              stays exactly as it is.
            </p>
          </div>

          {error && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              <p style={{ margin: 0 }}>{error}</p>
              <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                If this keeps happening, email {SUPPORT_EMAIL} and we'll link it for you.
              </p>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={linking}>
          Back
        </button>
        <button className="btn btn-primary" onClick={handleLink} disabled={linking}>
          {linking ? (
            <>
              <span className="spinner" /> Linking…
            </>
          ) : (
            "Link to my account"
          )}
        </button>
      </div>
    </div>
  );
}
