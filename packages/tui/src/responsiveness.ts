/** Passive scalar-only observations at TuiBase boundaries. No input or rendered content is supplied. */
export const TUI_RESPONSIVENESS_KINDS = Object.freeze([
	"input_dispatch",
	"input_dispatch_error",
	"render_request",
	"render_coalesced",
	"render_cancelled",
	"render_wait",
	"render",
	"render_error",
	"full_redraw",
] as const);
export type TuiResponsivenessKind = (typeof TUI_RESPONSIVENESS_KINDS)[number];
export type TuiResponsivenessObserver = (kind: TuiResponsivenessKind, durationMs: number) => void | Promise<void>;
export interface TuiResponsivenessObservation {
	readonly generation: number;
	emit: TuiResponsivenessObserver;
}
const subscriptions = new Map<object, TuiResponsivenessObserver>();
let generation = 0;
let observation: TuiResponsivenessObservation | undefined;
const ignoreRejection = () => {};
function refresh(): void {
	const callbacks = [...subscriptions.values()];
	const currentGeneration = ++generation;
	observation =
		callbacks.length === 0
			? undefined
			: {
					generation: currentGeneration,
					emit(kind, durationMs) {
						for (const callback of callbacks) {
							try {
								const result = callback(kind, durationMs);
								if (result) void result.catch(ignoreRejection);
							} catch {}
						}
					},
				};
}
/** At most four independent owners; unsubscribing never removes another owner's subscription.
 * Synchronous observer work still consumes main-thread time: keep callbacks bounded. */
export function subscribeTuiResponsiveness(callback: TuiResponsivenessObserver): () => void {
	if (subscriptions.size >= 4) throw new Error("TUI responsiveness observer limit reached");
	const owner = {};
	subscriptions.set(owner, callback);
	refresh();
	return () => {
		if (subscriptions.delete(owner)) refresh();
	};
}
/** Disabled hot paths only read this optional static observer. */
export function getTuiResponsivenessObservation(): TuiResponsivenessObservation | undefined {
	return observation;
}
