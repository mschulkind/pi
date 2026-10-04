import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "fs";
import { afterEach, expect, test, vi } from "vitest";
import { createCoreTelemetry, getCoreTelemetryStatus } from "../src/core/core-telemetry.ts";
import { SessionManager } from "../src/core/session-manager.ts";

vi.mock("fs", { spy: true });
const temporary: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
async function manager() {
	const directory = await mkdtemp(join(tmpdir(), "pi-history-telemetry-"));
	temporary.push(directory);
	return SessionManager.create(directory, directory);
}
function fixture(manager: SessionManager, env: NodeJS.ProcessEnv = {}) {
	let now = 0;
	const histogram = {
		count: 1,
		min: 20e6,
		max: 20e6,
		mean: 20e6,
		percentile: () => 20e6,
		enable: vi.fn(),
		disable: vi.fn(),
		reset: vi.fn(() => {
			histogram.count = 0;
		}),
	};
	const clock = vi.fn(() => now);
	const owner = createCoreTelemetry(manager, env, { now: clock, monitor: () => histogram });
	return {
		owner,
		clock,
		histogram,
		advance: (ms = 60000) => {
			now += ms;
		},
	};
}
function rows(manager: SessionManager) {
	return manager
		.getEntries()
		.filter((entry) => entry.type === "custom" && entry.customType === "pi.core-responsiveness");
}

test("default owner buffers without IO; next real commit writes both rows once and reopens with the ordinary leaf", async () => {
	const session = await manager();
	session.appendMessage({ role: "user", content: "ordinary content", timestamp: 1 });
	const f = fixture(session);
	try {
		expect(f.owner).toBeDefined();
		const append = vi.spyOn(fs, "appendFileSync");
		f.advance();
		f.owner!.sample();
		expect(append).not.toHaveBeenCalled();
		expect(rows(session)).toHaveLength(0);
		expect(f.owner!.status().health).toMatchObject({ bufferedRecords: 1, recordsPersisted: 0 });
		const id = session.appendMessage({ role: "user", content: "second", timestamp: 2 });
		expect(append).toHaveBeenCalledTimes(1);
		expect(rows(session)).toHaveLength(1);
		const reopened = SessionManager.open(session.getSessionFile()!);
		expect(reopened.getLeafId()).toBe(id);
		expect(reopened.getBranch().map((entry) => entry.type)).toEqual(["message", "custom", "message"]);
		expect(reopened.buildSessionContext().messages).toHaveLength(2);
		expect(f.owner!.status().health).toMatchObject({ bufferedRecords: 0, recordsPersisted: 1 });
		expect(await readFile(session.getSessionFile()!, "utf8")).not.toContain("core-telemetry.lock");
	} finally {
		f.owner?.close();
	}
});

test("setup-only rows keep metadata pending until the first conversation commit and report persisted health truthfully", async () => {
	const session = await manager();
	const f = fixture(session);
	try {
		f.advance();
		f.owner!.sample();
		session.appendModelChange("fixture", "fixture");
		const setup = session.appendThinkingLevelChange("off");
		expect(existsSync(session.getSessionFile()!)).toBe(false);
		expect(rows(session)).toHaveLength(0);
		expect(f.owner!.status().health).toMatchObject({ bufferedRecords: 1, recordsPersisted: 0, recordsInMemory: 0 });
		const leaf = session.appendMessage({ role: "user", content: "first conversation", timestamp: 1 });
		expect(f.owner!.status().health).toMatchObject({ bufferedRecords: 0, recordsPersisted: 1, recordsInMemory: 0 });
		const reopened = SessionManager.open(session.getSessionFile()!);
		expect(reopened.getLeafId()).toBe(leaf);
		expect(rows(reopened)[0]!.parentId).toBe(setup);
		expect(reopened.getBranch().map((entry) => entry.type)).toEqual([
			"model_change",
			"thinking_level_change",
			"custom",
			"message",
		]);
		expect(reopened.buildSessionContext().messages).toHaveLength(1);
	} finally {
		f.owner?.close();
	}
});

test("only exact zero disables; capture directory is ignored; disabled owner performs no telemetry work", () => {
	const session = SessionManager.inMemory();
	const off = fixture(session, { PI_CORE_TELEMETRY: "0", PI_CORE_TELEMETRY_DIR: "/ignored" });
	expect(off.owner).toBeUndefined();
	expect(off.clock).not.toHaveBeenCalled();
	expect(off.histogram.enable).not.toHaveBeenCalled();
	for (const env of [
		{},
		{ PI_CORE_TELEMETRY: "1" },
		{ PI_CORE_TELEMETRY: "false" },
		{ PI_CORE_TELEMETRY_DIR: "relative" },
	]) {
		const f = fixture(session, env);
		expect(f.owner).toBeDefined();
		f.owner?.close();
	}
	expect(getCoreTelemetryStatus()).toMatchObject({
		configured: true,
		live: false,
		reason: "no_active_session",
		health: null,
	});
});

test("new empty persistent and nonpersistent sessions never create telemetry-only files", async () => {
	const session = await manager();
	const f = fixture(session);
	f.advance();
	f.owner!.sample();
	f.owner!.close();
	expect(existsSync(session.getSessionFile()!)).toBe(false);
	expect(rows(session)).toHaveLength(1);
	expect(f.owner!.status().health!.recordsPersisted).toBe(0);
	const memory = SessionManager.inMemory();
	const m = fixture(memory);
	m.advance();
	m.owner!.sample();
	m.owner!.close();
	expect(rows(memory)).toHaveLength(1);
	expect(m.owner!.status().persistence).toBe("memory");
});

test("queue stays bounded across the whole session; idle samples do not spam or flush IO", async () => {
	const session = await manager();
	session.appendMessage({ role: "user", content: "ordinary", timestamp: 1 });
	const f = fixture(session);
	const append = vi.spyOn(fs, "appendFileSync");
	try {
		for (let i = 0; i < 121; i++) {
			f.advance();
			f.owner!.sample();
		}
		expect(f.owner!.status()).toMatchObject({ live: true, health: { bufferedRecords: 2, droppedRecords: 119 } });
		expect(append).not.toHaveBeenCalled();
		f.advance(5000);
		f.owner!.sample();
		expect(f.owner!.status().health!.bufferedRecords).toBe(2);
		session.appendMessage({ role: "user", content: "flush", timestamp: 2 });
		expect(append).toHaveBeenCalledTimes(1);
	} finally {
		f.owner?.close();
	}
});

test("branch and identity changes cannot carry buffered windows to another origin", async () => {
	const session = await manager();
	const first = session.appendMessage({ role: "user", content: "first", timestamp: 1 });
	session.appendMessage({ role: "user", content: "second", timestamp: 2 });
	const f = fixture(session);
	try {
		f.advance();
		f.owner!.sample();
		session.branch(first);
		session.appendMessage({ role: "user", content: "branch", timestamp: 3 });
		expect(rows(session)).toHaveLength(0);
		f.advance();
		f.owner!.sample();
		session.newSession();
		f.advance();
		f.owner!.sample();
		expect(rows(session)).toHaveLength(0);
		expect(f.owner!.status().live).toBe(false);
	} finally {
		f.owner?.close();
	}
});

test("final checkpoint cannot recreate a deleted conversation file", async () => {
	const session = await manager();
	session.appendMessage({ role: "user", content: "ordinary", timestamp: 1 });
	const f = fixture(session);
	f.advance();
	f.owner!.sample();
	await rm(session.getSessionFile()!);
	f.owner!.close();
	expect(existsSync(session.getSessionFile()!)).toBe(false);
	expect(f.owner!.status().health).toMatchObject({ recordsPersisted: 0, droppedRecords: 1, writeErrors: 1 });
});

test("oversized metadata is dropped without affecting ordinary commits", async () => {
	const session = await manager();
	const complete = vi.fn();
	session.bufferCoreTelemetry({ invalidOversizedData: "x".repeat(8192) }, complete);
	expect(complete).toHaveBeenCalledWith("dropped");
	session.appendMessage({ role: "user", content: "ordinary", timestamp: 1 });
	expect(rows(session)).toHaveLength(0);
	expect(session.buildSessionContext().messages).toHaveLength(1);
});

test("final metadata-only error is counted without throwing; ordinary write errors still propagate", async () => {
	const session = await manager();
	session.appendMessage({ role: "user", content: "ordinary", timestamp: 1 });
	const f = fixture(session);
	f.advance();
	f.owner!.sample();
	vi.spyOn(fs, "openSync").mockImplementation(() => {
		throw new Error("private error");
	});
	vi.spyOn(fs, "appendFileSync").mockImplementation(() => {
		throw new Error("private error");
	});
	expect(() => f.owner!.close()).not.toThrow();
	expect(f.owner!.status().health).toMatchObject({ recordsPersisted: 0, writeErrors: 1, droppedRecords: 1 });
	expect(JSON.stringify(f.owner!.status())).not.toContain("private error");
	expect(() => session.appendMessage({ role: "user", content: "ordinary", timestamp: 2 })).toThrow("private error");
});
