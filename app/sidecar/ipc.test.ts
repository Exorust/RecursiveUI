import { test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import type { Subprocess } from "bun";

/*
 * Integration test for the stdin/stdout JSON-line protocol — the most-touched,
 * least-tested wiring. Spawns the real sidecar and drives it the way the Rust
 * backend does. Uses only read-only handlers (unknown, discover-skills) so no
 * telemetry/genome state is mutated.
 */

let proc: Subprocess<"pipe", "pipe", "pipe">;
let stdout: any; // Bun's reader type differs from the DOM lib type
const responses = new Map<number, any>();
let buffer = "";

async function pump(decoder = new TextDecoder()) {
  // Continuously drain stdout, indexing response lines by reqId.
  while (true) {
    const { value, done } = await stdout.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "response" && typeof msg.reqId === "number") {
          responses.set(msg.reqId, msg);
        }
      } catch {
        // non-JSON line, ignore
      }
    }
  }
}

function send(obj: Record<string, unknown>) {
  proc.stdin.write(JSON.stringify(obj) + "\n");
  proc.stdin.flush();
}

async function waitFor(reqId: number, timeoutMs = 8000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (responses.has(reqId)) return responses.get(reqId);
    await Bun.sleep(20);
  }
  throw new Error(`timed out waiting for reqId ${reqId}`);
}

beforeAll(async () => {
  proc = Bun.spawn(["bun", "run", join(import.meta.dir, "index.ts")], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  stdout = proc.stdout.getReader();
  pump(); // fire-and-forget drain
  await Bun.sleep(300); // let the sidecar boot
});

afterAll(() => {
  proc?.kill();
});

test("unknown message type replies ok:false with its reqId", async () => {
  send({ type: "totally-bogus", reqId: 1 });
  const r = await waitFor(1);
  expect(r.ok).toBe(false);
  expect(r.reqId).toBe(1);
});

test("discover-skills returns the skill inventory", async () => {
  send({ type: "discover-skills", reqId: 2 });
  const r = await waitFor(2);
  expect(r.ok).toBe(true);
  expect(Array.isArray(r.skills)).toBe(true);
  expect(r.skills.length).toBeGreaterThan(0);
});

// The core correlation guarantee: fire several at once, each response must
// come back tagged with the reqId it was sent with — never crossed.
test("concurrent requests correlate by reqId", async () => {
  send({ type: "totally-bogus", reqId: 100 });
  send({ type: "discover-skills", reqId: 101 });
  send({ type: "totally-bogus", reqId: 102 });

  const [a, b, c] = await Promise.all([waitFor(100), waitFor(101), waitFor(102)]);
  expect(a.reqId).toBe(100);
  expect(a.ok).toBe(false);
  expect(b.reqId).toBe(101);
  expect(b.ok).toBe(true);
  expect(b.skills.length).toBeGreaterThan(0);
  expect(c.reqId).toBe(102);
  expect(c.ok).toBe(false);
});
