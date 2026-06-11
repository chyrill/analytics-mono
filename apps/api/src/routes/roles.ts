import express, { Router } from "express";
import { db, roles, rolePages, pages, users } from "@analytics/db";
import { eq, asc, count } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "../lib/auth";

const router: express.Router = Router();

// ── GET /pages — available pages for role assignment (auth required) ──────────
router.get("/pages", requireAuth, async (_req, res): Promise<void> => {
    const allPages = await db
        .select()
        .from(pages)
        .orderBy(asc(pages.sortOrder));
    res.json(allPages);
});

// All /roles routes require superadmin
router.use(requireAuth, requireSuperAdmin);

// ── GET /roles ────────────────────────────────────────────────────────────────
router.get("/", async (_req, res): Promise<void> => {
    const allRoles = await db.select().from(roles).orderBy(asc(roles.id));

    const result = await Promise.all(
        allRoles.map(async (role) => {
            const rolePageList = await db
                .select({
                    pageId: rolePages.pageId,
                    path: pages.path,
                    label: pages.label,
                    position: rolePages.position,
                })
                .from(rolePages)
                .innerJoin(pages, eq(rolePages.pageId, pages.id))
                .where(eq(rolePages.roleId, role.id))
                .orderBy(asc(rolePages.position));

            const [{ userCount }] = await db
                .select({ userCount: count() })
                .from(users)
                .where(eq(users.roleId, role.id));

            return { ...role, pages: rolePageList, userCount: Number(userCount) };
        })
    );

    res.json(result);
});

// ── POST /roles ───────────────────────────────────────────────────────────────
router.post("/", async (req, res): Promise<void> => {
    const { name, pages: pagesList } = req.body ?? {};
    if (!name?.trim()) {
        res.status(400).json({ error: "name is required" });
        return;
    }
    if (!Array.isArray(pagesList) || pagesList.length === 0) {
        res.status(400).json({ error: "pages array is required" });
        return;
    }

    const [role] = await db
        .insert(roles)
        .values({ name: name.trim() })
        .returning();

    // pagesList: [{ pageId: number, position: number }]
    await db.insert(rolePages).values(
        pagesList.map((p: { pageId: number; position: number }) => ({
            roleId: role.id,
            pageId: p.pageId,
            position: p.position,
        }))
    );

    res.status(201).json(role);
});

export default router;
