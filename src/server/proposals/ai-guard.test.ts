import { describe, expect, it } from "vitest";
import { checkAiRewrite } from "./ai-guard";

const draft = {
  subject: "A website for Chez Ama",
  body: [
    "Hello Chez Ama team,",
    "Congratulations on your 4.6-star rating from 87 reviews.",
    "See the idea here: http://localhost:3000/c/tok123",
    "Best regards,",
    "Kofi Mensah",
    "+228 90 00 00 00 · kofi@atelier.example",
    "atelier.example",
  ].join("\n"),
};
const sig = ["Kofi Mensah", "+228 90 00 00 00 · kofi@atelier.example", "atelier.example"];
const rewrite = (body: string, subject = draft.subject) => ({ subject, body });

describe("checkAiRewrite", () => {
  it("accepts a rewrite that keeps facts, links and signature", () => {
    const body = [
      "Hello Chez Ama team,",
      "Your 4.6-star rating across 87 reviews says a lot about your work.",
      "I sketched a homepage idea for you: http://localhost:3000/c/tok123",
      "Best regards,",
      ...sig,
    ].join("\n");
    expect(checkAiRewrite(draft, rewrite(body), sig)).toEqual({ ok: true });
  });

  it("rejects invented numbers", () => {
    const body = `${draft.body.replace("87 reviews.", "87 reviews and 10 years in business.")}`;
    expect(checkAiRewrite(draft, rewrite(body), sig)).toMatchObject({ ok: false, problem: expect.stringMatching(/number/) });
  });

  it("rejects new links, emails and domains", () => {
    expect(checkAiRewrite(draft, rewrite(`${draft.body}\nhttps://evil.example/offer`), sig).ok).toBe(false);
    expect(checkAiRewrite(draft, rewrite(`${draft.body}\nWrite to sales@other.example`), sig).ok).toBe(false);
    expect(checkAiRewrite(draft, rewrite(`${draft.body}\nVisit other-site.com`), sig).ok).toBe(false);
  });

  it("rejects a rewrite that drops the concept link or the signature", () => {
    expect(checkAiRewrite(draft, rewrite(draft.body.replace(" http://localhost:3000/c/tok123", "")), sig)).toMatchObject({ ok: false, problem: "dropped a link" });
    expect(checkAiRewrite(draft, rewrite(draft.body.replace("Kofi Mensah\n", "")), sig)).toMatchObject({ ok: false, problem: "changed the signature" });
  });

  it("rejects leftover placeholders", () => {
    expect(checkAiRewrite(draft, rewrite(`${draft.body}\n[Your name]`), sig)).toMatchObject({ ok: false, problem: "left a placeholder" });
  });
});
