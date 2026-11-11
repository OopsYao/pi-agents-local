# Project Context

pi-agents-local is a pi extension that loads `AGENTS.local.md` from the session working directory. It supplements shared `AGENTS.md` rules with personal or machine-specific instructions by extending pi's native loading semantics, not by introducing a separate prompt mechanism.

The extension loads a snapshot during session initialization and `/reload`, then adds it to `systemPromptOptions.contextFiles` before each run. It does not reread the file on every run. The current public extension API does not register these additions with the resource loader, so the file will not appear in the TUI's native startup Context list.

See `README.md` for user-facing behavior and limitations.

## Design Principle

Align with native `AGENTS.md` loading semantics. Apart from the filename and the explicitly limited search scope, do not invent separate loading, content-processing, or error-handling rules. Document differences imposed by the public extension API rather than emulating native behavior through internal hacks.

## Implementation Boundaries

- Read only `AGENTS.local.md` in the session working directory; do not search parent directories.
- Load a snapshot during session initialization and `/reload`; do not watch the file or reread it per run. Replace the previous snapshot on reload, including when the file is missing or unreadable.
- Modify `systemPromptOptions.contextFiles` through the public `before_agent_start` event. Do not return a complete `systemPrompt` or inject file instructions through chat messages.
- Preserve native context files and their relative order; append the local file afterward. Deduplicate by file path without overwriting content supplied by another source at the same path.
- Follow the target pi version's native loader for content processing and errors. Do not add trimming, empty-file filtering, or size limits.

## Development Entry Points

Before implementation, read the target pi version's complete extension documentation, relevant examples, and exported types. Check the native resource loader's actual behavior rather than treating other plugins as the reference.
