import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_KEYLEN = 64;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_SALT_LEN = 16;

function scryptAsync(
    password: string,
    salt: Buffer,
    keylen: number,
    options: { N: number; r: number; p: number },
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        scrypt(password, salt, keylen, options, (error, derivedKey) => {
            if (error) {
                reject(error);
            } else {
                resolve(derivedKey);
            }
        });
    });
}

export function sha256Hex(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

export function secureCompare(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) {
        return false;
    }
    return timingSafeEqual(left, right);
}

export function randomToken(bytes = 32): string {
    return randomBytes(bytes).toString("base64url");
}

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(SCRYPT_SALT_LEN);
    const derived = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
    });
    return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("base64")}:${derived.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, n, r, p, saltBase64, hashBase64] = stored.split(":");
    if (scheme !== "scrypt" || !n || !r || !p || !saltBase64 || !hashBase64) {
        return false;
    }
    const salt = Buffer.from(saltBase64, "base64");
    const expected = Buffer.from(hashBase64, "base64");
    const derived = await scryptAsync(password, salt, expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
    });
    return timingSafeEqual(derived, expected);
}
