export interface HermesModel {
    id: string;
    object: "model" | string;
    created: number;
    owned_by: string;
    permission?: unknown[];
    root?: string | null;
    parent?: string | null;
}

export interface HermesModelList {
    object: "list";
    data: HermesModel[];
}

export interface HermesToolFunction {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
}

export interface HermesTool {
    type: "function";
    function: HermesToolFunction;
}

export interface HermesInputItem {
    type: string;
    text?: string;
    [field: string]: unknown;
}

export type HermesInput = string | HermesInputItem[];

export interface HermesResponseCreateParams {
    model: string;
    input: HermesInput;
    instructions?: string;
    stream?: boolean;
    temperature?: number;
    top_p?: number;
    max_output_tokens?: number;
    session_id?: string;
    api_key?: string;
    base_url?: string;
    tools?: HermesTool[];
    tool_choice?: unknown;
    [field: string]: unknown;
}

export interface HermesUsage {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
}

export interface HermesResponseContentPart {
    type: string;
    text?: string;
    [field: string]: unknown;
}

export interface HermesResponseOutputItem {
    type: string;
    role?: string;
    content?: HermesResponseContentPart[];
    [field: string]: unknown;
}

export interface HermesResponse {
    id: string;
    object: string;
    status: string;
    created: number;
    model: string;
    output_text?: string;
    output?: HermesResponseOutputItem[];
    usage?: HermesUsage | null;
    error?: unknown;
    [field: string]: unknown;
}

export interface HermesChatMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
}

export interface HermesChatCompletionParams {
    model: string;
    messages: HermesChatMessage[];
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
    [field: string]: unknown;
}

export interface HermesChatCompletionChoice {
    index: number;
    message: HermesChatMessage;
    finish_reason: string | null;
}

export interface HermesChatCompletion {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: HermesChatCompletionChoice[];
    usage?: HermesUsage | null;
    [field: string]: unknown;
}

export interface HermesSSEEvent {
    type?: string;
    [field: string]: unknown;
}
