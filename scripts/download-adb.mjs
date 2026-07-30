import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const resourcesDir = path.join(projectRoot, 'src-tauri', 'resources');
const tempDir = path.join(projectRoot, 'src-tauri', 'target', 'tmp-adb-downloads');

const PLATFORMS = {
  linux: {
    dir: 'platform-tools-linux',
    url: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip',
    required: 'adb',
  },
  macos: {
    dir: 'platform-tools-macos',
    url: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
    required: 'adb',
  },
  windows: {
    dir: 'platform-tools-windows',
    url: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip',
    required: 'adb.exe',
  },
};

function log(message) {
  console.log(`[ADB setup] ${message}`);
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = https.get(url, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
        file.close();
        fs.unlink(destPath, () => {});
        return resolve(downloadFile(response.headers.location, destPath));
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`HTTP status code ${response.statusCode}`));
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

function extractZip(zipPath, targetExtractDir) {
  fs.mkdirSync(targetExtractDir, { recursive: true });

  if (process.platform === 'win32') {
    log(`Extracting with PowerShell to ${targetExtractDir}`);
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${targetExtractDir}' -Force`], {
      stdio: 'inherit',
    });
    return;
  }

  if (process.env.PATH && process.env.PATH.includes('unzip')) {
    try {
      log(`Extracting with unzip to ${targetExtractDir}`);
      execFileSync('unzip', ['-o', zipPath, '-d', targetExtractDir], { stdio: 'inherit' });
      return;
    } catch {
      // fall through to python fallback
    }
  }

  log(`Extracting with Python zipfile to ${targetExtractDir}`);
  execFileSync('python3', ['-m', 'zipfile', '-e', zipPath, targetExtractDir], { stdio: 'inherit' });
}

function isPlatformToolBinary(name) {
  const lower = name.toLowerCase();
  return lower === 'adb' || lower === 'adb.exe' || lower.endsWith('.dll') || lower.endsWith('.so') || lower.endsWith('.dylib') || lower.includes('lib');
}

function copyPlatformTools(sourceDir, destDir) {
  const platformToolsDir = path.join(sourceDir, 'platform-tools');
  if (!fs.existsSync(platformToolsDir)) {
    throw new Error(`Expected platform-tools directory was not found in ${sourceDir}`);
  }

  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(platformToolsDir);

  for (const entry of entries) {
    const srcPath = path.join(platformToolsDir, entry);
    const targetPath = path.join(destDir, entry);

    if (!isPlatformToolBinary(entry)) {
      continue;
    }

    fs.cpSync(srcPath, targetPath, { recursive: true, force: true });

    const lower = entry.toLowerCase();
    if (entry === 'adb' || lower.endsWith('.so') || lower.endsWith('.dylib')) {
      try {
        fs.chmodSync(targetPath, 0o755);
      } catch {
        // ignore chmod failures on Windows filesystems
      }
    }
  }
}

async function ensureAdbBundle() {
  log(`Preparing bundled ADB under ${resourcesDir}`);
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  for (const [platformKey, config] of Object.entries(PLATFORMS)) {
    const bundleDir = path.join(resourcesDir, config.dir);
    const requiredFile = path.join(bundleDir, config.required);

    if (fs.existsSync(requiredFile)) {
      log(`[${platformKey}] ADB bundle already exists at ${bundleDir}`);
      continue;
    }

    log(`[${platformKey}] Downloading platform-tools from ${config.url}`);
    const zipPath = path.join(tempDir, `${platformKey}.zip`);
    const extractDir = path.join(tempDir, `extract-${platformKey}`);

    await downloadFile(config.url, zipPath);
    extractZip(zipPath, extractDir);
    copyPlatformTools(extractDir, bundleDir);

    log(`[${platformKey}] ADB bundle ready at ${bundleDir}`);
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
  log('ADB bundles prepared for Linux, Windows, and macOS');
}

ensureAdbBundle().catch((err) => {
  console.error('[ADB setup] Failed to prepare ADB bundle:', err);
  process.exit(1);
});
