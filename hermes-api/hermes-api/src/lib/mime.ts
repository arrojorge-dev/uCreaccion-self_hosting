const MIME_BY_EXTENSION: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    html: "text/html",
    xml: "application/xml",
    zip: "application/zip",
    gz: "application/gzip",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function mimeTypeFromFilename(filename: string): string {
    const extension = filename.includes(".")
        ? (filename.split(".").pop()?.toLowerCase() ?? "")
        : "";
    return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}
