export interface PushNotification {
    type: string;
    title: string;
    body?: string;
    payload?: unknown;
}

export interface PushProvider {
    send(userId: string, notification: PushNotification): Promise<void>;
}

export class NoopPushProvider implements PushProvider {
    async send(): Promise<void> {}
}
