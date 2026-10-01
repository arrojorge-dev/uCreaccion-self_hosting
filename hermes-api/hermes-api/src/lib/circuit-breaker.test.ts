import { describe, expect, it } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
    it("passes successful calls through and stays closed", async () => {
        const breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
        let calls = 0;
        const result = await breaker.call(async () => {
            calls += 1;
            return "ok";
        });
        expect(result).toBe("ok");
        expect(calls).toBe(1);
        expect(breaker.state).toBe("closed");
    });

    it("opens after the failure threshold and rejects fast while open", async () => {
        const now = 0;
        const breaker = new CircuitBreaker({
            failureThreshold: 3,
            cooldownMs: 1000,
            now: () => now,
        });
        for (let i = 0; i < 3; i++) {
            await expect(
                breaker.call(async () => Promise.reject(new Error("boom"))),
            ).rejects.toThrow("boom");
        }
        expect(breaker.state).toBe("open");
        await expect(breaker.call(async () => "ok")).rejects.toBeInstanceOf(CircuitOpenError);
    });

    it("recovers through half-open after the cooldown", async () => {
        let now = 0;
        const breaker = new CircuitBreaker({
            failureThreshold: 2,
            cooldownMs: 1000,
            now: () => now,
        });
        for (let i = 0; i < 2; i++) {
            await expect(
                breaker.call(async () => Promise.reject(new Error("x"))),
            ).rejects.toThrow();
        }
        expect(breaker.state).toBe("open");
        now = 1001;
        expect(breaker.state).toBe("half_open");
        const result = await breaker.call(async () => "recovered");
        expect(result).toBe("recovered");
        expect(breaker.state).toBe("closed");
    });

    it("reopens after a failed half-open trial", async () => {
        let now = 0;
        const breaker = new CircuitBreaker({
            failureThreshold: 1,
            cooldownMs: 1000,
            now: () => now,
        });
        await expect(breaker.call(async () => Promise.reject(new Error("down")))).rejects.toThrow();
        now = 1001;
        await expect(
            breaker.call(async () => Promise.reject(new Error("still down"))),
        ).rejects.toThrow("still down");
        expect(breaker.state).toBe("open");
    });
});
