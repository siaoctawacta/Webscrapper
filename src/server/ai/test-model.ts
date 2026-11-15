/**
 * Test-only mock models for the AI Gateway wrapper (imported by *.test.ts files only, never by app code).
 */
import { MockLanguageModelV4 } from "ai/test";

type GenerateOptions = MockLanguageModelV4["doGenerateCalls"][number];
type GenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

const usage: GenerateResult["usage"] = {
  inputTokens: { total: 120, noCache: 120, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 80, text: 80, reasoning: undefined },
};

const result = (text: string): GenerateResult => ({
  content: [{ type: "text", text }],
  finishReason: { unified: "stop", raw: undefined },
  usage,
  warnings: [],
});

/** A model that answers with `text` (or whatever `respond` returns for the call). */
export function mockTextModel(respond: string | ((opts: GenerateOptions) => string)) {
  return new MockLanguageModelV4({
    modelId: "mock-model",
    doGenerate: async (opts) => result(typeof respond === "string" ? respond : respond(opts)),
  });
}

/** A model that answers with `data` serialized as JSON. */
export const mockJsonModel = (data: unknown) => mockTextModel(JSON.stringify(data));

/** A model that never answers until the call is aborted. */
export function hangingModel() {
  return new MockLanguageModelV4({
    modelId: "mock-hanging",
    doGenerate: (opts) =>
      new Promise<GenerateResult>((_resolve, reject) => {
        opts.abortSignal?.addEventListener("abort", () => reject(opts.abortSignal?.reason ?? new Error("aborted")));
      }),
  });
}

/** A model that fails like an unreachable provider. */
export function failingModel(error: Error = new Error("connection refused")) {
  return new MockLanguageModelV4({
    modelId: "mock-failing",
    doGenerate: async () => {
      throw error;
    },
  });
}

/** System + user text of a recorded call, for assertions on prompt assembly. */
export function promptText(opts: GenerateOptions): { system: string; user: string } {
  let system = "";
  let user = "";
  for (const m of opts.prompt) {
    if (m.role === "system") system += m.content;
    if (m.role === "user") for (const part of m.content) if (part.type === "text") user += part.text;
  }
  return { system, user };
}
