import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildMarketplace,
  buildCodexManifest,
  buildClaudeManifest,
  buildOmpManifest,
  buildPortableHooks,
  normalizeFactoryAgent,
} from "./sync-harness-plugins.mjs";

test("points OMP marketplace entries at canonical plugin directories", () => {
  const marketplace = buildMarketplace(
    "cursor-plugins",
    { name: "Cursor" },
    [
      {
        name: "example",
        source: "example",
        description: "An example plugin",
        version: "1.0.0",
        category: "developer-tools",
      },
    ],
    "omp",
  );

  assert.equal(marketplace.plugins[0].source, "./example");
});

test("normalizes Cursor stop hooks into the Claude and Factory hook contract", () => {
  const normalized = buildPortableHooks({
    version: 1,
    hooks: {
      afterAgentResponse: [{ command: "./hooks/capture-response.sh" }],
      stop: [{ command: "bun run \${CURSOR_PLUGIN_ROOT}/hooks/stop.ts" }],
    },
  });

  assert.deepEqual(Object.keys(normalized), ["hooks"]);
  assert.equal(normalized.hooks.Stop.length, 2);
  assert.equal(
    normalized.hooks.Stop[0].hooks[0].command,
    '"\${CLAUDE_PLUGIN_ROOT}/hooks/capture-response.sh"',
  );
  assert.equal(
    normalized.hooks.Stop[1].hooks[0].command,
    'bun run "\${CLAUDE_PLUGIN_ROOT}/hooks/stop.ts"',
  );
});

test("maps read-only Cursor agents to Factory droids", () => {
  const normalized = normalizeFactoryAgent(
    "---\nname: reviewer\nreadonly: true\nis_background: true\n---\nReview the code.\n",
  );

  assert.match(normalized, /tools: read-only/);
  assert.doesNotMatch(normalized, /readonly:/);
  assert.doesNotMatch(normalized, /is_background:/);
});

test("keeps Codex manifests inside the local plugin contract", () => {
  const manifest = buildCodexManifest(
    {
      name: "example",
      version: "1.0.0",
      description: "An example plugin",
      author: { name: "Cursor" },
      homepage: "https://github.com/cursor/plugins",
      repository: "https://github.com/cursor/plugins",
      license: "MIT",
      keywords: ["example"],
    },
    process.cwd(),
  );

  assert.deepEqual(manifest.skills, undefined);
  assert.equal(manifest.interface.displayName, "example");
  assert.deepEqual(manifest.interface.defaultPrompt, ["Use example"]);
  assert.equal("hooks" in manifest, false);
  assert.equal("agents" in manifest, false);
});

test("projects Claude agents as explicit files and leaves default hooks implicit", () => {
  const manifest = buildClaudeManifest(
    {
      name: "agent-compatibility",
      description: "Compatibility checks",
      version: "1.0.0",
      author: { name: "Cursor" },
    },
    process.cwd() + "/agent-compatibility",
  );

  assert.deepEqual(manifest.agents, [
    "./agents/compatibility-scan-review.md",
    "./agents/docs-reliability-review.md",
    "./agents/startup-review.md",
    "./agents/validation-review.md",
  ]);
  assert.equal("hooks" in manifest, false);
});

test("buildOmpManifest projects skills, droids, and hooks for OMP", () => {
  const manifest = buildOmpManifest(
    {
      name: "pstack",
      description: "test plugin",
      version: "0.11.3",
      author: { name: "Cursor" },
      category: "developer-tools",
    },
    process.cwd() + "/pstack",
  );

  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.droids, "./droids");
  assert.equal(manifest.category, "developer-tools");
  assert.equal("agents" in manifest, false);
});

test("buildOmpManifest omits hooks when no hooks.json exists", () => {
  const manifest = buildOmpManifest(
    { name: "teaching", version: "1.0.0", description: "teaching" },
    process.cwd() + "/teaching",
  );

  assert.equal("hooks" in manifest, false);
  assert.equal("droids" in manifest, false);
});
