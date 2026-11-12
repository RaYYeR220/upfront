"use client";

import { useEffect, useReducer } from "react";
import { api, streamUrl } from "./api.ts";
import { type CheckView, initialView, reduce, type StreamEvent, viewFromRow } from "./check-stream.ts";

const EVENTS = ["start", "node", "receipt", "outcome", "review", "end"] as const;

type Action = StreamEvent | { event: "__replace"; data: CheckView };

function reducer(v: CheckView, a: Action): CheckView {
  return a.event === "__replace" ? (a.data as CheckView) : reduce(v, a);
}

/**
 * Follows a check live: subscribes to its event stream and folds every graph
 * step into one view. A finished check falls back to the stored result.
 */
export function useCheck(checkId: string): CheckView {
  const [view, dispatch] = useReducer(reducer, checkId, initialView);

  useEffect(() => {
    let closed = false;
    const es = new EventSource(streamUrl(checkId));
    for (const name of EVENTS) {
      es.addEventListener(name, (msg) => {
        if (closed) return;
        try {
          dispatch({ event: name, data: JSON.parse((msg as MessageEvent).data) });
        } catch {
          /* ignore a malformed frame */
        }
        if (name === "end") es.close();
      });
    }
    es.onerror = async () => {
      es.close();
      if (closed) return;
      try {
        const row = await api.getCheck(checkId);
        dispatch({ event: "__replace", data: viewFromRow(checkId, row) });
      } catch {
        /* the page shows the last known state */
      }
    };
    return () => {
      closed = true;
      es.close();
    };
  }, [checkId]);

  return view;
}
