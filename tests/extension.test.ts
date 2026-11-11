import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  ExtensionHandler,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import agentsLocal from "../index.ts";

function fixture(t: TestContext) {
  // Keep test writes inside the project, and remove them even on assertion failure.
  const root = mkdtempSync(join(process.cwd(), ".test-agents-local-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "project");
  mkdirSync(cwd);
  return { root, cwd, path: join(cwd, "AGENTS.local.md") };
}

function harness() {
  const handlers = new Map<string, unknown>();
  // Only the registration surface is mocked; events use the real public types.
  const pi = {
    on(name: string, handler: unknown) {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
  } as unknown as ExtensionAPI;
  agentsLocal(pi);
  assert.deepEqual([...handlers.keys()], ["session_start", "before_agent_start"]);

  return {
    async start(cwd: string, reason: SessionStartEvent["reason"] = "startup") {
      const handler = handlers.get("session_start") as ExtensionHandler<SessionStartEvent>;
      await handler({ type: "session_start", reason }, { cwd } as ExtensionContext);
    },
    async run(files: Array<{ path: string; content: string }> = [], custom = false) {
      const base = {
        type: "before_agent_start" as const,
        systemPrompt: "native prompt",
        systemPromptOptions: {
          cwd: process.cwd(), selectedTools: [], hiddenTools: [], toolSnippets: {},
          toolGuidelines: {}, promptGuidelines: [], appendSystemPrompt: "",
          sections: { preserved: "unchanged" }, contextFiles: files, skills: [],
        },
      };
      const event: BeforeAgentStartEvent = custom
        ? { ...base, messageType: "custom", message: { role: "custom", customType: "test", content: "run", display: false, timestamp: 0 } }
        : { ...base, messageType: "user", prompt: "run" };
      const handler = handlers.get("before_agent_start") as ExtensionHandler<BeforeAgentStartEvent, unknown>;
      assert.equal(await handler(event, {} as ExtensionContext), undefined);
      assert.equal(event.systemPrompt, "native prompt");
      assert.deepEqual(event.systemPromptOptions.sections, { preserved: "unchanged" });
      assert.equal(event.systemPromptOptions.forceSystemPrompt, undefined);
      return event.systemPromptOptions.contextFiles;
    },
  };
}

test("appends cwd-local instructions after native files, without reading parents", async (t) => {
  const { root, cwd, path } = fixture(t);
  writeFileSync(join(root, "AGENTS.local.md"), "parent must not load");
  const h = harness();
  await h.start(cwd);
  assert.deepEqual(await h.run(), []);

  writeFileSync(path, "local");
  await h.start(cwd, "reload");
  const native = [{ path: join(root, "AGENTS.md"), content: "global" }, { path: join(cwd, "AGENTS.md"), content: "project" }];
  const original = [...native];
  assert.strictEqual(await h.run(native), native);
  assert.deepEqual(native, [...original, { path, content: "local" }]);
  assert.strictEqual(native[0], original[0]);
  assert.strictEqual(native[1], original[1]);
});

test("keeps a snapshot between runs and refreshes it on reload", async (t) => {
  const { cwd, path } = fixture(t);
  writeFileSync(path, "first");
  const h = harness();
  await h.start(cwd);
  writeFileSync(path, "second");
  assert.deepEqual(await h.run(), [{ path, content: "first" }]);
  await h.start(cwd, "reload");
  assert.deepEqual(await h.run([], true), [{ path, content: "second" }]);
  rmSync(path);
  assert.deepEqual(await h.run(), [{ path, content: "second" }]);
  await h.start(cwd, "reload");
  assert.deepEqual(await h.run(), []);
});

test("deduplicates by path without overwriting another source or mutating the snapshot", async (t) => {
  const { cwd, path } = fixture(t);
  writeFileSync(path, "snapshot");
  const h = harness();
  await h.start(cwd);
  const existing = [{ path, content: "other source" }];
  assert.deepEqual(await h.run(existing), [{ path, content: "other source" }]);
  const appended = await h.run();
  await h.run(appended);
  assert.equal(appended.length, 1);
  appended[0]!.content = "mutated by a later handler";
  assert.deepEqual(await h.run(), [{ path, content: "snapshot" }]);
});

test("matches native BOM handling while preserving empty files and whitespace", async (t) => {
  const { cwd, path } = fixture(t);
  const h = harness();
  for (const [input, expected] of [["", ""], [" \n\t", " \n\t"], ["\uFEFF", ""], ["\uFEFF  rules\r\n", "  rules\r\n"], ["\uFEFF\uFEFFrules", "\uFEFFrules"]]) {
    writeFileSync(path, input!);
    await h.start(cwd, "reload");
    assert.deepEqual(await h.run(), [{ path, content: expected }]);
  }
});

test("skips non-regular files and clears the previous snapshot", async (t) => {
  const { cwd, path } = fixture(t);
  const h = harness();
  writeFileSync(path, "old");
  await h.start(cwd);
  rmSync(path);
  mkdirSync(path);
  await h.start(cwd, "reload");
  assert.deepEqual(await h.run(), []);
});

test("follows symlinks to regular files like the native loader", async (t) => {
  const { root, cwd, path } = fixture(t);
  const target = join(root, "personal.md");
  writeFileSync(target, "linked");
  symlinkSync(target, path);
  const h = harness();
  await h.start(cwd);
  assert.deepEqual(await h.run(), [{ path, content: "linked" }]);
  rmSync(target);
  await h.start(cwd, "reload");
  assert.deepEqual(await h.run(), []);
});

test("warns on unreadable files, continues, and discards stale content", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async (t) => {
  const { cwd, path } = fixture(t);
  writeFileSync(path, "old");
  const h = harness();
  await h.start(cwd);
  const warning = t.mock.method(console, "error", () => {});
  chmodSync(path, 0);
  try {
    await h.start(cwd, "reload");
    assert.deepEqual(await h.run(), []);
    assert.equal(warning.mock.callCount(), 1);
    assert.match(String(warning.mock.calls[0]!.arguments[0]), /Warning: Could not read .*AGENTS\.local\.md:.*EACCES/);
  } finally {
    chmodSync(path, 0o600);
  }
});

test("replaces snapshots on session changes and keeps extension instances isolated", async (t) => {
  const { root, cwd, path } = fixture(t);
  writeFileSync(path, "one");
  const otherCwd = join(root, "other");
  mkdirSync(otherCwd);
  const otherPath = join(otherCwd, "AGENTS.local.md");
  writeFileSync(otherPath, "two");
  const first = harness();
  const second = harness();
  assert.deepEqual(await first.run(), []);
  await first.start(cwd);
  await second.start(otherCwd);
  assert.deepEqual(await first.run(), [{ path, content: "one" }]);
  assert.deepEqual(await second.run(), [{ path: otherPath, content: "two" }]);
  await first.start(otherCwd, "resume");
  assert.deepEqual(await first.run(), [{ path: otherPath, content: "two" }]);
});
