// Bundles mcp/main.ts into one dependency-free file the Claude plugin can run: node finance-k.mjs mcp
import { build } from "esbuild";

await build({
  entryPoints: ["mcp/main.ts"],
  outfile: "plugins/finance-k/server/finance-k.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "warning",
});
