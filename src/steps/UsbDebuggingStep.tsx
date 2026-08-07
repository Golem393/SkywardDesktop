interface UsbDebuggingStepProps {
  onContinue: () => void;
  onCancel: () => void;
}

/**
 * Signing out of accounts is deliberately NOT here. It used to be step 1, which left the
 * phone signed out for the whole of setup; it now happens in InstallStep, immediately
 * before Device Owner is claimed, so the window is as short as possible.
 */
const INSTRUCTIONS: { title: string; detail: string }[] = [
  {
    title: "Unlock Developer options",
    detail:
      "Open the Settings app and go to About phone → Software information → Build number. Tap Build number 7 times.",
  },
  {
    title: "Turn on USB debugging",
    detail:
      "Go to Settings → Developer options → USB deubgging. Tap the toggle to turn on USB debugging",
  },
];

export default function UsbDebuggingStep({ onContinue, onCancel }: UsbDebuggingStepProps) {
  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header">
          <div className="step-header">
            <div className="step-number active">1</div>
            <div>
              <div className="step-title">Prepare the phone</div>
            </div>
          </div>
        </div>
        <div className="card-content">
          <p className="card-description" style={{ marginTop: 0, marginBottom: 20 }}>
            Follow the steps below to prepare for the setup.
          </p>

          <ol className="instruction-list">
            {INSTRUCTIONS.map((item, i) => (
              <li key={item.title}>
                <span className="instruction-number">{i + 1}</span>
                <div>
                  <div className="instruction-title">{item.title}</div>
                  <p className="instruction-detail">{item.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="alert alert-info" style={{ marginTop: 20 }}>
            <p style={{ margin: 0, lineHeight: 1.6 }}>
              If you are using a Samsung device, you may need to turn off the Auto Blocker. To disable it, go to Settings → Security and privacy → Auto Blocker and tap the toggle.
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={onContinue}>
          I enabled USB debugging
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
