# Cursor plugins

Official Cursor plugins for popular developer tools, frameworks, and SaaS products. Each plugin is a standalone directory at the repository root with its own `.cursor-plugin/plugin.json` manifest.

The repository also publishes compatibility manifests for Claude Code and Factory/Droid. Those manifests point at the same component directories used by Cursor, so skills, hooks, agents, commands, and MCP configuration are mapped rather than copied.

## Plugins

| `name` | Plugin | Author | Category | `description` (from marketplace) |
|:-------|:-------|:-------|:---------|:-------------------------------------|
| `continual-learning` | [Continual Learning](continual-learning/) | Cursor | Developer Tools | Incremental transcript-driven memory updates for AGENTS.md using high-signal bullet points only. |
| `cursor-team-kit` | [Cursor Team Kit](cursor-team-kit/) | Cursor | Developer Tools | Internal team workflows used by Cursor developers for CI, code review, shipping, local automation, and verification. |
| `create-plugin` | [Create Plugin](create-plugin/) | Cursor | Developer Tools | Scaffold and validate new Cursor plugins. |
| `agent-compatibility` | [Agent Compatibility](agent-compatibility/) | Cursor | Developer Tools | CLI-backed repo compatibility scans plus Cursor agents that audit startup, validation, and docs against reality. |
| `cli-for-agent` | [CLI for Agents](cli-for-agent/) | Cursor | Developer Tools | Patterns for designing CLIs that coding agents can run reliably: flags, help with examples, pipelines, errors, idempotency, dry-run. |
| `pr-review-canvas` | [PR Review Canvas](pr-review-canvas/) | Cursor | Developer Tools | Render PR diffs as interactive Cursor Canvases organized for reviewer comprehension — groups changes by importance, separates boilerplate from core logic, and highlights tricky or unexpected code. |
| `docs-canvas` | [Docs Canvas](docs-canvas/) | Cursor | Developer Tools | Render documentation — architecture notes, API references, runbooks, and codebase walkthroughs — as a navigable Cursor Canvas with sections, table of contents, diagrams, and cross-references. |
| `cursor-sdk` | [Cursor SDK](cursor-sdk/) | Cursor | Developer Tools | Build apps, scripts, CI pipelines, and automations on top of the Cursor TypeScript SDK (@cursor/sdk) — runtime selection, auth, streaming, MCP, error handling, and ready-to-extend integration patterns. |

Author values match each plugin’s `plugin.json` `author.name` (Cursor lists `plugins@cursor.com` in the manifest).

## Repository structure

This is a multi-plugin marketplace repository. The root `.cursor-plugin/marketplace.json` lists all plugins, and each plugin has its own manifest:

```
plugins/
├── .cursor-plugin/
│   └── marketplace.json       # Marketplace manifest (lists all plugins)
├── .claude-plugin/
│   └── marketplace.json       # Claude Code-compatible marketplace manifest
├── .factory-plugin/
│   └── marketplace.json       # Factory-compatible marketplace manifest
├── plugin-name/
│   ├── .cursor-plugin/
│   │   └── plugin.json        # Per-plugin manifest
│   ├── .claude-plugin/
│   │   └── plugin.json        # Claude Code-compatible manifest
│   ├── .factory-plugin/
│   │   └── plugin.json        # Factory-compatible manifest
│   ├── skills/                # Agent skills (SKILL.md with frontmatter)
│   ├── agents/                # Cursor and Claude subagent definitions
│   ├── droids -> agents       # Factory Droid mapping, when agents exist
│   ├── rules/                 # Cursor rules (.mdc files)
│   ├── hooks/                 # Hook definitions, when present
│   ├── mcp.json               # MCP server definitions, when present
│   ├── README.md
│   ├── CHANGELOG.md
│   └── LICENSE
└── ...
```

## Compatibility mapping

Cursor remains the source of truth. Run the generator after changing a `.cursor-plugin/plugin.json` file:

```bash
node scripts/generate-compat-manifests.mjs
```

The generator writes:

- `.claude-plugin/marketplace.json` and each plugin's `.claude-plugin/plugin.json`.
- `.factory-plugin/marketplace.json` and each plugin's `.factory-plugin/plugin.json`.

Component mappings:

| Cursor | Claude Code | Factory/Droid |
|:-------|:------------|:--------------|
| `skills` | `skills` | `skills` |
| `agents` | `agents` | `droids` |
| `hooks` | `hooks` | `hooks` |
| `commands` | `commands` | `commands` |
| `mcpServers` | `mcpServers` | `mcpServers` |

Factory expects Droid definitions under `droids/`, so plugins with an existing `agents/` directory use a `droids -> agents` symlink. Do not duplicate agent files into `droids/`.

## License

MIT
