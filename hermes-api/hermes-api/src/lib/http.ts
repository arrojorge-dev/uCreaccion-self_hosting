import { Readable } from "node:stream";
import { request } from "undici";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class HttpError extends Error {
    readonly status: number;
    readonly statusText: string;
    readonly bodyText: string;
    readonly url: string;

    constructor(options: {
        status: number;
        statusText: string;
        bodyText: string;
        url: string;
        cause?: unknown;
    }) {
        super(`HTTP ${options.status} ${options.statusText} for ${options.url}`, {
            cause: options.cause,
        });
        this.name = "HttpError";
        this.status = options.status;
        this.statusText = options.statusText;
        this.bodyText = options.bodyText;
        this.url = options.url;
    }

    get retryable(): boolean {
        return RETRYABLE_STATUS.has(this.status);
    }
}

export class RequestTimeoutError extends Error {
    readonly url: string;

    constructor(url: string) {
        super(`Request timed out: ${url}`);
        this.name = "RequestTimeoutError";
        this.url = url;
    }
}

export class MalformedResponseError extends Error {
    readonly url: string;

    constructor(url: string, cause: unknown) {
        super(`Malformed response from ${url}`, { cause });
        this.name = "MalformedResponseError";
        this.url = url;
    }
}

export interface HttpClientOptions {
    baseUrl: string;
    timeoutMs?: number;
    retries?: number;
    headers?: Record<string, string>;
}

export interface HttpRequestOptions {
    headers?: Record<string, string>;
    query?: Record<string, string>;
    signal?: AbortSignal;
    retries?: number;
}

export interface HttpResponseBody {
    status: number;
    url: string;
    body: string;
}

export interface HttpClient {
    get<T>(path: string, options?: HttpRequestOptions): Promise<T>;
    post<T>(path: string, body: unknown, options?: HttpRequestOptions): Promise<T>;
    postRaw(path: string, body: unknown, options?: HttpRequestOptions): Promise<HttpResponseBody>;
    stream(
        path: string,
        body: unknown,
        options?: HttpRequestOptions,
    ): Promise<ReadableStream<Uint8Array>>;
    close(): Promise<void>;
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string>): string {
    const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const url = new URL(path.replace(/^\//, ""), normalizedBase);
    for (const [key, value] of Object.entries(query ?? {})) {
        url.searchParams.set(key, value);
    }
    return url.toString();
}

function backoff(attempt: number): number {
    return Math.min(100 * 2 ** attempt, 2000);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBody<T>(text: string, url: string): T {
    if (!text) {
        return undefined as T;
    }
    try {
        return JSON.parse(text) as T;
    } catch (error) {
        throw new MalformedResponseError(url, error);
    }
}

export function createHttpClient(options: HttpClientOptions): HttpClient {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const maxRetries = options.retries ?? 2;
    const baseHeaders = options.headers ?? {};

    async function execute(
        method: string,
        path: string,
        bodyText: string | undefined,
        requestOptions: HttpRequestOptions,
    ): Promise<HttpResponseBody> {
        const url = buildUrl(options.baseUrl, path, requestOptions.query);
        const headers: Record<string, string> = { ...baseHeaders, ...requestOptions.headers };
        if (bodyText !== undefined) {
            headers["content-type"] = "application/json";
        }
        if (headers.accept === undefined) {
            headers.accept = "application/json";
        }

        const attempts = requestOptions.retries ?? maxRetries;

        for (let attempt = 0; ; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            const outerSignal = requestOptions.signal;
            const onOuterAbort = () => controller.abort();
            if (outerSignal) {
                outerSignal.addEventListener("abort", onOuterAbort, { once: true });
            }
            try {
                const response = await request(url, {
                    method,
                    headers,
                    ...(bodyText !== undefined ? { body: bodyText } : {}),
                    signal: controller.signal,
                });
                const text = await response.body.text();
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    return { status: response.statusCode, url, body: text };
                }
                const error = new HttpError({
                    status: response.statusCode,
                    statusText: response.statusText,
                    bodyText: text,
                    url,
                });
                if (error.retryable && attempt < attempts) {
                    await delay(backoff(attempt));
                    continue;
                }
                throw error;
            } catch (error) {
                if (controller.signal.aborted) {
                    if (outerSignal?.aborted) {
                        throw error;
                    }
                    throw new RequestTimeoutError(url);
                }
                if (error instanceof HttpError) {
                    if (error.retryable && attempt < attempts) {
                        await delay(backoff(attempt));
                        continue;
                    }
                    throw error;
                }
                if (attempt < attempts) {
                    await delay(backoff(attempt));
                    continue;
                }
                throw error;
            } finally {
                clearTimeout(timer);
                if (outerSignal) {
                    outerSignal.removeEventListener("abort", onOuterAbort);
                }
            }
        }
    }

    async function stream(
        path: string,
        body: unknown,
        requestOptions: HttpRequestOptions,
    ): Promise<ReadableStream<Uint8Array>> {
        const url = buildUrl(options.baseUrl, path, requestOptions.query);
        const headers: Record<string, string> = {
            ...baseHeaders,
            ...requestOptions.headers,
            "content-type": "application/json",
            accept: "text/event-stream",
        };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await request(url, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal: requestOptions.signal ?? controller.signal,
            });
            if (response.statusCode >= 300) {
                const text = await response.body.text();
                throw new HttpError({
                    status: response.statusCode,
                    statusText: response.statusText,
                    bodyText: text,
                    url,
                });
            }
            return Readable.toWeb(response.body) as ReadableStream<Uint8Array>;
        } catch (error) {
            if (controller.signal.aborted && !requestOptions.signal?.aborted) {
                throw new RequestTimeoutError(url);
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    return {
        async get<T>(path: string, requestOptions: HttpRequestOptions = {}): Promise<T> {
            const result = await execute("GET", path, undefined, requestOptions);
            return parseBody<T>(result.body, result.url);
        },
        async post<T>(
            path: string,
            body: unknown,
            requestOptions: HttpRequestOptions = {},
        ): Promise<T> {
            const result = await execute("POST", path, JSON.stringify(body), requestOptions);
            return parseBody<T>(result.body, result.url);
        },
        async postRaw(
            path: string,
            body: unknown,
            requestOptions: HttpRequestOptions = {},
        ): Promise<HttpResponseBody> {
            return execute("POST", path, JSON.stringify(body), requestOptions);
        },
        stream,
        async close(): Promise<void> {
            // The global dispatcher is shared and must not be closed per client.
        },
    };
}
