import { describe, expect, it } from "vitest";
import { mimeTypeFromFilename } from "./mime.js";

describe("mimeTypeFromFilename", () => {
    it("maps known extensions", () => {
        expect(mimeTypeFromFilename("guia.pdf")).toBe("application/pdf");
        expect(mimeTypeFromFilename("foto.PNG")).toBe("image/png");
        expect(mimeTypeFromFilename("notas.md")).toBe("text/markdown");
    });

    it("falls back to octet-stream for unknown extensions", () => {
        expect(mimeTypeFromFilename("datos.xyz")).toBe("application/octet-stream");
        expect(mimeTypeFromFilename("sin-extension")).toBe("application/octet-stream");
    });
});
