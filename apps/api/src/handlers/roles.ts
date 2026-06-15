import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { db, roles, rolePages, pages, users } from "@analytics/db";
import { eq, asc, count } from "drizzle-orm";
import { verifyToken } from "../lib/auth";

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

function ok(body: unknown, status = 200): APIGatewayProxyStructuredResultV2 {
    return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}
function err(msg: string, status = 400): APIGatewayProxyStructuredResultV2 {
    return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) };
}

function verifyAuth(authHeader: string | undefined) {
    if (!authHeader?.startsWith("Bearer ")) return null;
    try { return verifyToken(authHeader.slice(7)); } catch { return null; }
}

export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyStructuredResultV2> => {
    const routeKey = event.routeKey ?? "";
    const authHeader = event.headers?.authorization ?? event.headers?.Authorization;
    let body: Record<string, unknown> = {};
    try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* ignore */ }

    try {
        const payload = verifyAuth(authHeader);
        if (!payload) return err("Unauthorized", 401);

        // GET /roles/pages — any authenticated user can list pages for role assignment
        if (routeKey === "GET /roles/pages") {
            const allPages = await db.select().from(pages).orderBy(asc(pages.sortOrder));
            return ok(allPages);
        }

        // All other /roles routes require superadmin
        if (!payload.isSuperAdmin) return err("Forbidden", 403);

        // GET /roles
        if (routeKey === "GET /roles") {
            const allRoles = await db.select().from(roles).orderBy(asc(roles.id));
            const result = await Promise.all(allRoles.map(async (role) => {
                const rolePageList = await db
                    .select({ pageId: rolePages.pageId, path: pages.path, label: pages.label, position: rolePages.position })
                    .from(rolePages)
                    .innerJoin(pages, eq(rolePages.pageId, pages.id))
                    .where(eq(rolePages.roleId, role.id))
                    .orderBy(asc(rolePages.position));
                const [{ userCount }] = await db
                    .select({ userCount: count() }).from(users).where(eq(users.roleId, role.id));
                return { ...role, pages: rolePageList, userCount: Number(userCount) };
            }));
            return ok(result);
        }

        // POST /roles
        if (routeKey === "POST /roles") {
            const { name, pages: pagesList } = body as { name?: string; pages?: { pageId: number; position: number }[] };
            if (!name?.trim()) return err("name is required");
            if (!Array.isArray(pagesList) || pagesList.length === 0) return err("pages array is required");

            const [role] = await db.insert(roles).values({ name: name.trim() }).returning();
            await db.insert(rolePages).values(
                pagesList.map((p) => ({ roleId: role.id, pageId: p.pageId, position: p.position }))
            );
            return ok(role, 201);
        }

        return err("Not found", 404);
    } catch (e) {
        console.error("[roles]", e);
        return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Internal Server Error" }) };
    }
};
