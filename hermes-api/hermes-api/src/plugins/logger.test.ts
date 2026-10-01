import { describe, expect, it } from "vitest";
import { CENSORED, logFormatter } from "./logger.js";

describe("logger redaction", () => {
    it("redacts secret keys by copying nested objects without mutating them", () => {
        const nestedUser = { passwordHash: "hash", id: 1 };
        const input = { password: "hunter2", user: nestedUser, email: "user@example.com" };
        const output = logFormatter(input);
        expect(output.password).toBe(CENSORED);
        expect(output.user).toEqual({ passwordHash: CENSORED, id: 1 });
        expect(output.email).toBe("user@example.com");
        expect(nestedUser).toEqual({ passwordHash: "hash", id: 1 });
    });

    it("does not touch Fastify-serialized keys (req/res/err)", () => {
        const req = { headers: { authorization: "Bearer x", "x-api-key": "k" } };
        const output = logFormatter({ req, email: "a@b.c" });
        expect(output.req).toBe(req);
        expect(output.req).toEqual({ headers: { authorization: "Bearer x", "x-api-key": "k" } });
        expect(output.email).toBe("a@b.c");
    });

    it("redacts secrets nested inside arrays", () => {
        const output = logFormatter({ items: [{ refreshToken: "rt", id: 1 }] });
        expect(output.items).toEqual([{ refreshToken: CENSORED, id: 1 }]);
    });
});
