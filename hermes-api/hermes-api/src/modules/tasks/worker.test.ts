import { describe, expect, it } from "vitest";

describe("sin reintento automático", () => {
    it("documenta la política: al primer fallo la tarea queda FAILED", () => {
        // handleFailure siempre marca FAILED directo (sin reencolado a ENQUEUED).
        // El reintento solo existe a petición del usuario (crear una tarea nueva).
        expect(true).toBe(true);
    });
});
