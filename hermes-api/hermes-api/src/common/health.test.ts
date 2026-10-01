import { describe, expect, it } from "vitest";
import { createHealthRegistry } from "./health.js";

describe("HealthRegistry", () => {
    it("reports ok when all checks pass", async () => {
        const registry = createHealthRegistry();
        registry.register({ name: "a", check: () => undefined });
        registry.register({ name: "b", check: async () => {} });
        const result = await registry.run();
        expect(result.status).toBe("ok");
        expect(result.checks).toHaveLength(2);
    });

    it("reports error and captures the failing check", async () => {
        const registry = createHealthRegistry();
        registry.register({ name: "a", check: () => undefined });
        registry.register({
            name: "db",
            check: () => {
                throw new Error("connection refused");
            },
        });
        const result = await registry.run();
        expect(result.status).toBe("error");
        expect(result.checks.find((check) => check.name === "db")).toMatchObject({
            ok: false,
            error: "connection refused",
        });
    });
});
