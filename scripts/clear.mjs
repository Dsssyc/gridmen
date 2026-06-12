#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { rootDir } from "./setup-env.mjs";

const dryRun = process.argv.includes("--dry-run");

const targets = [
  {
    label: "backend resource directory",
    path: path.join(rootDir, "server", "resource"),
  },
  {
    label: "noodle database",
    path: path.join(rootDir, "server", "noodle.db"),
  },
];

function assertInsideRoot(targetPath) {
  const relative = path.relative(rootDir, targetPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clear path outside project root: ${targetPath}`);
  }
}

async function pathExists(targetPath) {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

console.log("Gridmen clear");
if (dryRun) {
  console.log("Mode: dry run");
}

for (const target of targets) {
  assertInsideRoot(target.path);
  const displayPath = path.relative(rootDir, target.path);
  const exists = await pathExists(target.path);

  if (!exists) {
    console.log(`Skip missing ${target.label}: ${displayPath}`);
    continue;
  }

  if (dryRun) {
    console.log(`Would remove ${target.label}: ${displayPath}`);
    continue;
  }

  await fs.rm(target.path, {
    force: true,
    maxRetries: 3,
    recursive: true,
    retryDelay: 100,
  });
  console.log(`Removed ${target.label}: ${displayPath}`);
}

console.log(dryRun ? "\nDry run complete." : "\nClear complete.");
