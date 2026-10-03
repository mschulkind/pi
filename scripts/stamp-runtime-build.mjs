import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function captureBuildIdentity(root) {
 const git = (...args) => {
  try { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim(); } catch { return null; }
 };
 const hash = createHash("sha256");
 // Compiled inputs include dependency workspaces and local dirty source, not just HEAD.
 // Ignore the stamp itself so repeated stamping is deterministic.
 const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
   const path = join(dir, entry.name);
   if (entry.isDirectory()) walk(path);
   else if (entry.isFile() && /\.(js|json|wasm)$/.test(entry.name) && !path.endsWith("/core/runtime-build.js") && !path.includes("/bundle/") && !path.includes("/bun/")) {
    hash.update(relative(root, path)); hash.update("\0"); hash.update(readFileSync(path)); hash.update("\0");
   }
  }
 };
 for (const workspace of readdirSync(join(root, "packages"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
  try { walk(join(root, "packages", workspace.name, "dist")); } catch (error) { if (error.code !== "ENOENT") throw error; }
 }
 const version = JSON.parse(readFileSync(join(root, "packages/coding-agent/package.json"), "utf8")).version;
 const status = git("status", "--porcelain", "--untracked-files=normal");
 return { schemaVersion: 1, version, forkCommit: git("rev-parse", "HEAD"), dirty: status === null ? null : status.length > 0,
  buildDigest: hash.digest("hex"), digestScope: "compiled_workspace_inputs", origin: "build" };
}
export function stampRuntimeBuild(root) {
 const identity = captureBuildIdentity(root);
 writeFileSync(join(root, "packages/coding-agent/dist/core/runtime-build.js"), `export const runtimeBuildIdentity = Object.freeze(${JSON.stringify(identity)});\n`);
 return identity;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 stampRuntimeBuild(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
}
