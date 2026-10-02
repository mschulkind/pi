import type { PerformanceCorrelation } from "@earendil-works/pi-ai";

/** Session event state, not message timestamps. One request id survives explicit agent retries. */
export class PerformanceCorrelationState {
	private operationId: string | undefined;
	private logicalRequestId: string | undefined;
	private retryPending = false;
	observe(event: { type: string; message?: { role: string }; reason?: string }): void {
		if (event.type === "message_start" && event.message?.role === "user") {
			this.operationId = globalThis.crypto.randomUUID();
			this.logicalRequestId = globalThis.crypto.randomUUID();
		}
		if (event.type === "auto_retry_start" || (event.type === "auto_compaction_start" && event.reason === "overflow"))
			this.retryPending = true;
		if (event.type === "turn_start") {
			this.operationId ??= globalThis.crypto.randomUUID();
			if (!this.retryPending) this.logicalRequestId = globalThis.crypto.randomUUID();
			this.retryPending = false;
		}
		if (event.type === "auto_compaction_start" && event.reason === "manual")
			this.operationId = globalThis.crypto.randomUUID();
	}
	get correlation(): PerformanceCorrelation {
		return {
			operationId: this.operationId,
			logicalRequestId: this.logicalRequestId,
			purpose: this.logicalRequestId ? "assistant" : "unknown",
		};
	}
}
