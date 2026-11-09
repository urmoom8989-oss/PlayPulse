// run(): a command at a lower CPU priority (the HD lane, 039).
import assert from "node:assert/strict";
import { getPriority, platform } from "node:os";
import { test } from "node:test";
import { run } from "../lib/run.mjs";

test("a command run with a priority gets that nice value", { skip: platform() !== "linux" }, async () => {
  // Field 19 of /proc/<pid>/stat is the nice value; the sleep lets setPriority land first.
  const read = "sleep 0.3; cut -d' ' -f19 /proc/$$/stat";
  assert.equal((await run("sh", ["-c", read], { priority: 19 })).trim(), "19");
  // Without one, it keeps the worker's own.
  assert.equal((await run("sh", ["-c", read])).trim(), String(getPriority()));
});
