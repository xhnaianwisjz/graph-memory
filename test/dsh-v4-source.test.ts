import { describe, expect, it } from "vitest";

import { assertV4RowAdmission } from "@deepseek-ai/dsh-session-format-v3-to-v4";

import { graphMemorySource, isGraphMemorySource } from "../src/format/dsh-source.ts";
import { replaceDshArchivedPrefix } from "../src/format/dsh-compaction.ts";
import { replaceDshCompletedTurnTrace } from "../src/format/dsh-turn-projection.ts";

/**
 * DSH 0.1.7 session format V4 rejects the retired V3 `source` wrapper before a
 * durable row is written:
 *
 *   format v4 message requires a producer-owned source kind
 *
 * That rejection aborts the whole turn, so every durable Graph Memory write
 * must pass the host's own admission check. These tests call the real
 * validator rather than restating the rule, and they fail if a new
 * `session.append` reintroduces the wrapper.
 */
function assertDurableUserMessage(event: any): void {
  expect(() => assertV4RowAdmission(event)).not.toThrow();
}

/** The retired wrapper the whole fix removes. */
function legacySource() {
  return { kind: "plugin", plugin: "graph-memory" };
}

describe("DSH V4 durable source admission", () => {
  it("rejects the retired V3 wrapper this fix replaces", () => {
    expect(() => assertV4RowAdmission({
      type: "user/message",
      seq: 1,
      time: Date.now(),
      surfaceOp: "append",
      data: {
        id: "legacy",
        role: "user",
        source: legacySource(),
        content: [{ type: "text", text: "probe" }],
      },
    })).toThrow(/producer-owned source kind/);
  });

  it("builds a producer-owned source DSH admits, with no plugin field", () => {
    const source = graphMemorySource();
    expect(source).toEqual({ kind: "plugin:graph-memory" });
    expect(source).not.toHaveProperty("plugin");
    assertDurableUserMessage({
      type: "user/message",
      seq: 1,
      time: Date.now(),
      surfaceOp: "append",
      data: { id: "ok", role: "user", source, content: [{ type: "text", text: "probe" }] },
    });
  });

  it("keeps recall snapshot attribution on a producer-owned source", () => {
    const source = graphMemorySource({
      form: "snapshot",
      sections: [{ name: "graph-memory:recall", text: "history" }],
    });
    expect(source.kind).toBe("plugin:graph-memory");
    expect(source.form).toBe("snapshot");
    assertDurableUserMessage({
      type: "user/message",
      seq: 2,
      time: Date.now(),
      surfaceOp: "append",
      data: { id: "recall", role: "user", source, content: [{ type: "text", text: "history" }] },
    });
  });

  it("admits the rolling-compaction archive replacement", () => {
    const appended: any[] = [];
    const session = {
      id: "s1",
      append(type: string, data: unknown, options?: Record<string, unknown>) {
        const event = { type, seq: 10 + appended.length, time: Date.now(), data, ...options };
        appended.push(event);
        return event;
      },
    };
    replaceDshArchivedPrefix(session, {
      measure: () => ({ nodes: [{ seq: 0, heuristicTokens: 10 }, { seq: 1, heuristicTokens: 10 }] }),
    }, { start: 0, end: 1, shadowedSeqs: [0, 1], retainedUserTurns: 2 });

    const replacement = appended.at(-1);
    expect(replacement.type).toBe("user/message");
    assertDurableUserMessage(replacement);
  });

  it("admits the completed-turn trace projection", () => {
    const appended: any[] = [];
    const session = {
      id: "s1",
      append(type: string, data: unknown, options?: Record<string, unknown>) {
        const event = { type, seq: 10 + appended.length, time: Date.now(), data, ...options };
        appended.push(event);
        return event;
      },
    };
    replaceDshCompletedTurnTrace(session, {
      measure: () => ({ nodes: [{ seq: 3, heuristicTokens: 5 }, { seq: 4, heuristicTokens: 5 }] }),
    }, {
      turn: 1,
      start: 3,
      end: 4,
      shadowedSeqs: [3, 4],
      questionSeq: 2,
      finalAnswerSeq: 5,
    });

    const replacement = appended.at(-1);
    expect(replacement.type).toBe("user/message");
    assertDurableUserMessage(replacement);
  });

  it("recognizes its own rows across both source generations", () => {
    expect(isGraphMemorySource(graphMemorySource())).toBe(true);
    expect(isGraphMemorySource(legacySource())).toBe(true);
    expect(isGraphMemorySource({ kind: "user" })).toBe(false);
    expect(isGraphMemorySource({ kind: "plugin", plugin: "some-other-plugin" })).toBe(false);
    expect(isGraphMemorySource({ kind: "plugin:pkg/other" })).toBe(false);
    expect(isGraphMemorySource(undefined)).toBe(false);
  });
});
