import { serveStdio } from "./server";
import { VERSION } from "./version";

const HELP = `finance-k ${VERSION}

Usage:
  finance-k mcp [--data-dir <dir>]   Run the read-only MCP server on stdio.
  finance-k --version
  finance-k --help

The server reads finance-k.sqlite from FINANCE_K_DATA_DIR, else
~/Library/Application Support/finance-k. It never writes and never uses the network.
`;

const args = process.argv.slice(2);
const command = args[0];

if (command === "--version" || command === "-v") {
  console.log(VERSION);
} else if (command === "mcp") {
  const i = args.indexOf("--data-dir");
  if (i !== -1) {
    const dir = args[i + 1];
    if (!dir) {
      console.error("--data-dir needs a directory");
      process.exit(2);
    }
    process.env.FINANCE_K_DATA_DIR = dir;
  }
  await serveStdio();
} else {
  console.log(HELP);
  process.exit(command === "--help" || command === "-h" ? 0 : 2);
}
