import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, fauxAssistantMessage, type Model } from "@earendil-works/pi-ai";
import { setKeybindings } from "@earendil-works/pi-tui";
import { expect, test } from "vitest";
import { prepareBranchEntries } from "../src/core/compaction/branch-summarization.ts";
import { compact, findCutPoint, prepareCompaction } from "../src/core/compaction/compaction.ts";
import { serializeConversation } from "../src/core/compaction/utils.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { convertToLlm } from "../src/core/messages.ts";
import { type SessionEntry, SessionManager } from "../src/core/session-manager.ts";
import { TreeSelectorComponent } from "../src/modes/interactive/components/tree-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

test("responsiveness metadata never enters model context or branch-summary serialization", () => {
	const manager = SessionManager.inMemory();
	manager.appendMessage({ role: "user", content: "ordinary conversation", timestamp: 1 });
	manager.appendCustomEntry("pi.core-responsiveness", {
		schema: "pi.core-responsiveness",
		secretMetadataSentinel: 123,
	});
	manager.appendMessage({ role: "user", content: "second conversation", timestamp: 2 });
	expect(manager.buildSessionContext().messages).toHaveLength(2);
	const projection = manager.buildSessionProjection();
	expect(projection.entries[1]!.messages).toEqual([]);
	const summary = serializeConversation(convertToLlm(prepareBranchEntries(manager.getEntries()).messages));
	expect(summary).toContain("ordinary conversation");
	expect(summary).not.toMatch(/responsiveness|secretMetadataSentinel/);
	const first = manager.getEntries()[0]!.id;
	manager.appendCompaction("summary", first, 10);
	expect(JSON.stringify(manager.buildSessionContext())).not.toMatch(/responsiveness|secretMetadataSentinel/);
});

test.each([
	{ keepRecentTokens: 1, api: "prepareCompaction" },
	{ keepRecentTokens: 2, api: "prepareCompaction" },
	{ keepRecentTokens: 1, api: "findCutPoint" },
	{ keepRecentTokens: 2, api: "findCutPoint" },
])(
	"telemetry preserves $api turn classification with $keepRecentTokens retained tokens",
	async ({ keepRecentTokens, api }) => {
		const plain = SessionManager.inMemory();
		const recorded = SessionManager.inMemory();
		let metadataId: string | undefined;
		for (let turn = 1; turn <= 3; turn++) {
			for (const manager of [plain, recorded]) {
				if (manager === recorded && turn === 3) {
					manager.appendCustomEntry("pi.core-responsiveness", {});
					metadataId = manager.getEntries().at(-1)!.id;
				}
				manager.appendMessage({ role: "user", content: `u${turn}`, timestamp: turn });
				manager.appendMessage({
					role: "assistant",
					content: [{ type: "text", text: `a${turn}` }],
					api: "openai-completions",
					provider: "fixture",
					model: "fixture",
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "stop",
					timestamp: turn,
				});
			}
		}
		if (api === "findCutPoint") {
			const plainCut = findCutPoint(plain.getEntries(), 0, plain.getEntries().length, keepRecentTokens);
			const recordedCut = findCutPoint(recorded.getEntries(), 0, recorded.getEntries().length, keepRecentTokens);
			expect(recordedCut.isSplitTurn).toBe(plainCut.isSplitTurn);
			expect(recordedCut.turnStartIndex).toBe(plainCut.turnStartIndex + (plainCut.isSplitTurn ? 1 : 0));
			expect(recordedCut.firstKeptEntryIndex).toBe(plainCut.firstKeptEntryIndex + (keepRecentTokens === 1 ? 1 : 0));
			return;
		}
		const settings = { enabled: true, reserveTokens: 10, keepRecentTokens };
		const expected = prepareCompaction(plain.getEntries(), settings)!;
		const actual = prepareCompaction(recorded.getEntries(), settings)!;
		expect(actual.isSplitTurn).toBe(expected.isSplitTurn);
		expect(actual.messagesToSummarize).toEqual(expected.messagesToSummarize);
		expect(actual.turnPrefixMessages).toEqual(expected.turnPrefixMessages);
		expect(actual.tokensBefore).toBe(expected.tokensBefore);
		expect(actual.firstKeptEntryId).toBe(keepRecentTokens === 2 ? metadataId : recorded.getEntries().at(-1)!.id);
		const model: Model<"openai-completions"> = {
			id: "fixture",
			name: "fixture",
			api: "openai-completions",
			provider: "fixture",
			baseUrl: "http://unused.invalid",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 100,
			maxTokens: 10,
		};
		const prompts: string[] = [];
		const stream: StreamFn = (_model, context) => {
			prompts.push(JSON.stringify(context));
			const events = createAssistantMessageEventStream();
			events.push({ type: "done", reason: "stop", message: fauxAssistantMessage("summary") });
			return events;
		};
		await compact(expected, model, undefined, undefined, undefined, undefined, undefined, stream);
		const expectedPrompts = prompts.splice(0);
		await compact(actual, model, undefined, undefined, undefined, undefined, undefined, stream);
		expect(prompts).toHaveLength(keepRecentTokens === 2 ? 1 : 2);
		// Request timestamps differ, but model-visible summary inputs are identical.
		expect(prompts.map((prompt) => prompt.replace(/"timestamp":\d+/g, '"timestamp":0'))).toEqual(
			expectedPrompts.map((prompt) => prompt.replace(/"timestamp":\d+/g, '"timestamp":0')),
		);
	},
);

test("exported HTML excludes telemetry leaves from all/search views and transcript rendering", () => {
	const template = readFileSync(new URL("../src/core/export-html/template.js", import.meta.url), "utf8");
	const filterSource = template.slice(
		template.indexOf("function hasTextContent("),
		template.indexOf("function recalculateVisualStructure("),
	);
	const filter = runInNewContext(
		`let filterMode = 'all'; let searchQuery = ''; const recalculateVisualStructure = () => {}; ${filterSource}; (nodes, leaf, query = '') => { searchQuery = query; return filterNodes(nodes, leaf); };`,
	) as (
		nodes: Array<{ node: { entry: SessionEntry; label?: string } }>,
		leaf: string,
		query?: string,
	) => Array<{ node: { entry: SessionEntry } }>;
	const manager = SessionManager.inMemory();
	const first = manager.appendMessage({ role: "user", content: "ordinary", timestamp: 1 });
	const leaf = manager.appendCustomEntry("pi.core-responsiveness", { schema: "pi.core-responsiveness" });
	const nodes = manager.getEntries().map((entry) => ({ node: { entry, label: "core-responsiveness" } }));
	expect(filter(nodes, leaf).map((node) => node.node.entry.id)).toEqual([first]);
	expect(filter(nodes, leaf, "core-responsiveness").map((node) => node.node.entry.id)).toEqual([first]);
	const renderSource = template.slice(
		template.indexOf("function renderEntry("),
		template.indexOf("// HEADER / STATS"),
	);
	const render = runInNewContext(
		`const formatTimestamp = () => ''; const escapeHtml = String; const renderCopyLinkButton = () => ''; ${renderSource}; renderEntry;`,
	) as (entry: SessionEntry) => string;
	expect(render(manager.getEntry(leaf)!)).toBe("");
});

test("ordinary session discovery/search indexes content, not responsiveness metadata", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-telemetry-search-"));
	try {
		const manager = SessionManager.create(directory, directory);
		manager.appendMessage({ role: "user", content: "ordinary conversation", timestamp: 1 });
		manager.appendCustomEntry("pi.core-responsiveness", {
			schema: "pi.core-responsiveness",
			secretMetadataSentinel: 123,
		});
		const listing = await SessionManager.list(directory, directory);
		expect(listing[0]!.allMessagesText).toBe("ordinary conversation");
		expect(JSON.stringify(listing)).not.toMatch(/responsiveness|secretMetadataSentinel/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("tree presentation/search hides core metadata even in all mode while preserving visible ancestry", () => {
	initTheme("dark");
	setKeybindings(new KeybindingsManager());
	const manager = SessionManager.inMemory();
	const first = manager.appendMessage({ role: "user", content: "ordinary conversation", timestamp: 1 });
	manager.appendCustomEntry("pi.core-responsiveness", { schema: "pi.core-responsiveness" });
	const second = manager.appendMessage({ role: "user", content: "second conversation", timestamp: 2 });
	const selector = new TreeSelectorComponent(
		manager.getTree(),
		second,
		24,
		() => {},
		() => {},
		undefined,
		undefined,
		"all",
	);
	expect(selector.render(120).join("\n")).not.toContain("pi.core-responsiveness");
	selector.getTreeList().handleInput("core-responsiveness");
	expect(selector.getTreeList().getSelectedNode()).toBeUndefined();
	const leaf = manager.appendCustomEntry("pi.core-responsiveness", {});
	const active = new TreeSelectorComponent(
		manager.getTree(),
		leaf,
		24,
		() => {},
		() => {},
		undefined,
		undefined,
		"all",
	);
	expect(active.getTreeList().getSelectedNode()?.entry.id).toBe(second);
	expect(manager.getBranch(second)[0]!.id).toBe(first);
});
