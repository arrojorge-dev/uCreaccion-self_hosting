import type { HermesResponse } from "./types.js";

export function extractResponseText(response: HermesResponse): string {
    if (typeof response.output_text === "string" && response.output_text.length > 0) {
        return response.output_text;
    }
    const parts: string[] = [];
    for (const item of response.output ?? []) {
        for (const part of item.content ?? []) {
            if (typeof part.text === "string" && part.text.length > 0) {
                parts.push(part.text);
            }
        }
    }
    return parts.join("\n");
}
