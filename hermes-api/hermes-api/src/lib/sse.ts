import type { FastifyReply } from "fastify";

export interface SseEvent {
    event?: string;
    data: unknown;
}

export function openSseStream(reply: FastifyReply): void {
    reply.hijack();
    reply.raw.setHeader("x-request-id", reply.request.id);
    reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
    });
}

export function writeSseEvent(reply: FastifyReply, message: SseEvent): void {
    const lines = [`data: ${JSON.stringify(message.data)}`];
    if (message.event) {
        lines.unshift(`event: ${message.event}`);
    }
    reply.raw.write(`${lines.join("\n")}\n\n`);
}

export function heartbeatSse(reply: FastifyReply): void {
    reply.raw.write(": keep-alive\n\n");
}

export function closeSseStream(reply: FastifyReply): void {
    reply.raw.end();
}
