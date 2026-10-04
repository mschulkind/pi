import { url as inspectorUrl } from "node:inspector";
import { basename } from "node:path";
import { type CoreTelemetry, getCoreTelemetryStatus } from "./core-telemetry.ts";
import type { Extension } from "./extensions/types.ts";
import type { ModelRuntime } from "./model-runtime.ts";
import { runtimeBuildIdentity } from "./runtime-build.ts";
import { getLoadedExtensionIdentity } from "./runtime-provenance.ts";

/** Snapshot contains no session/attempt UUID, inspector URL, or credentials. */
export function getRuntimeInfo(runtime: ModelRuntime, loadedExtensions: readonly Extension[], owner?: CoreTelemetry) {
	const existingInspector = !!inspectorUrl();
	return {
		schemaVersion: 1 as const,
		build: runtimeBuildIdentity,
		extensions: loadedExtensions.map((extension) => ({
			name: basename(extension.path),
			...getLoadedExtensionIdentity(extension),
		})),
		transport: runtime.getTransportRecordingStatus(),
		responsiveness: getCoreTelemetryStatus(owner),
		inspector: {
			status: existingInspector ? ("active" as const) : ("disabled" as const),
			origin: existingInspector ? ("existing_origin_unknown" as const) : ("not_started" as const),
			// Yolo launch-network v2 is observational only; v1 positive proof was withdrawn.
			// Even readonly private claims cannot authorize a listener: privileged mount
			// replacement resistance is unproven. Keep this independent of record bytes.
			automaticEnablement: "disabled_missing_authoritative_yolo_contract" as const,
		},
	};
}
export function formatRuntimeInfo(info: ReturnType<typeof getRuntimeInfo>): string {
	const build = info.build;
	const dirty = (value: boolean | null) => (value === null ? "unknown" : value ? "dirty" : "clean");
	return [
		`Running Pi: ${build.version} (${build.origin})`,
		`Fork commit at build: ${build.forkCommit ?? "unknown"}; ${dirty(build.dirty)}`,
		`Build digest (${build.digestScope}): ${build.buildDigest ?? "unknown"}`,
		"Loaded extensions (entry snapshots; dependency graphs are not attested):",
		...info.extensions.map(
			(extension) =>
				`  ${extension.name}: version=${extension.version ?? "unknown"} commit=${extension.commit ?? "unknown"} ${dirty(extension.dirty)} origin=${extension.origin} entryDigest=${extension.entryDigest ?? "unknown"} uncertainty=${extension.uncertainty ?? "none"}`,
		),
		`Transport: capability=${info.transport.capabilityVersion} enabled=${info.transport.enabled} coverage=${info.transport.coverage}`,
		`Observed recorder health: ${info.transport.observedHealth ? JSON.stringify(info.transport.observedHealth) : "unavailable"}`,
		`Core responsiveness: capability=${info.responsiveness.capabilityVersion} configured=${info.responsiveness.configured} live=${info.responsiveness.live} reason=${info.responsiveness.reason} persistence=${info.responsiveness.persistence} coverage=${info.responsiveness.coverage}`,
		`Observed responsiveness health: ${info.responsiveness.health ? JSON.stringify(info.responsiveness.health) : "unavailable"}`,
		`Inspector: ${info.inspector.status}; origin=${info.inspector.origin}; ${info.inspector.automaticEnablement}`,
	].join("\n");
}
