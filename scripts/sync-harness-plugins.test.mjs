import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildCodexManifest,
  buildClaudeManifest,
  buildFactoryManifest,
  buildPortableHooks,
} from "./sync-harness-plugins.mjs";

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

test("maps the canonical agents directory to Factory droids", () => {
  const manifest = buildFactoryManifest(
    {
      name: "pstack",
      version: "0.11.2",
      description: "A shared plugin",
    },
    { description: "A shared plugin" },
    process.cwd() + "/pstack",
  );

  assert.equal(manifest.droids, "./droids");
});

test("keeps Codex manifests inside the local plugin contract", () => {
  const manifest = buildCodexManifest(
    {
      name: "pstack",
      version: "0.11.2",
      description: "An example plugin",
      author: { name: "Cursor" },
      homepage: "https://github.com/cursor/plugins",
      repository: "https://github.com/cursor/plugins",
      license: "MIT",
      keywords: ["example"],
    },
    process.cwd() + "/pstack",
  );

  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.apps, undefined);
  assert.equal(manifest.interface.displayName, "pstack");
  assert.deepEqual(manifest.interface.defaultPrompt, ["Use pstack"]);
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

test("projects the canonical portable hook file into Claude's manifest", () => {
  const manifest = buildClaudeManifest(
    {
      name: "continual-learning",
      description: "Compatibility checks",
      version: "1.0.0",
      author: { name: "Cursor" },
    },
    process.cwd() + "/continual-learning",
  );

  assert.equal(manifest.hooks, "./hooks/hooks.json");
});
