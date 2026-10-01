import { describe, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken } from "./jwt.js";

describe("access tokens", () => {
    it("signs and verifies a token", async () => {
        const token = await signAccessToken({ id: "user-1", nickname: "jorge" });
        const payload = await verifyAccessToken(token);
        expect(payload.sub).toBe("user-1");
        expect(payload.nickname).toBe("jorge");
    });

    it("rejects a tampered token", async () => {
        const token = await signAccessToken({ id: "user-1", nickname: "jorge" });
        await expect(verifyAccessToken(`${token}x`)).rejects.toThrow();
    });

    it("rejects garbage", async () => {
        await expect(verifyAccessToken("not-a-jwt")).rejects.toThrow();
    });
});
