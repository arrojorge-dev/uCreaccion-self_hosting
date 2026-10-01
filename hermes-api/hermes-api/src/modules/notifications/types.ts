export interface CreateNotificationInput {
    type: string;
    title: string;
    body?: string;
    payload?: unknown;
    outboxMessageId?: string | null;
}

export interface NotificationDto {
    id: string;
    type: string;
    title: string;
    body: string | null;
    payload: unknown;
    read: boolean;
    readAt: string | null;
    createdAt: string;
}
