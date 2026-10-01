import { describe, expect, it } from "vitest";
import { extractTokenFromBaseUrl, normalizeBaseUrl } from "./service.js";

describe("normalizeBaseUrl", () => {
    it("añade /v1 a una URL sin él", () => {
        expect(normalizeBaseUrl("http://192.168.1.39:11434")).toBe("http://192.168.1.39:11434/v1");
    });

    it("quita barras finales antes de añadir /v1", () => {
        expect(normalizeBaseUrl("http://192.168.1.39:11434/")).toBe("http://192.168.1.39:11434/v1");
    });

    it("no duplica /v1 si ya lo tiene", () => {
        expect(normalizeBaseUrl("http://192.168.1.39:11434/v1")).toBe(
            "http://192.168.1.39:11434/v1",
        );
    });

    it("añade /v1 antes del query string", () => {
        const token = "96ae022e7b3d";
        const result = normalizeBaseUrl(`http://157.107.19.62:16647/?token=${token}`);
        expect(result).toBe(`http://157.107.19.62:16647/v1?token=${token}`);
    });

    it("respeta un /v1 previo con query string", () => {
        const token = "96ae022e7b3d";
        const result = normalizeBaseUrl(`http://157.107.19.62:16647/v1?token=${token}`);
        expect(result).toBe(`http://157.107.19.62:16647/v1?token=${token}`);
    });

    it("normaliza la URL por defecto del env", () => {
        expect(normalizeBaseUrl("http://194.228.55.129:36327/v1")).toBe(
            "http://194.228.55.129:36327/v1",
        );
    });
});

describe("extractTokenFromBaseUrl", () => {
    it("extrae el token del query string", () => {
        const token = "96ae022e7b3d7f2a359c9a1487cfa08b1379d76c8588aaf7344a9d2231e00900";
        expect(extractTokenFromBaseUrl(`http://157.107.19.62:16647/?token=${token}`)).toBe(token);
    });

    it("devuelve vacío si no hay query string", () => {
        expect(extractTokenFromBaseUrl("http://157.107.19.62:16647/v1")).toBe("");
    });

    it("devuelve vacío si no hay parámetro token", () => {
        expect(extractTokenFromBaseUrl("http://157.107.19.62:16647/v1?foo=bar")).toBe("");
    });
});
