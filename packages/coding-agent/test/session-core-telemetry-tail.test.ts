import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "fs";
import { afterEach, expect, test, vi } from "vitest";
import { createCoreTelemetry } from "../src/core/core-telemetry.ts";
import { SessionManager } from "../src/core/session-manager.ts";

vi.mock("fs", { spy: true });
const temporary: string[] = [];
afterEach(async () => {
	vi.resetAllMocks();
	vi.restoreAllMocks();
	for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

// Vitest isolates this module's process-wide recovery state from other test files.
// Within this file it intentionally remains enabled after the first failed repair.
test.each([
	{ repairFails: false, destination: "preloaded" },
	{ repairFails: false, destination: "hardlink" },
	{ repairFails: false, destination: "replaced" },
	{ repairFails: true, destination: "preloaded" },
	{ repairFails: true, destination: "hardlink" },
	{ repairFails: true, destination: "replaced" },
])(
	"failed final telemetry append isolates its tail ($repairFails, $destination)",
	async ({ repairFails, destination }) => {
		const directory = await mkdtemp(join(tmpdir(), "pi-telemetry-tail-"));
		temporary.push(directory);
		const manager = SessionManager.create(directory, directory);
		const first = manager.appendMessage({ role: "user", content: "before", timestamp: 1 });
		const file = manager.getSessionFile()!;
		const alias = join(directory, "alias.jsonl");
		if (destination !== "preloaded") fs.linkSync(file, alias);
		const replacement = SessionManager.open(destination === "hardlink" ? alias : file);
		const moved = destination === "replaced" ? SessionManager.open(alias) : undefined;
		let now = 0;
		let count = 1;
		const owner = createCoreTelemetry(
			manager,
			{},
			{
				now: () => now,
				monitor: () => ({
					get count() {
						return count;
					},
					min: 20e6,
					max: 20e6,
					mean: 20e6,
					percentile: () => 20e6,
					enable: () => {},
					disable: () => {},
					reset: () => {
						count = 0;
					},
				}),
			},
		)!;
		now = 60000;
		owner.sample();
		const write = vi
			.spyOn(fs, "writeFileSync")
			.mockClear()
			.mockImplementationOnce((fd, data) => {
				if (typeof fd !== "number") throw new Error("expected existing journal fd");
				fs.writeSync(fd, String(data).slice(0, 24));
				if (destination === "replaced") {
					fs.unlinkSync(alias);
					fs.renameSync(file, alias);
					const replacementFd = fs.openSync(file, "wx");
					try {
						fs.writeSync(
							replacementFd,
							`${JSON.stringify(manager.getHeader())}\n${JSON.stringify(manager.getEntry(first))}\n`,
						);
					} finally {
						fs.closeSync(replacementFd);
					}
				}
				throw new Error("partial metadata append");
			});
		if (repairFails)
			write.mockImplementationOnce(() => {
				throw new Error("newline repair failed");
			});
		expect(() => owner.close()).not.toThrow();
		expect(owner.status().health).toMatchObject({ recordsPersisted: 0, droppedRecords: 1, writeErrors: 1 });
		expect(write).toHaveBeenNthCalledWith(2, write.mock.calls[0]![0], "\n");
		write.mockReset();
		write.mockRestore();

		if (moved) {
			// This writer was loaded before the failure and the inode's path replacement.
			moved.appendMessage({ role: "user", content: "moved", timestamp: 2 });
			expect(SessionManager.open(alias).buildSessionContext().messages).toHaveLength(2);
		}
		const second = replacement.appendMessage({ role: "user", content: "after", timestamp: 2 });
		const third = replacement.appendMessage({ role: "user", content: "later", timestamp: 3 });
		const reopened = SessionManager.open(replacement.getSessionFile()!);
		expect(reopened.getBranch().map((entry) => entry.id)).toEqual([first, second, third]);
		expect(reopened.buildSessionContext().messages).toHaveLength(3);
		expect(reopened.getLeafId()).toBe(third);
		for (const line of (await readFile(replacement.getSessionFile()!, "utf8")).split("\n")) {
			if (line.includes('"after"') || line.includes('"later"')) expect(() => JSON.parse(line)).not.toThrow();
		}

		const other = SessionManager.create(directory, directory);
		const otherFirst = other.appendMessage({ role: "user", content: "other", timestamp: 1 });
		const otherSecond = other.appendMessage({ role: "user", content: "other later", timestamp: 2 });
		expect(
			SessionManager.open(other.getSessionFile()!)
				.getBranch()
				.map((entry) => entry.id),
		).toEqual([otherFirst, otherSecond]);
		expect(() => owner.close()).not.toThrow();
		vi.spyOn(fs, "appendFileSync").mockImplementationOnce(() => {
			throw new Error("ordinary write failed");
		});
		expect(() => replacement.appendMessage({ role: "user", content: "failed ordinary", timestamp: 4 })).toThrow(
			"ordinary write failed",
		);
		expect(SessionManager.open(replacement.getSessionFile()!).getLeafId()).toBe(third);
	},
);
