#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  printProxySummary,
  rootDir,
  withProxyEnv,
} from "./setup-env.mjs";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const { env, proxy } = withProxyEnv(process.env);

console.log("Gridmen start");
printProxySummary(proxy, env);

const child = spawn(
  npmCommand,
  [
    "exec",
    "--",
    "concurrently",
    "npm run start:client",
    "npm run dev:web",
    "npm run start:server",
  ],
  {
    cwd: rootDir,
    env,
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
