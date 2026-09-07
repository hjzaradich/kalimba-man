#!/usr/bin/env node
/**
 * Cuts a release. Usage:
 *
 *   node scripts/release.mjs 0.2.0 "What changed"
 *
 * This bumps the version in the three places Tauri reads it, commits, tags
 * `v0.2.0`, and pushes the branch and the tag. GitHub Actions does the rest
 * (.github/workflows/ci.yml, job `release`): signed installers for Windows,
 * macOS and Linux, published with the updater's latest.json as a GitHub
 * release on this repo. Installed copies are offered the update on their
 * next launch.
 *
 * Three things must line up or updates fail silently for users:
 *   1. The version must increase; equal or lower and nobody is offered it.
 *   2. Artifacts must be signed with the key whose public half is in
 *      tauri.conf.json (the TAURI_SIGNING_PRIVATE_KEY secret in CI).
 *   3. latest.json must be reachable without auth: the repo is public.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAURI_CONF = join(root, "src-tauri", "tauri.conf.json");
const PACKAGE = join(root, "package.json");
const CARGO = join(root, "src-tauri", "Cargo.toml");

const [version, notes = ""] = process.argv.slice(2);

function die(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  die('Usage: node scripts/release.mjs <version> [notes]\n    e.g. node scripts/release.mjs 0.2.0 "Fixed the loop button"');
}
if (git("status", "--porcelain") !== "") {
  die("The working tree has uncommitted changes. Commit or stash them first.");
}
try {
  git("remote", "get-url", "origin");
} catch {
  die("No 'origin' remote. Add the GitHub repo first: git remote add origin <url>");
}

const conf = JSON.parse(readFileSync(TAURI_CONF, "utf8"));
const previous = conf.version;
const compare = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
// The very first release may keep the version already in the config, as long
// as no tag for it exists yet. After that, every release must go up.
let tagExists = false;
try {
  git("rev-parse", "-q", "--verify", `refs/tags/v${version}`);
  tagExists = true;
} catch {
  /* no such tag */
}
if (tagExists) {
  die(`Tag v${version} already exists. Pick a higher version; never re-release under an existing tag.`);
}
if (compare(version, previous) < 0 || (compare(version, previous) === 0 && tagExists)) {
  die(`tauri.conf.json is at ${previous}; ${version} must be higher or users on ${previous} are not offered it.`);
}

conf.version = version;
writeFileSync(TAURI_CONF, `${JSON.stringify(conf, null, 2)}\n`);

const pkg = JSON.parse(readFileSync(PACKAGE, "utf8"));
pkg.version = version;
writeFileSync(PACKAGE, `${JSON.stringify(pkg, null, 2)}\n`);

const cargo = readFileSync(CARGO, "utf8").replace(/^version = "[^"]+"/m, `version = "${version}"`);
writeFileSync(CARGO, cargo);
// Keep Cargo.lock in step so CI's `cargo test` does not complain.
execFileSync("cargo", ["update", "-p", "kalimba-man", "--offline"], { cwd: join(root, "src-tauri"), stdio: "ignore" });

console.log(`\n  version ${previous} → ${version}`);

const tag = `v${version}`;
git("add", TAURI_CONF, PACKAGE, CARGO, join(root, "src-tauri", "Cargo.lock"));
git("commit", "-m", `Release ${tag}${notes ? `\n\n${notes}` : ""}`);
git("tag", "-a", tag, "-m", notes || `Version ${version}`);
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
git("push", "origin", branch);
git("push", "origin", tag);

const origin = git("remote", "get-url", "origin").replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/");
console.log(`
  ✓ Tagged and pushed ${tag}

  Watch the build:   ${origin}/actions
  The release lands: ${origin}/releases/tag/${tag}
`);
