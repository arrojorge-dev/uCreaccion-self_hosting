import fp from "fastify-plugin";

export const requestIdPlugin = fp(async (app) => {
    app.addHook("onSend", async (_request, reply) => {
        reply.header("x-request-id", reply.request.id);
    });
});
