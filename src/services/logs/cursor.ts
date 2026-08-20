export function decodeCursor(cursor: string): { timestamp: string; id: number } {
    let decoded: { timestamp: string; id: number };
    try {
        decoded = JSON.parse(Buffer.from(cursor, "base64").toString());
    } catch {
        throw new Error("invalid cursor");
    }

    if (!decoded || typeof decoded.timestamp !== "string" || typeof decoded.id !== "number") {
        throw new Error("invalid cursor");
    }

    return decoded;
}
