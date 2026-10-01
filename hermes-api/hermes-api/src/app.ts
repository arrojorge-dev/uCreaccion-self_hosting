import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import {
    serializerCompiler,
    validatorCompiler,
    type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { AppError } from "./common/errors/app-error.js";
import { env } from "./config/env.js";
import { secureCompare } from "./lib/crypto.js";
import { ApiKeysService, createApikeysRoutes } from "./modules/apikeys/index.js";
import { AuditService } from "./modules/audit/index.js";
import { AuthService, createAuthRoutes } from "./modules/auth/index.js";
import type { AuthenticatedUser } from "./modules/auth/types.js";
import { ConversationsService, createConversationsRoutes } from "./modules/conversations/index.js";
import { createDevicesRoutes, DevicesService } from "./modules/devices/index.js";
import {
    createHermesClient,
    createHermesModule,
    type HermesClient,
} from "./modules/hermes/index.js";
import { createNotificationsRoutes, NotificationsService } from "./modules/notifications/index.js";
import { PenaltyService } from "./modules/penalty/index.js";
import { createTasksRoutes, TasksService, taskEventBus } from "./modules/tasks/index.js";
import { createUsageService, type UsageService } from "./modules/usage/index.js";
import { createUsersRoutes, UsersService } from "./modules/users/index.js";
import { createWebhooksRoutes, WebhooksService } from "./modules/webhooks/index.js";
import { createAuthPlugin } from "./plugins/auth.js";
import { errorHandlerPlugin } from "./plugins/error-handler.js";
import { healthPlugin } from "./plugins/health.js";
import { createInfrastructurePlugin } from "./plugins/infrastructure.js";
import { loggerOptions } from "./plugins/logger.js";
import { createMetricsPlugin } from "./plugins/metrics.js";
import { registerRateLimit } from "./plugins/rate-limit.js";
import { requestIdPlugin } from "./plugins/request-id.js";
import { serializerPlugin } from "./plugins/serializer.js";

export interface BuildAppOptions {
    infrastructure?: boolean;
    hermesClient?: HermesClient;
    notificationsService?: NotificationsService;
    webhooksService?: WebhooksService;
    usageService?: UsageService;
    auditService?: AuditService;
    penaltyService?: PenaltyService;
    devicesService?: DevicesService;
    metrics?: boolean;
    resolveLocalUser?: () => Promise<AuthenticatedUser>;
}

const DOCS_USER = "docs";
const DOCS_PREFIX = "/documentation";

function checkDocsBasicAuth(request: FastifyRequest, reply: FastifyReply): void {
    if (!env.DOCS_SECRET) {
        return;
    }
    const header = request.headers.authorization;
    const valid =
        typeof header === "string" &&
        header.startsWith("Basic ") &&
        (() => {
            const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
            const separator = decoded.indexOf(":");
            if (separator === -1) {
                return false;
            }
            const user = decoded.slice(0, separator);
            const password = decoded.slice(separator + 1);
            return user === DOCS_USER && secureCompare(password, env.DOCS_SECRET);
        })();
    if (!valid) {
        reply.header("WWW-Authenticate", `Basic realm="hermes docs"`);
        throw AppError.unauthorized("Documentation requires credentials");
    }
}

function generateRequestId(request: {
    headers: Record<string, string | string[] | undefined>;
}): string {
    const incoming = request.headers["x-request-id"];
    const value = typeof incoming === "string" ? incoming : "";
    const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    return sanitized || randomUUID();
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
    const app = Fastify({
        logger: loggerOptions(),
        genReqId: generateRequestId,
        trustProxy: ["127.0.0.1", "::1"],
        bodyLimit: 10 * 1024 * 1024,
    }).withTypeProvider<ZodTypeProvider>();

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    app.register(cors, {
        origin: env.CORS_ORIGINS,
        methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Authorization", "Content-Type", "x-request-id"],
        credentials: false,
    });

    app.addHook("onRequest", async (request, reply) => {
        if (request.url.startsWith(DOCS_PREFIX)) {
            checkDocsBasicAuth(request, reply);
        }
    });

    app.register(swagger, {
        openapi: {
            info: {
                title: "Hermes API",
                description: "Backend de orquestación sobre Hermes Agent.",
                version: "1.0.0",
            },
        },
    });
    app.register(swaggerUI, { routePrefix: "/documentation" });

    app.register(createMetricsPlugin({ enabled: options.metrics }));
    app.register(requestIdPlugin);
    app.register(serializerPlugin);
    app.register(errorHandlerPlugin);
    app.register(healthPlugin);

    const usersService = new UsersService();
    const authService = new AuthService(usersService);
    const conversationsService = new ConversationsService();
    const notificationsService = options.notificationsService ?? new NotificationsService();
    const auditService = options.auditService ?? new AuditService();
    const webhooksService = options.webhooksService ?? new WebhooksService(undefined, auditService);
    const usageService = options.usageService ?? createUsageService();
    const penaltyService = options.penaltyService ?? new PenaltyService();
    const apiKeysService = new ApiKeysService(undefined, auditService);
    const devicesService = options.devicesService ?? new DevicesService();

    app.register(createAuthPlugin({ apiKeysService, resolveLocalUser: options.resolveLocalUser }));
    app.register(registerRateLimit);

    const hermesClient = options.hermesClient ?? createHermesClient();
    const tasksService = new TasksService(taskEventBus, conversationsService, {
        usage: usageService,
        audit: auditService,
        penalty: penaltyService,
    });
    app.register(createHermesModule({ client: hermesClient }), { prefix: env.API_BASE_PATH });
    app.register(createAuthRoutes(authService), { prefix: env.API_BASE_PATH });
    app.register(createUsersRoutes(usersService), { prefix: env.API_BASE_PATH });
    app.register(createApikeysRoutes(apiKeysService), { prefix: env.API_BASE_PATH });
    app.register(createTasksRoutes(tasksService), { prefix: env.API_BASE_PATH });
    app.register(createConversationsRoutes(conversationsService), { prefix: env.API_BASE_PATH });
    app.register(createNotificationsRoutes(notificationsService), { prefix: env.API_BASE_PATH });
    app.register(createWebhooksRoutes(webhooksService), { prefix: env.API_BASE_PATH });
    app.register(createDevicesRoutes(devicesService), { prefix: env.API_BASE_PATH });

    if (options.infrastructure !== false) {
        app.register(createInfrastructurePlugin({ hermesClient }));
    }

    return app;
}
