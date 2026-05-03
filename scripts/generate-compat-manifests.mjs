#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJSON(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function pickMetadata(cursorManifest) {
  const metadata = {};
  for (const key of [
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "category",
    "tags",
  ]) {
    if (cursorManifest[key] !== undefined) {
      metadata[key] = cursorManifest[key];
    }
  }
  return metadata;
}

function addClaudeComponents(target, cursorManifest, pluginDir) {
  for (const key of ["skills", "commands", "mcpServers"]) {
    if (cursorManifest[key] !== undefined) {
      target[key] = cursorManifest[key];
    }
  }

  const agentPaths = getMarkdownFiles(resolve(pluginDir, "agents"));
  if (agentPaths.length > 0) {
    target.agents = agentPaths;
  }

  if (!existsSync(resolve(pluginDir, "hooks/hooks.json")) && cursorManifest.hooks !== undefined) {
    target.hooks = cursorManifest.hooks;
  }

  if (existsSync(resolve(pluginDir, ".mcp.json")) && target.mcpServers === undefined) {
    target.mcpServers = "./.mcp.json";
  }
}

function addFactoryComponents(target, cursorManifest, pluginDir) {
  for (const key of ["skills", "hooks", "commands"]) {
    if (cursorManifest[key] !== undefined) {
      target[key] = cursorManifest[key];
    }
  }

  if (cursorManifest.agents !== undefined) {
    target.droids = cursorManifest.agents;
  }

  if (cursorManifest.mcpServers !== undefined) {
    target.mcpServers = cursorManifest.mcpServers;
  } else if (existsSync(resolve(pluginDir, "mcp.json"))) {
    target.mcpServers = "./mcp.json";
  }
}

const CLAUDE_MARKETPLACE_REPO =
  process.env.CLAUDE_MARKETPLACE_REPO ?? "harshav167/cursor-plugins";

function withRelativeLocalSource(entry) {
  if (typeof entry.source !== "string") {
    return { ...entry };
  }

  if (
    entry.source.startsWith("./") ||
    entry.source.startsWith("/") ||
    entry.source.includes("://")
  ) {
    return { ...entry };
  }

  return {
    ...entry,
    source: `./${entry.source}`,
  };
}

function withClaudeGitSubdirSource(entry) {
  if (typeof entry.source !== "string") {
    return { ...entry };
  }

  return {
    ...entry,
    source: {
      source: "git-subdir",
      url: CLAUDE_MARKETPLACE_REPO,
      path: entry.source.replace(/^\.\//, ""),
      ref: "main",
    },
  };
}

function getMarkdownFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => `./agents/${entry.name}`)
    .sort();
}

const cursorMarketplace = loadJSON(resolve(root, ".cursor-plugin/marketplace.json"));

const claudeMarketplace = {
  name: cursorMarketplace.name,
  owner: cursorMarketplace.owner,
  metadata: {
    ...cursorMarketplace.metadata,
    compatibility: "Claude Code",
  },
  plugins: cursorMarketplace.plugins.map(withClaudeGitSubdirSource),
};

const factoryMarketplace = {
  name: cursorMarketplace.name,
  owner: cursorMarketplace.owner,
  metadata: {
    ...cursorMarketplace.metadata,
    compatibility: "Factory",
  },
  plugins: cursorMarketplace.plugins.map(withRelativeLocalSource),
};

writeJSON(resolve(root, ".claude-plugin/marketplace.json"), claudeMarketplace);
writeJSON(resolve(root, ".factory-plugin/marketplace.json"), factoryMarketplace);

for (const entry of cursorMarketplace.plugins) {
  const pluginDir = resolve(root, entry.source);
  const cursorManifestPath = resolve(pluginDir, ".cursor-plugin/plugin.json");
  const cursorManifest = loadJSON(cursorManifestPath);

  const claudeManifest = pickMetadata(cursorManifest);
  addClaudeComponents(claudeManifest, cursorManifest, pluginDir);
  writeJSON(resolve(pluginDir, ".claude-plugin/plugin.json"), claudeManifest);

  const factoryManifest = pickMetadata(cursorManifest);
  addFactoryComponents(factoryManifest, cursorManifest, pluginDir);
  writeJSON(resolve(pluginDir, ".factory-plugin/plugin.json"), factoryManifest);
}
