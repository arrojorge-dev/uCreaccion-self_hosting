import { createHmac } from "node:crypto";

export function hmacSha256Hex(secret: string, body: string): string {
    return createHmac("sha256", secret).update(body).digest("hex");
}

export function signWebhookPayload(secret: string, body: string): string {
    return `sha256=${hmacSha256Hex(secret, body)}`;
}

export function verifyWebhookSignature(secret: string, body: string, signature: string): boolean {
    const expected = signWebhookPayload(secret, body);
    if (signature.length !== expected.length) {
        return false;
    }
    let diff = 0;
    for (let i = 0; i < signature.length; i++) {
        diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return diff === 0;
}
