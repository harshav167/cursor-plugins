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
const OMP_MARKETPLACE = ".omp-plugin/marketplace.json";
const CODEX_MARKETPLACE = ".agents/plugins/marketplace.json";
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

function normalizeFactoryAgent(sourceMarkdown) {
  const match = sourceMarkdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return sourceMarkdown;
  const [, frontmatter, body] = match;
  const lines = frontmatter.split("\n");
  let hasReadonly = false;
  const kept = [];
  for (const line of lines) {
    const key = line.split(":")[0].trim();
    if (key === "readonly") {
      if (/:\s*true/.test(line)) hasReadonly = true;
      continue;
    }
    if (key === "is_background") continue;
    kept.push(line);
  }
  if (hasReadonly) kept.push("tools: read-only");
  const newFrontmatter = kept.length ? `---\n${kept.join("\n")}\n---\n` : "";
  return `${newFrontmatter}${body}`;
}

function buildOmpManifest(sourceManifest, pluginDirectory) {
  const manifest = commonManifestFields(sourceManifest, {});
  if (Array.isArray(sourceManifest.keywords)) manifest.keywords = sourceManifest.keywords;
  if (hasDirectory(resolve(pluginDirectory, "skills"))) manifest.skills = "./skills/";
  if (hasDirectory(resolve(pluginDirectory, "rules"))) manifest.rules = "./rules/";
  if (hasDirectory(resolve(pluginDirectory, "agents"))) manifest.droids = "./droids";
  const hooksDir = resolve(pluginDirectory, "hooks");
  if (hasDirectory(hooksDir) && existsSync(resolve(hooksDir, "hooks.json"))) {
    manifest.hooks = "./hooks/hooks.json";
  }
  if (existsSync(resolve(pluginDirectory, ".mcp.json"))) manifest.mcpServers = "./.mcp.json";
  if (sourceManifest.category) manifest.category = sourceManifest.category;
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
        : format === "omp"
          ? {
              owner,
              metadata: { description: "Cursor plugins for oh-my-pi" },
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
          : format === "omp"
            ? {
                source: `./${entry.source.replace(/^\.\//, "")}`,
                description: entry.description,
                version: entry.version,
                category: entry.category ?? "Developer Tools",
              }
            : { source: `./${entry.source}`, description: entry.description }),
    })),
  };
}

const OMP_PLUGIN_ROOT_TOKEN = "${OMP_PLUGIN_ROOT}";
const OMP_PROJECTION_ROOT = "omp-plugins";
const VALID_SKILL_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function normalizeSkillName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeOmpSkill(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return markdown;
  const [, frontmatter, body] = match;
  const lines = frontmatter.split("\n");
  let changed = false;
  const kept = [];
  for (const line of lines) {
    if (/^disable-model-invocation:\s*true\s*$/i.test(line)) {
      changed = true;
      continue;
    }
    const m = line.match(/^name:\s*(.+)$/);
    if (m) {
      const raw = m[1].trim().replace(/^["']|["']$/g, "");
      if (VALID_SKILL_NAME.test(raw)) {
        kept.push(line);
        continue;
      }
      const fixed = normalizeSkillName(raw);
      if (fixed && VALID_SKILL_NAME.test(fixed)) {
        changed = true;
        kept.push(`name: ${fixed}`);
        continue;
      }
    }
    kept.push(line);
  }
  if (!changed) return markdown;
  return `---\n${kept.join("\n")}\n---\n${body}`;
}

function addRecursiveOutputs(outputs, sourceDir, targetDir, skip = new Set(), transform) {
  if (!existsSync(sourceDir)) return;
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = resolve(sourceDir, entry.name);
    const relativePath = relativeToRoot(sourcePath);
    if (skip.has(relativePath)) continue;
    const targetPath = `${targetDir}/${entry.name}`;
    if (entry.isDirectory()) {
      addRecursiveOutputs(outputs, sourcePath, targetPath, skip, transform);
    } else if (entry.isFile()) {
      let content = readFileSync(sourcePath, "utf8");
      if (transform) content = transform(sourcePath, content);
      addOutput(outputs, targetPath, content);
    }
  }
}

function normalizeOmpHookCommand(command) {
  return normalizeHookCommand(command).replaceAll("${CLAUDE_PLUGIN_ROOT}", OMP_PLUGIN_ROOT_TOKEN);
}

function buildOmpPortableHooks(source) {
  const sourceHooks = source?.hooks && typeof source.hooks === "object" ? source.hooks : source;
  const hooks = {};
  for (const [eventName, entries] of Object.entries(sourceHooks ?? {})) {
    if (eventName === "version") continue;
    const normalizedEntries = (Array.isArray(entries) ? entries : [entries])
      .map((entry) => {
        if (typeof entry === "string") {
          return {
            matcher: "*",
            hooks: [{ type: "command", command: normalizeOmpHookCommand(entry) }],
          };
        }
        if (!entry || typeof entry !== "object") return null;
        if (Array.isArray(entry.hooks)) {
          return {
            ...entry,
            hooks: entry.hooks.map((hook) => ({
              ...hook,
              ...(typeof hook.command === "string"
                ? { command: normalizeOmpHookCommand(hook.command) }
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
                command: normalizeOmpHookCommand(entry.command),
              },
            ],
          };
        }
        return null;
      })
      .filter(Boolean);
    if (normalizedEntries.length === 0) continue;
    const targetEvent = portableHookEvent(eventName);
    hooks[targetEvent] = [...(hooks[targetEvent] ?? []), ...normalizedEntries];
  }
  return { hooks };
}

function buildPstackExtension() {
  return `import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const LOOP_STATE = ".omp/pstack/loop.json";
const SETUP_RULE = resolve(process.env.HOME ?? "~", ".omp/agent/rules/pstack-models.md");

interface LoopState {
  prompt: string;
  promise: string;
  iteration: number;
  maxIterations: number;
}

function loadLoopState(): LoopState | null {
  if (!existsSync(LOOP_STATE)) return null;
  try {
    return JSON.parse(readFileSync(LOOP_STATE, "utf8")) as LoopState;
  } catch {
    return null;
  }
}

function saveLoopState(state: LoopState): void {
  mkdirSync(resolve(LOOP_STATE, ".."), { recursive: true });
  writeFileSync(LOOP_STATE, JSON.stringify(state, null, 2) + "\\n", "utf8");
}

function clearLoopState(): void {
  if (existsSync(LOOP_STATE)) unlinkSync(LOOP_STATE);
}

export default function pstackExtension(pi: any) {
  pi.registerCommand("loop", {
    description: "Run a prompt in a loop until a completion promise is fulfilled or max iterations reached. Usage: /loop <max> <promise> <prompt>",
    handler: async (args: string) => {
      const parts = args.trim().split(/\\s+/);
      const maxIterations = parseInt(parts[0] ?? "0", 10) || 0;
      const promise = parts[1] ?? "";
      const prompt = parts.slice(2).join(" ");
      if (!prompt) {
        pi.sendMessage({ role: "user", content: [{ type: "text", text: "Usage: /loop <maxIterations> <completionPromise> <prompt>" }] });
        return;
      }
      saveLoopState({ prompt, promise, iteration: 0, maxIterations });
      pi.sendUserMessage(\`Loop started. Iteration 1.\\n\\n\${prompt}\`);
    },
  });

  pi.registerCommand("stop-loop", {
    description: "Stop the active pstack loop.",
    handler: async () => {
      clearLoopState();
      pi.sendMessage({ role: "user", content: [{ type: "text", text: "Loop stopped." }] });
    },
  });

  pi.registerCommand("setup-pstack", {
    description: "Configure which models pstack uses per role. Writes an always-applied OMP rule.",
    handler: async () => {
      const models = pi.getAllTools ? [] : [];
      const ruleDir = resolve(SETUP_RULE, "..");
      if (!existsSync(ruleDir)) mkdirSync(ruleDir, { recursive: true });
      const defaultRule = \`---
description: pstack per-role model choices (overrides skill defaults)
---
# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
feature, refactoring: grok-4.5-fast-xhigh
bug-fix: gpt-5.5-high-fast
perf-issue: gpt-5.5-high-fast
hillclimb: gpt-5.5-high-fast
judgment and prose: claude-opus-4-8-thinking-xhigh
hardest tasks: claude-fable-5-thinking-max
\`;
      writeFileSync(SETUP_RULE, defaultRule, "utf8");
      pi.sendMessage({ role: "user", content: [{ type: "text", text: \`Wrote \${SETUP_RULE}. Edit it to change model assignments per role.\` }] });
    },
  });

  pi.on("session_stop", async (event: any) => {
    if (event.stop_hook_active) return;
    const state = loadLoopState();
    if (!state) return;

    const lastMessage = event.last_assistant_message;
    const responseText = typeof lastMessage?.content === "string"
      ? lastMessage.content
      : Array.isArray(lastMessage?.content)
        ? lastMessage.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
        : "";

    if (state.promise && responseText.includes(\`<promise>\${state.promise}</promise>\`)) {
      clearLoopState();
      return { continue: false };
    }

    if (state.maxIterations > 0 && state.iteration + 1 >= state.maxIterations) {
      clearLoopState();
      return { continue: false };
    }

    state.iteration += 1;
    saveLoopState(state);

    const header = state.promise
      ? \`[pstack loop iteration \${state.iteration}. To complete: output <promise>\${state.promise}</promise> ONLY when genuinely true.]\`
      : \`[pstack loop iteration \${state.iteration}.]\`;

    return { continue: true, additionalContext: \`\${header}\\n\\n\${state.prompt}\` };
  });
}
`;
}

function planOmpProjection(outputs, pluginDirectory, cursorManifest, marketplaceEntry) {
  const targetBase = `${OMP_PROJECTION_ROOT}/${cursorManifest.name}`;
  const ompManifest = buildOmpManifest(cursorManifest, pluginDirectory);

  addJsonOutput(outputs, `${targetBase}/package.json`, {
    name: cursorManifest.name,
    version: cursorManifest.version ?? "1.0.0",
    description: cursorManifest.description ?? marketplaceEntry.description ?? "",
    private: true,
    type: "module",
    omp: cursorManifest.name === "pstack"
      ? { extensions: [`./extensions/${cursorManifest.name}.ts`] }
      : {},
  });

  const skipDirs = new Set([
    relativeToRoot(resolve(pluginDirectory, ".claude-plugin")),
    relativeToRoot(resolve(pluginDirectory, ".factory-plugin")),
    relativeToRoot(resolve(pluginDirectory, ".cursor-plugin")),
    relativeToRoot(resolve(pluginDirectory, ".codex-plugin")),
    relativeToRoot(resolve(pluginDirectory, "droids")),
  ]);

  const skillsDir = resolve(pluginDirectory, "skills");
  if (hasDirectory(skillsDir)) {
    addRecursiveOutputs(outputs, skillsDir, `${targetBase}/skills`, skipDirs, (sourcePath, content) => {
      if (sourcePath.endsWith("SKILL.md")) return normalizeOmpSkill(content);
      return content;
    });
  }

  const rulesDir = resolve(pluginDirectory, "rules");
  if (hasDirectory(rulesDir)) {
    addRecursiveOutputs(outputs, rulesDir, `${targetBase}/rules`, skipDirs);
  }

  const assetsDir = resolve(pluginDirectory, "assets");
  if (hasDirectory(assetsDir)) {
    addRecursiveOutputs(outputs, assetsDir, `${targetBase}/assets`, skipDirs);
  }

  for (const filename of ["README.md", "LICENSE", "CHANGELOG.md"]) {
    const filePath = resolve(pluginDirectory, filename);
    if (existsSync(filePath)) {
      addOutput(outputs, `${targetBase}/${filename}`, readFileSync(filePath, "utf8"));
    }
  }

  const agentsDir = resolve(pluginDirectory, "agents");
  if (hasDirectory(agentsDir)) {
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const source = readFileSync(resolve(agentsDir, entry.name), "utf8");
      addOutput(outputs, `${targetBase}/droids/${entry.name}`, normalizeFactoryAgent(source));
    }
  }

  const hooksDir = resolve(pluginDirectory, "hooks");
  const sourceHookPath = resolve(hooksDir, "hooks.json");
  const cursorHookPath = resolve(hooksDir, "cursor-hooks.json");
  if (existsSync(sourceHookPath)) {
    const hookSource = existsSync(cursorHookPath)
      ? loadJson(cursorHookPath)
      : loadJson(sourceHookPath);
    addJsonOutput(outputs, `${targetBase}/hooks/hooks.json`, buildOmpPortableHooks(hookSource));
    for (const entry of readdirSync(hooksDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (entry.name === "hooks.json" || entry.name === "cursor-hooks.json") continue;
      addOutput(
        outputs,
        `${targetBase}/hooks/${entry.name}`,
        readFileSync(resolve(hooksDir, entry.name), "utf8"),
      );
    }
  }

  const mcpPath = resolve(pluginDirectory, ".mcp.json");
  if (existsSync(mcpPath)) {
    addOutput(outputs, `${targetBase}/.mcp.json`, readFileSync(mcpPath, "utf8"));
  }

  const skillsProjectionDir = resolve(pluginDirectory, "skills");
  if (hasDirectory(skillsProjectionDir)) {
    for (const skillDir of readdirSync(skillsProjectionDir, { withFileTypes: true })) {
      if (!skillDir.isDirectory()) continue;
      const skillMd = resolve(skillsProjectionDir, skillDir.name, "SKILL.md");
      if (!existsSync(skillMd)) continue;
      const raw = readFileSync(skillMd, "utf8");
      if (!/^disable-model-invocation:\s*true$/m.test(raw)) continue;
      const nameMatch = raw.match(/^name:\s*(.+)$/m);
      const skillName = nameMatch ? normalizeSkillName(nameMatch[1].trim()) : skillDir.name;
      const descMatch = raw.match(/^description:\s*(.+)$/m);
      const description = descMatch ? descMatch[1].trim() : `Invoke the ${skillName} skill`;
      addOutput(
        outputs,
        `${targetBase}/commands/${skillName}.md`,
        `---\ndescription: ${description}\n---\nApply the \`${skillName}\` skill now. Read its SKILL.md in full before doing any work.\n`,
      );
    }
  }

  const hasExtension = cursorManifest.name === "pstack";

  if (hasExtension) {
    addOutput(outputs, `${targetBase}/extensions/${cursorManifest.name}.ts`, buildPstackExtension());
  }

  return {
    name: cursorManifest.name,
    ompSource: `${OMP_PROJECTION_ROOT}/${cursorManifest.name}`,
    description: marketplaceEntry.description ?? "",
    version: cursorManifest.version ?? "1.0.0",
    category: cursorManifest.category ?? "Developer Tools",
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
    addJsonOutput(
     outputs,
      `${marketplaceEntry.source}/.codex-plugin/plugin.json`,
      buildCodexManifest(cursorManifest, pluginDirectory),
   );

    const agentsDirectory = resolve(pluginDirectory, "agents");
    if (hasDirectory(agentsDirectory)) {
      for (const agentEntry of readdirSync(agentsDirectory, { withFileTypes: true })) {
        if (!agentEntry.isFile() || !agentEntry.name.endsWith(".md")) continue;
        const agentSource = readFileSync(resolve(agentsDirectory, agentEntry.name), "utf8");
        addOutput(
          outputs,
          `${marketplaceEntry.source}/droids/${agentEntry.name}`,
          normalizeFactoryAgent(agentSource),
        );
      }
    }

    const mcpPath = resolve(pluginDirectory, ".mcp.json");
    const factoryMcpPath = resolve(pluginDirectory, "mcp.json");
    if (existsSync(mcpPath) && !existsSync(factoryMcpPath)) {
      addOutput(outputs, `${marketplaceEntry.source}/mcp.json`, readFileSync(mcpPath, "utf8"));
    }

    entries.push({ ...marketplaceEntry, name: cursorManifest.name });
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
    OMP_MARKETPLACE,
    buildMarketplace("cursor-plugins", { name: "Cursor", email: "plugins@cursor.com" }, entries, "omp"),
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
  buildMarketplace,
  buildCodexManifest,
  buildClaudeManifest,
  buildFactoryManifest,
  buildOmpManifest,
  buildPortableHooks,
  normalizeFactoryAgent,
};
