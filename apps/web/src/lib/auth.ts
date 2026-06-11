const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001";

export interface AuthUser {
    id: string;
    email: string;
    isSuperAdmin: boolean;
    roleId: number | null;
    mustChangePassword: boolean;
    role: {
        id: number;
        name: string;
        pages: { path: string; label: string; position: number }[];
    } | null;
}

const TOKEN_KEY = "analytics_token";
const USER_KEY = "analytics_user";

export function getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = localStorage.getItem(USER_KEY);
        return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
        return null;
    }
}

export function storeAuth(token: string, user: AuthUser): void {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
}

export async function apiLogin(
    email: string,
    password: string
): Promise<{ token: string; mustChangePassword: boolean; redirectTo: string; user: Omit<AuthUser, "role" | "mustChangePassword"> }> {
    const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Login failed");
    }
    return res.json();
}

export async function apiGetMe(token: string): Promise<AuthUser> {
    const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Unauthorized");
    return res.json();
}

export async function apiChangePassword(
    token: string,
    newPassword: string
): Promise<void> {
    const res = await fetch(`${API_BASE}/auth/change-password`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ newPassword }),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to change password");
    }
}

export function authedFetch(path: string, init?: RequestInit): Promise<Response> {
    const token = getToken();
    return fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });
}
