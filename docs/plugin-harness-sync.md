# Plugin harness synchronization

This fork treats the Cursor plugin manifests under .cursor-plugin/ as the source of truth. The
scripts/sync-harness-plugins.mjs generator projects every marketplace entry into the native
Claude Code, Factory Droid, Oh My Pi, and Codex plugin contracts.

## Generated surfaces

- Claude Code: .claude-plugin/plugin.json and .claude-plugin/marketplace.json
- Factory Droid: .factory-plugin/plugin.json, .factory-plugin/marketplace.json, and droids/
- Oh My Pi: .omp-plugin/marketplace.json
- Codex: <name>/.codex-plugin/plugin.json and .agents/plugins/marketplace.json

Skills, agents, hooks, and supporting files remain in the canonical plugin directory. Factory's
`droids/` path is a symlink to that same plugin's `agents/` directory. Cursor hook definitions are
preserved as `hooks/cursor-hooks.json` and their events and commands are projected into the portable
Claude/Factory `hooks/hooks.json` form. No harness receives a copied skills or agents tree.
Cursor-only rules/ are intentionally not advertised to the other harnesses because their plugin
contracts do not define a compatible rules component.

Codex manifests are limited to the local plugin ingestion contract: skills, apps, MCP servers, and
the required interface metadata. The Codex manifest lives beside the canonical content and points
at that same `skills/` directory. Codex's current plugin contract does not expose Claude/Factory
agent or lifecycle-hook declarations in `.codex-plugin/plugin.json`; those files remain available
in the canonical tree for the harnesses that support them.

## Local commands

    node scripts/sync-harness-plugins.mjs
    node scripts/sync-harness-plugins.mjs --check
    node --test scripts/sync-harness-plugins.test.mjs

The check mode is used by CI and fails when a canonical Cursor change has not been projected into
the four harness surfaces.

## Documentation used

- Claude Code plugin creation: https://code.claude.com/docs/en/plugins
- Claude Code plugin reference: https://code.claude.com/docs/en/plugins-reference
- Claude Code plugin marketplaces: https://code.claude.com/docs/en/plugin-marketplaces
- Factory plugin building guide: https://docs.factory.ai/guides/building/building-plugins
- Factory plugin configuration: https://docs.factory.ai/cli/configuration/plugins
- Codex plugins: https://help.openai.com/en/articles/20001256-plugins-in-codex/
- Local Codex manifest validator: the plugin-creator skill's scripts/validate_plugin.py
