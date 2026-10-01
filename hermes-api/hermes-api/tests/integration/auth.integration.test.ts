import "dotenv/config";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { disconnectDatabase, prisma } from "../../src/lib/db.js";

interface AuthResponse {
	user: { id: string; nickname: string; name: string | null };
	tokens: { accessToken: string; refreshToken: string };
}

let app: FastifyInstance;
const createdNicknames: string[] = [];

function uniqueNickname(prefix: string): string {
	const nickname = `${prefix}-${Date.now().toString(36).slice(-6)}-${Math.random().toString(36).slice(2, 6)}`;
	createdNicknames.push(nickname);
	return nickname;
}

function bearer(token: string): { authorization: string } {
	return { authorization: `Bearer ${token}` };
}

async function register(nickname: string, password: string, name?: string): Promise<AuthResponse> {
	const response = await app.inject({
		method: "POST",
		url: "/api/v1/auth/register",
		payload: { nickname, password, ...(name ? { name } : {}) },
	});
	expect(response.statusCode).toBe(201);
	return response.json() as AuthResponse;
}

beforeAll(async () => {
	app = buildApp({ infrastructure: false });
	await app.ready();
});

afterAll(async () => {
	await app.close();
	await prisma.user.deleteMany({ where: { nickname: { in: createdNicknames } } });
	await disconnectDatabase();
});

describe("auth flow", () => {
	it("registers, logs in and reads its own profile", async () => {
		const nickname = uniqueNickname("auth");
		const password = "password-123";
		const registered = await register(nickname, password, "Ada");

		expect(registered.user.nickname).toBe(nickname);
		expect(registered.user.name).toBe("Ada");
		expect(registered.tokens.accessToken.length).toBeGreaterThan(0);
		expect(registered.tokens.refreshToken.length).toBeGreaterThan(0);

		const me = await app.inject({
			method: "GET",
			url: "/api/v1/users/me",
			headers: bearer(registered.tokens.accessToken),
		});
		expect(me.statusCode).toBe(200);
		expect(me.json().nickname).toBe(nickname);

		const login = await app.inject({
			method: "POST",
			url: "/api/v1/auth/login",
			payload: { nickname, password },
		});
		expect(login.statusCode).toBe(200);
		expect((login.json() as AuthResponse).tokens.accessToken).toBeTruthy();
	});

	it("rejects invalid credentials", async () => {
		const nickname = uniqueNickname("badpass");
		await register(nickname, "password-123");
		const login = await app.inject({
			method: "POST",
			url: "/api/v1/auth/login",
			payload: { nickname, password: "wrong-password" },
		});
		expect(login.statusCode).toBe(401);
		expect(login.json().error.code).toBe("UNAUTHORIZED");
	});

	it("rejects duplicate nickname registration", async () => {
		const nickname = uniqueNickname("dup");
		await register(nickname, "password-123");
		const second = await app.inject({
			method: "POST",
			url: "/api/v1/auth/register",
			payload: { nickname, password: "password-123" },
		});
		expect(second.statusCode).toBe(409);
		expect(second.json().error.code).toBe("CONFLICT");
	});

	it("rotates refresh tokens and revokes the family on reuse", async () => {
		const { tokens } = await register(uniqueNickname("rotate"), "password-123");

		const rotated = await app.inject({
			method: "POST",
			url: "/api/v1/auth/refresh",
			payload: { refreshToken: tokens.refreshToken },
		});
		expect(rotated.statusCode).toBe(200);
		const rotatedBody = rotated.json() as AuthResponse["tokens"];
		expect(rotatedBody.refreshToken).not.toBe(tokens.refreshToken);

		const reused = await app.inject({
			method: "POST",
			url: "/api/v1/auth/refresh",
			payload: { refreshToken: tokens.refreshToken },
		});
		expect(reused.statusCode).toBe(401);

		const familyRevoked = await app.inject({
			method: "POST",
			url: "/api/v1/auth/refresh",
			payload: { refreshToken: rotatedBody.refreshToken },
		});
		expect(familyRevoked.statusCode).toBe(401);
	});

	it("logout revokes the refresh token", async () => {
		const { tokens } = await register(uniqueNickname("logout"), "password-123");

		const logout = await app.inject({
			method: "POST",
			url: "/api/v1/auth/logout",
			headers: bearer(tokens.accessToken),
			payload: { refreshToken: tokens.refreshToken },
		});
		expect(logout.statusCode).toBe(204);

		const refreshed = await app.inject({
			method: "POST",
			url: "/api/v1/auth/refresh",
			payload: { refreshToken: tokens.refreshToken },
		});
		expect(refreshed.statusCode).toBe(401);
	});
});

describe("api keys", () => {
	it("enforces api key scopes and revocation", async () => {
		const { tokens } = await register(uniqueNickname("apikey"), "password-123");

		const created = await app.inject({
			method: "POST",
			url: "/api/v1/apikeys",
			headers: bearer(tokens.accessToken),
			payload: { name: "dev", scopes: ["profile:read"] },
		});
		expect(created.statusCode).toBe(201);
		const keyBody = created.json() as { id: string; key: string };
		expect(keyBody.key.startsWith("hk_")).toBe(true);

		const allowed = await app.inject({
			method: "GET",
			url: "/api/v1/users/me",
			headers: { "x-api-key": keyBody.key },
		});
		expect(allowed.statusCode).toBe(200);

		const denied = await app.inject({
			method: "GET",
			url: "/api/v1/apikeys",
			headers: { "x-api-key": keyBody.key },
		});
		expect(denied.statusCode).toBe(403);
		expect(denied.json().error.code).toBe("FORBIDDEN");

		const revoked = await app.inject({
			method: "POST",
			url: `/api/v1/apikeys/${keyBody.id}/revoke`,
			headers: bearer(tokens.accessToken),
		});
		expect(revoked.statusCode).toBe(204);

		const afterRevoke = await app.inject({
			method: "GET",
			url: "/api/v1/users/me",
			headers: { "x-api-key": keyBody.key },
		});
		expect(afterRevoke.statusCode).toBe(401);
	});
});

describe("isolation", () => {
	it("never leaks data between users", async () => {
		const first = await register(uniqueNickname("iso-a"), "password-123", "A");
		const second = await register(uniqueNickname("iso-b"), "password-123", "B");

		const meA = await app.inject({
			method: "GET",
			url: "/api/v1/users/me",
			headers: bearer(first.tokens.accessToken),
		});
		const meB = await app.inject({
			method: "GET",
			url: "/api/v1/users/me",
			headers: bearer(second.tokens.accessToken),
		});
		expect(meA.json().nickname).toBe(first.user.nickname);
		expect(meB.json().nickname).toBe(second.user.nickname);
		expect(meA.json().nickname).not.toBe(meB.json().nickname);
	});
});
