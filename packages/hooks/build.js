import { build } from "esbuild";
import { readdirSync } from "fs";

const entryPoints = readdirSync("src")
  .filter((f) => f.endsWith(".ts") && !f.startsWith("lib"))
  .map((f) => `src/${f}`);

await build({
  entryPoints,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outdir: "dist",
  banner: { js: "#!/usr/bin/env node" },
  external: [],
});

console.log("Built:", entryPoints);
