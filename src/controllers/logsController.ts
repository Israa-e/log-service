import type { Request, Response } from "express";
import { insertLogs, queryAggregate, queryLogs } from "../services/logs/index.js";


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