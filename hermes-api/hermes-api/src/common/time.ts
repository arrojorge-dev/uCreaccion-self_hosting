export function parseDurationSeconds(value: string): number {
    const match = /^(\d+)([smhd])$/.exec(value.trim());
    if (!match) {
        throw new Error(`Invalid duration format: "${value}"`);
    }
    const amount = Number(match[1]);
    switch (match[2]) {
        case "s":
            return amount;
        case "m":
            return amount * 60;
        case "h":
            return amount * 3600;
        case "d":
            return amount * 86_400;
        default:
            throw new Error(`Invalid duration unit: "${value}"`);
    }
}
