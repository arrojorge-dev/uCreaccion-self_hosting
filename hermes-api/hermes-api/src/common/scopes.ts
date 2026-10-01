export const scopes = {
    profileRead: "profile:read",
    profileWrite: "profile:write",
    apikeysRead: "apikeys:read",
    apikeysWrite: "apikeys:write",
    tasksRead: "tasks:read",
    tasksWrite: "tasks:write",
    conversationsRead: "conversations:read",
    conversationsWrite: "conversations:write",
    webhooksRead: "webhooks:read",
    webhooksWrite: "webhooks:write",
    notificationsRead: "notifications:read",
    notificationsWrite: "notifications:write",
    metricsRead: "metrics:read",
} as const;

export type Scope = (typeof scopes)[keyof typeof scopes];
