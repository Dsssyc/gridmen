import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const isWindows = process.platform === "win32";
const defaultElectronMirror = "https://npmmirror.com/mirrors/electron/";

function firstEnvValue(env, keys) {
  for (const key of keys) {
    if (env[key]) {
      return env[key];
    }
  }
  return "";
}

export function proxyConfig(env = process.env) {
  const allProxy = firstEnvValue(env, ["ALL_PROXY", "all_proxy"]);
  const httpsProxy =
    firstEnvValue(env, ["HTTPS_PROXY", "https_proxy"]) ||
    firstEnvValue(env, ["HTTP_PROXY", "http_proxy"]) ||
    allProxy;
  const httpProxy =
    firstEnvValue(env, ["HTTP_PROXY", "http_proxy"]) ||
    firstEnvValue(env, ["HTTPS_PROXY", "https_proxy"]) ||
    allProxy;
  const noProxy = firstEnvValue(env, ["NO_PROXY", "no_proxy"]);

  return {
    allProxy,
    hasProxy: Boolean(httpProxy || httpsProxy || allProxy),
    httpProxy,
    httpsProxy,
    noProxy,
  };
}

export function withProxyEnv(env = process.env) {
  const proxy = proxyConfig(env);
  const childEnv = { ...env };

  if (proxy.httpProxy) {
    childEnv.HTTP_PROXY = proxy.httpProxy;
    childEnv.http_proxy = proxy.httpProxy;
    childEnv.npm_config_proxy ||= proxy.httpProxy;
  }

  if (proxy.httpsProxy) {
    childEnv.HTTPS_PROXY = proxy.httpsProxy;
    childEnv.https_proxy = proxy.httpsProxy;
    childEnv.npm_config_https_proxy ||= proxy.httpsProxy;
  }

  if (proxy.allProxy) {
    childEnv.ALL_PROXY = proxy.allProxy;
    childEnv.all_proxy = proxy.allProxy;
  }

  if (proxy.noProxy) {
    childEnv.NO_PROXY = proxy.noProxy;
    childEnv.no_proxy = proxy.noProxy;
    childEnv.npm_config_noproxy ||= proxy.noProxy;
  }

  if (proxy.hasProxy) {
    childEnv.ELECTRON_GET_USE_PROXY = "1";
  }

  const electronMirror =
    childEnv.ELECTRON_MIRROR || childEnv.npm_config_electron_mirror;
  if (!electronMirror) {
    childEnv.ELECTRON_MIRROR = defaultElectronMirror;
    childEnv.npm_config_electron_mirror = defaultElectronMirror;
  }

  return { env: childEnv, proxy };
}

export function redactProxy(value) {
  if (!value) {
    return "";
  }

  try {
    const parsed = new URL(value);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return value.includes("@") ? "[set]" : value;
  }
}

export function capture(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    encoding: "utf8",
    env: options.env ?? process.env,
    shell: isWindows,
  });

  return {
    error: result.error,
    ok: result.status === 0,
    status: result.status,
    stderr: result.stderr?.trim() ?? "",
    stdout: result.stdout?.trim() ?? "",
  };
}

export function toolVersion(command, args = ["--version"], options = {}) {
  return capture(command, args, options);
}

export function commandExists(command, options = {}) {
  return toolVersion(command, ["--version"], options).ok;
}

export function runStep(label, command, args = [], options = {}) {
  const cwd = options.cwd ?? rootDir;
  const display = [command, ...args].join(" ");

  console.log(`\n> ${label}`);
  console.log(`  ${path.relative(rootDir, cwd) || "."}$ ${display}`);

  if (options.dryRun) {
    return;
  }

  const result = spawnSync(command, args, {
    cwd,
    env: options.env ?? process.env,
    shell: isWindows,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export function printProxySummary(proxy, env = process.env) {
  if (!proxy.hasProxy) {
    console.log("Proxy: none detected");
  } else {
    console.log("Proxy: detected; Electron download proxy is enabled");
    if (proxy.httpProxy) {
      console.log(`  HTTP_PROXY=${redactProxy(proxy.httpProxy)}`);
    }
    if (proxy.httpsProxy) {
      console.log(`  HTTPS_PROXY=${redactProxy(proxy.httpsProxy)}`);
    }
    if (proxy.allProxy) {
      console.log(`  ALL_PROXY=${redactProxy(proxy.allProxy)}`);
    }
    if (proxy.noProxy) {
      console.log(`  NO_PROXY=${proxy.noProxy}`);
    }
  }

  const electronMirror = env.ELECTRON_MIRROR || env.npm_config_electron_mirror;
  if (electronMirror) {
    console.log(`Electron mirror: ${electronMirror}`);
  }
}
