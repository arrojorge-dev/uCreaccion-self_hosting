export interface CreatedApiKey {
    id: string;
    name: string;
    scopes: string[];
    key: string;
}

export interface ApiKeySummary {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
}

export interface ActiveApiKey {
    id: string;
    userId: string;
    scopes: string[];
}
