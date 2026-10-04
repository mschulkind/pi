import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

// Review P2: repository-root docs are not shipped in the coding-agent package.
test("core telemetry changelog links to the fork contract without escaping the installed package", async () => {
	const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
	const link = changelog.match(/\[Core responsiveness\]\(([^)]+)\)/)?.[1];
	expect(link).toBe("https://github.com/mschulkind/pi/blob/main/docs/core-responsiveness/implementation.md");
	const document = new URL("../../../docs/core-responsiveness/implementation.md", import.meta.url);
	expect(await readFile(document, "utf8")).toContain('schema="pi.core-responsiveness"');
});
