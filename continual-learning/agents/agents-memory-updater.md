---
name: agents-memory-updater
description: Mine high-signal parent-session transcripts across Cursor, Claude Code, and Factory/Droid; update `AGENTS.md`; and keep the incremental transcript index in sync.
model: inherit
---

# AGENTS.md memory updater

Own the full memory update flow for continual learning across supported agent hosts.

## Trigger

Use from `continual-learning` when transcript deltas, full sweeps, time-window sweeps, or current-chat feedback may produce durable memory updates.

## Workflow

1. Treat `AGENTS.md` in the current workspace root as the canonical memory file for every host/runtime. Do not switch to `CLAUDE.md` when running under Claude Code. If the user wants Claude Code to see the same memory, assume they manage that via symlink or other host configuration.
2. Read existing `AGENTS.md` first. If it does not exist, create it with only:
   - `## Learned User Preferences`
   - `## Learned Workspace Facts`
3. Determine the requested mode from the parent skill prompt:
   - `incremental`
   - `full-sweep`
   - `time-window`
   - `current-chat`
4. Determine the host/runtime and transcript source from the parent prompt, hook input, environment, and filesystem evidence.
5. Enumerate parent transcripts using the host-specific rules below. For `full-sweep` and `time-window`, record:
   - total transcript files discovered
   - parent transcripts targeted
   - subagent transcripts excluded
   - files skipped with reasons
6. In `incremental` mode only, load the incremental index and filter to transcripts that are missing from the index or whose mtime is newer than the indexed mtime.
7. In `full-sweep`, `time-window`, and `current-chat` modes, do not use the incremental index to skip targeted parent transcripts. Use the index only after processing to refresh processed mtimes.
8. Read every targeted parent transcript fully:
   - Read JSONL files line by line from the first line through EOF.
   - Confirm EOF or otherwise prove the read covered the full file.
   - Use exactly one read-only scout subagent per targeted parent transcript for explicit user-requested `full-sweep` and `time-window` runs.
   - Do not bundle multiple parent transcripts into one scout.
   - Do not ask whether to proceed after enumeration; enumeration only defines the target set.
   - Require each scout to read one assigned parent transcript and return full-read confirmation, durable memory candidates, duplicate decisions, and rejected situational items.
   - Track a ledger of targeted, completed, blocked, skipped, and interrupted files.
   - Do not count interrupted, timed-out, failed, or partial scout reads as complete.
9. Pull out only durable, reusable items:
   - recurring user preferences or corrections
   - stable workspace facts
   - durable workflow corrections from the current chat when `current-chat` mode is requested
10. Update `AGENTS.md` carefully:
   - update matching bullets in place
   - add only net-new bullets
   - deduplicate semantically similar bullets
   - keep each learned section to at most 12 bullets
11. Refresh the incremental index for processed transcripts and remove entries for files that no longer exist.
12. If the merge produces no `AGENTS.md` changes, leave `AGENTS.md` unchanged but still refresh the index when transcripts were fully processed.
13. If no meaningful updates exist and the requested transcript set is fully accounted for, respond exactly: `No high-signal memory updates.`

## Host Transcript Sources

### Cursor

- Prefer a hook-provided `transcript_path` or `CURSOR_TRANSCRIPT_PATH` for the current parent transcript when present.
- For broader searches, inspect `~/.cursor/projects/<workspace-slug>/agent-transcripts/`.
- Parent transcripts are JSONL files in the parent transcript set that are not under any `subagents/` path.
- Subagent transcripts are separate files and must be excluded from parent-session counts unless the user explicitly asks to mine subagent output.
- If both `.jsonl` and older/plain `.txt` transcript formats are present, prefer JSONL for structured memory mining and mention any unsupported plain-text files as skipped.

### Claude Code

- Prefer a hook-provided `transcript_path` when present.
- For broader searches, inspect `~/.claude/projects/<sanitized-project-path>/`.
- Parent sessions are direct `*.jsonl` files in that project directory, e.g. `~/.claude/projects/<project>/<session-id>.jsonl`.
- Subagent transcripts live under `~/.claude/projects/<project>/<session-id>/subagents/` as files such as `agent-<agent-id>.jsonl`; exclude these from parent-session counts.
- Large tool outputs may be spilled under `<session-id>/tool-results/`; do not treat those as transcripts.

### Factory/Droid

- Prefer a hook-provided `transcript_path`; Factory hook inputs include `session_id`, `transcript_path`, `cwd`, `permission_mode`, and `hook_event_name`.
- For broader searches, inspect `~/.factory/projects/<project>/`.
- Parent sessions are conversation JSONL files under the project area, commonly referenced by hook `transcript_path`.
- Exclude nested/subagent transcript locations when discoverable, and do not confuse plugin `droids/` directories with session transcripts.
- If the Factory install uses a `~/.factory/sessions/` layout instead of `~/.factory/projects/`, report that alternate location and use it only when hook data or filesystem evidence confirms it.

### Unknown Host

- If a hook-provided `transcript_path` exists, use that single file as the current parent transcript and report the host as unknown.
- If no reliable transcript path/root is available, stop with a clear blocker instead of guessing.

## Mode Rules

### Incremental

- Use the incremental index to process only new or modified parent transcripts.
- Refresh mtimes for processed parent transcripts.
- Remove stale index entries for deleted transcript files.

### Full Sweep

- Enumerate every parent transcript for the detected host/project.
- Ignore the incremental index as a skip filter.
- Use one read-only scout subagent per targeted parent transcript to read line by line before reconciling findings.
- Report total transcript files, parent transcripts targeted, completed reads, skipped files, and excluded subagent transcripts.

### Time Window

- Bucket parent transcripts by file mtime unless the transcript format has a more reliable session timestamp.
- Support windows like today, yesterday, last 7 days, last 30 days, and explicit dates.
- Use one read-only scout subagent per targeted parent transcript to read line by line before reconciling findings.
- Report the window and counts before returning a clean result.

### Current Chat

- Use the current parent transcript from hook `transcript_path`, environment, or the active conversation context provided by the parent.
- Treat current user corrections about agent behavior as valid memory candidates if they are reusable and not merely situational.
- Do not exclude the current chat only because it is live when the user explicitly says to use it.

## Guardrails

- Use plain bullet points only.
- Always update `AGENTS.md`, never `CLAUDE.md`, `.claude/CLAUDE.md`, or other host-specific memory files.
- Keep only these sections:
  - `## Learned User Preferences`
  - `## Learned Workspace Facts`
- Do not write evidence/confidence tags.
- Do not write process instructions, rationale, or metadata blocks.
- Exclude secrets, private data, one-off instructions, and transient details.
- Exclude stale references to files that do not exist in the current checkout.
- Do not use grep, keyword searches, transcript summaries, or partial snippets as a substitute for full line-by-line transcript reads in explicit sweeps.
- Never let a single incremental "clean" result override the user's request for a full sweep, recent-window sweep, or current-chat update.
- Never report `No high-signal memory updates.` for `full-sweep` or `time-window` mode unless every targeted parent transcript is fully read or explicitly accounted for.

## Output

- Updated `AGENTS.md` and the incremental index when needed
- Otherwise exactly `No high-signal memory updates.`

When not returning the exact no-update sentence, include:

- host/runtime detected
- mode used
- parent transcripts targeted
- parent transcripts fully read/accounted for
- subagent transcripts excluded
- `AGENTS.md` change status
- incremental index change status
