import { AppError } from "../../common/errors/app-error.js";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import { NoopPushProvider, type PushProvider } from "./sender.js";
import type { CreateNotificationInput, NotificationDto } from "./types.js";

function toNotificationDto(notification: {
    id: string;
    type: string;
    title: string;
    body: string | null;
    payload: unknown;
    readAt: Date | null;
    createdAt: Date;
}): NotificationDto {
    return {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        payload: notification.payload ?? null,
        read: notification.readAt !== null,
        readAt: notification.readAt?.toISOString() ?? null,
        createdAt: notification.createdAt.toISOString(),
    };
}

export class NotificationsService {
    constructor(
        private readonly db: PrismaClient = prisma,
        private readonly push: PushProvider = new NoopPushProvider(),
    ) {}

    async create(userId: string, input: CreateNotificationInput): Promise<NotificationDto> {
        const notification = await this.db.notification.create({
            data: {
                userId,
                outboxMessageId: input.outboxMessageId ?? null,
                type: input.type,
                title: input.title,
                body: input.body ?? null,
                payload:
                    input.payload === undefined
                        ? undefined
                        : (input.payload as Prisma.InputJsonValue),
            },
        });
        try {
            await this.push.send(userId, {
                type: notification.type,
                title: notification.title,
                body: notification.body ?? undefined,
                payload: (notification.payload as Record<string, unknown> | null) ?? undefined,
            });
        } catch {
            // Push is best-effort; failures must not roll back the persisted notification.
        }
        return toNotificationDto(notification);
    }

    async list(userId: string, limit = 50): Promise<NotificationDto[]> {
        const notifications = await this.db.notification.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: limit,
        });
        return notifications.map(toNotificationDto);
    }

    async get(userId: string, id: string): Promise<NotificationDto> {
        const notification = await this.db.notification.findFirst({ where: { id, userId } });
        if (!notification) {
            throw AppError.notFound("Notification not found");
        }
        return toNotificationDto(notification);
    }

    async unreadCount(userId: string): Promise<number> {
        return this.db.notification.count({ where: { userId, readAt: null } });
    }

    async markRead(userId: string, id: string): Promise<NotificationDto> {
        const notification = await this.db.notification.findFirst({ where: { id, userId } });
        if (!notification) {
            throw AppError.notFound("Notification not found");
        }
        const updated = await this.db.notification.update({
            where: { id },
            data: { readAt: notification.readAt ?? new Date() },
        });
        return toNotificationDto(updated);
    }

    async markAllRead(userId: string): Promise<number> {
        const result = await this.db.notification.updateMany({
            where: { userId, readAt: null },
            data: { readAt: new Date() },
        });
        return result.count;
    }
}
