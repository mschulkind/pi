import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { LocalPerformanceRecorder } from "../src/core/api-performance-recorder.ts";

const directories: string[] = [];
afterEach(async () => {
	for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function directory() {
	const dir = await mkdtemp(join(tmpdir(), "pi-performance-exit-"));
	directories.push(dir);
	return dir;
}
function child(dir: string, budget = 250) {
	return spawnSync(
		process.execPath,
		[
			"--import",
			fileURLToPath(new URL("./fixtures/performance-source-resolver.mjs", import.meta.url)),
			fileURLToPath(new URL("./fixtures/performance-exit.ts", import.meta.url)),
			dir,
			String(budget),
		],
		{ timeout: 10000, encoding: "utf8", env: { PATH: process.env.PATH, PI_OFFLINE: "1", PI_TELEMETRY: "0" } },
	);
}
describe("performance production shutdown and retention", () => {
	it("drains queued records on explicit process.exit without caller flush", async () => {
		const dir = await directory();
		const result = child(dir);
		expect(result.status, result.stderr).toBe(0);
		const files = await readdir(dir);
		expect(files).toHaveLength(2);
		const records = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(dir, file), "utf8"))));
		expect(records.every((record) => record.recordKind === "coverage_gap" && record.actualApiHostname === null)).toBe(
			true,
		);
		expect(records.find((record) => record.api === "bedrock-converse-stream")).toMatchObject({
			sessionId: "session",
			logicalRequestId: "request",
			purpose: "assistant",
		});
	});
	it("reports records lost at the bounded shutdown deadline instead of silently losing them", async () => {
		const dir = await directory();
		const result = child(dir, 0);
		expect(result.status, result.stderr).toBe(0);
		expect(await readdir(dir)).toEqual([]);
		expect(result.stderr).toContain("shutdown: dropped=2 writeFailures=0");
	});
	it("retains a bounded set across dead-process runs", async () => {
		const dir = await directory();
		expect(child(dir).status).toBe(0);
		const first = await readdir(dir);
		expect(child(dir).status).toBe(0);
		const second = await readdir(dir);
		expect(second).toHaveLength(2);
		expect(second.every((file) => !first.includes(file))).toBe(true);
	});
	it("does not prune another active recorder's files", async () => {
		const dir = await directory();
		const first = new LocalPerformanceRecorder(dir, { maxFileBytes: 1, retainedFiles: 1 });
		first.noteUnsupported("bedrock-converse-stream");
		await first.flush();
		const previous = await readdir(dir);
		const second = new LocalPerformanceRecorder(dir, { maxFileBytes: 1, retainedFiles: 1 });
		second.noteUnsupported("google-generative-ai");
		await second.flush();
		expect(await readdir(dir)).toEqual(expect.arrayContaining(previous));
		first.close();
		second.close();
	});
});
