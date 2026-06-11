import express, { Router } from "express";
import { db, users, roles, rolePages, pages } from "@analytics/db";
import { eq, asc } from "drizzle-orm";
import {
    requireAuth,
    requireSuperAdmin,
    hashPassword,
    generatePassword,
    type AuthRequest,
} from "../lib/auth";

const router: express.Router = Router();
router.use(requireAuth, requireSuperAdmin);

// ── GET /users ────────────────────────────────────────────────────────────────
router.get("/", async (_req, res): Promise<void> => {
    const rows = await db
        .select({
            id: users.id,
            email: users.email,
            roleId: users.roleId,
            roleName: roles.name,
            isActive: users.isActive,
            isSuperAdmin: users.isSuperAdmin,
            mustChangePassword: users.mustChangePassword,
            createdAt: users.createdAt,
        })
        .from(users)
        .leftJoin(roles, eq(users.roleId, roles.id))
        .orderBy(asc(users.createdAt));

    res.json(rows);
});

// ── POST /users ───────────────────────────────────────────────────────────────
router.post("/", async (req: AuthRequest, res): Promise<void> => {
    const { email, roleId } = req.body ?? {};
    if (!email) {
        res.status(400).json({ error: "email is required" });
        return;
    }

    const plainPassword = generatePassword();
    const passwordHash = await hashPassword(plainPassword);

    const [created] = await db
        .insert(users)
        .values({
            email: email.toLowerCase().trim(),
            passwordHash,
            roleId: roleId ?? null,
            isActive: true,
            isSuperAdmin: false,
            mustChangePassword: true,
        })
        .returning({
            id: users.id,
            email: users.email,
            roleId: users.roleId,
            createdAt: users.createdAt,
        });

    // Return the plaintext password once — superadmin hands it to the user
    res.status(201).json({ ...created, generatedPassword: plainPassword });
});

// ── PATCH /users/:id ──────────────────────────────────────────────────────────
router.patch("/:id", async (req: AuthRequest, res): Promise<void> => {
    const id = req.params.id as string;
    const { email, roleId } = req.body ?? {};

    const updates: Partial<typeof users.$inferInsert> = {};
    if (email !== undefined) updates.email = email.toLowerCase().trim();
    if (roleId !== undefined) updates.roleId = roleId;

    if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "Nothing to update" });
        return;
    }

    const [updated] = await db
        .update(users)
        .set(updates)
        .where(eq(users.id, id))
        .returning({
            id: users.id,
            email: users.email,
            roleId: users.roleId,
            isActive: users.isActive,
        });

    if (!updated) {
        res.status(404).json({ error: "User not found" });
        return;
    }
    res.json(updated);
});

// ── PATCH /users/:id/deactivate ───────────────────────────────────────────────
router.patch("/:id/deactivate", async (req: AuthRequest, res): Promise<void> => {
    const id = req.params.id as string;

    // Block superadmin self-deactivation
    if (req.user!.isSuperAdmin && req.user!.id === id) {
        res.status(400).json({ error: "Superadmin cannot deactivate themselves" });
        return;
    }

    const [updated] = await db
        .update(users)
        .set({ isActive: false })
        .where(eq(users.id, id))
        .returning({ id: users.id, isActive: users.isActive });

    if (!updated) {
        res.status(404).json({ error: "User not found" });
        return;
    }
    res.json(updated);
});

// ── POST /users/:id/reset-password ────────────────────────────────────────────
router.post("/:id/reset-password", async (_req, res): Promise<void> => {
    const id = _req.params.id as string;

    const plainPassword = generatePassword();
    const passwordHash = await hashPassword(plainPassword);

    const [updated] = await db
        .update(users)
        .set({ passwordHash, mustChangePassword: true })
        .where(eq(users.id, id))
        .returning({ id: users.id, email: users.email });

    if (!updated) {
        res.status(404).json({ error: "User not found" });
        return;
    }

    // Return the new plaintext password once
    res.json({ ...updated, generatedPassword: plainPassword });
});

export default router;
