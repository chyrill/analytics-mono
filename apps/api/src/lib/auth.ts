import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { db, users } from "@analytics/db";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is not set");

const JWT_EXPIRES_IN = "7d";

export interface JwtPayload {
    userId: string;
    email: string;
    isSuperAdmin: boolean;
    roleId: number | null;
    mustChangePassword: boolean;
}

export function signToken(payload: JwtPayload): string {
    return jwt.sign(payload, JWT_SECRET!, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
    return jwt.verify(token, JWT_SECRET!) as JwtPayload;
}

export async function hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
}

export async function comparePassword(
    plain: string,
    hash: string
): Promise<boolean> {
    return bcrypt.compare(plain, hash);
}

/** Generate a random 8-character alphanumeric password */
export function generatePassword(): string {
    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// ── Middleware ────────────────────────────────────────────────────────────────

export interface AuthRequest extends Request {
    user?: typeof users.$inferSelect;
}

/**
 * requireAuth — validates JWT and checks is_active on every request.
 * Attaches the full user record to req.user.
 */
export async function requireAuth(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    const token = authHeader.slice(7);
    let payload: JwtPayload;
    try {
        payload = verifyToken(token);
    } catch {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
    }

    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, payload.userId))
        .limit(1);

    if (!user || !user.isActive) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    req.user = user;
    next();
}

/**
 * requireSuperAdmin — must be used after requireAuth.
 */
export function requireSuperAdmin(
    req: AuthRequest,
    res: Response,
    next: NextFunction
): void {
    if (!req.user?.isSuperAdmin) {
        res.status(403).json({ error: "Forbidden" });
        return;
    }
    next();
}
