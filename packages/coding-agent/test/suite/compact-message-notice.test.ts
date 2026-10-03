import { Container, Text, type TUI } from "@earendil-works/pi-tui";
import { beforeAll, expect, test } from "vitest";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { CustomMessageComponent } from "../../src/modes/interactive/components/custom-message.ts";
import { SettingsSelectorComponent } from "../../src/modes/interactive/components/settings-selector.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../src/utils/ansi.ts";
import { createHarness } from "./harness.ts";

beforeAll(() => initTheme("dark"));
test("registered message/entry providers follow renderer lookup order without making entries visible", async () => {
	const harness = await createHarness({
		extensionFactories: [
			(pi) => {
				pi.registerMessageHints<{ count: number }>("private", (message) => ({
					counts: [{ label: "items", value: message.details?.count ?? 0 }],
				}));
				pi.registerEntryHints<{ count: number }>("private", (entry) => ({
					counts: [{ label: "items", value: entry.data?.count ?? 0 }],
				}));
			},
			(pi) => pi.registerMessageHints("private", () => ({ summary: "wrong provider" })),
		],
	});
	try {
		const provider = harness.session.extensionRunner.getMessageHints("private");
		expect(provider).toBeDefined();
		const message = {
			role: "custom" as const,
			customType: "private",
			content: "SECRET",
			details: { count: 5 },
			display: true,
			timestamp: 1,
		};
		const row = new CustomMessageComponent(message, undefined, undefined, 1, {}, provider);
		expect(stripAnsi(row.render(80).join("\n"))).toContain("items 5");
		expect(stripAnsi(row.render(80).join("\n"))).not.toContain("SECRET");
		expect(harness.session.extensionRunner.getEntryRenderer("private")).toBeUndefined();
		expect(harness.session.extensionRunner.getEntryHints("private")).toBeDefined();
	} finally {
		harness.cleanup();
	}
});
test("InteractiveMode settings updates retain raw exception inheritance", async () => {
	const harness = await createHarness({
		settings: { transcriptPresentation: { exceptions: [{ kind: "tool", name: "private" }] } },
	});
	let selector: SettingsSelectorComponent | undefined;
	const mode = {
		session: harness.session,
		settingsManager: harness.settingsManager,
		ui: { mode: "regular", requestRender() {} },
		chatContainer: new Container(),
		themeController: { getThemeSelection: () => "dark", getTerminalTheme: () => "dark" },
		showSelector(factory: (done: () => void) => { component: unknown }) {
			const result = factory(() => {});
			if (result.component instanceof SettingsSelectorComponent) selector = result.component;
		},
	};
	try {
		const show = (InteractiveMode.prototype as unknown as { showSettingsSelector(this: unknown): void })
			.showSettingsSelector;
		show.call(mode);
		if (!selector) throw Error("selector missing");
		const list = selector.getSettingsList();
		list.selectItem("transcript-presentation");
		list.handleInput("\r");
		list.handleInput("\x1b[B");
		list.handleInput("\r");
		expect(harness.settingsManager.getGlobalSettings().transcriptPresentation?.exceptions).toEqual([
			{ kind: "tool", name: "private" },
		]);
		expect(harness.settingsManager.getTranscriptPresentation().exceptions[0].maxLines).toBe(3);
	} finally {
		harness.cleanup();
	}
});
test("InteractiveMode notices retain consecutive info replacement and separate warning/error delivery", () => {
	const chatContainer = new Container();
	const settingsManager = SettingsManager.inMemory();
	const mode = {
		chatContainer,
		settingsManager,
		toolOutputExpanded: false,
		ui: { requestRender() {} } as unknown as TUI,
	};
	const show = (
		InteractiveMode.prototype as unknown as {
			showExtensionNotify(this: unknown, message: string, severity?: "info" | "warning" | "error"): void;
		}
	).showExtensionNotify;
	show.call(mode, "SECRET INFO");
	show.call(mode, "SECRET REPLACEMENT");
	expect(chatContainer.children).toHaveLength(1);
	expect(stripAnsi(chatContainer.render(80).join("\n"))).not.toContain("SECRET");
	show.call(mode, "SECRET WARNING", "warning");
	show.call(mode, "SECRET ERROR", "error");
	expect(chatContainer.children).toHaveLength(3);
	expect(chatContainer.render(1).map(stripAnsi)).toEqual(["·", "?", "!"]);
	for (const child of chatContainer.children) {
		if ("setExpanded" in child && typeof child.setExpanded === "function") child.setExpanded(true);
	}
	expect(stripAnsi(chatContainer.render(80).join("\n"))).toContain("SECRET REPLACEMENT");
	expect(stripAnsi(chatContainer.render(80).join("\n"))).toContain("SECRET ERROR");
	chatContainer.addChild(new Text("boundary", 0, 0));
	show.call(mode, "after boundary");
	expect(chatContainer.children).toHaveLength(5);
});
