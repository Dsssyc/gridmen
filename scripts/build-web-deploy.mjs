#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  printProxySummary,
  rootDir,
  withProxyEnv,
} from "./setup-env.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const defaultPublicBasePath = "/gridmen/";
const defaultApiBaseUrl = "/gridmen";

export function createDeployBuildEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    VITE_PUBLIC_BASE_PATH:
      baseEnv.VITE_PUBLIC_BASE_PATH ?? defaultPublicBasePath,
    VITE_API_BASE_URL: baseEnv.VITE_API_BASE_URL ?? defaultApiBaseUrl,
  };
}

function run() {
  const { env, proxy } = withProxyEnv(process.env);
  const childEnv = createDeployBuildEnv(env);

  console.log("Gridmen web deploy build");
  console.log(`Public base path: ${childEnv.VITE_PUBLIC_BASE_PATH}`);
  console.log(`API base URL: ${childEnv.VITE_API_BASE_URL}`);
  printProxySummary(proxy, childEnv);

  const child = spawn(npmCommand, ["run", "build"], {
    cwd: path.join(rootDir, "client", "src"),
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
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run();
}
