import { describe, expect, it } from "vitest";
import { exponentialBackoffMs } from "./backoff.js";

describe("exponentialBackoffMs", () => {
    it("grows exponentially from the base", () => {
        expect(exponentialBackoffMs(1, 200, 60_000)).toBe(200);
        expect(exponentialBackoffMs(2, 200, 60_000)).toBe(400);
        expect(exponentialBackoffMs(3, 200, 60_000)).toBe(800);
        expect(exponentialBackoffMs(4, 200, 60_000)).toBe(1600);
    });

    it("caps at the max delay", () => {
        expect(exponentialBackoffMs(10, 200, 60_000)).toBe(60_000);
        expect(exponentialBackoffMs(20, 200, 60_000)).toBe(60_000);
    });
});
