#!/usr/bin/env node

import { lstatSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Ajv from "ajv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

const marketplaceSchema = loadJSON(
  resolve(root, "schemas/marketplace.schema.json")
);
const pluginSchema = loadJSON(resolve(root, "schemas/plugin.schema.json"));

const ajv = new Ajv({ allErrors: true, validateFormats: false });

const validateMarketplace = ajv.compile(marketplaceSchema);
const validatePlugin = ajv.compile(pluginSchema);

let errors = 0;

function fail(message) {
  console.error(`ERROR: ${message}`);
  errors++;
}

function schemaErrors(validator) {
  for (const err of validator.errors) {
    const detail =
      err.keyword === "additionalProperties"
        ? `${err.message}: "${err.params.additionalProperty}"`
        : err.message;
    console.error(`  ${err.instancePath || "/"}: ${detail}`);
  }
}

function ensurePath(pluginName, pluginDir, component, relativePath) {
  if (typeof relativePath !== "string" || !relativePath.startsWith("./")) {
    fail(
      `Plugin "${pluginName}": ${component} path must be relative and start with "./"`
    );
    return;
  }

  const componentPath = resolve(pluginDir, relativePath);
  if (!existsSync(componentPath)) {
    fail(
      `Plugin "${pluginName}": ${component} path "${relativePath}" does not exist`
    );
  }
}

function ensureComponentPaths(pluginName, pluginDir, manifest, mappings) {
  for (const [component, manifestKey] of mappings) {
    const value = manifest[manifestKey];
    if (value === undefined || typeof value === "object") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        ensurePath(pluginName, pluginDir, component, item);
      }
    } else {
      ensurePath(pluginName, pluginDir, component, value);
    }
  }
}

// 1. Validate marketplace.json
const marketplacePath = resolve(root, ".cursor-plugin/marketplace.json");

if (!existsSync(marketplacePath)) {
  fail(".cursor-plugin/marketplace.json not found");
  process.exit(1);
}

const marketplace = loadJSON(marketplacePath);

if (!validateMarketplace(marketplace)) {
  fail("marketplace.json schema validation failed:");
  schemaErrors(validateMarketplace);
}

const claudeMarketplacePath = resolve(root, ".claude-plugin/marketplace.json");
const factoryMarketplacePath = resolve(root, ".factory-plugin/marketplace.json");

if (!existsSync(claudeMarketplacePath)) {
  fail(".claude-plugin/marketplace.json not found");
}

if (!existsSync(factoryMarketplacePath)) {
  fail(".factory-plugin/marketplace.json not found");
}

const claudeMarketplace = existsSync(claudeMarketplacePath)
  ? loadJSON(claudeMarketplacePath)
  : { plugins: [] };
const factoryMarketplace = existsSync(factoryMarketplacePath)
  ? loadJSON(factoryMarketplacePath)
  : { plugins: [] };

if (existsSync(claudeMarketplacePath) && !validateMarketplace(claudeMarketplace)) {
  fail("Claude marketplace schema validation failed:");
  schemaErrors(validateMarketplace);
}

if (existsSync(factoryMarketplacePath) && !validateMarketplace(factoryMarketplace)) {
  fail("Factory marketplace schema validation failed:");
  schemaErrors(validateMarketplace);
}

const claudeEntries = new Map(
  (claudeMarketplace.plugins ?? []).map((entry) => [entry.name, entry])
);
const factoryEntries = new Map(
  (factoryMarketplace.plugins ?? []).map((entry) => [entry.name, entry])
);

// 2. Validate each plugin
for (const entry of marketplace.plugins ?? []) {
  const pluginDir = resolve(root, entry.source);
  const pluginJsonPath = resolve(pluginDir, ".cursor-plugin/plugin.json");
  const claudePluginJsonPath = resolve(pluginDir, ".claude-plugin/plugin.json");
  const factoryPluginJsonPath = resolve(pluginDir, ".factory-plugin/plugin.json");

  // Check source directory exists
  if (!existsSync(pluginDir)) {
    fail(
      `Plugin "${entry.name}": source directory "${entry.source}" does not exist`
    );
    continue;
  }

  // Check plugin.json exists
  if (!existsSync(pluginJsonPath)) {
    fail(
      `Plugin "${entry.name}": missing .cursor-plugin/plugin.json in "${entry.source}"`
    );
    continue;
  }

  const pluginJson = loadJSON(pluginJsonPath);

  if (!validatePlugin(pluginJson)) {
    fail(
      `Plugin "${entry.name}": plugin.json schema validation failed (${entry.source}/.cursor-plugin/plugin.json):`
    );
    schemaErrors(validatePlugin);
  }

  // Check that marketplace name matches plugin name
  if (pluginJson.name && pluginJson.name !== entry.name) {
    fail(
      `Plugin "${entry.name}": marketplace name does not match plugin.json name "${pluginJson.name}"`
    );
  }

  if (claudeEntries.get(entry.name)?.source !== entry.source) {
    fail(`Plugin "${entry.name}": Claude marketplace entry is missing or mismatched`);
  }

  if (factoryEntries.get(entry.name)?.source !== entry.source) {
    fail(`Plugin "${entry.name}": Factory marketplace entry is missing or mismatched`);
  }

  if (!existsSync(claudePluginJsonPath)) {
    fail(
      `Plugin "${entry.name}": missing .claude-plugin/plugin.json in "${entry.source}"`
    );
  } else {
    const claudePluginJson = loadJSON(claudePluginJsonPath);
    if (!validatePlugin(claudePluginJson)) {
      fail(
        `Plugin "${entry.name}": Claude plugin.json schema validation failed (${entry.source}/.claude-plugin/plugin.json):`
      );
      schemaErrors(validatePlugin);
    }
    if (claudePluginJson.name !== entry.name) {
      fail(
        `Plugin "${entry.name}": Claude plugin.json name does not match "${entry.name}"`
      );
    }
    ensureComponentPaths(entry.name, pluginDir, claudePluginJson, [
      ["skills", "skills"],
      ["agents", "agents"],
      ["hooks", "hooks"],
      ["commands", "commands"],
      ["mcpServers", "mcpServers"],
    ]);
  }

  if (!existsSync(factoryPluginJsonPath)) {
    fail(
      `Plugin "${entry.name}": missing .factory-plugin/plugin.json in "${entry.source}"`
    );
  } else {
    const factoryPluginJson = loadJSON(factoryPluginJsonPath);
    if (!validatePlugin(factoryPluginJson)) {
      fail(
        `Plugin "${entry.name}": Factory plugin.json schema validation failed (${entry.source}/.factory-plugin/plugin.json):`
      );
      schemaErrors(validatePlugin);
    }
    if (factoryPluginJson.name !== entry.name) {
      fail(
        `Plugin "${entry.name}": Factory plugin.json name does not match "${entry.name}"`
      );
    }
    ensureComponentPaths(entry.name, pluginDir, factoryPluginJson, [
      ["skills", "skills"],
      ["droids", "droids"],
      ["hooks", "hooks"],
      ["commands", "commands"],
      ["mcpServers", "mcpServers"],
    ]);
  }

  const droidsPath = resolve(pluginDir, "droids");
  if (existsSync(droidsPath) && !lstatSync(droidsPath).isSymbolicLink()) {
    fail(`Plugin "${entry.name}": droids must map to existing agents via symlink`);
  }
}

// 3. Report results
if (errors > 0) {
  console.error(`\nValidation failed with ${errors} error(s).`);
  process.exit(1);
} else {
  console.log("All plugins validated successfully.");
  process.exit(0);
}
