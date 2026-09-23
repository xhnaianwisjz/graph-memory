/**
 * Durable message-source attribution for the Graph Memory DSH adapter.
 *
 * DSH 0.1.7 (session format V4) tightened `source.kind` from a free string to a
 * *producer-owned* kind. The persistence codec rejects the retired V3 wrapper
 * before the row is written:
 *
 *   format v4 message requires a producer-owned source kind
 *
 * so a durable `{ kind: "plugin", plugin: "graph-memory" }` makes the whole
 * turn fail. DSH's own V3->V4 read migration maps a non-first-party plugin to
 * `plugin:<name>` and drops the `plugin` field; the runtime writer has no such
 * fallback, so every durable Graph Memory write must emit that shape itself.
 *
 * Only *durable* writes must use {@link graphMemorySource}. Messages that are
 * merely part of a `ctx.llm.stream` request are never persisted by DSH and are
 * deliberately left untouched by this module.
 */
/** Stable plugin identity shared by every Graph Memory durable write. */
export const DSH_PRODUCER_ID = "graph-memory";
/**
 * Producer-owned `source.kind` for a Graph Memory durable message.
 *
 * Mirrors `producerKind()` in `@deepseek-ai/dsh-session-format-v3-to-v4` for a
 * plugin outside its rename and same-name release tables.
 */
export const DSH_PRODUCER_SOURCE_KIND = `plugin:${DSH_PRODUCER_ID}`;
/**
 * Build the `source` of a Graph Memory durable message.
 *
 * @param fields - optional attribution the DSH client projections understand.
 * @returns a source whose `kind` is producer-owned, carrying no `plugin` field.
 */
export function graphMemorySource(fields = {}) {
    return { kind: DSH_PRODUCER_SOURCE_KIND, ...fields };
}
/**
 * Whether a durable message source is Graph Memory's own, across formats.
 *
 * Accepts both the current producer-owned kind and the retired V3 wrapper, so
 * history written before this fix keeps working after a read migration.
 *
 * @param source - `source` field of a durable DSH message.
 * @returns whether Graph Memory produced the message.
 */
export function isGraphMemorySource(source) {
    if (!source || typeof source !== "object")
        return false;
    const value = source;
    if (value.kind === DSH_PRODUCER_SOURCE_KIND)
        return true;
    return value.kind === "plugin" && value.plugin === DSH_PRODUCER_ID;
}
