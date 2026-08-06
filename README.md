# Skyward Installer

Desktop companion that installs and provisions SkywardBlocker on an Android phone over ADB.
Ships its own `adb` — users install nothing else.

## Development

```bash
npm install
npm run tauri dev
```

`npm run setup:adb` downloads Google's platform-tools into `src-tauri/resources/` on first
run. They're gitignored; the build re-downloads them if missing.

## Building locally

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/skyward-updater.key)"
npm run tauri build
```

**The export is required.** `tauri.conf.json` pins an updater public key, and Tauri refuses
to finish a build it can't sign — you get `A public key has been found, but no private key`
*after* the bundle is written, which looks like a bundling failure but isn't. Put the export
in your shell profile.

Bundles land in `src-tauri/target/release/bundle/`. Only ADB for the host platform is
bundled, via `tauri.{linux,windows,macos}.conf.json` — building all three into every
installer would add ~30 MB of tools nobody on that platform can run.

## Releasing

The git tag is the single source of truth for the version; CI writes it into `package.json`
and `Cargo.toml`, and `tauri.conf.json` reads it back out of `package.json`. Don't edit the
version by hand.

```bash
git tag v0.1.2 && git push origin main --tags
```

That builds Linux, Windows and macOS, uploads the installers to the public
`desktop-releases` Supabase bucket, and publishes a `desktop_releases` row — which is what
both the website's download buttons and installed copies' update checks read, via
`/api/desktop/latest.json` on mdm-backend.

A tag that isn't `vX.Y.Z` fails the build early and on purpose: MSI and `.app` reject
anything that isn't strictly three numeric components.

### Required GitHub secrets

| Secret | Where it comes from |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/skyward-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | empty string (the key was generated without one) |
| `SUPABASE_URL` | Supabase project settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings — service role, not anon |

**Back up the private key somewhere you won't lose it.** It is the only thing existing
installs trust. Lose it and no already-installed copy can ever be updated again — every
client would reject a differently-signed build, and the only route back is asking each
user to download and install a new one by hand.

## Auto-updates

`src/components/UpdateBanner.tsx` checks on launch and offers the update; installing is
always the parent's choice, since on Windows the installer closes the app to swap the
binary and mid-provisioning that would leave a phone half-configured.

Two platform limits shape the release artifacts:

- **Linux updates only work from the AppImage.** `.deb` and `.rpm` belong to the package
  manager, so promote the AppImage as the Linux download.
- **macOS updates use `.app.tar.gz`**, not the `.dmg` a first-time visitor downloads, which
  is why `desktop_releases` stores `platforms` (updater) and `downloads` (website)
  separately.
