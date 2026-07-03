import assert from "node:assert/strict";
import test from "node:test";

import { createDeployBuildEnv } from "./build-web-deploy.mjs";

test("createDeployBuildEnv sets deploy defaults while preserving Mapbox token", () => {
  const env = createDeployBuildEnv({
    NODE_ENV: "test",
    VITE_MAP_TOKEN: "pk.test-token",
  });

  assert.equal(env.NODE_ENV, "test");
  assert.equal(env.VITE_MAP_TOKEN, "pk.test-token");
  assert.equal(env.VITE_PUBLIC_BASE_PATH, "/gridmen/");
  assert.equal(env.VITE_API_BASE_URL, "/gridmen");
});

test("createDeployBuildEnv allows explicit deploy overrides", () => {
  const env = createDeployBuildEnv({
    VITE_PUBLIC_BASE_PATH: "/custom/",
    VITE_API_BASE_URL: "https://example.test/custom",
  });

  assert.equal(env.VITE_PUBLIC_BASE_PATH, "/custom/");
  assert.equal(env.VITE_API_BASE_URL, "https://example.test/custom");
});
