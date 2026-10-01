import { CircuitBreaker, type CircuitBreakerOptions } from "../../lib/circuit-breaker.js";
import { createHttpClient, type HttpClient } from "../../lib/http.js";
import type {
    HermesChatCompletion,
    HermesChatCompletionParams,
    HermesModel,
    HermesModelList,
    HermesResponse,
    HermesResponseCreateParams,
    HermesSSEEvent,
} from "./types.js";

export interface HermesClientOptions {
    baseUrl: string;
    apiKey: string;
    timeoutMs?: number;
    retries?: number;
    circuitBreaker?: CircuitBreakerOptions;
}

export interface HermesRequestOptions {
    signal?: AbortSignal;
    headers?: Record<string, string>;
}

export class HermesClient {
    private readonly http: HttpClient;
    private readonly circuit: CircuitBreaker;

    constructor(options: HermesClientOptions) {
        this.http = createHttpClient({
            baseUrl: options.baseUrl,
            timeoutMs: options.timeoutMs ?? 10_000,
            retries: options.retries ?? 2,
            headers: {
                authorization: `Bearer ${options.apiKey}`,
            },
        });
        this.circuit = new CircuitBreaker(options.circuitBreaker);
    }

    async ping(): Promise<void> {
        await this.circuit.call(() => this.http.get<{ status?: string }>("/health"));
    }

    async models(): Promise<HermesModel[]> {
        const list = await this.circuit.call(() => this.http.get<HermesModelList>("/v1/models"));
        return list.data;
    }

    async responsesCreate(
        params: HermesResponseCreateParams,
        options: HermesRequestOptions = {},
    ): Promise<HermesResponse> {
        return this.circuit.call(() =>
            this.http.post<HermesResponse>("/v1/responses", params, { signal: options.signal }),
        );
    }

    async chatCompletions(
        params: HermesChatCompletionParams,
        options: HermesRequestOptions = {},
    ): Promise<HermesChatCompletion> {
        return this.circuit.call(() =>
            this.http.post<HermesChatCompletion>("/v1/chat/completions", params, {
                signal: options.signal,
            }),
        );
    }

    async *streamResponses(
        params: HermesResponseCreateParams,
        options: HermesRequestOptions = {},
    ): AsyncGenerator<HermesSSEEvent, void, unknown> {
        const body = await this.circuit.call(() =>
            this.http.stream(
                "/v1/responses",
                { ...params, stream: true },
                { signal: options.signal, headers: options.headers },
            ),
        );
        for await (const event of parseSse(body)) {
            yield event;
        }
    }

    async stopResponses(idempotencyKey: string): Promise<{ stopped: boolean }> {
        // Best-effort: interrupt the agent run on Hermes so Ollama stops
        // generating. Not wrapped in the circuit breaker (a timeout would
        // otherwise leave the circuit open and block the stop call).
        const response = await this.http.postRaw(
            "/v1/responses/stop",
            { idempotency_key: idempotencyKey },
            { signal: AbortSignal.timeout(10_000) },
        );
        try {
            return JSON.parse(response.body) as { stopped: boolean };
        } catch {
            return { stopped: false };
        }
    }

    async close(): Promise<void> {
        await this.http.close();
    }
}

function parseSseBlock(block: string): HermesSSEEvent | null {
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
        if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
        }
    }
    if (dataLines.length === 0) {
        return null;
    }
    const payload = dataLines.join("\n");
    if (payload === "[DONE]") {
        return null;
    }
    try {
        return JSON.parse(payload) as HermesSSEEvent;
    } catch {
        return { type: "raw", data: payload };
    }
}

async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<HermesSSEEvent> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
            const boundary = buffer.indexOf("\n\n");
            if (boundary === -1) {
                break;
            }
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const event = parseSseBlock(block);
            if (event) {
                yield event;
            }
        }
    }
    const trailing = parseSseBlock(buffer);
    if (trailing) {
        yield trailing;
    }
}
