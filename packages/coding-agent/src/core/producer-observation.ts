import type { PerformanceCorrelation } from "@earendil-works/pi-ai";

/** A provider dispatch is an SDK generation invocation, not proof of a transport attempt. */
export interface GenerationObservation {
	readonly schemaVersion: 1;
	readonly boundary: "provider_dispatch";
	readonly sdkInvocationId: string;
	readonly logicalRequestId: string;
	readonly sessionId: string | null;
	readonly operationId: string | null;
	readonly purpose: NonNullable<PerformanceCorrelation["purpose"]>;
	readonly orchestrationRetry: number | null;
	readonly provider: string | null;
	readonly api: string | null;
	readonly model: string | null;
	readonly wireAttemptId: null;
	readonly transportCoverage: "supported" | "unsupported";
}
export interface ProducerObservationCapability {
	readonly version: 1;
	subscribe(callback: (event: GenerationObservation) => void | Promise<void>): () => void;
	createAuxiliaryCorrelation(
		purpose: Exclude<GenerationObservation["purpose"], "assistant" | "unknown">,
		parent?: Pick<PerformanceCorrelation, "sessionId" | "operationId">,
	): PerformanceCorrelation;
}

/** Reject URL-like or arbitrary metadata rather than truncating it into a plausible identity. */
export function sanitizeCorrelationId(value: unknown): string | null {
	return typeof value === "string" &&
		value.length > 0 &&
		value.length <= 256 &&
		/^[a-zA-Z0-9_./:-]+$/.test(value) &&
		!value.includes("//")
		? value
		: null;
}
export function getProducerObservationCapability(runtime: unknown): ProducerObservationCapability | null {
	try {
		if (!runtime || typeof runtime !== "object" || !("getProducerObservationCapability" in runtime)) return null;
		const accessor: unknown = runtime.getProducerObservationCapability;
		if (typeof accessor !== "function") return null;
		const capability: unknown = accessor.call(runtime);
		if (
			!capability ||
			typeof capability !== "object" ||
			!("version" in capability) ||
			capability.version !== 1 ||
			!("subscribe" in capability) ||
			typeof capability.subscribe !== "function" ||
			!("createAuxiliaryCorrelation" in capability) ||
			typeof capability.createAuxiliaryCorrelation !== "function"
		)
			return null;
		return capability as ProducerObservationCapability;
	} catch {
		return null;
	}
}

export class ProducerObservation {
	private readonly callbacks = new Set<(event: GenerationObservation) => void | Promise<void>>();
	readonly capability: ProducerObservationCapability = Object.freeze({
		version: 1 as const,
		subscribe: (callback: (event: GenerationObservation) => void | Promise<void>) => {
			this.callbacks.add(callback);
			return () => {
				this.callbacks.delete(callback);
			};
		},
		createAuxiliaryCorrelation: (
			purpose: Exclude<GenerationObservation["purpose"], "assistant" | "unknown">,
			parent: Pick<PerformanceCorrelation, "sessionId" | "operationId"> = {},
		) => ({
			sessionId: sanitizeCorrelationId(parent.sessionId) ?? undefined,
			operationId: sanitizeCorrelationId(parent.operationId) ?? undefined,
			logicalRequestId: globalThis.crypto.randomUUID(),
			purpose,
		}),
	});
	emit(event: GenerationObservation): void {
		const snapshot = Object.freeze({ ...event });
		for (const callback of [...this.callbacks]) {
			try {
				void Promise.resolve(callback(snapshot)).catch(() => {});
			} catch {
				/* Observation cannot fail dispatch. */
			}
		}
	}
}
