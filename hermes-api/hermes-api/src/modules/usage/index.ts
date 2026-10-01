import { env } from "../../config/env.js";
import { UsageService } from "./service.js";

export { UsageService } from "./service.js";
export * from "./types.js";

export function createUsageService(): UsageService {
    return new UsageService(undefined, {
        FREE: {
            requestsPerWindow: env.QUOTA_FREE_REQUESTS,
            tokensPerWindow: env.QUOTA_FREE_TOKENS,
        },
        PRO: {
            requestsPerWindow: env.QUOTA_PRO_REQUESTS,
            tokensPerWindow: env.QUOTA_PRO_TOKENS,
        },
    });
}
