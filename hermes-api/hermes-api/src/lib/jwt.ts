import { jwtVerify, SignJWT } from "jose";
import { env } from "../config/env.js";

const encoder = new TextEncoder();

export interface AccessTokenPayload {
    sub: string;
    nickname: string;
}

export async function signAccessToken(user: { id: string; nickname: string }): Promise<string> {
    return new SignJWT({ nickname: user.nickname, type: "access" })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(user.id)
        .setIssuedAt()
        .setIssuer(env.JWT_ISSUER)
        .setExpirationTime(env.JWT_ACCESS_TTL)
        .sign(encoder.encode(env.JWT_ACCESS_SECRET));
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    const { payload } = await jwtVerify(token, encoder.encode(env.JWT_ACCESS_SECRET), {
        issuer: env.JWT_ISSUER,
        algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string") {
        throw new Error("Access token is missing a subject");
    }
    return {
        sub: payload.sub,
        nickname: typeof payload.nickname === "string" ? payload.nickname : "",
    };
}
