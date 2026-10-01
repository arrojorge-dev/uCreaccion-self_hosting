import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { scopes } from "../../common/scopes.js";
import type { TaskStatus } from "../../generated/prisma/client.js";
import { closeSseStream, heartbeatSse, openSseStream, writeSseEvent } from "../../lib/sse.js";
import { auditSourceFrom, getAuthenticatedUser } from "../../plugins/auth.js";
import { createTaskSchema, streamQuerySchema, taskDtoSchema, taskIdParamsSchema } from "./dto.js";
import { type TaskEventBus, taskEventBus } from "./event-bus.js";
import { isFinalStatus, type TasksService } from "./service.js";
import { isFinalEvent, type TaskDto } from "./types.js";

function taskStatusEvent(status: TaskStatus): string {
    switch (status) {
        case "RUNNING":
            return "task.running";
        case "SUCCEEDED":
            return "task.succeeded";
        case "FAILED":
            return "task.failed";
        case "CANCELLED":
            return "task.cancelled";
        default:
            return "task.queued";
    }
}

function attachTaskStream(
    reply: FastifyReply,
    request: FastifyRequest,
    task: TaskDto,
    bus: TaskEventBus,
): void {
    openSseStream(reply);
    let closed = false;
    let unsubscribe: () => void = () => undefined;
    let heartbeat: NodeJS.Timeout | undefined;

    function closeAndCleanup(): void {
        if (closed) {
            return;
        }
        closed = true;
        if (heartbeat) {
            clearInterval(heartbeat);
        }
        unsubscribe();
        closeSseStream(reply);
    }

    unsubscribe = bus.subscribe(task.id, (event) => {
        if (closed) {
            return;
        }
        writeSseEvent(reply, { event: event.type, data: event });
        if (isFinalEvent(event)) {
            closeAndCleanup();
        }
    });

    request.raw.on("close", closeAndCleanup);
    heartbeat = setInterval(() => heartbeatSse(reply), 15_000);

    if (closed) {
        unsubscribe();
    }

    if (!closed && isFinalStatus(task.status)) {
        const event = taskStatusEvent(task.status);
        writeSseEvent(reply, { event, data: { type: event, task } });
        closeAndCleanup();
    }
}

export function createTasksRoutes(service: TasksService): FastifyPluginAsyncZod {
    return async (app) => {
        app.post(
            "/tasks",
            {
                schema: {
                    body: createTaskSchema,
                    querystring: streamQuerySchema,
                    response: { 200: taskDtoSchema, 201: taskDtoSchema },
                },
                config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
                preHandler: [app.requireAuth, app.requireScope(scopes.tasksWrite)],
            },
            async (request, reply) => {
                const auth = getAuthenticatedUser(request);
                const body =
                    !request.body.token && !request.body.api_key && request.llmToken
                        ? { ...request.body, token: request.llmToken }
                        : request.body;
                const result = await service.create(auth.userId, body, auditSourceFrom(request));
                const stream = request.body.stream === true || request.query.stream === "true";
                if (stream) {
                    attachTaskStream(reply, request, result.task, taskEventBus);
                    return;
                }
                reply.status(result.created ? 201 : 200).send(result.task);
            },
        );

        app.get(
            "/tasks",
            {
                schema: {
                    response: { 200: z.array(taskDtoSchema) },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.tasksRead)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                return service.list(auth.userId);
            },
        );

        app.get(
            "/tasks/:id",
            {
                schema: {
                    params: taskIdParamsSchema,
                    response: { 200: taskDtoSchema },
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.tasksRead)],
            },
            async (request) => {
                const auth = getAuthenticatedUser(request);
                return service.get(auth.userId, request.params.id);
            },
        );

        app.get(
            "/tasks/:id/events",
            {
                schema: {
                    params: taskIdParamsSchema,
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.tasksRead)],
            },
            async (request, reply) => {
                const auth = getAuthenticatedUser(request);
                const dto = await service.get(auth.userId, request.params.id);
                attachTaskStream(reply, request, dto, taskEventBus);
            },
        );

        app.post(
            "/tasks/:id/cancel",
            {
                schema: {
                    params: taskIdParamsSchema,
                },
                preHandler: [app.requireAuth, app.requireScope(scopes.tasksWrite)],
            },
            async (request, reply) => {
                const auth = getAuthenticatedUser(request);
                await service.cancel(auth.userId, request.params.id, auditSourceFrom(request));
                return reply.status(204).send();
            },
        );
    };
}
