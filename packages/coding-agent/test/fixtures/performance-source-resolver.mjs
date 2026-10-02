import { registerHooks } from "node:module";
const aliases = new Map([
 ["@earendil-works/pi-ai/api/performance", new URL("../../../ai/src/api/performance.ts", import.meta.url).href],
 ["@earendil-works/pi-telemetry", new URL("../../../telemetry/src/index.ts", import.meta.url).href],
]);
registerHooks({ resolve(specifier, context, nextResolve) { return nextResolve(aliases.get(specifier) ?? specifier, context); } });
