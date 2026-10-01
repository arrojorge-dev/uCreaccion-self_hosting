import fp from "fastify-plugin";

const replacer = (_key: string, value: unknown) => {
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    return value;
};

export const serializerPlugin = fp(async (app) => {
    app.setReplySerializer((payload) => {
        if (payload === undefined || payload === null) {
            return "";
        }
        if (typeof payload === "string") {
            return payload;
        }
        return JSON.stringify(payload, replacer);
    });
});
