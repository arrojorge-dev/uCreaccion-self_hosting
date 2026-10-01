import type { FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { Counter, Histogram, Registry } from "prom-client";
import { AppError } from "../common/errors/app-error.js";
import { scopes } from "../common/scopes.js";
import { env } from "../config/env.js";
import { getAuthenticatedUser } from "./auth.js";

declare module "fastify" {
    interface FastifyInstance {
        metrics: {
            register: Registry;
            httpRequestsTotal: Counter<string>;
            httpRequestDurationSeconds: Histogram<string>;
        };
    }
}

const startTimes = new WeakMap<FastifyRequest, bigint>();

export function createMetricsPlugin(options: { enabled?: boolean } = {}) {
    return fp(async (app) => {
        if (options.enabled === false) {
            return;
        }
        const register = new Registry();
        const httpRequestsTotal = new Counter({
            name: "hermes_http_requests_total",
            help: "Total number of HTTP requests handled",
            labelNames: ["method", "status"],
            registers: [register],
        });
        const httpRequestDurationSeconds = new Histogram({
            name: "hermes_http_request_duration_seconds",
            help: "HTTP request duration in seconds",
            labelNames: ["method"],
            registers: [register],
        });

        app.decorate("metrics", { register, httpRequestsTotal, httpRequestDurationSeconds });

        app.addHook("onRequest", async (request) => {
            startTimes.set(request, process.hrtime.bigint());
        });

        app.addHook("onResponse", async (request, reply) => {
            if (request.routeOptions.url === "/metrics") {
                return;
            }
            const start = startTimes.get(request);
            if (start !== undefined) {
                const seconds = Number(process.hrtime.bigint() - start) / 1e9;
                app.metrics.httpRequestDurationSeconds.observe({ method: request.method }, seconds);
            }
            app.metrics.httpRequestsTotal.inc({
                method: request.method,
                status: String(reply.statusCode),
            });
        });

        app.get(
            "/metrics",
            {
                schema: { hide: true },
            },
            async (request, reply) => {
                const auth = getAuthenticatedUser(request);
                const isLocalUser =
                    auth.type === "user" &&
                    auth.nickname === env.LOCAL_USER_NICKNAME.trim().toLowerCase();
                if (
                    !isLocalUser &&
                    (auth.type !== "apiKey" || !auth.scopes.includes(scopes.metricsRead))
                ) {
                    throw AppError.forbidden("Insufficient scope");
                }
                reply.type("text/plain; version=0.0.4");
                return register.metrics();
            },
        );
    });
}
