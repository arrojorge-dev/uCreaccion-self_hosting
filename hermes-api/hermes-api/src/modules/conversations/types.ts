export interface ConversationDto {
    id: string;
    projectId: string | null;
    title: string | null;
    hermesSessionId: string | null;
    createdAt: string;
    lastUsedAt: string;
}

export interface MessageDto {
    id: string;
    conversationId: string;
    role: string;
    content: string;
    createdAt: string;
}

export interface CreateConversationInput {
    projectId?: string;
    title?: string;
}

export interface ConversationDetail {
    conversation: ConversationDto;
    messages: MessageDto[];
}
