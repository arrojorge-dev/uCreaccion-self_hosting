import { validatorCompiler, type ZodTypeProvider } from "@fastify/type-provider-zod";
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorHandlerPlugin } from "./error-handler.js";
import { requestIdPlugin } from "./request-id.js";

const echoSchema = z.object({
    name: z.string().min(1),
});

async function buildTestApp(): Promise<FastifyInstance> {
    const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    await app.register(requestIdPlugin);
    await app.register(errorHandlerPlugin);
    app.post("/echo", { schema: { body: echoSchema } }, async (request) => {
        return { name: request.body.name };
    });
    return app;
}

describe("fastify-type-provider-zod integration", () => {
    it("accepts a valid body", async () => {
        const app = await buildTestApp();
        await app.ready();
        const response = await app.inject({
            method: "POST",
            url: "/echo",
            payload: { name: "ok" },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ name: "ok" });
        await app.close();
    });

    it("rejects an invalid body with our error shape", async () => {
        const app = await buildTestApp();
        await app.ready();
        const response = await app.inject({
            method: "POST",
            url: "/echo",
            payload: { name: "" },
        });
        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.error.code).toBe("VALIDATION_ERROR");
        expect(typeof body.error.requestId).toBe("string");
        await app.close();
    });
});
