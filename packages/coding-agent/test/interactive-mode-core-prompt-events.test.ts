import { describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

type CorePromptPrototype = {
	showAuthPrompt(this: unknown, dialog: unknown, prompt: unknown, providerId: string): Promise<string>;
	showExtensionConfirm(this: unknown, title: string, message: string): Promise<boolean>;
	showExtensionSelector(
		this: unknown,
		title: string,
		options: string[],
		opts?: { signal?: AbortSignal },
	): Promise<string | undefined>;
};
const prototype = InteractiveMode.prototype as unknown as CorePromptPrototype;

describe("core prompts notify extension listeners", () => {
	it("brackets an authentication input after the provider asks for a code", async () => {
		const withUIPrompt = vi.fn((_kind, _title, run: () => Promise<string>) => run());
		const dialog = { showManualInput: vi.fn(async () => "123456") };
		const context = { session: { extensionRunner: { withUIPrompt } } };

		await expect(
			prototype.showAuthPrompt.call(context, dialog, { type: "manual_code", message: "Enter code" }, "anthropic"),
		).resolves.toBe("123456");
		expect(withUIPrompt).toHaveBeenCalledWith("input", "Enter code", expect.any(Function));
	});

	it("preserves provider-specific login choices while notifying prompt listeners", async () => {
		const withUIPrompt = vi.fn((_kind, _title, run: () => Promise<string>) => run());
		const showAuthSelect = vi.fn(async () => "copy_code");
		const context = { session: { extensionRunner: { withUIPrompt } }, showAuthSelect };
		const dialog = {};
		const prompt = { type: "select", message: "Login method", options: [] };
		await expect(prototype.showAuthPrompt.call(context, dialog, prompt, "radius")).resolves.toBe("copy_code");
		expect(withUIPrompt).toHaveBeenCalledWith("select", "Login method", expect.any(Function));
		expect(showAuthSelect).toHaveBeenCalledWith(dialog, prompt, "radius");
	});

	it("reports a core confirmation before it waits for a selection", async () => {
		const withUIPrompt = vi.fn((_kind, _title, run: () => Promise<boolean>) => run());
		const context = {
			session: { extensionRunner: { withUIPrompt } },
			showExtensionSelector: vi.fn(async () => "Yes"),
		};
		await expect(
			prototype.showExtensionConfirm.call(context, "Import session", "Replace current session?"),
		).resolves.toBe(true);
		expect(withUIPrompt).toHaveBeenCalledWith("confirm", "Import session", expect.any(Function));
	});

	it("reports a core selector while it waits for a choice", async () => {
		initTheme("dark");
		const withUIPrompt = vi.fn((_kind, _title, run: () => Promise<string | undefined>) => run());
		const context = {
			session: { extensionRunner: { withUIPrompt } },
			ui: { setFocus: vi.fn(), requestRender: vi.fn() },
			editorContainer: { clear: vi.fn(), addChild: vi.fn() },
			editor: {},
			disposeActiveSelector: vi.fn(),
			hideExtensionSelector: vi.fn(),
		};
		const choice = prototype.showExtensionSelector.call(context, "Options", ["First"]);
		expect(withUIPrompt).toHaveBeenCalledWith("select", "Options", expect.any(Function));
		const selector = (context as typeof context & { extensionSelector?: { handleInput: (key: string) => void } })
			.extensionSelector;
		if (!selector) await choice;
		selector?.handleInput("\n");
		await expect(choice).resolves.toBe("First");
	});

	it("does not notify for a selector already cancelled before it appears", async () => {
		const withUIPrompt = vi.fn();
		const context = { session: { extensionRunner: { withUIPrompt } } };
		await expect(
			prototype.showExtensionSelector.call(context, "Options", [], { signal: AbortSignal.abort() }),
		).resolves.toBeUndefined();
		expect(withUIPrompt).not.toHaveBeenCalled();
	});
});
