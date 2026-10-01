import type { HermesClient, HermesRequestOptions } from "./client.js";
import { toAppError } from "./errors.js";
import type {
    HermesChatCompletion,
    HermesChatCompletionParams,
    HermesModel,
    HermesResponse,
    HermesResponseCreateParams,
    HermesSSEEvent,
} from "./types.js";

export class HermesService {
    constructor(private readonly client: HermesClient) {}

    async getModels(): Promise<HermesModel[]> {
        try {
            return await this.client.models();
        } catch (error) {
            throw toAppError(error, "hermes.models");
        }
    }

    async ping(): Promise<void> {
        try {
            await this.client.ping();
        } catch (error) {
            throw toAppError(error, "hermes.health");
        }
    }

    async createResponse(
        params: HermesResponseCreateParams,
        options: HermesRequestOptions = {},
    ): Promise<HermesResponse> {
        try {
            return await this.client.responsesCreate(params, options);
        } catch (error) {
            throw toAppError(error, "hermes.responses.create");
        }
    }

    async chatCompletion(
        params: HermesChatCompletionParams,
        options: HermesRequestOptions = {},
    ): Promise<HermesChatCompletion> {
        try {
            return await this.client.chatCompletions(params, options);
        } catch (error) {
            throw toAppError(error, "hermes.chat.completions");
        }
    }

    async *streamResponse(
        params: HermesResponseCreateParams,
        options: HermesRequestOptions = {},
    ): AsyncGenerator<HermesSSEEvent, void, unknown> {
        try {
            for await (const event of this.client.streamResponses(params, options)) {
                yield event;
            }
        } catch (error) {
            throw toAppError(error, "hermes.responses.stream");
        }
    }
}
