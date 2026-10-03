import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Extension, ExtensionFactory } from "./extensions/types.ts";
import { runtimeBuildIdentity } from "./runtime-build.ts";

export interface LoadedExtensionIdentity {
	readonly version: string | null;
	readonly commit: string | null;
	readonly dirty: boolean | null;
	readonly entryDigest: string | null;
	readonly origin: "entry_load_snapshot" | "builtin_build" | "inline_unknown";
	readonly uncertainty: "dependency_graph_not_attested" | "entry_changed_during_load" | "unknown" | null;
}
const factories = new WeakMap<ExtensionFactory, LoadedExtensionIdentity>();
const extensions = new WeakMap<Extension, LoadedExtensionIdentity>();
const unknownIdentity: LoadedExtensionIdentity = Object.freeze({
	version: null,
	commit: null,
	dirty: null,
	entryDigest: null,
	origin: "inline_unknown",
	uncertainty: "unknown",
});

export function readExtensionEntryDigest(path: string): string | null {
	try {
		return createHash("sha256").update(readFileSync(path)).digest("hex");
	} catch {
		return null;
	}
}

/** Called only at a real module load, never during import of this helper or rendering. */
export function captureExtensionEntryIdentity(path: string): LoadedExtensionIdentity {
	const entryDigest = readExtensionEntryDigest(path);
	let sourcePath = path;
	try {
		sourcePath = realpathSync(path);
	} catch {
		/* Missing source stays unknown. */
	}
	let version: string | null = null;
	let directory = dirname(sourcePath);
	while (true) {
		try {
			const manifest: unknown = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
			if (
				manifest &&
				typeof manifest === "object" &&
				"version" in manifest &&
				typeof manifest.version === "string" &&
				/^[a-zA-Z0-9.+_-]{1,128}$/.test(manifest.version)
			)
				version = manifest.version;
			break;
		} catch {
			/* Search parents only at load. */
		}
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	const git = (...args: string[]) => {
		try {
			return execFileSync("git", ["-C", dirname(sourcePath), ...args], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 1000,
			}).trim();
		} catch {
			return null;
		}
	};
	const commit = git("rev-parse", "HEAD");
	const status = git("status", "--porcelain", "--untracked-files=normal");
	return Object.freeze({
		version,
		commit: commit && /^[a-f0-9]{40,64}$/.test(commit) ? commit : null,
		dirty: status === null ? null : status.length > 0,
		entryDigest,
		origin: "entry_load_snapshot",
		uncertainty: "dependency_graph_not_attested",
	});
}
export function rememberLoadedFactory(factory: ExtensionFactory, identity: LoadedExtensionIdentity): void {
	// Native ESM may return the same factory after a cache clear. Do not relabel
	// that already-loaded function with a newer disk snapshot.
	if (!factories.has(factory)) factories.set(factory, identity);
}
export function rememberLoadedExtension(extension: Extension, factory: ExtensionFactory): void {
	const identity =
		factories.get(factory) ??
		(extension.path.startsWith("builtin:")
			? Object.freeze({
					version: runtimeBuildIdentity.version,
					commit: runtimeBuildIdentity.forkCommit,
					dirty: runtimeBuildIdentity.dirty,
					entryDigest: runtimeBuildIdentity.buildDigest,
					origin: "builtin_build" as const,
					uncertainty: runtimeBuildIdentity.origin === "build" ? null : ("unknown" as const),
				})
			: unknownIdentity);
	extensions.set(extension, identity);
}
export function getLoadedExtensionIdentity(extension: Extension): LoadedExtensionIdentity {
	return extensions.get(extension) ?? unknownIdentity;
}
