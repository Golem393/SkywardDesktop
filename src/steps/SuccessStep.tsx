interface SuccessStepProps {
  deviceModel: string;
  email: string;
  onDone: () => void;
}

export default function SuccessStep({ deviceModel, email, onDone }: SuccessStepProps) {
  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header" style={{ textAlign: "center", paddingBottom: 0 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "oklch(0.60 0.15 150 / 0.12)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--success)" }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="card-title" style={{ fontSize: 22, textAlign: "center" }}>
            Setup Complete
          </h2>
          <p className="card-description" style={{ textAlign: "center", maxWidth: 340, margin: "8px auto 0" }}>
            SkywardBlocker has been installed and activated on <strong>{deviceModel}</strong>.
          </p>
        </div>
        <div className="card-content" style={{ textAlign: "center" }}>

          <div className="mt-6">
            <p className="text-sm text-muted" style={{ lineHeight: 1.6 }}>
              You can safely disconnect the USB cable.
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <button className="btn btn-primary" onClick={onDone}>
          Back to Dashboard
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
