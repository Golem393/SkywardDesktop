import { ReactNode, useCallback, useEffect, useState } from "react";
import "./App.css";

import LoginStep from "./steps/LoginStep";
import HomePage from "./pages/HomePage";
import DevicesPage from "./pages/DevicesPage";
import UpdateBanner from "./components/UpdateBanner";
import { errorMessage, fetchMe, Me, SessionExpiredError, setAccessToken } from "./lib/api";

declare global {
  interface Window {
    /** Dev-only: corrupts the in-memory session token so the next authenticated call
     *  401s, without waiting out the real ~1hr Supabase JWT expiry. Only defined in dev
     *  builds — see the `import.meta.env.DEV` guard below. */
    __expireSession?: () => void;
  }
}

type Route = "home" | "devices";

const NAV: { key: Route; label: string; icon: ReactNode }[] = [
  {
    key: "home",
    label: "Home",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    key: "devices",
    label: "Devices",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
        <line x1="12" y1="18" x2="12.01" y2="18" />
      </svg>
    ),
  },
];

if (import.meta.env.DEV) {
  // From the webview devtools console (right-click → Inspect): window.__expireSession()
  // then click Refresh / Push Schedule / Create Schedule / Remove Device to see the
  // session-expiry handling without waiting out a real token.
  window.__expireSession = () => {
    setAccessToken("dev-forced-expiry-" + Date.now());
    console.log("[dev] Session token corrupted — the next authenticated call will 401.");
  };
}

const PAGE_COPY: Record<Route, { title: string; subtitle: string }> = {
  home: {
    title: "Home",
    subtitle: "Your blocking schedule and where it stands.",
  },
  devices: {
    title: "Devices",
    subtitle: "Set up and manage the phone Skyward protects.",
  },
};

function App() {
  const [email, setEmail] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [route, setRoute] = useState<Route>("home");

  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);

  /** Clears everything tied to the current login. Shared by the manual "Sign out" button
   *  and by an expired-session auto-logout — the two differ only in the message left for
   *  the login screen to show. */
  const signOut = useCallback((reason?: string) => {
    setAccessToken(null);
    setEmail("");
    setSignedIn(false);
    setMe(null);
    setLoadError(null);
    setRoute("home");
    setSessionMessage(reason ?? null);
  }, []);

  /** Re-read the account record. Every mutation funnels through this so Home and Devices
   *  never drift from what the backend actually holds. */
  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setMe(await fetchMe());
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        // Retrying with the same dead token can never succeed, and leaving the last
        // successful fetch on screen (behind an error banner) reads as current data when
        // it may no longer be — e.g. a schedule deleted server-side after the last
        // successful refresh. Sign out fully rather than just showing an error.
        signOut("Your session expired. Please sign in again.");
        return;
      }
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [signOut]);

  useEffect(() => {
    if (signedIn) refresh();
  }, [signedIn, refresh]);

  const handleLogin = (userEmail: string) => {
    setEmail(userEmail);
    setSignedIn(true);
    setRoute("home");
  };

  if (!signedIn) {
    // The banner sits outside the shell too: the update check finishes long before anyone
    // signs in, and the login screen is the calmest moment to interrupt for a restart.
    return (
      <>
        <UpdateBanner />
        <LoginStep onLogin={handleLogin} message={sessionMessage} />
      </>
    );
  }

  return (
    <div className="app-shell">
      <UpdateBanner />
      <nav className="navbar">
        <div className="navbar-brand">
          <svg className="navbar-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 2L2 7l10 5 10-5-10-5z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 17l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 12l10 5 10-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Skyward Installer
        </div>
        <div className="navbar-right">
          <span className="navbar-email">{email}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={refresh}
            disabled={loading}
            title="Re-fetch your schedule and device from the server"
          >
            {loading ? (
              <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            )}
            Refresh
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </nav>

      <div className="page-container wide">
        <div className="dashboard-grid">
          <aside className="sidebar">
            <nav className="sidebar-nav">
              {NAV.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`nav-item ${route === item.key ? "active" : ""}`}
                  onClick={() => setRoute(item.key)}
                  aria-current={route === item.key ? "page" : undefined}
                >
                  <span className="nav-item-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>
          </aside>

          <main className="main-content">
            <div className="page-header">
              <h1>{PAGE_COPY[route].title}</h1>
              <p>{PAGE_COPY[route].subtitle}</p>
            </div>

            {loadError && (
              <div className="alert alert-error" style={{ marginBottom: 16 }}>
                <p style={{ margin: 0 }}>{loadError}</p>
                <button className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={refresh}>
                  Try again
                </button>
              </div>
            )}

            <div className="animate-in" key={route}>
              {route === "home" && (
                <HomePage me={me} loading={loading} refresh={refresh} signOut={signOut} onGoToDevices={() => setRoute("devices")} />
              )}
              {route === "devices" && (
                <DevicesPage me={me} loading={loading} refresh={refresh} signOut={signOut} />
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;
