import { describe, expect, it } from "vitest";
import { evaluateQuota } from "./quotas.js";

describe("evaluateQuota", () => {
    it("allows usage within the limits", () => {
        expect(
            evaluateQuota(
                { requests: 4, tokens: 100 },
                {
                    requestsPerWindow: 10,
                    tokensPerWindow: 1000,
                },
            ),
        ).toEqual({ allowed: true, reason: null });
    });

    it("denies when requests reach the limit", () => {
        expect(
            evaluateQuota(
                { requests: 10, tokens: 100 },
                {
                    requestsPerWindow: 10,
                    tokensPerWindow: 1000,
                },
            ),
        ).toEqual({ allowed: false, reason: "requests" });
    });

    it("denies when tokens reach the limit", () => {
        expect(
            evaluateQuota(
                { requests: 0, tokens: 1000 },
                {
                    requestsPerWindow: 10,
                    tokensPerWindow: 1000,
                },
            ),
        ).toEqual({ allowed: false, reason: "tokens" });
    });

    it("treats null limits as unlimited", () => {
        expect(
            evaluateQuota(
                { requests: 999, tokens: 9999 },
                {
                    requestsPerWindow: null,
                    tokensPerWindow: null,
                },
            ),
        ).toEqual({ allowed: true, reason: null });
    });
});
