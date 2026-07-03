#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";

import {
  printProxySummary,
  rootDir,
  withProxyEnv,
} from "./setup-env.mjs";

const { env, proxy } = withProxyEnv(process.env);
const childEnv = {
  ...env,
  WEB_PUBLIC_BASE_PATH: env.WEB_PUBLIC_BASE_PATH ?? "/gridmen",
  WEB_STATIC_DIR: env.WEB_STATIC_DIR ?? path.join(rootDir, "templates"),
  SERVER_PORT: env.SERVER_PORT ?? "8000",
};

console.log("Gridmen local web server");
console.log(`WEB_PUBLIC_BASE_PATH: ${childEnv.WEB_PUBLIC_BASE_PATH}`);
console.log(`WEB_STATIC_DIR: ${childEnv.WEB_STATIC_DIR}`);
console.log(`SERVER_PORT: ${childEnv.SERVER_PORT}`);
printProxySummary(proxy, childEnv);

const child = spawn("uv", ["run", "main.py"], {
  cwd: path.join(rootDir, "server"),
  env: childEnv,
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
