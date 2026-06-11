#!/usr/bin/env node

import path from "node:path";
import {
  printProxySummary,
  rootDir,
  runStep,
  toolVersion,
  withProxyEnv,
} from "./setup-env.mjs";

const dryRun = process.argv.includes("--dry-run");
const { env, proxy } = withProxyEnv(process.env);
const uv = toolVersion("uv", ["--version"], { env });

console.log("Gridmen setup");
if (dryRun) {
  console.log("Mode: dry run");
}
printProxySummary(proxy, env);

if (!uv.ok) {
  console.error("\nMissing required tool: uv");
  console.error("Install uv before running setup:");
  console.error("  macOS/Linux: curl -LsSf https://astral.sh/uv/install.sh | sh");
  console.error("  Homebrew:    brew install uv");
  console.error(
    '  Windows:     powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
  );
  process.exit(1);
}

console.log(`uv: ${uv.stdout}`);

const steps = [
  {
    args: ["ci"],
    command: "npm",
    cwd: rootDir,
    label: "Install workspace dependencies",
  },
  {
    args: ["ci"],
    command: "npm",
    cwd: path.join(rootDir, "client"),
    label: "Install Electron dependencies",
  },
  {
    args: [path.join("node_modules", "electron", "install.js")],
    command: "node",
    cwd: path.join(rootDir, "client"),
    label: "Install Electron runtime",
  },
  {
    args: ["ci"],
    command: "npm",
    cwd: path.join(rootDir, "client", "src"),
    label: "Install React renderer dependencies",
  },
  {
    args: ["sync"],
    command: "uv",
    cwd: path.join(rootDir, "server"),
    label: "Sync backend Python environment",
  },
];

for (const step of steps) {
  runStep(step.label, step.command, step.args, {
    cwd: step.cwd,
    dryRun,
    env,
  });
}

console.log("\nSetup complete.");
