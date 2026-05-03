---
name: continual-learning
description: Orchestrate continual learning by selecting the right host transcript source and delegating AGENTS.md updates to `agents-memory-updater`.
disable-model-invocation: true
---

# Continual Learning

Keep `AGENTS.md` current by delegating transcript mining to `agents-memory-updater` with an explicit mode and host transcript source.

## Trigger

Use when:

- A stop hook asks to run continual learning.
- The user asks to mine prior chats, maintain `AGENTS.md`, or run the continual-learning loop.
- The user challenges a clean memory result or says important feedback was missed.
- The user narrows memory mining to the current chat, today, yesterday, last week, or another time window.

## Workflow

1. Classify the requested mode before delegating:
   - `incremental`: hook-triggered normal run; process only new or changed parent transcripts using the incremental index.
   - `full-sweep`: user asks for every prior chat/session, says the updater missed things, or challenges a clean result.
   - `time-window`: user asks for today, yesterday, last N days, last week, last month, or similar.
   - `current-chat`: user says the feedback is in the current chat or asks to use the live conversation.
2. Identify the host/runtime and transcript source:
   - Cursor: use hook `transcript_path` when available. Otherwise inspect `~/.cursor/projects/<workspace-slug>/agent-transcripts/`. Parent transcripts are the JSONL files not under a `subagents/` path; subagent transcripts must be excluded from parent-session counts.
   - Claude Code: use hook `transcript_path` when available. Otherwise inspect `~/.claude/projects/<sanitized-project-path>/`. Parent sessions are direct `*.jsonl` files in the project directory. Subagent sessions live under `<session-id>/subagents/` and must be excluded from parent-session counts.
   - Factory/Droid: use hook `transcript_path` when available. Otherwise inspect `~/.factory/projects/<project>/`. Parent sessions are conversation JSONL files under that project area. Exclude known nested/subagent locations and never treat plugin `droids/` definitions as transcripts.
   - Unknown host: prefer a trusted hook-provided `transcript_path`; otherwise ask the updater to report that the transcript source is unavailable instead of guessing.
3. For `full-sweep` and `time-window` modes, enumerate the target parent transcript list before mining:
   - Count total transcript files discovered.
   - Count parent transcripts after excluding subagent paths.
   - Count excluded subagent transcripts.
   - Apply any requested time-window filter to the parent list.
   - Report the targeted parent count to the updater.
4. For explicit user-requested sweeps, require subagent-backed full reads before findings are returned:
   - Launch read-only scout subagents in safe batches, normally one scout per parent transcript or per small group of very short transcripts.
   - Each scout must read assigned JSONL files line by line from start to EOF, confirm EOF, and return durable memory candidates plus rejected situational items.
   - Do not accept grep-only, keyword-only, snippet-only, summary-only, or mtime-only analysis as complete.
   - Do not count interrupted, timed-out, or partial scouts as complete.
5. Pass the mode, host, transcript root/path, targeted parent list/count, current user request, and canonical memory target `AGENTS.md` to `agents-memory-updater`.
6. Require the updater to report:
   - host/runtime detected
   - mode used
   - parent transcripts targeted
   - parent transcripts fully read/accounted for
   - subagent transcripts excluded
   - whether `AGENTS.md` changed
   - whether the incremental index changed
7. Return the updater result without independently extracting memory in the parent flow.

## Guardrails

- Keep the parent skill orchestration-only.
- Do not mine transcript contents or edit files in the parent flow.
- Do not bypass the subagent.
- Always target `AGENTS.md` for memory updates, including when running under Claude Code. Do not redirect updates to `CLAUDE.md`; the user manages any `AGENTS.md` to `CLAUDE.md` symlink.
- For explicit sweeps, do not return findings until targeted parent transcripts have been line-by-line read by scouts or explicitly accounted for.
- Do not use grep or term searches as a substitute for full transcript reads.
- Do not let an incremental index skip files in `full-sweep`, `time-window`, or `current-chat` mode.
- Do not report a clean result unless the requested transcript set is fully accounted for.
