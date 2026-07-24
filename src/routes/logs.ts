import { Router } from "express";
import {
    createLogs,
    getLogs,
    aggregateLogs
} from "../controllers/logsController.js";


const router = Router();


router.post("/", createLogs);

router.get("/", getLogs);

router.get("/aggregate", aggregateLogs);


export default router;