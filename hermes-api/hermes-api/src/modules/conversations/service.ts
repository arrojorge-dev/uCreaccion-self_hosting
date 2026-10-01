import { AppError } from "../../common/errors/app-error.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/db.js";
import type {
    ConversationDetail,
    ConversationDto,
    CreateConversationInput,
    MessageDto,
} from "./types.js";

function toConversationDto(conversation: {
    id: string;
    projectId: string | null;
    title: string | null;
    hermesSessionId: string | null;
    createdAt: Date;
    lastUsedAt: Date;
}): ConversationDto {
    return {
        id: conversation.id,
        projectId: conversation.projectId,
        title: conversation.title,
        hermesSessionId: conversation.hermesSessionId,
        createdAt: conversation.createdAt.toISOString(),
        lastUsedAt: conversation.lastUsedAt.toISOString(),
    };
}

function toMessageDto(message: {
    id: string;
    conversationId: string;
    role: string;
    content: string;
    createdAt: Date;
}): MessageDto {
    return {
        id: message.id,
        conversationId: message.conversationId,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
    };
}

export class ConversationsService {
    constructor(private readonly db: PrismaClient = prisma) {}

    async create(userId: string, input: CreateConversationInput): Promise<ConversationDto> {
        if (input.projectId) {
            await this.ensureProject(userId, input.projectId);
        }
        const conversation = await this.db.conversation.create({
            data: {
                userId,
                projectId: input.projectId ?? null,
                title: input.title?.trim() || null,
            },
        });
        return toConversationDto(conversation);
    }

    async list(userId: string): Promise<ConversationDto[]> {
        const conversations = await this.db.conversation.findMany({
            where: { userId },
            orderBy: { lastUsedAt: "desc" },
            take: 50,
        });
        return conversations.map(toConversationDto);
    }

    async getOwned(userId: string, id: string): Promise<ConversationDto> {
        const conversation = await this.db.conversation.findFirst({ where: { id, userId } });
        if (!conversation) {
            throw AppError.notFound("Conversation not found");
        }
        return toConversationDto(conversation);
    }

    async getWithMessages(userId: string, id: string, limit = 50): Promise<ConversationDetail> {
        const conversation = await this.getOwned(userId, id);
        const messages = await this.db.message.findMany({
            where: { conversationId: id },
            orderBy: { createdAt: "asc" },
            take: limit,
        });
        return { conversation, messages: messages.map(toMessageDto) };
    }

    async listMessages(userId: string, conversationId: string, limit = 100): Promise<MessageDto[]> {
        await this.getOwned(userId, conversationId);
        const messages = await this.db.message.findMany({
            where: { conversationId },
            orderBy: { createdAt: "asc" },
            take: limit,
        });
        return messages.map(toMessageDto);
    }

    async resetContext(userId: string, id: string): Promise<void> {
        await this.getOwned(userId, id);
        await this.db.conversation.update({ where: { id }, data: { hermesSessionId: null } });
    }

    private async ensureProject(userId: string, projectId: string): Promise<void> {
        const project = await this.db.project.findFirst({ where: { id: projectId, userId } });
        if (!project) {
            throw AppError.badRequest("Project not found");
        }
    }
}
