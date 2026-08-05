interface UsbDebuggingStepProps {
  onContinue: () => void;
  onCancel: () => void;
}

const INSTRUCTIONS: { title: string; detail: string }[] = [
  {
    title: "Remove every account from the phone",
    detail:
      "Settings → Accounts, and remove all Google and other accounts. Android refuses to hand over device administration while any account is still signed in, so setup will fail otherwise.",
  },
  {
    title: "Unlock Developer options",
    detail:
      "Settings → About phone, then tap Build number seven times. You'll be asked for the phone's PIN, then see \"You are now a developer\".",
  },
  {
    title: "Turn on USB debugging",
    detail:
      "Settings → System → Developer options, and switch on USB debugging.",
  },
  {
    title: "Connect the phone by USB",
    detail:
      "Plug the phone into this computer. A prompt will appear on the phone asking you to allow USB debugging — tap Allow.",
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
            Do these four things on the phone you want to protect, in order.
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
              Setup wipes nothing, but it does take over device administration. Back up anything
              you care about first.
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={onContinue}>
          I've done all four
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
