import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execSync } from 'node:child_process';
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

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const request = https.get(url, (response) => {
      // Handle redirects
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
    }).on('error', (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

async function extractZip(zipPath, targetExtractDir) {
  fs.mkdirSync(targetExtractDir, { recursive: true });
  let extracted = false;

  // Try extracting via adm-zip if present in node_modules
  try {
    const AdmZipModule = await import('adm-zip').catch(() => null);
    if (AdmZipModule && AdmZipModule.default) {
      const zip = new AdmZipModule.default(zipPath);
      zip.extractAllTo(targetExtractDir, true);
      extracted = true;
    } else if (AdmZipModule && typeof AdmZipModule === 'function') {
      const zip = new AdmZipModule(zipPath);
      zip.extractAllTo(targetExtractDir, true);
      extracted = true;
    }
  } catch (err) {
    // Fall back to OS utilities below
  }

  // OS utilities fallback for cross-platform zero-dependency extraction
  if (!extracted) {
    if (process.platform === 'win32') {
      execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${targetExtractDir}' -Force"`, { stdio: 'inherit' });
    } else {
      try {
        execSync(`unzip -o "${zipPath}" -d "${targetExtractDir}"`, { stdio: 'inherit' });
      } catch (unzipErr) {
        execSync(`python3 -m zipfile -e "${zipPath}" "${targetExtractDir}"`, { stdio: 'inherit' });
      }
    }
  }
}

async function main() {
  console.log('[Setup ADB] Checking bundled ADB platform binaries in src-tauri/resources/...');

  // Check if all platform binaries already exist
  let allExist = true;
  for (const [key, config] of Object.entries(PLATFORMS)) {
    const checkPath = path.join(resourcesDir, config.dir, config.required);
    if (!fs.existsSync(checkPath)) {
      allExist = false;
      break;
    }
  }

  if (allExist) {
    console.log('[Setup ADB] All ADB platform binaries are already present! Skipping download.');
    return;
  }

  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  for (const [platformKey, config] of Object.entries(PLATFORMS)) {
    const destDir = path.join(resourcesDir, config.dir);
    const requiredFile = path.join(destDir, config.required);

    if (fs.existsSync(requiredFile)) {
      console.log(`[Setup ADB] [${platformKey}] Binary already exists at ${config.dir}, skipping.`);
      continue;
    }

    console.log(`[Setup ADB] [${platformKey}] Downloading Google Android Platform-Tools...`);
    const zipPath = path.join(tempDir, `${platformKey}.zip`);
    const extractDir = path.join(tempDir, `extract-${platformKey}`);

    await downloadFile(config.url, zipPath);
    console.log(`[Setup ADB] [${platformKey}] Extracting archive...`);
    await extractZip(zipPath, extractDir);

    fs.mkdirSync(destDir, { recursive: true });

    const platformToolsDir = path.join(extractDir, 'platform-tools');
    if (fs.existsSync(platformToolsDir)) {
      const items = fs.readdirSync(platformToolsDir);
      for (const item of items) {
        const lower = item.toLowerCase();
        // Keep ADB binary and all required libraries (e.g. AdbWinApi.dll, AdbWinUsbApi.dll, Linux/Mac dynamic libs)
        const shouldCopy = lower === 'adb' ||
                           lower === 'adb.exe' ||
                           lower.endsWith('.dll') ||
                           lower.endsWith('.so') ||
                           lower.endsWith('.dylib') ||
                           lower.includes('lib');

        if (shouldCopy) {
          const srcPath = path.join(platformToolsDir, item);
          const targetPath = path.join(destDir, item);
          fs.cpSync(srcPath, targetPath, { recursive: true, force: true });

          // Guarantee execution permissions on Linux and macOS binaries/libraries
          if (item === 'adb' || lower.endsWith('.so') || lower.endsWith('.dylib')) {
            try {
              fs.chmodSync(targetPath, 0o755);
            } catch (chmodErr) {
              // Ignore chmod errors on Windows filesystems
            }
          }
        }
      }
    }

    console.log(`[Setup ADB] [${platformKey}] Successfully set up in ${config.dir}/`);
  }

  // Cleanup temporary downloads
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('[Setup ADB] All ADB binaries have been successfully downloaded and bundled!');
}

main().catch((err) => {
  console.error('[Setup ADB] Error during setup:', err);
  process.exit(1);
});
