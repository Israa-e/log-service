import type { LogEntry, ValidationResult } from "./types.js";

export const VALID_LEVELS = ["debug", "info", "warn", "error"];

function normalizeAttributes(attributes: Record<string, string | number | boolean>) {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(attributes)) {
        if (value === null || value === undefined) {
            throw new Error(`invalid attribute value for '${key}'`);
        }
        if (typeof value === "object") {
            throw new Error(`nested object in attribute '${key}'`);
        }
        normalized[key] = String(value);
    }
    return normalized;
}

export function validateLogEntry(log: LogEntry, now: number = Date.now()): ValidationResult {
    if (typeof log !== "object" || log === null || Array.isArray(log)) {
        return { valid: false, reason: "entry must be an object" };
    }

    if (!log.timestamp) {
        return { valid: false, reason: "timestamp is required" };
    }

    const ts = log.timestamp;
    const time = new Date(ts);
    if (isNaN(time.getTime())) {
        return { valid: false, reason: "invalid timestamp" };
    }

    const fiveMinutesFromNow = now + 5 * 60 * 1000;
    if (time.getTime() > fiveMinutesFromNow) {
        return { valid: false, reason: "timestamp too far in the future" };
    }

    if (!VALID_LEVELS.includes(log.level)) {
        return { valid: false, reason: `invalid level: '${log.level}'` };
    }

    if (typeof log.service !== "string" || log.service.trim() === "") {
        return { valid: false, reason: "service is required" };
    }

    if (typeof log.message !== "string" || log.message.trim() === "") {
        return { valid: false, reason: "message is required" };
    }

    let normalizedAttributes: string | null = null;
    if (log.attributes != null) {
        if (typeof log.attributes !== "object" || Array.isArray(log.attributes)) {
            return { valid: false, reason: "attributes must be a flat object" };
        }
        try {
            normalizedAttributes = JSON.stringify(normalizeAttributes(log.attributes));
        } catch (error: any) {
            return { valid: false, reason: error.message };
        }
    }

    return {
        valid: true,
        row: [ts, log.level, log.service, log.message, normalizedAttributes],
        epochMs: time.getTime(),
    };
}
