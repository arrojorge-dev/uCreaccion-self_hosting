import "dotenv/config";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { disconnectDatabase, prisma } from "../../src/lib/db.js";
import { HermesClient } from "../../src/modules/hermes/index.js";
import {
    NotificationsService,
    type PushNotification,
    type PushProvider,
} from "../../src/modules/notifications/index.js";
import { startMockServer } from "../helpers/mock-server.js";

class RecordingPushProvider implements PushProvider {
    readonly sent: Array<{ userId: string; notification: PushNotification }> = [];

    async send(userId: string, notification: PushNotification): Promise<void> {
        this.sent.push({ userId, notification });
    }
}

interface UserCtx {
    token: string;
    userId: string;
    nickname: string;
}

let app: FastifyInstance;
let push: RecordingPushProvider;
let notifications: NotificationsService;
let hermesMock: Awaited<ReturnType<typeof startMockServer>>;
const createdNicknames: string[] = [];

function bearer(token: string): { authorization: string } {
    return { authorization: `Bearer ${token}` };
}

function uniqueNickname(prefix: string): string {
    const nickname = `${prefix}-${Date.now().toString(36).slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
    createdNicknames.push(nickname);
    return nickname;
}

async function registerUser(prefix: string): Promise<UserCtx> {
    const response = await app.inject({
        method: "POST",
        url: "/api/v1/auth/register",
        payload: { nickname: uniqueNickname(prefix), password: "password-123" },
    });
    const body = response.json() as {
        user: { id: string; nickname: string };
        tokens: { accessToken: string };
    };
    return {
        token: body.tokens.accessToken,
        userId: body.user.id,
        nickname: body.user.nickname,
    };
}

beforeAll(async () => {
    await prisma.notification.deleteMany();
    await prisma.outboxMessage.deleteMany();
    hermesMock = await startMockServer(() => ({
        json: { id: "resp", status: "completed", output_text: "ok" },
    }));
    push = new RecordingPushProvider();
    notifications = new NotificationsService(undefined, push);
    const client = new HermesClient({
        baseUrl: hermesMock.url,
        apiKey: "test-key",
        retries: 0,
    });
    app = buildApp({ infrastructure: false, hermesClient: client, notificationsService: notifications });
    await app.ready();
});

afterAll(async () => {
    await app.close();
    await prisma.user.deleteMany({ where: { nickname: { in: createdNicknames } } });
    await prisma.notification.deleteMany();
    await prisma.outboxMessage.deleteMany();
    await disconnectDatabase();
    await hermesMock.close();
});

describe("notifications API", () => {
    it("lists notifications with unread state", async () => {
        const user = await registerUser("list");
        await notifications.create(user.userId, {
            type: "task.completed",
            title: "Tarea completada",
            body: "Listo.",
        });
        await notifications.create(user.userId, {
            type: "task.completed",
            title: "La tarea falló",
            body: "Ocurrió un error.",
        });

        const list = await app.inject({
            method: "GET",
            url: "/api/v1/notifications",
            headers: bearer(user.token),
        });
        expect(list.statusCode).toBe(200);
        const body = list.json() as Array<{ title: string; read: boolean }>;
        expect(body).toHaveLength(2);
        expect(body.every((item) => item.read === false)).toBe(true);

        const unread = await app.inject({
            method: "GET",
            url: "/api/v1/notifications/unread-count",
            headers: bearer(user.token),
        });
        expect(unread.json()).toEqual({ unread: 2 });
    });

    it("marks a notification as read", async () => {
        const user = await registerUser("read");
        const created = await notifications.create(user.userId, {
            type: "task.completed",
            title: "Tarea completada",
        });
        const mark = await app.inject({
            method: "PATCH",
            url: `/api/v1/notifications/${created.id}/read`,
            headers: bearer(user.token),
        });
        expect(mark.statusCode).toBe(200);
        expect((mark.json() as { read: boolean }).read).toBe(true);

        const unread = await app.inject({
            method: "GET",
            url: "/api/v1/notifications/unread-count",
            headers: bearer(user.token),
        });
        expect(unread.json()).toEqual({ unread: 0 });
    });

    it("marks all notifications as read and isolates by user", async () => {
        const owner = await registerUser("readall");
        const stranger = await registerUser("readall-stranger");
        await notifications.create(owner.userId, {
            type: "task.completed",
            title: "A",
        });
        await notifications.create(owner.userId, {
            type: "task.completed",
            title: "B",
        });
        await notifications.create(stranger.userId, {
            type: "task.completed",
            title: "S",
        });

        const markAll = await app.inject({
            method: "PATCH",
            url: "/api/v1/notifications/read-all",
            headers: bearer(owner.token),
        });
        expect(markAll.statusCode).toBe(204);

        const ownerUnread = await app.inject({
            method: "GET",
            url: "/api/v1/notifications/unread-count",
            headers: bearer(owner.token),
        });
        expect(ownerUnread.json()).toEqual({ unread: 0 });

        const strangerUnread = await app.inject({
            method: "GET",
            url: "/api/v1/notifications/unread-count",
            headers: bearer(stranger.token),
        });
        expect(strangerUnread.json()).toEqual({ unread: 1 });
    });

    it("does not expose another user's notification", async () => {
        const owner = await registerUser("iso-notif");
        const stranger = await registerUser("iso-notif-stranger");
        const created = await notifications.create(owner.userId, {
            type: "task.completed",
            title: "Privada",
        });
        const res = await app.inject({
            method: "GET",
            url: `/api/v1/notifications/${created.id}`,
            headers: bearer(stranger.token),
        });
        expect(res.statusCode).toBe(404);
    });

    it("invokes the push provider on creation", async () => {
        const user = await registerUser("push");
        push.sent.length = 0;
        await notifications.create(user.userId, {
            type: "task.completed",
            title: "Push me",
            body: "Hello",
        });
        expect(push.sent).toHaveLength(1);
        expect(push.sent[0]).toMatchObject({
            userId: user.userId,
            notification: { type: "task.completed", title: "Push me", body: "Hello" },
        });
    });
});
