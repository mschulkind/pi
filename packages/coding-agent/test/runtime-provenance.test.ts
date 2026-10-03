import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createEventBus } from "../src/core/event-bus.ts";
import {
	clearExtensionCache,
	createExtensionRuntime,
	loadExtensionFromFactory,
	loadExtensionsCached,
} from "../src/core/extensions/loader.ts";
import {
	captureExtensionEntryIdentity,
	getLoadedExtensionIdentity,
	type LoadedExtensionIdentity,
	rememberLoadedFactory,
} from "../src/core/runtime-provenance.ts";

it("does not relabel a reused native factory with a newer disk snapshot", async () => {
	const factory = () => {};
	const first: LoadedExtensionIdentity = {
		version: "1",
		commit: "old",
		dirty: false,
		entryDigest: "old",
		origin: "entry_load_snapshot",
		uncertainty: "dependency_graph_not_attested",
	};
	rememberLoadedFactory(factory, Object.freeze(first));
	rememberLoadedFactory(factory, { ...first, version: "2", commit: "new", entryDigest: "new" });
	const extension = await loadExtensionFromFactory(factory, process.cwd(), createEventBus(), createExtensionRuntime());
	expect(getLoadedExtensionIdentity(extension)).toEqual(first);
});

it("preserves loaded identity across changed disk HEAD and cached reload, then captures a fresh entry", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-loaded-"));
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", dir, ...args], {
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "fixture",
				GIT_AUTHOR_EMAIL: "fixture@example.test",
				GIT_COMMITTER_NAME: "fixture",
				GIT_COMMITTER_EMAIL: "fixture@example.test",
			},
			stdio: "pipe",
		});
	try {
		git("init");
		writeFileSync(join(dir, "package.json"), '{"version":"1.2.3","type":"module"}');
		const entry = join(dir, "extension.ts");
		writeFileSync(entry, "export default function () {}\n");
		git("add", ".");
		git("commit", "-m", "fixture");
		const first = await loadExtensionsCached([entry], dir);
		expect(first.errors).toEqual([]);
		const identity = getLoadedExtensionIdentity(first.extensions[0]);
		expect(identity).toMatchObject({
			version: "1.2.3",
			dirty: false,
			origin: "entry_load_snapshot",
			uncertainty: "dependency_graph_not_attested",
		});
		if (process.platform !== "win32") {
			const deployed = mkdtempSync(join(tmpdir(), "pi-entry-link-"));
			try {
				writeFileSync(join(deployed, "package.json"), '{"version":"9.9.9"}');
				const alias = join(deployed, "extension.ts");
				symlinkSync(entry, alias);
				expect(captureExtensionEntryIdentity(alias)).toEqual(identity);
			} finally {
				rmSync(deployed, { recursive: true, force: true });
			}
		}
		writeFileSync(entry, "export default function () { const changed = true; }\n");
		writeFileSync(join(dir, "package.json"), '{"version":"2.0.0","type":"module"}');
		git("add", ".");
		git("commit", "-m", "changed");
		const cached = await loadExtensionsCached([entry], dir);
		expect(getLoadedExtensionIdentity(cached.extensions[0])).toEqual(identity);
		expect(getLoadedExtensionIdentity(first.extensions[0])).toEqual(identity);
		clearExtensionCache();
		writeFileSync(entry, "export default function () { const dirty = true; }\n");
		const fresh = await loadExtensionsCached([entry], dir);
		expect(fresh.errors).toEqual([]);
		const next = getLoadedExtensionIdentity(fresh.extensions[0]);
		expect(next).toMatchObject({ version: "2.0.0", dirty: true });
		expect(next.commit).not.toBe(identity.commit);
		expect(next.entryDigest).not.toBe(identity.entryDigest);
	} finally {
		clearExtensionCache();
		rmSync(dir, { recursive: true, force: true });
	}
});
