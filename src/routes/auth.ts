import { Router } from "express";
import {
    login,
    logout,
    sessionStatus,
    listUsers,
    createUser,
    requireAuth,
} from "../controllers/authController.js";

const router = Router();

router.post("/login", login);
router.post("/logout", logout);
router.get("/session", sessionStatus);

router.get("/users", requireAuth, listUsers);
router.post("/users", requireAuth, createUser);

export default router;
