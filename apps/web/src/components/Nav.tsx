"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../contexts/AuthContext";

const ALL_PAGES = [
    { path: "/", label: "Reconciliation" },
    { path: "/funnel-analytics", label: "Funnel Analytics" },
    { path: "/health", label: "Health Index" },
    { path: "/health-2", label: "Health Index v2" },
    { path: "/zoho-health", label: "Zoho Health" },
    { path: "/shop-analytics", label: "Shop Analytics" },
    { path: "/patients", label: "Patients" },
];

export default function Nav() {
    const { user, logout } = useAuth();
    const pathname = usePathname();
    if (!user) return null;

    const navPages = user.isSuperAdmin
        ? [...ALL_PAGES, { path: "/user-management", label: "User Management" }]
        : (user.role?.pages.map((p) => ({ path: p.path, label: p.label })) ?? []);

    const isActive = (path: string) => {
        const norm = pathname.replace(/\/$/, "") || "/";
        return norm === path || pathname === path;
    };

    return (
        <nav style={navStyle}>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1 }}>
                {navPages.map((page) => (
                    <Link
                        key={page.path}
                        href={page.path}
                        style={{
                            ...linkStyle,
                            ...(isActive(page.path) ? activeLinkStyle : {}),
                        }}
                    >
                        {page.label}
                    </Link>
                ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13, color: "#666" }}>{user.email}</span>
                <button onClick={logout} style={logoutBtn}>
                    Sign out
                </button>
            </div>
        </nav>
    );
}

const navStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
    background: "#111",
    borderBottom: "1px solid #222",
    height: 48,
    position: "sticky",
    top: 0,
    zIndex: 100,
};

const linkStyle: React.CSSProperties = {
    padding: "6px 12px",
    borderRadius: 4,
    fontSize: 13,
    color: "#aaa",
    textDecoration: "none",
    transition: "background 0.15s",
};

const activeLinkStyle: React.CSSProperties = {
    background: "#1e3a5f",
    color: "#60a5fa",
};

const logoutBtn: React.CSSProperties = {
    background: "none",
    border: "1px solid #333",
    color: "#999",
    padding: "4px 10px",
    borderRadius: 4,
    fontSize: 12,
    cursor: "pointer",
};
