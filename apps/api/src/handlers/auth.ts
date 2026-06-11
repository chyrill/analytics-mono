import type { APIGatewayProxyHandlerV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { db, users, roles, rolePages, pages } from "@analytics/db";
import { eq, asc } from "drizzle-orm";
import { signToken, verifyToken, comparePassword, hashPassword } from "../lib/auth";

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

function ok(body: unknown, status = 200): APIGatewayProxyStructuredResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify(body) };
}
function err(msg: string, status = 400): APIGatewayProxyStructuredResultV2 {
  return { statusCode: status, headers: CORS, body: JSON.stringify({ error: msg }) };
}

async function getAuthedUser(authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
    if (!user || !user.isActive) return null;
    return user;
  } catch {
    return null;
  }
}

export const handler: APIGatewayProxyHandlerV2 = async (event): Promise<APIGatewayProxyStructuredResultV2> => {
  const routeKey = event.routeKey ?? "";
  const authHeader = event.headers?.authorization ?? event.headers?.Authorization;
  let body: Record<string, unknown> = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { /* ignore */ }

  try {
    // POST /auth/login
    if (routeKey === "POST /auth/login") {
      const { email, password } = body as { email?: string; password?: string };
      if (!email || !password) return err("Email and password are required");

      const [user] = await db.select().from(users)
        .where(eq(users.email, email.toLowerCase().trim())).limit(1);

      if (!user || !(await comparePassword(password, user.passwordHash)) || !user.isActive) {
        return err("Invalid credentials", 401);
      }

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

      return ok({
        token,
        mustChangePassword: user.mustChangePassword,
        redirectTo,
        user: { id: user.id, email: user.email, isSuperAdmin: user.isSuperAdmin, roleId: user.roleId },
      });
    }

    // GET /auth/me
    if (routeKey === "GET /auth/me") {
      const authUser = await getAuthedUser(authHeader);
      if (!authUser) return err("Unauthorized", 401);

      let roleData: { id: number; name: string; pages: { path: string; label: string; position: number }[] } | null = null;
      if (!authUser.isSuperAdmin && authUser.roleId) {
        const [role] = await db.select({ id: roles.id, name: roles.name }).from(roles)
          .where(eq(roles.id, authUser.roleId)).limit(1);
        if (role) {
          const rolePageList = await db
            .select({ path: pages.path, label: pages.label, position: rolePages.position })
            .from(rolePages)
            .innerJoin(pages, eq(rolePages.pageId, pages.id))
            .where(eq(rolePages.roleId, authUser.roleId))
            .orderBy(asc(rolePages.position));
          roleData = { ...role, pages: rolePageList };
        }
      }

      return ok({
        id: authUser.id,
        email: authUser.email,
        isSuperAdmin: authUser.isSuperAdmin,
        roleId: authUser.roleId,
        mustChangePassword: authUser.mustChangePassword,
        role: roleData,
      });
    }

    // POST /auth/change-password
    if (routeKey === "POST /auth/change-password") {
      const authUser = await getAuthedUser(authHeader);
      if (!authUser) return err("Unauthorized", 401);

      const { newPassword } = body as { newPassword?: string };
      if (!newPassword || newPassword.length < 8) return err("New password must be at least 8 characters");

      const passwordHash = await hashPassword(newPassword);
      await db.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, authUser.id));
      return ok({ ok: true });
    }

    return err("Not found", 404);
  } catch (e) {
    console.error("[auth]", e);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "Internal Server Error" }) };
  }
};
