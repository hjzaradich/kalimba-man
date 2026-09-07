# Releasing

Cutting a release is one command from a clean tree:

```bash
node scripts/release.mjs 0.2.0 "Fixed the loop button"
```

It bumps the version, commits, tags `v0.2.0`, and pushes. GitHub Actions
then builds signed installers for Windows, macOS and Linux and publishes
them, with the updater's `latest.json`, to the public releases repo:

https://github.com/hjzaradich/kalimba-man-releases/releases

Installed copies check that file on launch and offer the update.

## One-time setup

1. **Repos.** The code repo (this one) can stay private. The releases repo
   must be public, because every installed copy fetches `latest.json`
   anonymously and GitHub does not serve release assets from private repos
   without a token.
2. **Signing key.** `~/.tauri/kalimba-man.key` was generated with
   `npx tauri signer generate`. Its public half is in `tauri.conf.json`.
   Back the private key up somewhere safe: lose it and no installed copy
   will ever accept another update. Never commit it.
3. **Secrets** on the code repo (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY`: the contents of `~/.tauri/kalimba-man.key`.
   - `RELEASES_TOKEN`: a fine-grained personal access token with
     *Contents: read and write* on the releases repo only.

## What friends see

Nothing is code-signed, which costs money and is separate from update
signing. First run therefore shows a warning:

- **Windows**: SmartScreen says the publisher is unknown. Click *More
  info*, then *Run anyway*. Installs per user; no admin rights needed.
- **macOS**: Gatekeeper refuses to open it. Right-click the app, choose
  *Open*, and confirm. On newer macOS the dialog sends you to
  *System Settings → Privacy & Security → Open Anyway* instead.
- **Linux**: the AppImage needs `chmod +x` once; the `.deb` installs normally.

Updates on Windows and Linux install in place. On macOS the updater
replaces the app bundle; if Gatekeeper objects again after an update, the
right-click *Open* dance is needed once more. Code signing and notarization
would remove all of this and are the "later" item on the roadmap.

## Checking macOS

There is no Mac on hand, so macOS builds are blind. Before telling a Mac
user to install, download the `.dmg` from a release on a borrowed Mac and
check: the app opens, a tab imports, audio plays after the first click, and
the updater banner appears when a newer release exists.

## If a release goes wrong

- The build failed: fix it, then delete the tag locally and remotely
  (`git tag -d v0.2.0 && git push origin :v0.2.0`), delete the draft release
  if one was made, and run the script again with the same version.
- The build succeeded but the app is broken: publish a higher version.
  Never re-upload different files under an existing tag; installed copies
  that already saw that version will not look again.
