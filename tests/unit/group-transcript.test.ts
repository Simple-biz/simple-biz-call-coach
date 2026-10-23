import { describe, it, expect } from "vitest";
import { groupTranscriptions } from "@/utils/group-transcript";
import type { Transcription } from "@/types";

const t = (speaker: Transcription["speaker"], text: string, isFinal = true, ts = 0): Transcription => ({
  id: `${speaker}-${text}-${ts}`, speaker, text, isFinal, timestamp: ts, confidence: 1,
});

describe("groupTranscriptions", () => {
  it("joins a lead's digit groups into one paragraph", () => {
    const g = groupTranscriptions([
      t("agent", "What's your social?", true, 1),
      t("customer", "It's 123", true, 2),
      t("customer", "45", true, 3),
      t("customer", "6789.", true, 4),
    ]);
    expect(g).toHaveLength(2);
    expect(g[1]).toMatchObject({ speaker: "customer", text: "It's 123 45 6789.", interim: "", timestamp: 2 });
  });

  it("starts a new paragraph when the speaker changes", () => {
    const g = groupTranscriptions([t("customer", "a"), t("agent", "b"), t("customer", "c")]);
    expect(g.map((p) => p.text)).toEqual(["a", "b", "c"]);
  });

  it("shows a trailing interim after the finals, and drops it once a final lands", () => {
    const live = groupTranscriptions([t("customer", "My number is 555"), t("customer", "01", false)]);
    expect(live[0]).toMatchObject({ text: "My number is 555", interim: "01" });

    const settled = groupTranscriptions([t("customer", "My number is 555"), t("customer", "0123", true)]);
    expect(settled[0]).toMatchObject({ text: "My number is 555 0123", interim: "" });
  });

  it("skips empty fragments without splitting the paragraph", () => {
    const g = groupTranscriptions([t("customer", "one"), t("customer", "  "), t("customer", "two")]);
    expect(g).toHaveLength(1);
    expect(g[0].text).toBe("one two");
  });

  it("handles a paragraph that is only interim so far", () => {
    const g = groupTranscriptions([t("customer", "hel", false)]);
    expect(g[0]).toMatchObject({ text: "", interim: "hel" });
  });
});
