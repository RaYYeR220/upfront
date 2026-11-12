import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initialView, reduce, type StreamEvent } from "../src/lib/check-stream.ts";

/** Parses a recorded server-sent-events log into events. */
function parseSse(text: string): StreamEvent[] {
  return text
    .split(/\n\n+/)
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      return event && data ? { event, data: JSON.parse(data) } : null;
    })
    .filter((x): x is StreamEvent => !!x);
}

const SAMPLE = `event: start
data: {"checkId":"c1","query":"841936560","amountEur":6800}

event: node
data: {"checkId":"c1","name":"resolve","type":"decision","startedAt":"t","ms":1,"costUsd":0,"input":{},"output":{},"status":"ok"}

event: receipt
data: {"id":"r1","merchant":"api.sirenic.eu","url":"u1","amountUsd":0.005,"txHash":null,"network":"eip155:8453","paidAt":"t","payer":"house","status":"settled"}

event: receipt
data: {"id":"r2","merchant":"api.sirenic.eu","url":"u2","amountUsd":0,"txHash":null,"network":"eip155:8453","paidAt":"t","payer":"house","status":"refused","refusalCode":"session_total_exceeded"}

event: receipt
data: {"id":"r1","merchant":"api.sirenic.eu","url":"u1","amountUsd":0.005,"txHash":null,"network":"eip155:8453","paidAt":"t","payer":"house","status":"settled"}

event: review
data: {"review":{"status":"done","route":"block","reason":"Too generous."},"final":{"mode":"prepay"},"finalReasons":[{"factIds":[],"text":"Independent reviewer disagreed"}],"reviewed":true}

event: end
data: {}
`;

describe("check stream reducer", () => {
  it("builds the live view: nodes, receipts once each, refusals, review, end", () => {
    const v = parseSse(SAMPLE).reduce(reduce, initialView("c1"));
    expect(v.status).toBe("running");
    expect(v.query).toBe("841936560");
    expect(v.current).toBe("resolve");
    expect(v.receipts).toHaveLength(2);
    expect(v.spentUsd).toBe(0.005);
    expect(v.refused.map((r) => r.refusalCode)).toEqual(["session_total_exceeded"]);
    expect(v.final).toEqual({ mode: "prepay" });
    expect(v.reviewed).toBe(true);
    expect(v.ended).toBe(true);
  });

  it("replays a full recorded check to its outcome", () => {
    const file = join(import.meta.dirname, "fixtures", "check-841936560.sse");
    const v = parseSse(readFileSync(file, "utf8")).reduce(reduce, initialView("x"));
    expect(v.status).toBe("done");
    expect(Object.keys(v.nodes).sort()).toEqual(["buy", "decide", "extract", "floors", "issue", "plan", "resolve", "review"]);
    expect(v.final).toEqual({ mode: "decline" });
    expect(v.result?.entity.name).toBe("KD SOCCER CONSULTING");
  });
});
