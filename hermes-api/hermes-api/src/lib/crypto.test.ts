import { describe, expect, it } from "vitest";
import { hashPassword, randomToken, sha256Hex, verifyPassword } from "./crypto.js";

describe("password hashing", () => {
    it("hashes and verifies a password", async () => {
        const stored = await hashPassword("super-secret");
        expect(stored.startsWith("scrypt:")).toBe(true);
        expect(await verifyPassword("super-secret", stored)).toBe(true);
        expect(await verifyPassword("wrong", stored)).toBe(false);
    });

    it("uses a unique salt per hash", async () => {
        const first = await hashPassword("same");
        const second = await hashPassword("same");
        expect(first).not.toBe(second);
    });

    it("rejects malformed stored hashes", async () => {
        expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    });
});

describe("tokens", () => {
    it("sha256 is deterministic", () => {
        expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
        expect(sha256Hex("abc")).not.toBe(sha256Hex("abd"));
    });

    it("produces url-safe base64 tokens", () => {
        const token = randomToken(32);
        expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(token.length).toBeGreaterThanOrEqual(32);
    });
});
