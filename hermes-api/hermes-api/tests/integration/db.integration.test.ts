import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { disconnectDatabase, prisma } from "../../src/lib/db.js";

function uniqueNickname(prefix: string): string {
	return `${prefix}-${Date.now().toString(36).slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
}

describe("prisma integration", () => {
	afterAll(async () => {
		await disconnectDatabase();
	});

	it("creates and reads a user with related entities and cascades deletion", async () => {
		const user = await prisma.user.create({
			data: { nickname: uniqueNickname("user"), passwordHash: "hash", name: "Test" },
		});
		const conversation = await prisma.conversation.create({
			data: { userId: user.id, title: "Migración VPS" },
		});
		const task = await prisma.task.create({
			data: {
				userId: user.id,
				conversationId: conversation.id,
				inputPayload: { model: "hermes-agent", input: "hola" },
				status: "ENQUEUED",
			},
		});
		await prisma.task.update({
			where: { id: task.id },
			data: { status: "SUCCEEDED", resultPayload: { text: "ok" } },
		});

		const found = await prisma.task.findFirst({ where: { userId: user.id } });
		expect(found?.status).toBe("SUCCEEDED");

		await prisma.user.delete({ where: { id: user.id } });
		const orphan = await prisma.task.findUnique({ where: { id: task.id } });
		expect(orphan).toBeNull();
	});

	it("enforces a unique (userId, idempotencyKey) constraint", async () => {
		const user = await prisma.user.create({
			data: { nickname: uniqueNickname("dup"), passwordHash: "hash" },
		});
		const base = { userId: user.id, inputPayload: { input: "x" } };
		await prisma.task.create({ data: { ...base, idempotencyKey: "key-1" } });
		await expect(
			prisma.task.create({ data: { ...base, idempotencyKey: "key-1" } }),
		).rejects.toMatchObject({ code: "P2002" });
		await prisma.user.delete({ where: { id: user.id } });
	});
});
