import { describe, expect, it } from "vitest";
import { AppError } from "./app-error.js";
import { toErrorResponse, toHttpStatus } from "./http.js";

describe("toHttpStatus", () => {
    it("uses the AppError statusCode", () => {
        expect(toHttpStatus(AppError.notFound("nope"))).toBe(404);
        expect(toHttpStatus(AppError.unauthorized())).toBe(401);
    });

    it("defaults unknown errors to 500", () => {
        expect(toHttpStatus(new Error("boom"))).toBe(500);
    });
});

describe("toErrorResponse", () => {
    it("returns AppError fields with requestId", () => {
        const body = toErrorResponse(AppError.conflict("exists", { id: 1 }), "req-1");
        expect(body.error.code).toBe("CONFLICT");
        expect(body.error.message).toBe("exists");
        expect(body.error.requestId).toBe("req-1");
        expect(body.error.details).toEqual({ id: 1 });
    });

    it("hides internal error details", () => {
        const body = toErrorResponse(new Error("secret"), "req-1");
        expect(body.error.code).toBe("INTERNAL_ERROR");
        expect(body.error.message).toBe("Internal server error");
        expect(JSON.stringify(body)).not.toContain("secret");
    });
});
