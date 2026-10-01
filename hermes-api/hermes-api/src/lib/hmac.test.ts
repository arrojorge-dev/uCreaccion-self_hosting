import { describe, expect, it } from "vitest";
import { hmacSha256Hex, signWebhookPayload, verifyWebhookSignature } from "./hmac.js";

describe("signWebhookPayload", () => {
    it("produces the expected sha256 HMAC prefix", () => {
        const signature = signWebhookPayload("secret", '{"a":1}');
        expect(signature.startsWith("sha256=")).toBe(true);
        expect(signature.length).toBe(7 + 64);
        expect(signature.slice(7)).toBe(hmacSha256Hex("secret", '{"a":1}'));
    });

    it("verifies a valid signature", () => {
        const signature = signWebhookPayload("s3cret", '{"event":"task.completed"}');
        expect(verifyWebhookSignature("s3cret", '{"event":"task.completed"}', signature)).toBe(
            true,
        );
    });

    it("rejects a tampered body or wrong secret", () => {
        const signature = signWebhookPayload("s3cret", '{"event":"task.completed"}');
        expect(verifyWebhookSignature("s3cret", '{"event":"task.failed"}', signature)).toBe(false);
        expect(verifyWebhookSignature("other", '{"event":"task.completed"}', signature)).toBe(
            false,
        );
    });
});
