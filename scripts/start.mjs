#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import {
  printProxySummary,
  rootDir,
  withProxyEnv,
} from "./setup-env.mjs";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const { env, proxy } = withProxyEnv(process.env);
const shutdownGraceMs = 8_000;
const forceKillGraceMs = 12_000;

const processes = [
  {
    command: npmCommand,
    args: ["start"],
    cwd: path.join(rootDir, "client"),
    name: "client",
  },
  {
    command: npmCommand,
    args: ["run", "dev"],
    cwd: path.join(rootDir, "client", "src"),
    name: "web",
  },
  {
    command: "uv",
    args: ["run", "main.py"],
    cwd: path.join(rootDir, "server"),
    name: "server",
  },
];

const children = new Map();
let shuttingDown = false;
let desiredExitCode = 0;
let shutdownTimer;
let forceKillTimer;

console.log("Gridmen start");
printProxySummary(proxy, env);

function prefixStream(stream, prefix, target) {
  const lines = readline.createInterface({ input: stream });
  lines.on("line", (line) => {
    target.write(`[${prefix}] ${line}\n`);
  });
  return lines;
}

function signalChild(child, signal) {
  if (
    child.exitCode !== null ||
    child.signalCode !== null ||
    !Number.isInteger(child.pid)
  ) {
    return;
  }

  try {
    if (isWindows) {
      child.kill(signal);
      return;
    }

    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") {
      console.error(`Failed to signal ${child.gridmenName}: ${error.message}`);
    }
  }
}

function taskkill(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

function reapIfDone() {
  if (!shuttingDown || children.size > 0) {
    return;
  }

  clearTimeout(shutdownTimer);
  clearTimeout(forceKillTimer);
  process.exit(desiredExitCode);
}

function shutdown(signal = "SIGTERM", exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  desiredExitCode = exitCode;

  for (const child of children.values()) {
    signalChild(child, signal);
  }

  shutdownTimer = setTimeout(() => {
    for (const child of children.values()) {
      signalChild(child, "SIGTERM");
    }
  }, shutdownGraceMs);

  forceKillTimer = setTimeout(() => {
    for (const child of children.values()) {
      if (isWindows) {
        taskkill(child);
      } else {
        signalChild(child, "SIGKILL");
      }
    }
  }, forceKillGraceMs);

  reapIfDone();
}

function startProcess(config) {
  const child = spawn(config.command, config.args, {
    cwd: config.cwd,
    detached: !isWindows,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.gridmenName = config.name;
  if (Number.isInteger(child.pid)) {
    children.set(child.pid, child);
  }

  prefixStream(child.stdout, config.name, process.stdout);
  prefixStream(child.stderr, config.name, process.stderr);

  child.on("error", (error) => {
    console.error(`[${config.name}] ${error.message}`);
    shutdown("SIGTERM", 1);
  });

  child.on("exit", (code, signal) => {
    if (Number.isInteger(child.pid)) {
      children.delete(child.pid);
    }

    if (!shuttingDown) {
      const exitCode = code ?? (signal ? 1 : 0);
      if (exitCode !== 0 || signal) {
        console.error(
          `[${config.name}] exited ${signal ? `with ${signal}` : `with code ${exitCode}`}`,
        );
      }
      shutdown("SIGTERM", exitCode);
      return;
    }

    reapIfDone();
  });
}

for (const processConfig of processes) {
  startProcess(processConfig);
}

process.on("SIGINT", () => {
  shutdown("SIGINT", 130);
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM", 143);
});
