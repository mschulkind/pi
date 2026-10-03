/** Replaced in dist at build time. Source execution has no compiled-build claim. */
export const runtimeBuildIdentity = Object.freeze({
	schemaVersion: 1 as const,
	version: "unknown",
	forkCommit: null as string | null,
	dirty: null as boolean | null,
	buildDigest: null as string | null,
	digestScope: "compiled_workspace_inputs" as const,
	origin: "source_unstamped" as "source_unstamped" | "build",
});
