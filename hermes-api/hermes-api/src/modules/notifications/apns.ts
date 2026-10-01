import http2 from "node:http2";
import { importPKCS8, SignJWT } from "jose";
import { env } from "../../config/env.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import { NoopPushProvider, type PushNotification, type PushProvider } from "./sender.js";

const APNS_HOSTS = {
    sandbox: "https://api.sandbox.push.apple.com",
    production: "https://api.push.apple.com",
} as const;

export const APNS_MAX_PAYLOAD_BYTES = 4096;
const TASK_COMPLETED_TYPE = "task.completed";
const PUSH_STATUSES = ["SUCCEEDED", "FAILED"] as const;
// Apple permite JWT válidos hasta 60 min; rotamos a los 50 min con margen de seguridad.
const JWT_REFRESH_MS = 50 * 60 * 1000;
const JWT_TTL_SECONDS = 55 * 60;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 1_000;
const INVALID_TOKEN_REASONS = new Set(["BadDeviceToken", "Unregistered"]);

export interface ApnsLogger {
    error(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
}

const noopLogger: ApnsLogger = {
    error: () => undefined,
    warn: () => undefined,
};

export interface ApnsResponse {
    status: number;
    body: string;
}

export interface ApnsTransport {
    send(
        deviceToken: string,
        payloadJson: string,
        jwt: string,
        collapseId?: string,
    ): Promise<ApnsResponse>;
    close(): Promise<void>;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateForLog(value: string, max = 200): string {
    return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function buildApnsPayload(input: {
    title: string;
    body?: string;
    badge: number;
    taskId?: string;
    status: string;
}): string {
    const serialize = (body?: string): string =>
        JSON.stringify({
            aps: {
                alert: body === undefined ? { title: input.title } : { title: input.title, body },
                sound: "default",
                badge: input.badge,
                "content-available": 1,
            },
            ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
            status: input.status,
        });

    let body = input.body;
    for (;;) {
        const payload = serialize(body);
        const payloadBytes = Buffer.byteLength(payload, "utf8");
        if (payloadBytes <= APNS_MAX_PAYLOAD_BYTES) {
            return payload;
        }
        if (body === undefined) {
            return payload;
        }
        // Recorte consciente de bytes: en texto multibyte el exceso en bytes no equivale
        // a caracteres; estimar con la media de bytes/caracter conserva el máximo body.
        const excess = payloadBytes - APNS_MAX_PAYLOAD_BYTES;
        const avgBytesPerChar = Buffer.byteLength(body, "utf8") / body.length;
        const charsToRemove = Math.ceil(excess / avgBytesPerChar) + 1;
        const keep = body.length - charsToRemove;
        body = keep > 0 ? `${body.slice(0, keep)}…` : undefined;
    }
}

export class Http2ApnsTransport implements ApnsTransport {
    private session: http2.ClientHttp2Session | null = null;
    private readonly host: string;
    private readonly topic: string;
    private readonly requestTimeoutMs: number;
    private readonly connectFn: (authority: string) => http2.ClientHttp2Session;

    constructor(options: {
        host: string;
        topic: string;
        requestTimeoutMs?: number;
        connectFn?: (authority: string) => http2.ClientHttp2Session;
    }) {
        this.host = options.host;
        this.topic = options.topic;
        this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
        this.connectFn = options.connectFn ?? http2.connect;
    }

    async send(
        deviceToken: string,
        payloadJson: string,
        jwt: string,
        collapseId?: string,
    ): Promise<ApnsResponse> {
        const session = this.getSession();
        const requestTimeoutMs = this.requestTimeoutMs;
        return await new Promise<ApnsResponse>((resolve, reject) => {
            const headers: http2.OutgoingHttpHeaders = {
                ":method": "POST",
                ":path": `/3/device/${deviceToken}`,
                authorization: `bearer ${jwt}`,
                "apns-topic": this.topic,
                "apns-push-type": "alert",
                "apns-priority": "10",
                "content-type": "application/json",
            };
            if (collapseId) {
                headers["apns-collapse-id"] = collapseId;
            }
            const req = session.request(headers);
            const timer = setTimeout(() => {
                req.close(http2.constants.NGHTTP2_CANCEL);
                reject(new Error(`apns request timed out after ${requestTimeoutMs}ms`));
            }, requestTimeoutMs);
            let status = 0;
            const chunks: string[] = [];
            req.setEncoding("utf8");
            req.on("response", (responseHeaders) => {
                status = Number(responseHeaders[":status"] ?? 0);
            });
            req.on("data", (chunk) => {
                chunks.push(String(chunk));
            });
            req.on("end", () => {
                clearTimeout(timer);
                resolve({ status, body: chunks.join("") });
            });
            req.on("error", (error) => {
                clearTimeout(timer);
                this.session = null;
                reject(error);
            });
            req.end(payloadJson);
        });
    }

    async close(): Promise<void> {
        const session = this.session;
        this.session = null;
        session?.close();
    }

    private getSession(): http2.ClientHttp2Session {
        if (this.session && !this.session.destroyed && !this.session.closed) {
            return this.session;
        }
        const session = this.connectFn(this.host);
        session.on("error", () => {
            if (this.session === session) {
                this.session = null;
            }
        });
        session.on("close", () => {
            if (this.session === session) {
                this.session = null;
            }
        });
        this.session = session;
        return session;
    }
}

export interface ApnsPushProviderOptions {
    db?: PrismaClient;
    transport: ApnsTransport;
    apnsEnv?: "sandbox" | "production";
    keyP8: string;
    keyId: string;
    teamId: string;
    logger?: ApnsLogger;
    retryDelayMs?: number;
    jwtRefreshMs?: number;
    now?: () => number;
}

export class ApnsPushProvider implements PushProvider {
    logger: ApnsLogger;
    private readonly db: PrismaClient;
    private readonly transport: ApnsTransport;
    private readonly apnsEnv: "sandbox" | "production";
    private readonly keyP8: string;
    private readonly keyId: string;
    private readonly teamId: string;
    private readonly retryDelayMs: number;
    private readonly jwtRefreshMs: number;
    private readonly nowFn: () => number;
    private signingKey: CryptoKey | null = null;
    private jwtCache: { token: string; issuedAt: number } | null = null;

    constructor(options: ApnsPushProviderOptions) {
        this.db = options.db ?? prisma;
        this.transport = options.transport;
        this.apnsEnv = options.apnsEnv ?? env.APNS_ENV;
        this.keyP8 = options.keyP8;
        this.keyId = options.keyId;
        this.teamId = options.teamId;
        this.logger = options.logger ?? noopLogger;
        this.retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
        this.jwtRefreshMs = options.jwtRefreshMs ?? JWT_REFRESH_MS;
        this.nowFn = options.now ?? Date.now;
    }

    async send(userId: string, notification: PushNotification): Promise<void> {
        if (notification.type !== TASK_COMPLETED_TYPE) {
            return;
        }
        const meta = notification.payload as { taskId?: string; status?: string } | undefined;
        const status = meta?.status;
        // Solo SUCCEEDED/FAILED: nunca CANCELLED (el worker tampoco lo encola, doble guard).
        if (status === undefined || !(PUSH_STATUSES as readonly string[]).includes(status)) {
            return;
        }
        const devices = await this.db.deviceToken.findMany({
            where: { env: this.apnsEnv },
            select: { token: true },
        });
        if (devices.length === 0) {
            return;
        }
        const jwt = await this.getJwt();
        const badge = await this.db.notification.count({ where: { userId, readAt: null } });
        const payloadJson = buildApnsPayload({
            title: notification.title,
            body: notification.body,
            badge,
            taskId: meta?.taskId,
            status,
        });
        for (const device of devices) {
            try {
                await this.deliver(device.token, payloadJson, jwt, meta?.taskId);
            } catch (error) {
                this.logger.warn(
                    { err: error, deviceTokenPrefix: device.token.slice(0, 8) },
                    "apns push failed",
                );
            }
        }
    }

    async close(): Promise<void> {
        await this.transport.close();
    }

    private async deliver(
        token: string,
        payloadJson: string,
        jwt: string,
        collapseId?: string,
    ): Promise<void> {
        let response: ApnsResponse;
        try {
            response = await this.transport.send(token, payloadJson, jwt, collapseId);
        } catch (firstError) {
            // Error de red/timeout: un único reintento.
            await sleep(this.retryDelayMs);
            try {
                response = await this.transport.send(token, payloadJson, jwt, collapseId);
            } catch {
                throw firstError;
            }
        }
        if (response.status === 200) {
            return;
        }
        if (await this.handleInvalidToken(token, response)) {
            return;
        }
        if (response.status === 429 || response.status >= 500) {
            await sleep(this.retryDelayMs);
            const retry = await this.transport.send(token, payloadJson, jwt, collapseId);
            if (retry.status === 200) {
                return;
            }
            if (await this.handleInvalidToken(token, retry)) {
                return;
            }
            throw new Error(`apns responded ${retry.status}: ${truncateForLog(retry.body)}`);
        }
        throw new Error(`apns responded ${response.status}: ${truncateForLog(response.body)}`);
    }

    private async handleInvalidToken(token: string, response: ApnsResponse): Promise<boolean> {
        let reason: string | undefined;
        try {
            const parsed = JSON.parse(response.body) as { reason?: string };
            reason = parsed.reason;
        } catch {
            reason = undefined;
        }
        const invalid =
            response.status === 410 ||
            (response.status === 400 &&
                reason !== undefined &&
                INVALID_TOKEN_REASONS.has(reason)) ||
            (reason !== undefined && INVALID_TOKEN_REASONS.has(reason));
        if (!invalid) {
            return false;
        }
        await this.db.deviceToken.deleteMany({ where: { token } });
        this.logger.warn(
            { deviceTokenPrefix: token.slice(0, 8), status: response.status, reason },
            "apns token invalidado; eliminado de DeviceToken",
        );
        return true;
    }

    private async getJwt(): Promise<string> {
        const now = this.nowFn();
        if (this.jwtCache && now - this.jwtCache.issuedAt < this.jwtRefreshMs) {
            return this.jwtCache.token;
        }
        this.signingKey ??= await importPKCS8(this.keyP8, "ES256");
        const issuedAtSeconds = Math.floor(now / 1000);
        const token = await new SignJWT({})
            .setProtectedHeader({ alg: "ES256", kid: this.keyId })
            .setIssuedAt(issuedAtSeconds)
            .setIssuer(this.teamId)
            .setExpirationTime(issuedAtSeconds + JWT_TTL_SECONDS)
            .sign(this.signingKey);
        this.jwtCache = { token, issuedAt: now };
        return token;
    }
}

export function createPushProvider(
    options: { db?: PrismaClient; logger?: ApnsLogger } = {},
): PushProvider {
    const logger = options.logger ?? noopLogger;
    if (!env.APNS_KEY_P8 || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) {
        logger.warn(
            {},
            "APNS_KEY_P8/APNS_KEY_ID/APNS_TEAM_ID sin configurar: push APNs desactivado",
        );
        return new NoopPushProvider();
    }
    const transport = new Http2ApnsTransport({
        host: APNS_HOSTS[env.APNS_ENV],
        topic: env.APNS_TOPIC,
    });
    return new ApnsPushProvider({
        db: options.db,
        transport,
        apnsEnv: env.APNS_ENV,
        keyP8: env.APNS_KEY_P8,
        keyId: env.APNS_KEY_ID,
        teamId: env.APNS_TEAM_ID,
        logger,
    });
}
