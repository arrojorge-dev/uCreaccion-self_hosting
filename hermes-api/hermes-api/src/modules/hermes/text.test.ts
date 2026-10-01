import { describe, expect, it } from "vitest";
import { extractResponseText } from "./text.js";
import type { HermesResponse } from "./types.js";

function response(overrides: Partial<HermesResponse> = {}): HermesResponse {
    return {
        id: "r1",
        object: "response",
        status: "completed",
        created: 1,
        model: "hermes-agent",
        ...overrides,
    } as HermesResponse;
}

describe("extractResponseText", () => {
    it("prefers the flat output_text field", () => {
        expect(extractResponseText(response({ output_text: "hola" }))).toBe("hola");
    });

    it("extracts text from the nested output content (OpenAI Responses shape)", () => {
        const r = response({
            output: [
                {
                    type: "message",
                    role: "assistant",
                    content: [{ type: "output_text", text: "París" }],
                },
                {
                    type: "message",
                    role: "assistant",
                    content: [{ type: "output_text", text: " y 4" }],
                },
            ],
        });
        expect(extractResponseText(r)).toBe("París\n y 4");
    });

    it("returns an empty string when there is no text", () => {
        expect(extractResponseText(response({ output: [{ type: "message", content: [] }] }))).toBe(
            "",
        );
    });
});
