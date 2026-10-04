import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import {
	subscribeTuiResponsiveness,
	TUI_RESPONSIVENESS_KINDS,
	type TuiResponsivenessKind,
} from "../src/responsiveness.ts";
import type { Terminal } from "../src/terminal.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";

class TestTerminal implements Terminal {
	columns = 80;
	rows = 24;
	kittyProtocolActive = false;
	input: ((data: string) => void) | undefined;
	writes = 0;
	start(input: (data: string) => void): void {
		this.input = input;
	}
	stop(): void {
		this.input = undefined;
	}
	async drainInput(): Promise<void> {}
	write(): void {
		this.writes++;
	}
	moveBy(): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(): void {}
	setProgress(): void {}
}

for (const Renderer of [TuiMainScreen, TuiAltScreen]) {
	test(`${Renderer.name}: another TUI's subscription changes cannot erase this owner's pending wait`, (t) => {
		let now = 100;
		t.mock.method(performance, "now", () => now);
		const first = new Renderer(new TestTerminal());
		const second = new Renderer(new TestTerminal());
		const waits: number[] = [];
		const offFirst = subscribeTuiResponsiveness((kind, duration) => {
			if (kind === "render_wait") waits.push(duration);
		}, first);
		let offSecond = () => {};
		try {
			first.start();
			offSecond = subscribeTuiResponsiveness(() => {}, second);
			offSecond();
			now += 5;
			first.renderNow();
			assert.deepEqual(waits, [5]);
		} finally {
			first.stop({ preserveScreen: true });
			second.stop({ preserveScreen: true });
			offFirst();
			offSecond();
		}
	});
	test(`${Renderer.name}: scoped owners isolate concurrent TUIs and detach independently`, () => {
		const terminals = [new TestTerminal(), new TestTerminal()];
		const first = new Renderer(terminals[0]!);
		const second = new Renderer(terminals[1]!);
		let firstInputs = 0;
		let secondInputs = 0;
		const offFirst = subscribeTuiResponsiveness((kind) => {
			if (kind === "input_dispatch") firstInputs++;
		}, first);
		const offSecond = subscribeTuiResponsiveness((kind) => {
			if (kind === "input_dispatch") secondInputs++;
		}, second);
		try {
			first.start();
			second.start();
			first.addInputListener(() => ({ consume: true }));
			second.addInputListener(() => ({ consume: true }));
			terminals[0]!.input!("private");
			assert.deepEqual([firstInputs, secondInputs], [1, 0]);
			offFirst();
			terminals[0]!.input!("private");
			terminals[1]!.input!("private");
			assert.deepEqual([firstInputs, secondInputs], [1, 1]);
		} finally {
			first.stop({ preserveScreen: true });
			second.stop({ preserveScreen: true });
			offFirst();
			offSecond();
		}
	});
	test(`${Renderer.name}: observes real dispatch, coalescing, scheduled and direct frames without content`, async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		let now = 100;
		t.mock.method(performance, "now", () => now);
		const events: Array<[TuiResponsivenessKind, number]> = [];
		const off = subscribeTuiResponsiveness((kind, duration) => {
			events.push([kind, duration]);
		});
		const terminal = new TestTerminal();
		const ui = new Renderer(terminal);
		const component = {
			render: () => {
				now += 7;
				return ["private UI body"];
			},
			invalidate() {},
			handleInput: (_data: string) => {
				now += 3;
			},
		};
		ui.addChild(component);
		ui.setFocus(component);
		try {
			ui.start();
			ui.requestRender();
			ui.requestRender();
			now += 5;
			await new Promise<void>((resolve) => process.nextTick(resolve));
			t.mock.timers.tick(16);
			assert.deepEqual(
				events.filter(([kind]) => kind === "render_wait"),
				[["render_wait", 5]],
			);
			assert.deepEqual(
				events.filter(([kind]) => kind === "render"),
				[["render", 7]],
			);
			assert.equal(events.filter(([kind]) => kind === "render_coalesced").length, 2);
			terminal.input!("private raw key/prompt");
			assert.deepEqual(
				events.find(([kind]) => kind === "input_dispatch"),
				["input_dispatch", 3],
			);
			await new Promise<void>((resolve) => process.nextTick(resolve));
			ui.renderNow();
			assert.equal(events.filter(([kind]) => kind === "render").length, 3);
			assert.ok(terminal.writes > 0);
			assert.doesNotMatch(JSON.stringify(events), /private|prompt|body/);
			ui.requestRender();
			ui.stop({ preserveScreen: true });
			assert.equal(events.filter(([kind]) => kind === "render_cancelled").length, 1);
			ui.start();
			ui.renderNow();
			assert.equal(events.filter(([kind]) => kind === "render_wait").at(-1)![1], 0);
		} finally {
			ui.stop({ preserveScreen: true });
			off();
		}
	});
	test(`${Renderer.name}: source exceptions survive throwing/rejecting observers and consumed input is measured`, async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		let now = 10;
		t.mock.method(performance, "now", () => now);
		const events: string[] = [];
		const off = subscribeTuiResponsiveness((kind) => {
			events.push(kind);
		});
		const offThrow = subscribeTuiResponsiveness(() => {
			throw new Error("observer secret");
		});
		const offReject = subscribeTuiResponsiveness(async () => {
			throw new Error("observer rejection");
		});
		const terminal = new TestTerminal();
		const ui = new Renderer(terminal);
		const error = new Error("source secret");
		let fails = false;
		ui.addChild({
			render: () => {
				now++;
				if (fails) throw error;
				return ["safe"];
			},
			invalidate() {},
		});
		try {
			ui.start();
			ui.renderNow();
			const remove = ui.addInputListener(() => {
				now += 2;
				return { consume: true };
			});
			terminal.input!("secret");
			remove();
			ui.addInputListener(() => {
				throw error;
			});
			assert.throws(
				() => terminal.input!("secret"),
				(value) => value === error,
			);
			fails = true;
			assert.throws(
				() => ui.renderNow(),
				(value) => value === error,
			);
			assert.equal(events.filter((kind) => kind === "input_dispatch").length, 2);
			assert.ok(events.includes("input_dispatch_error"));
			assert.ok(events.includes("render_error"));
			await new Promise<void>((resolve) => process.nextTick(resolve));
		} finally {
			ui.stop({ preserveScreen: true });
			off();
			offThrow();
			offReject();
		}
	});
}

test("disabled real dispatch adds no telemetry clock; observer ownership is independent and bounded", (t) => {
	let clocks = 0;
	t.mock.method(performance, "now", () => {
		clocks++;
		return 0;
	});
	const terminal = new TestTerminal();
	const ui = new TuiMainScreen(terminal);
	t.after(() => ui.stop());
	ui.start();
	ui.addInputListener(() => ({ consume: true }));
	terminal.input!("secret");
	assert.equal(clocks, 0);
	let observed = 0;
	const first = subscribeTuiResponsiveness(() => {});
	const second = subscribeTuiResponsiveness(() => {
		observed++;
	});
	first();
	first();
	terminal.input!("secret");
	assert.equal(observed, 1);
	second();
	terminal.input!("secret");
	assert.equal(observed, 1);
	assert.ok(Object.isFrozen(TUI_RESPONSIVENESS_KINDS));
	assert.equal(Reflect.set(TUI_RESPONSIVENESS_KINDS, "9", "private dimension"), false);
	const owners = Array.from({ length: 4 }, () => subscribeTuiResponsiveness(() => {}));
	assert.throws(() => subscribeTuiResponsiveness(() => {}), /observer limit/);
	for (const off of owners) off();
	ui.stop();
});

for (const Renderer of [TuiMainScreen, TuiAltScreen]) {
	test(`${Renderer.name}: disabled scheduler/direct render keeps only its existing clock calls`, async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		let clocks = 0;
		t.mock.method(performance, "now", () => {
			clocks++;
			return 100;
		});
		const ui = new Renderer(new TestTerminal());
		try {
			ui.start();
			ui.requestRender();
			ui.requestRender();
			assert.equal(clocks, 0);
			await new Promise<void>((resolve) => process.nextTick(resolve));
			assert.equal(clocks, 1);
			t.mock.timers.tick(16);
			assert.equal(clocks, 2);
			ui.renderNow();
			assert.equal(clocks, 3);
		} finally {
			ui.stop({ preserveScreen: true });
		}
	});

	test(`${Renderer.name}: changed observer ownership cannot inherit another capture's pending wait`, async (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		let now = 100;
		t.mock.method(performance, "now", () => now);
		const ui = new Renderer(new TestTerminal());
		let off = subscribeTuiResponsiveness(() => {});
		try {
			ui.start();
			off();
			const events: Array<[TuiResponsivenessKind, number]> = [];
			off = subscribeTuiResponsiveness((kind, duration) => {
				events.push([kind, duration]);
			});
			now += 50;
			ui.renderNow();
			assert.equal(events.filter(([kind]) => kind === "render").length, 1);
			assert.equal(events.filter(([kind]) => kind === "render_wait").length, 0);
			ui.requestRender(true);
			now += 4;
			await new Promise<void>((resolve) => process.nextTick(resolve));
			assert.deepEqual(
				events.filter(([kind]) => kind === "render_wait"),
				[["render_wait", 4]],
			);
		} finally {
			ui.stop({ preserveScreen: true });
			off();
		}
	});
}
