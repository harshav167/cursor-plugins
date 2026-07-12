#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, "..");
const checkOnly = process.argv.includes("--check");

const CURSOR_MARKETPLACE = ".cursor-plugin/marketplace.json";
const CLAUDE_MARKETPLACE = ".claude-plugin/marketplace.json";
const FACTORY_MARKETPLACE = ".factory-plugin/marketplace.json";
const CODEX_MARKETPLACE = ".agents/plugins/marketplace.json";
const CODEX_OUTPUT_ROOT = "codex-plugins";
const CLAUDE_MARKETPLACE_REPO =
  process.env.CLAUDE_MARKETPLACE_REPO ?? "harshav167/cursor-plugins";

const NATIVE_HOOK_EVENTS = new Set([
  "ConfigChange",
  "InstructionsLoaded",
  "MessageDisplay",
  "Notification",
  "PermissionDenied",
  "PermissionRequest",
  "PostCompact",
  "PostToolBatch",
  "PostToolUse",
  "PostToolUseFailure",
  "PreCompact",
  "PreToolUse",
  "SessionEnd",
  "SessionStart",
  "Setup",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "TaskCompleted",
  "TaskCreated",
  "TeammateIdle",
  "UserPromptExpansion",
  "UserPromptSubmit",
]);

const HOOK_EVENT_MAP = {
  afterAgentResponse: "Stop",
  afterToolCall: "PostToolUse",
  beforePromptSubmit: "UserPromptSubmit",
  beforeToolCall: "PreToolUse",
  sessionEnd: "SessionEnd",
  sessionStart: "SessionStart",
  stop: "Stop",
};

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function prettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function addOutput(outputs, path, contents) {
  outputs.set(resolve(root, path), contents);
}

function addSymlinkOutput(outputs, path, target) {
  outputs.set(resolve(root, path), { kind: "symlink", target });
}

function addJsonOutput(outputs, path, value) {
  addOutput(outputs, path, prettyJson(value));
}

function hasDirectory(path) {
  return existsSync(path);
}

function copyFilesRecursively(sourceDirectory, destinationDirectory, transform, outputs) {
  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = resolve(sourceDirectory, entry.name);
    const destinationPath = resolve(destinationDirectory, entry.name);
    if (entry.isDirectory()) {
      copyFilesRecursively(sourcePath, destinationPath, transform, outputs);
      continue;
    }
    const sourceContents = readFileSync(sourcePath, "utf8");
    const contents = transform ? transform(sourceContents, sourcePath) : sourceContents;
    outputs.set(destinationPath, contents);
  }
}

function normalizeFactoryAgent(contents) {
  if (!contents.startsWith("---\n")) return contents;
  const end = contents.indexOf("\n---", 4);
  if (end === -1) return contents;

  const frontmatter = contents
    .slice(4, end)
    .split("\n")
    .filter((line) => !/^readonly:\s*true\s*$/.test(line))
    .filter((line) => !/^is_background:\s*true\s*$/.test(line));
  if (!frontmatter.some((line) => /^tools:/.test(line)) && contents.includes("readonly: true")) {
    frontmatter.push("tools: read-only");
  }
  return `---\n${frontmatter.join("\n")}\n---${contents.slice(end + 4)}`;
}

function normalizeCodexSkill(contents, sourcePath) {
  if (!sourcePath.endsWith("/SKILL.md") || !contents.startsWith("---\n")) return contents;
  const end = contents.indexOf("\n---", 4);
  if (end === -1) return contents;
  const frontmatter = contents
    .slice(4, end)
    .split("\n")
    .filter((line) => !/^disable-model-invocation:\s*true\s*$/.test(line))
    .filter((line) => !/^disable_model_invocation:\s*true\s*$/.test(line))
    .map((line) => {
      if (!line.startsWith("description:")) return line;
      const value = line.slice("description:".length).trim();
      if (value.startsWith(">") || value.startsWith("|")) return line;
      const unquoted = value.replace(/^("|')|("|')$/g, "");
      return "description: " + JSON.stringify(unquoted);
    });
  return "---\n" + frontmatter.join("\n") + "\n---" + contents.slice(end + 4);
}

function normalizeHookCommand(command) {
  const rootToken = "${CLAUDE_PLUGIN_ROOT}";
  const replaced = command.replaceAll("${CURSOR_PLUGIN_ROOT}", rootToken);
  if (replaced.startsWith("bun run ${CLAUDE_PLUGIN_ROOT}/")) {
    return `bun run "${replaced.slice("bun run ".length)}"`;
  }
  if (replaced.startsWith("./hooks/")) {
    return `"${rootToken}/${replaced.slice(2)}"`;
  }
  if (replaced.startsWith("hooks/")) {
    return `"${rootToken}/${replaced}"`;
  }
  return replaced;
}

function portableHookEvent(eventName) {
  if (NATIVE_HOOK_EVENTS.has(eventName)) return eventName;
  return HOOK_EVENT_MAP[eventName] ?? eventName;
}

function portableHookEntry(entry) {
  if (typeof entry === "string") {
    return {
      matcher: "*",
      hooks: [{ type: "command", command: normalizeHookCommand(entry) }],
    };
  }
  if (!entry || typeof entry !== "object") return null;

  if (Array.isArray(entry.hooks)) {
    return {
      ...entry,
      hooks: entry.hooks.map((hook) => ({
        ...hook,
        ...(typeof hook.command === "string"
          ? { command: normalizeHookCommand(hook.command) }
          : {}),
      })),
    };
  }
  if (typeof entry.command === "string") {
    return {
      matcher: entry.matcher ?? "*",
      hooks: [
        {
          type: entry.type ?? "command",
          command: normalizeHookCommand(entry.command),
        },
      ],
    };
  }
  return null;
}

function buildPortableHooks(source) {
  const sourceHooks = source?.hooks && typeof source.hooks === "object" ? source.hooks : source;
  const hooks = {};
  for (const [eventName, entries] of Object.entries(sourceHooks ?? {})) {
    if (eventName === "version") continue;
    const normalizedEntries = (Array.isArray(entries) ? entries : [entries])
      .map(portableHookEntry)
      .filter(Boolean);
    if (normalizedEntries.length === 0) continue;
    const targetEvent = portableHookEvent(eventName);
    hooks[targetEvent] = [...(hooks[targetEvent] ?? []), ...normalizedEntries];
  }
  return { hooks };
}

function planHookOutputs(pluginDirectory, cursorManifest, outputs) {
  const hooksDirectory = resolve(pluginDirectory, "hooks");
  const sourceHookPath = resolve(hooksDirectory, "hooks.json");
  if (!existsSync(sourceHookPath)) return;

  const preservedHookPath = resolve(hooksDirectory, "cursor-hooks.json");
  const currentSource = loadJson(sourceHookPath);
  let preservedSource = existsSync(preservedHookPath) ? loadJson(preservedHookPath) : currentSource;
  let portableHooks = buildPortableHooks(preservedSource);
  const currentFile = loadJson(sourceHookPath);

  if (existsSync(preservedHookPath) && !sameJson(currentFile, portableHooks)) {
    preservedSource = currentFile;
    portableHooks = buildPortableHooks(preservedSource);
  }

  addJsonOutput(outputs, relativeToRoot(preservedHookPath), preservedSource);
  addJsonOutput(outputs, relativeToRoot(sourceHookPath), portableHooks);

  if (cursorManifest.hooks) {
    cursorManifest.hooks = "./hooks/cursor-hooks.json";
  }
}

function relativeToRoot(path) {
  return path.slice(root.length + 1);
}

function commonManifestFields(sourceManifest, marketplaceEntry) {
  const fields = {
    name: sourceManifest.name,
    description: sourceManifest.description ?? marketplaceEntry.description ?? "",
    version: sourceManifest.version ?? "1.0.0",
  };
  for (const key of ["author", "homepage", "repository", "license"]) {
    if (sourceManifest[key] !== undefined) fields[key] = sourceManifest[key];
  }
  return fields;
}

function buildClaudeManifest(sourceManifest, pluginDirectory) {
  const manifest = commonManifestFields(sourceManifest, {});
  for (const [key, relativePath] of [
   ["skills", "./skills/"],
   ["commands", "./commands/"],
   ["mcpServers", "./.mcp.json"],
 ]) {
    const pathValue = Array.isArray(relativePath) ? relativePath[0] : relativePath;
    const path = resolve(pluginDirectory, pathValue.slice(2).replace("/**/*.md", ""));
    if (key === "mcpServers" ? existsSync(path) : hasDirectory(path)) {
      manifest[key] = relativePath;
    }
  }
  const agentsDirectory = resolve(pluginDirectory, "agents");
  if (hasDirectory(agentsDirectory)) {
    const agentPaths = readdirSync(agentsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => `./agents/${entry.name}`);
    if (agentPaths.length > 0) manifest.agents = agentPaths;
  }
  if (Array.isArray(sourceManifest.keywords)) manifest.keywords = sourceManifest.keywords;
  return manifest;
}

function buildFactoryManifest(sourceManifest, marketplaceEntry, pluginDirectory) {
  const manifest = commonManifestFields(sourceManifest, marketplaceEntry);
  if (hasDirectory(resolve(pluginDirectory, "agents"))) {
    manifest.droids = "./droids";
  }
  return manifest;
}

function buildCodexManifest(sourceManifest, pluginDirectory) {
  const manifest = commonManifestFields(sourceManifest, {});
  if (Array.isArray(sourceManifest.keywords)) manifest.keywords = sourceManifest.keywords;
  if (hasDirectory(resolve(pluginDirectory, "skills"))) manifest.skills = "./skills/";
  if (existsSync(resolve(pluginDirectory, ".mcp.json"))) manifest.mcpServers = "./.mcp.json";

  const displayName = sourceManifest.displayName ?? sourceManifest.name;
  const asset = existsSync(resolve(pluginDirectory, "assets/avatar.png"))
    ? "./assets/avatar.png"
    : existsSync(resolve(pluginDirectory, "assets/logo.png"))
      ? "./assets/logo.png"
      : undefined;
  const interfaceMetadata = {
    displayName,
    shortDescription: truncate(manifest.description, 128),
    longDescription: manifest.description,
    developerName: sourceManifest.author?.name ?? "Cursor",
    category: sourceManifest.category ?? "Developer Tools",
    capabilities: ["Read", ...(sourceManifest.hooks || sourceManifest.agents ? ["Write"] : [])],
    websiteURL: sourceManifest.homepage ?? "https://github.com/cursor/plugins",
    privacyPolicyURL: "https://github.com/cursor/plugins#readme",
    termsOfServiceURL: "https://github.com/cursor/plugins/blob/main/LICENSE",
    defaultPrompt: [`Use ${truncate(displayName, 110)}`],
    brandColor: "#2563EB",
    screenshots: [],
  };
  if (asset) {
    interfaceMetadata.composerIcon = asset;
    interfaceMetadata.logo = asset;
  }
  manifest.interface = interfaceMetadata;
  return manifest;
}

function buildMarketplace(name, owner, entries, format) {
  return {
    name,
    ...(format === "claude"
      ? { owner, metadata: { description: "Cursor plugins for Claude Code" } }
      : format === "factory"
        ? {
            owner,
            metadata: { description: "Cursor plugins for Factory Droid" },
          }
        : { interface: { displayName: "Cursor Plugins for Codex" } }),
    plugins: entries.map((entry) => ({
      name: entry.name,
      ...(format === "codex"
        ? {
            source: { source: "local", path: `./${entry.codexSource}` },
            policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
            category: entry.category ?? "Developer Tools",
          }
        : format === "claude"
          ? {
              source: {
                source: "git-subdir",
                url: CLAUDE_MARKETPLACE_REPO,
                path: entry.source.replace(/^\.\//, ""),
                ref: "main",
              },
            }
          : { source: `./${entry.source}` }),
    })),
  };
}

function planOutputs() {
  const outputs = new Map();
  const cursorMarketplace = loadJson(resolve(root, CURSOR_MARKETPLACE));
  const entries = [];

  for (const marketplaceEntry of cursorMarketplace.plugins ?? []) {
    if (typeof marketplaceEntry.source !== "string") {
      throw new Error(`Plugin ${marketplaceEntry.name} has a non-local source`);
    }
    const pluginDirectory = resolve(root, marketplaceEntry.source);
    const cursorManifestPath = resolve(pluginDirectory, ".cursor-plugin/plugin.json");
    const cursorManifest = loadJson(cursorManifestPath);
    planHookOutputs(pluginDirectory, cursorManifest, outputs);

    if (cursorManifest.hooks) {
      addJsonOutput(outputs, relativeToRoot(cursorManifestPath), cursorManifest);
    }

    addJsonOutput(
      outputs,
      `${marketplaceEntry.source}/.claude-plugin/plugin.json`,
      buildClaudeManifest(cursorManifest, pluginDirectory),
    );
   addJsonOutput(
     outputs,
     `${marketplaceEntry.source}/.factory-plugin/plugin.json`,
     buildFactoryManifest(cursorManifest, marketplaceEntry, pluginDirectory),
   );
    const codexSource = `codex-plugins/${cursorManifest.name}`;
    const codexDirectory = resolve(root, codexSource);
    addJsonOutput(
     outputs,
     `${codexSource}/.codex-plugin/plugin.json`,
      buildCodexManifest(cursorManifest, pluginDirectory),
   );
    if (hasDirectory(resolve(pluginDirectory, "skills"))) {
      copyFilesRecursively(
        resolve(pluginDirectory, "skills"),
        resolve(codexDirectory, "skills"),
        normalizeCodexSkill,
        outputs,
      );
    }
    if (hasDirectory(resolve(pluginDirectory, "assets"))) {
      copyFilesRecursively(
        resolve(pluginDirectory, "assets"),
        resolve(codexDirectory, "assets"),
        null,
        outputs,
      );
    }
    for (const fileName of [".app.json", ".mcp.json", "CHANGELOG.md", "LICENSE", "README.md"]) {
      const sourcePath = resolve(pluginDirectory, fileName);
      if (existsSync(sourcePath)) {
        addOutput(outputs, `${codexSource}/${fileName}`, readFileSync(sourcePath, "utf8"));
      }
    }

    const agentsDirectory = resolve(pluginDirectory, "agents");
    if (hasDirectory(agentsDirectory)) {
      addSymlinkOutput(outputs, `${marketplaceEntry.source}/droids`, "agents");
    }

    const mcpPath = resolve(pluginDirectory, ".mcp.json");
    const factoryMcpPath = resolve(pluginDirectory, "mcp.json");
    if (existsSync(mcpPath) && !existsSync(factoryMcpPath)) {
      addOutput(outputs, `${marketplaceEntry.source}/mcp.json`, readFileSync(mcpPath, "utf8"));
    }

    entries.push({ ...marketplaceEntry, name: cursorManifest.name, codexSource });
  }

  addJsonOutput(
    outputs,
    CLAUDE_MARKETPLACE,
    buildMarketplace("cursor-plugins", { name: "Cursor", email: "plugins@cursor.com" }, entries, "claude"),
  );
  addJsonOutput(
    outputs,
    FACTORY_MARKETPLACE,
    buildMarketplace("cursor-plugins", { name: "Cursor", email: "plugins@cursor.com" }, entries, "factory"),
  );
  addJsonOutput(
    outputs,
    CODEX_MARKETPLACE,
    buildMarketplace("cursor-plugins", { name: "Cursor" }, entries, "codex"),
  );

  return outputs;
}

function applyOutputs(outputs) {
  let changed = 0;
  for (const [path, contents] of outputs) {
    if (contents?.kind === "symlink") {
      let matching = false;
      try {
        matching = lstatSync(path).isSymbolicLink() && readlinkSync(path) === contents.target;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (matching) continue;
      changed += 1;
      if (!checkOnly) {
        try {
          lstatSync(path);
          throw new Error(`Cannot replace existing non-matching droids path: ${path}`);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        mkdirSync(dirname(path), { recursive: true });
        symlinkSync(contents.target, path);
      }
      continue;
    }
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current === contents) continue;
    changed += 1;
    if (!checkOnly) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents, "utf8");
    }
  }
  return changed;
}

function run() {
  const outputs = planOutputs();
  const changed = applyOutputs(outputs);

  if (checkOnly && changed > 0) {
    console.error(`Harness sync is stale: ${changed} generated file(s) differ.`);
    process.exitCode = 1;
    return;
  }

  console.log(`${checkOnly ? "Checked" : "Synchronized"} ${outputs.size} generated harness files${changed ? ` (${changed} changed)` : ""}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  run();
}

export {
  buildCodexManifest,
  buildClaudeManifest,
  buildFactoryManifest,
  buildPortableHooks,
  normalizeFactoryAgent,
};
