# pi-agents-local

A pi extension that extends native `AGENTS.md` loading semantics to support `AGENTS.local.md` in the startup directory.

`AGENTS.md` holds shared project rules; `AGENTS.local.md` supplies personal or machine-specific additions. Apart from the filename and search scope, loading and content processing follow the native mechanism.

## Loading Behavior

- Read only `AGENTS.local.md` in the startup directory (the session working directory); do not search parent directories.
- Load during session initialization, not on every run. Use `/reload` or restart pi after changing the file.
- Preserve native project-instruction order and append the local file afterward. Appearing later does not grant higher instruction authority.
- Skip missing paths and non-regular files. Warn on stat/read failures and continue running. Reload replaces the snapshot even when the file is missing or unreadable.
- Strip a leading UTF-8 BOM, like the native loader; otherwise preserve content, including empty files and whitespace.
- Deduplicate by file path without replacing content already supplied at that path.

## Installation

Requires Node.js 22.19+ and pi with the mutable `before_agent_start.systemPromptOptions.contextFiles` API. Developed and tested against `@earendil-works/pi-coding-agent` 1.4.0; older pi APIs are not supported.

Try this checkout without changing pi settings:

```sh
pi -e /absolute/path/to/pi-agents-local/index.ts
```

Or install the local package persistently:

```sh
pi install /absolute/path/to/pi-agents-local
```

## Usage

Create `AGENTS.local.md` in the directory where you start pi and add your local instructions. Add the file to `.git/info/exclude` or an appropriate ignore rule to avoid committing personal content.

Do not enable another plugin that loads the same file, as this can duplicate instructions.

## Limitations

- The current public pi extension API cannot register the file in the TUI's native startup Context list. This does not prevent its content from being injected.
- The snapshot is appended through the extension event, not registered with the native resource loader. Native loader controls such as `--no-context-files` do not disable this extension; disable the extension itself when local instructions should not load.

## Development

```sh
npm ci
npm run check
npm test
npm pack --dry-run
```

The package ships TypeScript directly for pi's extension loader; no build step or runtime dependency on Bun is required.
