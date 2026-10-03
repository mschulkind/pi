import { isAbsolute, join } from "node:path";
import type { PerformanceRecordingHealth } from "./api-performance-recorder.ts";

export interface TransportRecordingStatus {
	readonly capabilityVersion: 1;
	readonly enabled: boolean;
	/** Configuration is not proof of a write or of supported transport traffic. */
	readonly observedHealth: PerformanceRecordingHealth | null;
	readonly coverage: "allowlisted_transports_only";
}
/** Explicit null and environment opt-out win; an environment directory wins over API defaults. */
export function resolvePerformanceDirectory(
	directory: string | null | undefined,
	env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
	if (directory === null || env.PI_API_PERFORMANCE === "0") return undefined;
	const selected =
		env.PI_API_PERFORMANCE_DIR ??
		directory ??
		(env.YOLO_DURABLE_DIR ? join(env.YOLO_DURABLE_DIR, "pi-api-performance") : undefined);
	return selected && isAbsolute(selected) ? selected : undefined;
}
