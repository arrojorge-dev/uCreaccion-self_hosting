import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { AuditService } from "./modules/audit/index.js";
import { createHermesClient } from "./modules/hermes/index.js";
import {
    ApnsPushProvider,
    createPushProvider,
    NotificationsService,
} from "./modules/notifications/index.js";
import { createTaskCompletedHandler, OutboxDispatcher } from "./modules/outbox/index.js";
import { PenaltyService } from "./modules/penalty/index.js";
import { TaskWorker, taskEventBus } from "./modules/tasks/index.js";
import { createUsageService } from "./modules/usage/index.js";
import { WebhookSender, WebhooksService } from "./modules/webhooks/index.js";

const hermesClient = createHermesClient();
const pushProvider = createPushProvider();
const notificationsService = new NotificationsService(undefined, pushProvider);
const webhooksService = new WebhooksService(undefined, new AuditService());
const usageService = createUsageService();
const auditService = new AuditService();
const penaltyService = new PenaltyService();
const app = buildApp({
    hermesClient,
    notificationsService,
    webhooksService,
    usageService,
    auditService,
    penaltyService,
});
if (pushProvider instanceof ApnsPushProvider) {
    pushProvider.logger = app.log;
}

const worker = new TaskWorker({
    client: hermesClient,
    bus: taskEventBus,
    logger: app.log,
    usage: usageService,
    penalty: penaltyService,
});
const outboxDispatcher = new OutboxDispatcher({
    handlers: {
        "task.completed": createTaskCompletedHandler({
            notifications: notificationsService,
            webhooks: webhooksService,
        }),
    },
    logger: app.log,
    pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
    maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
    retryBaseMs: env.OUTBOX_RETRY_BASE_MS,
});
const webhookSender = new WebhookSender({
    logger: app.log,
    maxAttempts: env.WEBHOOK_MAX_ATTEMPTS,
    retryBaseMs: env.WEBHOOK_RETRY_BASE_MS,
    timeoutMs: env.WEBHOOK_TIMEOUT_MS,
});

worker.start();
outboxDispatcher.start();
webhookSender.start();

async function start(): Promise<void> {
    try {
        await app.listen({ host: env.HOST, port: env.PORT });
    } catch (error) {
        app.log.fatal({ err: error }, "failed to start server");
        process.exit(1);
    }
}

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    try {
        await Promise.all([worker.stop(), outboxDispatcher.stop(), webhookSender.stop()]);
        if (pushProvider instanceof ApnsPushProvider) {
            await pushProvider.close();
        }
        await app.close();
        app.log.info("shutdown complete");
        process.exit(0);
    } catch (error) {
        app.log.error({ err: error }, "error during shutdown");
        process.exit(1);
    }
}

process.on("SIGINT", () => {
    void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
});

void start();
