#!/usr/bin/env node

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadJSON(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

const marketplaceSchema = loadJSON(
  resolve(root, "schemas/marketplace.schema.json")
);
const pluginSchema = loadJSON(resolve(root, "schemas/plugin.schema.json"));
const ompMarketplaceSchema = loadJSON(
  resolve(root, "schemas/omp-marketplace.schema.json")
);

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const validateMarketplace = ajv.compile(marketplaceSchema);
const validatePlugin = ajv.compile(pluginSchema);
const validateOmpMarketplace = ajv.compile(ompMarketplaceSchema);

let errors = 0;

function fail(message) {
  console.error(`ERROR: ${message}`);
  errors++;
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
  for (const err of validateMarketplace.errors) {
    console.error(`  ${err.instancePath || "/"}: ${err.message}`);
  }
}

// 2. Validate each plugin
for (const entry of marketplace.plugins ?? []) {
  const pluginDir = resolve(root, entry.source);
  const pluginJsonPath = resolve(pluginDir, ".cursor-plugin/plugin.json");

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
    for (const err of validatePlugin.errors) {
      const detail =
        err.keyword === "additionalProperties"
          ? `${err.message}: "${err.params.additionalProperty}"`
          : err.message;
      console.error(`  ${err.instancePath || "/"}: ${detail}`);
    }
  }

  // Check that marketplace name matches plugin name
  if (pluginJson.name && pluginJson.name !== entry.name) {
    fail(
      `Plugin "${entry.name}": marketplace name does not match plugin.json name "${pluginJson.name}"`
    );
  }
}

// 3. Validate OMP marketplace
const ompMarketplacePath = resolve(root, ".omp-plugin/marketplace.json");
if (!existsSync(ompMarketplacePath)) {
  fail(".omp-plugin/marketplace.json not found");
} else {
  const ompMarketplace = loadJSON(ompMarketplacePath);
  if (!validateOmpMarketplace(ompMarketplace)) {
    fail("OMP marketplace.json schema validation failed:");
    for (const err of validateOmpMarketplace.errors) {
      console.error(`  ${err.instancePath || "/"}: ${err.message}`);
    }
  } else {
    const cursorEntries = new Map(
      marketplace.plugins.map((plugin) => [plugin.name, plugin])
    );
    for (const entry of ompMarketplace.plugins ?? []) {
      const cursorEntry = cursorEntries.get(entry.name);
      if (!cursorEntry) {
        fail(`OMP plugin "${entry.name}" has no matching Cursor marketplace entry`);
        continue;
      }
      const expectedSource = `./${cursorEntry.source.replace(/^\.\//, "")}`;
      if (entry.source !== expectedSource) {
        fail(
          `OMP plugin "${entry.name}": source must be canonical ${expectedSource}, found ${entry.source}`
        );
      }
      const projDir = resolve(root, entry.source);
      const projManifest = resolve(projDir, ".claude-plugin/plugin.json");
      if (!existsSync(projManifest)) {
        fail(`OMP plugin "${entry.name}": missing projection manifest at ${entry.source}/.claude-plugin/plugin.json`);
        continue;
      }
      const projJson = loadJSON(projManifest);
      if (projJson.name && projJson.name !== entry.name) {
        fail(`OMP plugin "${entry.name}": projection name mismatch "${projJson.name}"`);
      }
      if (entry.version && projJson.version && entry.version !== projJson.version) {
        fail(`OMP plugin "${entry.name}": version mismatch catalog=${entry.version} manifest=${projJson.version}`);
      }
    }
    if ((ompMarketplace.plugins ?? []).length !== (marketplace.plugins ?? []).length) {
      fail(
        `OMP marketplace has ${ompMarketplace.plugins?.length ?? 0} plugins, Cursor has ${marketplace.plugins?.length ?? 0}`
      );
    }
  }
}

for (const staleProjectionDirectory of ["codex-plugins", "omp-plugins"]) {
  if (existsSync(resolve(root, staleProjectionDirectory))) {
    fail(`${staleProjectionDirectory}/ must not exist; marketplace entries use canonical plugin directories`);
  }
}

// 4. Report results
if (errors > 0) {
  console.error(`\nValidation failed with ${errors} error(s).`);
  process.exit(1);
} else {
  console.log("All plugins validated successfully.");
  process.exit(0);
}
