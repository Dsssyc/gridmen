#!/usr/bin/env node

import {
  capture,
  printProxySummary,
  rootDir,
  toolVersion,
  withProxyEnv,
} from "./setup-env.mjs";

const { env, proxy } = withProxyEnv(process.env);
let failed = false;

function checkTool(command, args = ["--version"], required = true) {
  const result = toolVersion(command, args, { env });
  if (result.ok) {
    console.log(`${command}: ${result.stdout || "ok"}`);
    return result;
  }

  const message = `${command}: missing or not executable`;
  if (required) {
    console.error(message);
    failed = true;
  } else {
    console.warn(`${message} (optional)`);
  }
  return result;
}

console.log("Gridmen setup doctor");
printProxySummary(proxy, env);

checkTool("node");
checkTool("npm");
checkTool("uv");

if (process.platform === "darwin") {
  const gdal = checkTool("gdal-config", ["--version"]);
  const brew = checkTool("brew", ["--version"], false);

  if (gdal.ok && brew.ok) {
    const linkage = capture("brew", ["linkage", "--test", "gdal"], {
      cwd: rootDir,
      env,
    });

    if (linkage.ok) {
      console.log("gdal linkage: ok");
    } else {
      console.error("gdal linkage: failed");
      if (linkage.stderr) {
        console.error(linkage.stderr);
      }
      failed = true;
    }
  }
}

if (failed) {
  console.error("\nDoctor failed. Fix the missing tool or native linkage issue, then rerun npm run doctor.");
  process.exit(1);
}

console.log("\nDoctor passed.");
