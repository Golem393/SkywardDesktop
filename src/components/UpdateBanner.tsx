import { useEffect, useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Where the update got to. `idle` covers both "haven't looked yet" and "nothing to do",
 *  since neither should put anything on screen. */
type Phase = "idle" | "available" | "downloading" | "ready" | "failed";

/**
 * Checks for a new Skyward Installer build on launch and, if the parent agrees, installs it.
 *
 * Update checks are deliberately silent when they fail. The check runs before login against
 * a server that may be asleep (Render free tier cold-starts), and a parent halfway through
 * provisioning a phone cannot act on "couldn't reach the update server" — so a failed
 * *check* leaves no trace and we try again next launch. A failed *install* does surface,
 * because by then they clicked a button and are owed an outcome.
 *
 * Installing is never automatic. On Windows the installer closes the app to swap the binary,
 * which mid-provisioning would leave a phone half-configured, so the parent picks the moment.
 */
export default function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    check()
      .then((found) => {
        // `check()` resolves to null when the running version is already current.
        if (cancelled || !found) return;
        setUpdate(found);
        setPhase("available");
      })
      .catch((err) => {
        // Intentionally not surfaced — see the note above.
        console.warn("[updater] check failed:", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function install() {
    if (!update) return;
    setPhase("downloading");
    setError(null);
    try {
      // Verifies the signature against the pubkey compiled into the app before writing
      // anything, so a tampered artifact fails here rather than being installed.
      await update.downloadAndInstall();
      setPhase("ready");
      // On Windows the NSIS installer has already exited the app by this point and this
      // line never runs; on Linux and macOS the swap is in place and we restart into it.
      await relaunch();
    } catch (err) {
      setPhase("failed");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (phase === "idle" || !update) return null;

  return (
    <div className={`alert ${phase === "failed" ? "alert-error" : "alert-info"} update-banner`}>
      <div className="update-banner-text">
        {phase === "failed" ? (
          <>
            <strong>Update failed.</strong> {error} — you can download the latest version
            from the Skyward website instead.
          </>
        ) : phase === "ready" ? (
          <>
            <strong>Update installed.</strong> Restarting…
          </>
        ) : (
          <>
            <strong>Version {update.version} is available.</strong>
            {update.body ? ` ${update.body}` : " "}
          </>
        )}
      </div>

      {(phase === "available" || phase === "failed") && (
        <button className="btn btn-primary btn-sm" onClick={install}>
          {phase === "failed" ? "Try again" : "Install and restart"}
        </button>
      )}

      {phase === "downloading" && (
        <span className="update-banner-progress">
          <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
          Downloading…
        </span>
      )}
    </div>
  );
}
