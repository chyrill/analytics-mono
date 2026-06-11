import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { db, users, roles } from "@analytics/db";
import { eq, asc } from "drizzle-orm";
import { verifyToken, hashPassword, generatePassword } from "../lib/auth";

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

function ok(body: unknown, status = 200): APIGatewayProxyStructuredResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}
function err(msg: string, status = 400): APIGatewayProxyStructuredResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) };
}

async function requireSuperAdmin(authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const payload = verifyToken(authHeader.slice(7));
    if (!payload.isSuperAdmin) return null;
    const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
    if (!user || !user.isActive || !user.isSuperAdmin) return null;
    return user;
  } catch {
    return null;
  }
}

export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyStructuredResultV2> => {
  const routeKey = event.routeKey ?? "";
  const authHeader = event.headers?.authorization ?? event.headers?.Authorization;
  const params = event.pathParameters ?? {};
  let body: Record<string, unknown> = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* ignore */ }

  try {
    const authUser = await requireSuperAdmin(authHeader);
    if (!authUser) return err("Forbidden", 403);

    // GET /users
    if (routeKey === "GET /users") {
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
      return ok(rows);
    }

    // POST /users
    if (routeKey === "POST /users") {
      const { email, roleId } = body as { email?: string; roleId?: number };
      if (!email) return err("email is required");

      const plainPassword = generatePassword();
      const passwordHash = await hashPassword(plainPassword);
      const [created] = await db.insert(users).values({
        email: email.toLowerCase().trim(),
        passwordHash,
        roleId: roleId ?? null,
        isActive: true,
        isSuperAdmin: false,
        mustChangePassword: true,
      }).returning({ id: users.id, email: users.email, roleId: users.roleId, createdAt: users.createdAt });

      return ok({ ...created, generatedPassword: plainPassword }, 201);
    }

    // PATCH /users/{id}
    if (routeKey === "PATCH /users/{id}") {
      const id = params.id;
      if (!id) return err("Missing user id");
      const { email, roleId } = body as { email?: string; roleId?: number | null };

      const updates: Partial<typeof users.$inferInsert> = {};
      if (email !== undefined) updates.email = (email as string).toLowerCase().trim();
      if (roleId !== undefined) updates.roleId = roleId as number | null;
      if (Object.keys(updates).length === 0) return err("Nothing to update");

      const [updated] = await db.update(users).set(updates).where(eq(users.id, id))
        .returning({ id: users.id, email: users.email, roleId: users.roleId, isActive: users.isActive });
      if (!updated) return err("User not found", 404);
      return ok(updated);
    }

    // PATCH /users/{id}/deactivate
    if (routeKey === "PATCH /users/{id}/deactivate") {
      const id = params.id;
      if (!id) return err("Missing user id");
      if (authUser.id === id) return err("Cannot deactivate yourself");

      const [updated] = await db.update(users).set({ isActive: false }).where(eq(users.id, id))
        .returning({ id: users.id, isActive: users.isActive });
      if (!updated) return err("User not found", 404);
      return ok(updated);
    }

    // POST /users/{id}/reset-password
    if (routeKey === "POST /users/{id}/reset-password") {
      const id = params.id;
      if (!id) return err("Missing user id");

      const plainPassword = generatePassword();
      const passwordHash = await hashPassword(plainPassword);
      const [updated] = await db.update(users).set({ passwordHash, mustChangePassword: true }).where(eq(users.id, id))
        .returning({ id: users.id, email: users.email });
      if (!updated) return err("User not found", 404);
      return ok({ ...updated, generatedPassword: plainPassword });
    }

    return err("Not found", 404);
  } catch (e) {
    console.error("[users]", e);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Internal Server Error" }) };
  }
};
