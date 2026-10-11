// Resolves the `@/` path alias for offline verify scripts.
// Usage: node --loader ./scripts/alias-loader.mjs scripts/verify-*.mjs
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const ROOT = "/home/hatch/workspace/nexarb-app-build/";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = ROOT + specifier.slice(2);
    const target = existsSync(base) ? base : base + ".ts";
    return {
      url: pathToFileURL(target).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
