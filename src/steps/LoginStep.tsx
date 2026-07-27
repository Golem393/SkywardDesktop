import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface AuthResponse {
  success: boolean;
  errorMessage: string | null;
}

interface LoginStepProps {
  onLogin: (email: string) => void;
}

export default function LoginStep({ onLogin }: LoginStepProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    setError(null);

    try {
      const res = await invoke<AuthResponse>("verify_subscription", { email, password });
      if (res.success) {
        onLogin(email);
      } else {
        setError(res.errorMessage || "Authentication failed. Please check your credentials.");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page aurora">
      <div className="login-card">
        <div className="card">
          <div className="card-header">
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: "oklch(0.71 0.08 247 / 0.1)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 12,
                }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--primary)" }}>
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <polyline points="10 17 15 12 10 7" />
                  <line x1="15" y1="12" x2="3" y2="12" />
                </svg>
              </div>
            </div>
            <h2 className="card-title" style={{ textAlign: "center", fontSize: 20 }}>
              Welcome to Skyward
            </h2>
            <p className="card-description" style={{ textAlign: "center" }}>
              Sign in with your Skyward account to set up a device.
            </p>
          </div>
          <div className="card-content">
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="label" htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && (
                <div
                  style={{
                    background: "oklch(0.6 0.22 27 / 0.08)",
                    border: "1px solid oklch(0.6 0.22 27 / 0.2)",
                    borderRadius: "calc(var(--radius) - 2px)",
                    padding: "10px 14px",
                    fontSize: 13,
                    color: "var(--destructive)",
                    marginBottom: 16,
                  }}
                >
                  {error}
                </div>
              )}

              <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                {loading ? (
                  <>
                    <span className="spinner" /> Verifying…
                  </>
                ) : (
                  "Sign in"
                )}
              </button>
            </form>
          </div>
        </div>

        <p className="text-xs text-muted text-center mt-4" style={{ lineHeight: 1.5 }}>
          Don't have an account? Visit{" "}
          <span style={{ color: "var(--primary)", fontWeight: 500 }}>skywardos.com</span>{" "}
          to subscribe.
        </p>
      </div>
    </div>
  );
}
