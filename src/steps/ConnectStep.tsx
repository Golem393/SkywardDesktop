import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Device {
  serial: string;
  status: string;
  model: string | null;
  product: string | null;
}

interface ConnectStepProps {
  onDeviceSelected: (serial: string, model: string) => void;
  onBack?: () => void;
}

export default function ConnectStep({ onDeviceSelected, onBack }: ConnectStepProps) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null);

  const scanDevices = useCallback(async () => {
    setScanning(true);
    try {
      const result = await invoke<Device[]>("detect_devices");
      setDevices(result);
      if (result.length === 1) {
        setSelectedSerial(result[0].serial);
      }
    } catch {
      setDevices([]);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    scanDevices();
  }, [scanDevices]);

  const handleContinue = () => {
    if (!selectedSerial) return;
    const device = devices.find((d) => d.serial === selectedSerial);
    onDeviceSelected(selectedSerial, device?.model || device?.serial || "Device");
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="card-header">
          <div className="step-header">
            <div className="step-number active">1</div>
            <div>
              <div className="step-title">Connect your device</div>
            </div>
          </div>
        </div>
        <div className="card-content">
          <p className="card-description" style={{ marginTop: 0 }}>
            Connect your Android phone to this computer using a USB cable. Make sure USB Debugging is enabled in Developer Options.
          </p>

          <div className="mt-4">
            <button className="btn btn-outline" onClick={scanDevices} disabled={scanning}>
              {scanning ? (
                <>
                  <span className="spinner" /> Scanning…
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  Scan for devices
                </>
              )}
            </button>
          </div>

          {devices.length > 0 && (
            <div className="mt-4 space-y-2">
              {devices.map((d) => (
                <div
                  key={d.serial}
                  className={`device-card ${selectedSerial === d.serial ? "selected" : ""}`}
                  onClick={() => setSelectedSerial(d.serial)}
                >
                  <div className="device-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                      <line x1="12" y1="18" x2="12.01" y2="18" />
                    </svg>
                  </div>
                  <div className="device-info">
                    <div className="device-name">{d.model || "Unknown Device"}</div>
                    <div className="device-serial">{d.serial}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`status-dot ${d.status === "device" ? "connected" : "pending"}`} />
                    <span className="text-xs text-muted">{d.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!scanning && devices.length === 0 && (
            <div className="mt-4" style={{ textAlign: "center", padding: "24px 16px" }}>
              <p className="text-sm text-muted">No devices found.</p>
              <p className="text-xs text-muted mt-2">
                Connect your phone via USB and enable USB Debugging, then click "Scan for devices".
              </p>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: onBack ? "space-between" : "flex-end" }}>
        {onBack && (
          <button className="btn btn-ghost" onClick={onBack}>
            Back
          </button>
        )}
        {selectedSerial && (
          <button className="btn btn-primary" onClick={handleContinue}>
            Continue
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
