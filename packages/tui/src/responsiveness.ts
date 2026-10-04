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
const scoped = new Map<object, Map<object, TuiResponsivenessObserver>>();
const observations = new WeakMap<object, TuiResponsivenessObservation>();
let generation = 0;
let observation: TuiResponsivenessObservation | undefined;
const ignoreRejection = () => {};
function compose(callbacks: TuiResponsivenessObserver[]): TuiResponsivenessObservation | undefined {
	const currentGeneration = ++generation;
	return callbacks.length === 0
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
function refresh(changedSource?: object): void {
	if (changedSource) {
		const callbacks = scoped.get(changedSource);
		const current = callbacks ? compose([...subscriptions.values(), ...callbacks.values()]) : undefined;
		if (current) observations.set(changedSource, current);
		else observations.delete(changedSource);
		return;
	}
	observation = compose([...subscriptions.values()]);
	for (const [source, callbacks] of scoped) {
		const current = compose([...subscriptions.values(), ...callbacks.values()]);
		if (current) observations.set(source, current);
		else observations.delete(source);
	}
}
/** Four owners per scope. Optional source confines observations to that actual TUI instance.
 * Synchronous observer work still consumes main-thread time: keep callbacks bounded. */
export function subscribeTuiResponsiveness(callback: TuiResponsivenessObserver, source?: object): () => void {
	const callbacks = source ? (scoped.get(source) ?? new Map<object, TuiResponsivenessObserver>()) : subscriptions;
	if (callbacks.size >= 4) throw new Error("TUI responsiveness observer limit reached");
	if (source) scoped.set(source, callbacks);
	const owner = {};
	callbacks.set(owner, callback);
	refresh(source);
	return () => {
		if (!callbacks.delete(owner)) return;
		if (source && callbacks.size === 0) {
			scoped.delete(source);
			observations.delete(source);
		}
		refresh(source);
	};
}
/** Disabled hot paths only read optional cached observations; no scans or allocations. */
export function getTuiResponsivenessObservation(source?: object): TuiResponsivenessObservation | undefined {
	return (source && observations.get(source)) || observation;
}
