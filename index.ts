import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ContextFile = { path: string; content: string };

function loadLocalContext(cwd: string): ContextFile | undefined {
  const path = resolve(cwd, "AGENTS.local.md");
  if (!existsSync(path)) return undefined;

  try {
    if (!statSync(path).isFile()) return undefined;
    const content = readFileSync(path, "utf-8");
    // Match the native loader: remove only a leading BOM, not whitespace.
    return { path, content: content.startsWith("\uFEFF") ? content.slice(1) : content };
  } catch (error) {
    console.error(`Warning: Could not read ${path}: ${error}`);
    return undefined;
  }
}

export default function agentsLocal(pi: ExtensionAPI): void {
  let snapshot: ContextFile | undefined;

  pi.on("session_start", (_event, ctx) => {
    snapshot = loadLocalContext(ctx.cwd);
  });

  pi.on("before_agent_start", (event) => {
    const local = snapshot;
    if (!local) return;
    const files = event.systemPromptOptions.contextFiles;
    if (!files.some((file) => file.path === local.path)) {
      files.push({ ...local });
    }
  });
}
