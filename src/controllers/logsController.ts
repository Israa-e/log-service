import type { Request, Response } from "express";
import { insertLogs, queryAggregate, queryLogs, IngestOverloadedError } from "../services/logs/index.js";


export async function createLogs(
    req: Request,
    res: Response
) {

    try {

        if (!req.body || !Array.isArray(req.body.logs)) {
            return res.status(400).json({ error: "body must contain a 'logs' array" });
        }

        const result = await insertLogs(req.body.logs);

        res.status(result.accepted > 0 ? 200 : 400)
            .json(result);

    } catch (error) {

        if (error instanceof IngestOverloadedError) {
            return res.status(503)
                .set("Retry-After", "1")
                .json({ error: "server is overloaded, retry shortly" });
        }

        res.status(500).json({
            error: "internal server error"
        });

    }
}

export async function getLogs(
    req: Request,
    res: Response
) {

    try {

        const result = await queryLogs(req.query);

        res.json(result);

    } catch (error: any) {

        res.status(400).json({
            error: error.message
        });

    }
}

export async function aggregateLogs(
    req: Request,
    res: Response
) {

    try {

        const result = await queryAggregate(req.query);

        res.json(result);

    } catch (error: any) {

        res.status(400).json({
            error: error.message
        });

    }
}