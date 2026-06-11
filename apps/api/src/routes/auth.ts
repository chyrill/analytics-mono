import express, { Router } from "express";
import { db, users, roles, rolePages, pages } from "@analytics/db";
import { eq, asc } from "drizzle-orm";
import {
    signToken,
    comparePassword,
    hashPassword,
    requireAuth,
    type AuthRequest,
} from "../lib/auth";

const router: express.Router = Router();

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post("/login", async (req, res): Promise<void> => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
    }

    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase().trim()))
        .limit(1);

    if (!user || !(await comparePassword(password, user.passwordHash))) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
    }

    if (!user.isActive) {
        res.status(401).json({ error: "Invalid credentials" });
        return;
    }

    // Determine post-login redirect
    let redirectTo = "/unauthorized";
    if (user.isSuperAdmin) {
        redirectTo = "/";
    } else if (user.roleId) {
        const firstPage = await db
            .select({ path: pages.path })
            .from(rolePages)
            .innerJoin(pages, eq(rolePages.pageId, pages.id))
            .where(eq(rolePages.roleId, user.roleId))
            .orderBy(asc(rolePages.position))
            .limit(1);
        redirectTo = firstPage[0]?.path ?? "/unauthorized";
    }

    const token = signToken({
        userId: user.id,
        email: user.email,
        isSuperAdmin: user.isSuperAdmin,
        roleId: user.roleId ?? null,
        mustChangePassword: user.mustChangePassword,
    });

    res.json({
        token,
        mustChangePassword: user.mustChangePassword,
        redirectTo,
        user: {
            id: user.id,
            email: user.email,
            isSuperAdmin: user.isSuperAdmin,
            roleId: user.roleId,
        },
    });
});

// ── POST /auth/change-password ────────────────────────────────────────────────
router.post(
    "/change-password",
    requireAuth,
    async (req: AuthRequest, res): Promise<void> => {
        const { newPassword } = req.body ?? {};
        if (!newPassword || newPassword.length < 8) {
            res
                .status(400)
                .json({ error: "New password must be at least 8 characters" });
            return;
        }

        const passwordHash = await hashPassword(newPassword);
        await db
            .update(users)
            .set({ passwordHash, mustChangePassword: false })
            .where(eq(users.id, req.user!.id));

        res.json({ ok: true });
    }
);

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get(
    "/me",
    requireAuth,
    async (req: AuthRequest, res): Promise<void> => {
        const user = req.user!;
        let roleData: { id: number; name: string; pages: { path: string; label: string; position: number }[] } | null = null;

        if (!user.isSuperAdmin && user.roleId) {
            const [role] = await db
                .select({ id: roles.id, name: roles.name })
                .from(roles)
                .where(eq(roles.id, user.roleId))
                .limit(1);

            if (role) {
                const rolePageList = await db
                    .select({
                        path: pages.path,
                        label: pages.label,
                        position: rolePages.position,
                    })
                    .from(rolePages)
                    .innerJoin(pages, eq(rolePages.pageId, pages.id))
                    .where(eq(rolePages.roleId, user.roleId))
                    .orderBy(asc(rolePages.position));

                roleData = { ...role, pages: rolePageList };
            }
        }

        res.json({
            id: user.id,
            email: user.email,
            isSuperAdmin: user.isSuperAdmin,
            mustChangePassword: user.mustChangePassword,
            role: roleData,
        });
    }
);

export default router;
