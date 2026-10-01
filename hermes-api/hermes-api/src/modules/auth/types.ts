import type { PublicUser } from "../users/types.js";

export interface TokenPair {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    tokenType: "Bearer";
}

export interface AuthResult {
    user: PublicUser;
    tokens: TokenPair;
}

export interface AuthContext {
    ip: string | null;
    userAgent: string | null;
}

export interface AuthenticatedUser {
    type: "user" | "apiKey";
    userId: string;
    nickname?: string;
    apiKeyId?: string;
    scopes: string[];
}
