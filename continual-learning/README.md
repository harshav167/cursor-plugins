# Continual Learning

Automatically and incrementally keeps `AGENTS.md` up to date from transcript changes.

The plugin combines:

- A `stop` hook that decides when to trigger learning.
- A `continual-learning` skill that selects the learning mode and host transcript source.
- An `agents-memory-updater` subagent that mines parent-session transcripts and updates `AGENTS.md`.

It is designed to avoid noisy rewrites by:

- Reading existing `AGENTS.md` first and updating matching bullets in place.
- Processing only new or changed transcript files for hook-triggered incremental runs.
- Running explicit full-sweep, time-window, or current-chat modes when the user asks for them.
- Writing plain bullet points only (no evidence/confidence metadata).

`AGENTS.md` is always the canonical memory target for this plugin, including when it runs under Claude Code. The updater must not write to `CLAUDE.md`; users who want Claude Code to consume the same file can symlink or configure that separately.

## Installation

```bash
/add-plugin continual-learning
```

## How it works

On eligible `stop` events, the hook may emit a `followup_message` that asks the agent to run the `continual-learning` skill.

The skill is marked `disable-model-invocation: true`, so it will not be auto-selected during normal model invocation. When it does run, it delegates the full memory update flow to `agents-memory-updater`.

The skill supports four modes:

- `incremental`: normal hook-triggered runs; use the transcript index to process only new or changed parent sessions.
- `full-sweep`: user-requested review of every parent session; do not use the index to skip old transcripts.
- `time-window`: user-requested review of a bounded period such as today, yesterday, last 7 days, or last month.
- `current-chat`: user-requested mining of the live/current conversation.

For `full-sweep` and `time-window`, the main agent must enumerate parent transcripts before mining: total transcript files discovered, parent transcripts targeted, subagent transcripts excluded, and any skipped files. The updater then launches exactly one read-only scout per targeted parent transcript. Each scout reads one parent JSONL file line by line through EOF before findings are reconciled. Enumeration is not completion, and the agent must not ask whether to proceed after enumeration. Grep, keyword searches, transcript summaries, and partial snippets are not sufficient for explicit sweeps.

## Transcript locations

The updater chooses parent-session transcript locations by host:

- Cursor: use hook `transcript_path` when present; otherwise inspect `~/.cursor/projects/<workspace-slug>/agent-transcripts/`. Exclude `subagents/` paths from parent-session counts.
- Claude Code: use hook `transcript_path` when present; otherwise inspect `~/.claude/projects/<sanitized-project-path>/`. Parent sessions are direct `*.jsonl` files; subagent transcripts live under `<session-id>/subagents/`.
- Factory/Droid: use hook `transcript_path` when present; otherwise inspect `~/.factory/projects/<project>/`. Exclude nested/subagent transcript locations and do not confuse plugin `droids/` definitions with session transcripts.
- Unknown host: use a trusted hook-provided transcript path if present; otherwise report that the transcript source is unavailable.

The hook keeps local runtime state in:

- `.cursor/hooks/state/continual-learning.json` (cadence state)

The updater uses an incremental transcript index at:

- `.cursor/hooks/state/continual-learning-index.json`

The index is only a skip filter for `incremental` mode. It must not skip targeted transcripts in `full-sweep`, `time-window`, or `current-chat` mode.

## Trigger cadence

Default cadence:

- minimum 10 completed turns
- minimum 120 minutes since the last run
- transcript mtime must advance since the previous run

Trial mode defaults (enabled in this plugin hook config):

- minimum 3 completed turns
- minimum 15 minutes
- automatically expires after 24 hours, then falls back to default cadence

## Optional env overrides

- `CONTINUAL_LEARNING_MIN_TURNS` (or legacy `CONTINUOUS_LEARNING_MIN_TURNS`)
- `CONTINUAL_LEARNING_MIN_MINUTES` (or legacy `CONTINUOUS_LEARNING_MIN_MINUTES`)
- `CONTINUAL_LEARNING_TRIAL_MODE` (or legacy `CONTINUOUS_LEARNING_TRIAL_MODE`)
- `CONTINUAL_LEARNING_TRIAL_MIN_TURNS` (or legacy `CONTINUOUS_LEARNING_TRIAL_MIN_TURNS`)
- `CONTINUAL_LEARNING_TRIAL_MIN_MINUTES` (or legacy `CONTINUOUS_LEARNING_TRIAL_MIN_MINUTES`)
- `CONTINUAL_LEARNING_TRIAL_DURATION_MINUTES` (or legacy `CONTINUOUS_LEARNING_TRIAL_DURATION_MINUTES`)

## Output format in AGENTS.md

The memory updater writes only:

- `## Learned User Preferences`
- `## Learned Workspace Facts`

Each item is a plain bullet point.

## License

MIT
