import { LocalPerformanceRecorder } from "../../src/core/api-performance-recorder.ts";

const recorder = new LocalPerformanceRecorder(process.argv[2], {
	exitBudgetMs: Number(process.argv[3] ?? 250),
	maxFileBytes: 1,
	retainedFiles: 2,
});
recorder.noteUnsupported("bedrock-converse-stream", {
	record: () => {},
	logicalRequestId: "request",
	sessionId: "session",
	purpose: "assistant",
});
recorder.noteUnsupported("google-generative-ai");
// Neither awaiting flush nor natural beforeExit: exercise the hook used by interactive shutdown.
process.exit(0);
