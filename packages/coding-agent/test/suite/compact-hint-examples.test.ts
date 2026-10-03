import { expect, test } from "vitest";
import todo from "../../examples/extensions/todo.ts";
import truncated from "../../examples/extensions/truncated-tool.ts";
import { createHarness } from "./harness.ts";

test.each([
	{ factory: todo, name: "todo" },
	{ factory: truncated, name: "rg" },
])("$name example supplies semantic hints without wrapping execution", async ({ factory, name }) => {
	const harness = await createHarness({ extensionFactories: [factory] });
	try {
		expect(harness.session.getToolDefinition(name)?.getCompactHints).toBeTypeOf("function");
	} finally {
		harness.cleanup();
	}
});
