import { Router } from "express";
import { login, logout, sessionStatus } from "../controllers/authController.js";

const router = Router();

router.post("/login", login);
router.post("/logout", logout);
router.get("/session", sessionStatus);

export default router;