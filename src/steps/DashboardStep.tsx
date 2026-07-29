interface DashboardStepProps {
  deviceId: string;
  deviceModel: string;
  onSelectInstall: () => void;
  onSelectUpdate: () => void;
  onSelectRemove: () => void;
}

export default function DashboardStep({
  deviceId,
  deviceModel,
  onSelectInstall,
  onSelectUpdate,
  onSelectRemove,
}: DashboardStepProps) {
  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header">
          <div className="step-header">
            <div className="step-number active">⚙</div>
            <div>
              <div className="step-title">Device Management Dashboard</div>
            </div>
          </div>
        </div>
        <div className="card-content">
          <p className="card-description" style={{ marginTop: 0, marginBottom: 20 }}>
            Connected to <strong>{deviceModel}</strong> ({deviceId}). Select an administrative action below:
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            {/* Option 1: Enroll New / Setup */}
            <div
              className="device-card"
              style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 20, cursor: "pointer" }}
              onClick={onSelectInstall}
            >
              <div>
                <div style={{ fontSize: 28, marginBottom: 12 }}>🛡️</div>
                <div className="device-name" style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Initial Setup & Install</div>
                <div className="device-serial" style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.4 }}>
                  Install SkywardBlocker APK and configure Device Owner security protection.
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm mt-4"
                style={{ width: "100%", marginTop: 16 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectInstall();
                }}
              >
                Start Setup
              </button>
            </div>

            {/* Option 2: Update App */}
            <div
              className="device-card"
              style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 20, cursor: "pointer" }}
              onClick={onSelectUpdate}
            >
              <div>
                <div style={{ fontSize: 28, marginBottom: 12 }}>⬆️</div>
                <div className="device-name" style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Update Application</div>
                <div className="device-serial" style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.4 }}>
                  Push an updated APK over USB while maintaining Device Owner protection. Requires 10-min unlock.
                </div>
              </div>
              <button
                className="btn btn-outline btn-sm mt-4"
                style={{ width: "100%", marginTop: 16 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectUpdate();
                }}
              >
                Update App
              </button>
            </div>

            {/* Option 3: Remove App */}
            <div
              className="device-card"
              style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 20, cursor: "pointer" }}
              onClick={onSelectRemove}
            >
              <div>
                <div style={{ fontSize: 28, marginBottom: 12 }}>🗑️</div>
                <div className="device-name" style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Decommission & Remove</div>
                <div className="device-serial" style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.4 }}>
                  Release Device Owner privileges and cleanly uninstall SkywardBlocker. Requires 10-min unlock.
                </div>
              </div>
              <button
                className="btn btn-outline btn-sm mt-4"
                style={{ width: "100%", marginTop: 16, borderColor: "var(--destructive)", color: "var(--destructive)" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectRemove();
                }}
              >
                Remove App
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
