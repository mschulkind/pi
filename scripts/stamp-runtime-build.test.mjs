import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { test } from "node:test";
import { captureBuildIdentity, stampRuntimeBuild } from "./stamp-runtime-build.mjs";

test("a packaged loaded stamp stays tied to build bytes, not changed disk HEAD", async () => {
 const root = mkdtempSync(join(tmpdir(), "pi-stamp-"));
 const git = (...args) => execFileSync("git", ["-C", root, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.test", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.test" }, stdio: "pipe" });
 try {
  mkdirSync(join(root, "packages/coding-agent/dist/core"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  writeFileSync(join(root, "packages/coding-agent/package.json"), '{"version":"1.2.3","type":"module"}');
  writeFileSync(join(root, "packages/coding-agent/dist/index.js"), 'export const fixture = 1;');
  git("init"); git("add", "."); git("commit", "-m", "fixture");
  const first = stampRuntimeBuild(root);
  const entry = join(root, "packages/coding-agent/dist/core/runtime-build.js");
  const loaded = require(entry).runtimeBuildIdentity;
  assert.deepEqual(loaded, first);
  assert.equal(first.dirty, false);
  writeFileSync(join(root, "packages/coding-agent/dist/index.js"), 'export const fixture = 2;');
  const dirty = captureBuildIdentity(root);
  assert.equal(dirty.dirty, true);
  assert.notEqual(dirty.buildDigest, first.buildDigest);
  git("add", "."); git("commit", "-m", "changed");
  const second = stampRuntimeBuild(root);
  assert.notEqual(second.forkCommit, first.forkCommit);
  assert.equal(require(entry).runtimeBuildIdentity.forkCommit, first.forkCommit);
  assert.match(readFileSync(join(root, "packages/coding-agent/dist/core/runtime-build.js"), "utf8"), new RegExp(second.forkCommit));
 } finally { rmSync(root, { recursive: true, force: true }); }
});
