import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface Device {
  serial: string;
  status: string;
  model: string | null;
  product: string | null;
}

function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function scanDevices() {
    setScanning(true);
    setError(null);
    try {
      const result = await invoke<Device[]>("detect_devices");
      setDevices(result);
      if (result.length === 0) {
        setError("No devices found. Make sure USB debugging is enabled and the phone is connected.");
      }
    } catch (e) {
      setError(String(e));
      setDevices([]);
    } finally {
      setScanning(false);
    }
  }

  return (
    <main className="container">
      <h1>Skyward Installer</h1>
      <p>Connect an Android device via USB and click scan.</p>

      <button onClick={scanDevices} disabled={scanning}>
        {scanning ? "Scanning..." : "Scan for Devices"}
      </button>

      {error && (
        <p style={{ color: "#ff6b6b", marginTop: "1rem" }}>{error}</p>
      )}

      {devices.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h3>Connected Devices:</h3>
          {devices.map((device) => (
            <div
              key={device.serial}
              style={{
                border: "1px solid #444",
                borderRadius: "8px",
                padding: "12px",
                marginTop: "8px",
              }}
            >
              <strong>{device.model || device.serial}</strong>
              <br />
              <small>
                Serial: {device.serial} | Status:{" "}
                <span
                  style={{
                    color: device.status === "device" ? "#51cf66" : "#ff6b6b",
                  }}
                >
                  {device.status}
                </span>
                {device.product && ` | Product: ${device.product}`}
              </small>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

export default App;
