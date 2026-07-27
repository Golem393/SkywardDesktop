import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

interface Device {
  serial: string;
  status: string;
  model: string | null;
  product: string | null;
}

interface DeviceInfo {
  serial: string;
  model: string;
  manufacturer: string;
  android_version: string;
  sdk_version: string;
}

interface PrerequisiteResult {
  usb_authorized: boolean;
  no_existing_owner: boolean;
  no_accounts: boolean;
  messages: string[];
  can_proceed: boolean;
}

interface VerificationResult {
  is_installed: boolean;
  is_device_owner: boolean;
  success: boolean;
  message: string;
}

interface AuthResponse {
  success: boolean;
  errorMessage: string | null;
}

function App() {
  // Device state
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  // Command output/test state
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [prereqResult, setPrereqResult] = useState<PrerequisiteResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerificationResult | null>(null);
  const [commandLog, setCommandLog] = useState<string>("");
  const [apkPath, setApkPath] = useState<string>("");

  // Auth test state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authResult, setAuthResult] = useState<string | null>(null);

  const log = (msg: string) => {
    setCommandLog((prev) => `[${new Date().toLocaleTimeString()}] ${msg}\n` + prev);
  };

  async function scanDevices() {
    setScanning(true);
    try {
      const result = await invoke<Device[]>("detect_devices");
      setDevices(result);
      log(`Scanned devices: found ${result.length}`);
      if (result.length > 0 && !selectedSerial) {
        setSelectedSerial(result[0].serial);
      }
    } catch (e) {
      log(`Scan failed: ${String(e)}`);
      setDevices([]);
    } finally {
      setScanning(false);
    }
  }

  async function checkPrereqs() {
    if (!selectedSerial) return;
    try {
      log("Checking prerequisites...");
      const res = await invoke<PrerequisiteResult>("check_prerequisites", { deviceId: selectedSerial });
      setPrereqResult(res);
      log(`Prerequisites result: can_proceed = ${res.can_proceed}`);
    } catch (e) {
      log(`Prereq check failed: ${String(e)}`);
    }
  }

  async function getInfo() {
    if (!selectedSerial) return;
    try {
      const info = await invoke<DeviceInfo>("get_device_info", { deviceId: selectedSerial });
      setDeviceInfo(info);
      log(`Device Info: ${info.manufacturer} ${info.model} (Android ${info.android_version})`);
    } catch (e) {
      log(`Get info failed: ${String(e)}`);
    }
  }

  async function testVerify() {
    if (!selectedSerial) return;
    try {
      const res = await invoke<VerificationResult>("verify_installation", { deviceId: selectedSerial });
      setVerifyResult(res);
      log(`Verify installation: ${res.message}`);
    } catch (e) {
      log(`Verify failed: ${String(e)}`);
    }
  }

  async function handleInstall() {
    if (!selectedSerial || !apkPath) {
      log("Error: please enter a local APK path to install.");
      return;
    }
    try {
      log(`Installing APK from ${apkPath}...`);
      const res = await invoke<string>("install_apk", { deviceId: selectedSerial, apkPath });
      log(`Success: ${res}`);
    } catch (e) {
      log(`Install Error: ${String(e)}`);
    }
  }

  async function handleSetOwner() {
    if (!selectedSerial) return;
    try {
      log("Setting Device Owner...");
      const res = await invoke<string>("set_device_owner", { deviceId: selectedSerial });
      log(`Success: ${res}`);
    } catch (e) {
      log(`Set Owner Error: ${String(e)}`);
    }
  }

  async function handleClearOwner() {
    if (!selectedSerial) return;
    try {
      log("Sending CLEAR_OWNER broadcast...");
      const res = await invoke<string>("clear_device_owner", { deviceId: selectedSerial });
      log(`Response: ${res}`);
    } catch (e) {
      log(`Clear Owner Error: ${String(e)}`);
    }
  }

  async function handleUninstall() {
    if (!selectedSerial) return;
    try {
      log("Attempting uninstall (clearing owner first)...");
      const res = await invoke<string>("uninstall_app", { deviceId: selectedSerial });
      log(`Success: ${res}`);
    } catch (e) {
      log(`Uninstall Error: ${String(e)}`);
    }
  }

  async function handlePushConfig() {
    if (!selectedSerial) return;
    try {
      log("Pushing runtime configuration via ADB broadcast...");
      const res = await invoke<string>("push_config", { deviceId: selectedSerial });
      log(`Success: ${res}`);
    } catch (e) {
      log(`Push Config Error: ${String(e)}`);
    }
  }

  async function testAuth() {
    if (!email || !password) {
      setAuthResult("Please enter email and password");
      return;
    }
    try {
      log(`Verifying subscription for ${email}...`);
      const res = await invoke<AuthResponse>("verify_subscription", { email, password });
      if (res.success) {
        setAuthResult("✅ Active subscription confirmed!");
        log("Auth successful: Active subscription confirmed.");
      } else {
        setAuthResult(`❌ Auth failed: ${res.errorMessage || "Unknown error"}`);
        log(`Auth rejected: ${res.errorMessage}`);
      }
    } catch (e) {
      setAuthResult(`Network / Backend error: ${String(e)}`);
      log(`Auth error: ${String(e)}`);
    }
  }

  return (
    <main className="container" style={{ textAlign: "left" }}>
      <h2 style={{ marginBottom: "20px" }}>Skyward Installer — Phase 3 Command Tester</h2>
      
      {/* 1. Device Selection & Detection */}
      <section style={{ padding: "16px", marginBottom: "16px" }}>
        <h3 style={{ marginTop: 0 }}>1. Device Detection</h3>
        <button onClick={scanDevices} disabled={scanning} style={{ marginRight: "12px" }}>
          {scanning ? "Scanning..." : "Scan for Devices"}
        </button>

        {devices.length > 0 && (
          <div style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "10px" }}>
            <label style={{ color: "#f0f6fc", fontWeight: 600 }}>Select Device: </label>
            <select
              value={selectedSerial || ""}
              onChange={(e) => setSelectedSerial(e.target.value)}
              style={{
                minWidth: "320px",
                colorScheme: "dark",
                color: "#ffffff",
                backgroundColor: "#161b22",
                border: "1px solid #30363d",
                padding: "8px 12px",
                borderRadius: "6px"
              }}
            >
              {devices.map((d) => (
                <option
                  key={d.serial}
                  value={d.serial}
                  style={{ color: "#ffffff", backgroundColor: "#161b22" }}
                >
                  {d.model || d.serial} ({d.status}) — [{d.serial}]
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {/* 2. Device Controls & Tests */}
      {selectedSerial && (
        <section style={{ padding: "16px", marginBottom: "16px" }}>
          <h3 style={{ marginTop: 0 }}>2. Commands for Selected Device ({selectedSerial})</h3>
          
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
            <button onClick={getInfo}>Get Device Info</button>
            <button onClick={checkPrereqs}>Check Prerequisites</button>
            <button onClick={testVerify}>Verify Installation</button>
            <button onClick={handlePushConfig} style={{ borderColor: "#58a6ff", color: "#58a6ff" }}>Push Config (Phase 3.5)</button>
            <button onClick={handleSetOwner} style={{ borderColor: "#2ea043", color: "#3fb950" }}>Set Device Owner</button>
            <button onClick={handleClearOwner} style={{ borderColor: "#d29922", color: "#e3b341" }}>Clear Owner Broadcast</button>
            <button onClick={handleUninstall} style={{ borderColor: "#f85149", color: "#ff7b72" }}>Uninstall App</button>
          </div>

          <div style={{ marginTop: "12px", display: "flex", gap: "8px", alignItems: "center" }}>
            <input
              type="text"
              placeholder="/absolute/path/to/app-debug.apk"
              value={apkPath}
              onChange={(e) => setApkPath(e.target.value)}
              style={{ flex: 1 }}
            />
            <button onClick={handleInstall}>Install APK</button>
          </div>

          {/* Render check outputs */}
          {deviceInfo && (
            <div style={{ background: "#21262d", border: "1px solid #30363d", color: "#f0f6fc", padding: "12px", borderRadius: "6px", marginTop: "14px", fontSize: "14px" }}>
              <strong style={{ color: "#58a6ff" }}>Device Details:</strong> {deviceInfo.manufacturer} {deviceInfo.model} | Android {deviceInfo.android_version} (SDK {deviceInfo.sdk_version})
            </div>
          )}

          {prereqResult && (
            <div style={{ background: "#21262d", border: "1px solid #30363d", color: "#f0f6fc", padding: "12px", borderRadius: "6px", marginTop: "14px", fontSize: "14px" }}>
              <strong style={{ color: prereqResult.can_proceed ? "#3fb950" : "#ff7b72" }}>
                Prerequisites Status: {prereqResult.can_proceed ? "READY TO INSTALL" : "CHECKS FAILED"}
              </strong>
              <ul style={{ margin: "8px 0 0 20px", color: "#c9d1d9" }}>
                {prereqResult.messages.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}

          {verifyResult && (
            <div style={{ background: "#21262d", border: "1px solid #30363d", color: "#f0f6fc", padding: "12px", borderRadius: "6px", marginTop: "14px", fontSize: "14px" }}>
              <strong style={{ color: verifyResult.success ? "#3fb950" : "#e3b341" }}>Verification:</strong> {verifyResult.message}
              <div style={{ marginTop: "4px", fontSize: "13px", color: "#8b949e" }}>
                Installed: <span style={{ color: verifyResult.is_installed ? "#3fb950" : "#ff7b72" }}>{String(verifyResult.is_installed)}</span> | Device Owner: <span style={{ color: verifyResult.is_device_owner ? "#3fb950" : "#ff7b72" }}>{String(verifyResult.is_device_owner)}</span>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 3. Subscription Auth Tester */}
      <section style={{ padding: "16px", marginBottom: "16px" }}>
        <h3 style={{ marginTop: 0 }}>3. Test Backend Subscription Check</h3>
        <div style={{ display: "flex", gap: "10px", maxWidth: "500px" }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ flex: 1 }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ flex: 1 }}
          />
          <button onClick={testAuth}>Check</button>
        </div>
        {authResult && <p style={{ marginTop: "12px", fontWeight: 600, color: authResult.includes("✅") ? "#3fb950" : "#ff7b72" }}>{authResult}</p>}
      </section>

      {/* 4. Console Logs */}
      <section style={{ padding: "16px" }}>
        <h3 style={{ marginTop: 0 }}>Command Activity Log</h3>
        <pre style={{
          background: "#0d1117",
          color: "#7ee787",
          border: "1px solid #30363d",
          padding: "12px",
          borderRadius: "6px",
          maxHeight: "200px",
          overflowY: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace",
          fontSize: "13px",
          lineHeight: "1.5",
          margin: 0
        }}>
          {commandLog || "No commands executed yet."}
        </pre>
      </section>
    </main>
  );
}

export default App;
