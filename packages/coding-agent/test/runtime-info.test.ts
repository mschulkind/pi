import * as fs from "node:fs";
import * as inspector from "node:inspector";
import { expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { formatRuntimeInfo, getRuntimeInfo } from "../src/core/runtime-info.ts";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";

vi.mock("node:fs", { spy: true });
vi.mock("node:inspector", { spy: true });

it("reports unstamped source and disabled inspector honestly without sensitive URLs", async () => {
	const runtime = await ModelRuntime.create({
		credentials: AuthStorage.inMemory(),
		modelsPath: null,
		refreshOnCreate: false,
		performanceDirectory: null,
	});
	const snapshot = getRuntimeInfo(runtime, []);
	expect(snapshot.build).toMatchObject({
		origin: "source_unstamped",
		forkCommit: null,
		buildDigest: null,
		dirty: null,
	});
	expect(snapshot.inspector.automaticEnablement).toBe("disabled_missing_authoritative_yolo_contract");
	const text = formatRuntimeInfo(snapshot);
	expect(text).toContain("Running Pi: unknown (source_unstamped)");
	expect(text).not.toMatch(/(?:ws|http):\/\//);
	expect(BUILTIN_SLASH_COMMANDS.some((command) => command.name === "runtime")).toBe(true);
	expect(formatRuntimeInfo(snapshot)).toBe(text);
});

it.each([1, 2])("never authorizes an inspector from forged readonly private version %i records", async (version) => {
	const runtime = await ModelRuntime.create({
		credentials: AuthStorage.inMemory(),
		modelsPath: null,
		refreshOnCreate: false,
		performanceDirectory: null,
	});
	// A privileged peer can replace even an apparently readonly effective mount.
	// These are available forged bytes, not a claim of a real mounted fixture.
	const record = JSON.stringify({
		schema: "yolo.launch-network",
		version,
		confinement: "jail",
		backend: "podman",
		applied_network_mode: "bridge",
		network_scope: "private",
	});
	const mountinfo = "101 1 0:42 / /run/yolo/launch ro,relatime - tmpfs tmpfs ro\n";
	const read = vi.spyOn(fs, "readFileSync").mockImplementation((path) => {
		if (String(path) === "/run/yolo/launch/network.json") return record;
		if (String(path) === "/proc/self/mountinfo") return mountinfo;
		throw new Error(`Unexpected filesystem read: ${String(path)}`);
	});
	const open = vi.spyOn(inspector, "open").mockImplementation(() => {
		throw new Error("Automatic inspector activation is forbidden");
	});
	const url = vi.spyOn(inspector, "url").mockReturnValue(undefined);
	read.mockClear();
	open.mockClear();
	try {
		const info = getRuntimeInfo(runtime, []);
		expect(info.inspector).toEqual({
			status: "disabled",
			origin: "not_started",
			automaticEnablement: "disabled_missing_authoritative_yolo_contract",
		});
		expect(formatRuntimeInfo(info)).toContain("disabled_missing_authoritative_yolo_contract");
		expect(open).not.toHaveBeenCalled();
		// Reporting remains snapshot-only; it must not consult either forged source.
		expect(read).not.toHaveBeenCalled();
	} finally {
		url.mockRestore();
		open.mockRestore();
		read.mockRestore();
	}
});
