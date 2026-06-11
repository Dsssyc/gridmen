import assert from "node:assert/strict";
import test from "node:test";

import { proxyConfig, redactProxy, withProxyEnv } from "./setup-env.mjs";

test("withProxyEnv normalizes proxy variables for npm and Electron", () => {
  const { env, proxy } = withProxyEnv({
    NO_PROXY: "localhost,127.0.0.1",
    https_proxy: "http://user:secret@example.test:8080",
  });

  assert.equal(proxy.hasProxy, true);
  assert.equal(env.HTTP_PROXY, "http://user:secret@example.test:8080");
  assert.equal(env.HTTPS_PROXY, "http://user:secret@example.test:8080");
  assert.equal(env.http_proxy, "http://user:secret@example.test:8080");
  assert.equal(env.https_proxy, "http://user:secret@example.test:8080");
  assert.equal(env.ELECTRON_GET_USE_PROXY, "1");
  assert.equal(env.ELECTRON_MIRROR, "https://npmmirror.com/mirrors/electron/");
  assert.equal(env.npm_config_https_proxy, "http://user:secret@example.test:8080");
  assert.equal(env.npm_config_electron_mirror, "https://npmmirror.com/mirrors/electron/");
  assert.equal(env.npm_config_noproxy, "localhost,127.0.0.1");
});

test("withProxyEnv leaves Electron proxy disabled when no proxy exists", () => {
  const { env, proxy } = withProxyEnv({ PATH: "/usr/bin" });

  assert.equal(proxy.hasProxy, false);
  assert.equal(env.ELECTRON_GET_USE_PROXY, undefined);
  assert.equal(env.ELECTRON_MIRROR, "https://npmmirror.com/mirrors/electron/");
  assert.equal(env.npm_config_proxy, undefined);
});

test("withProxyEnv preserves explicit Electron mirror", () => {
  const { env } = withProxyEnv({
    ELECTRON_MIRROR: "https://example.test/electron/",
  });

  assert.equal(env.ELECTRON_MIRROR, "https://example.test/electron/");
  assert.equal(env.npm_config_electron_mirror, undefined);
});

test("withProxyEnv removes Electron node-mode flag from child processes", () => {
  const { env } = withProxyEnv({
    ELECTRON_RUN_AS_NODE: "1",
    PATH: "/usr/bin",
  });

  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
});

test("proxyConfig prefers explicit http proxy over all proxy", () => {
  const proxy = proxyConfig({
    ALL_PROXY: "socks5://proxy.example.test:1080",
    HTTP_PROXY: "http://proxy.example.test:8080",
  });

  assert.equal(proxy.httpProxy, "http://proxy.example.test:8080");
  assert.equal(proxy.httpsProxy, "http://proxy.example.test:8080");
  assert.equal(proxy.allProxy, "socks5://proxy.example.test:1080");
});

test("redactProxy hides proxy passwords", () => {
  const redacted = redactProxy("http://user:secret@example.test:8080");

  assert.equal(redacted.includes("secret"), false);
  assert.equal(redacted.includes("***"), true);
});
