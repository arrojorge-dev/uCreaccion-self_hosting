export class CircuitOpenError extends Error {
    readonly retryAfterMs: number;

    constructor(retryAfterMs: number) {
        super("circuit is open");
        this.name = "CircuitOpenError";
        this.retryAfterMs = retryAfterMs;
    }
}

export interface CircuitBreakerOptions {
    failureThreshold?: number;
    cooldownMs?: number;
    now?: () => number;
}

export type CircuitState = "closed" | "open" | "half_open";

export class CircuitBreaker {
    private readonly failureThreshold: number;
    private readonly cooldownMs: number;
    private readonly now: () => number;
    private circuitState: CircuitState = "closed";
    private consecutiveFailures = 0;
    private openedAt = 0;

    constructor(options: CircuitBreakerOptions = {}) {
        this.failureThreshold = options.failureThreshold ?? 5;
        this.cooldownMs = options.cooldownMs ?? 10_000;
        this.now = options.now ?? (() => Date.now());
    }

    get state(): CircuitState {
        if (this.circuitState === "open" && this.now() - this.openedAt >= this.cooldownMs) {
            return "half_open";
        }
        return this.circuitState;
    }

    async call<T>(fn: () => Promise<T>): Promise<T> {
        const state = this.state;
        if (state === "open") {
            throw new CircuitOpenError(this.cooldownMs - (this.now() - this.openedAt));
        }
        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private onSuccess(): void {
        if (this.state === "half_open") {
            this.reset();
            return;
        }
        this.consecutiveFailures = 0;
    }

    private onFailure(): void {
        if (this.state === "half_open") {
            this.open();
            return;
        }
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= this.failureThreshold) {
            this.open();
        }
    }

    private open(): void {
        this.circuitState = "open";
        this.openedAt = this.now();
    }

    private reset(): void {
        this.circuitState = "closed";
        this.consecutiveFailures = 0;
        this.openedAt = 0;
    }
}
