import { describe, expect, it } from "vitest";
import { parseDurationSeconds } from "./time.js";

describe("parseDurationSeconds", () => {
    it("parses supported units", () => {
        expect(parseDurationSeconds("45s")).toBe(45);
        expect(parseDurationSeconds("15m")).toBe(900);
        expect(parseDurationSeconds("2h")).toBe(7200);
        expect(parseDurationSeconds("30d")).toBe(2_592_000);
    });

    it("rejects invalid formats", () => {
        expect(() => parseDurationSeconds("30")).toThrow();
        expect(() => parseDurationSeconds("10x")).toThrow();
        expect(() => parseDurationSeconds("")).toThrow();
    });
});
