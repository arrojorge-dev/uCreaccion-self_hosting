export interface HealthCheck {
    name: string;
    check: () => Promise<void> | void;
}

export interface HealthCheckResult {
    name: string;
    ok: boolean;
    error?: string;
}

export interface HealthRunResult {
    status: "ok" | "error";
    checks: HealthCheckResult[];
}

export class HealthRegistry {
    private readonly checks: HealthCheck[] = [];

    register(check: HealthCheck): void {
        this.checks.push(check);
    }

    async run(): Promise<HealthRunResult> {
        const checks = await Promise.all(
            this.checks.map(async (check) => {
                try {
                    await check.check();
                    return { name: check.name, ok: true } satisfies HealthCheckResult;
                } catch (error) {
                    return {
                        name: check.name,
                        ok: false,
                        error: error instanceof Error ? error.message : String(error),
                    } satisfies HealthCheckResult;
                }
            }),
        );
        const allOk = checks.every((check) => check.ok);
        return { status: allOk ? "ok" : "error", checks };
    }
}

export function createHealthRegistry(): HealthRegistry {
    return new HealthRegistry();
}
