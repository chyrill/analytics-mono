"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authedFetch } from "../../lib/auth";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AppPage {
    id: number;
    path: string;
    label: string;
    sortOrder: number;
}

interface Role {
    id: number;
    name: string;
    pages: { pageId: number; path: string; label: string; position: number }[];
    userCount: number;
}

interface User {
    id: string;
    email: string;
    roleId: number | null;
    roleName: string | null;
    isActive: boolean;
    isSuperAdmin: boolean;
    mustChangePassword: boolean;
    createdAt: string;
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function UserManagementPage() {
    const [tab, setTab] = useState<"users" | "roles">("users");

    return (
        <div style={{ padding: "24px 28px", maxWidth: 1000 }}>
            <h1 style={{ margin: "0 0 20px", fontSize: 22, color: "#e8e8e8" }}>
                User Management
            </h1>
            <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid #222", paddingBottom: 0 }}>
                {(["users", "roles"] as const).map((t) => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        style={{
                            background: "none",
                            border: "none",
                            color: tab === t ? "#60a5fa" : "#666",
                            borderBottom: tab === t ? "2px solid #3b82f6" : "2px solid transparent",
                            padding: "8px 16px",
                            cursor: "pointer",
                            fontSize: 14,
                            fontWeight: tab === t ? 600 : 400,
                            textTransform: "capitalize",
                        }}
                    >
                        {t}
                    </button>
                ))}
            </div>
            {tab === "users" ? <UsersTab /> : <RolesTab />}
        </div>
    );
}

// ── Users Tab ─────────────────────────────────────────────────────────────────

function UsersTab() {
    const [users, setUsers] = useState<User[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [editUser, setEditUser] = useState<User | null>(null);
    const [resetResult, setResetResult] = useState<{ email: string; password: string } | null>(null);
    const [addResult, setAddResult] = useState<{ email: string; password: string } | null>(null);
    const [confirmDeactivate, setConfirmDeactivate] = useState<User | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        const [u, r] = await Promise.all([
            authedFetch("/users").then((r) => r.json()),
            authedFetch("/roles").then((r) => r.json()),
        ]);
        setUsers(u);
        setRoles(r);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    async function handleAdd(email: string, roleId: number | null) {
        const res = await authedFetch("/users", {
            method: "POST",
            body: JSON.stringify({ email, roleId }),
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error); return; }
        setAddResult({ email: data.email, password: data.generatedPassword });
        setShowAdd(false);
        load();
    }

    async function handleEdit(id: string, email: string, roleId: number | null) {
        const res = await authedFetch(`/users/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ email, roleId }),
        });
        if (!res.ok) { const d = await res.json(); alert(d.error); return; }
        setEditUser(null);
        load();
    }

    async function handleDeactivate(id: string) {
        const res = await authedFetch(`/users/${id}/deactivate`, { method: "PATCH" });
        if (!res.ok) { const d = await res.json(); alert(d.error); return; }
        setConfirmDeactivate(null);
        load();
    }

    async function handleReset(id: string, email: string) {
        const res = await authedFetch(`/users/${id}/reset-password`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) { alert(data.error); return; }
        setResetResult({ email, password: data.generatedPassword });
    }

    return (
        <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <span style={{ color: "#666", fontSize: 13 }}>{users.length} user{users.length !== 1 ? "s" : ""}</span>
                <button onClick={() => setShowAdd(true)} style={primaryBtn}>+ Add User</button>
            </div>

            {loading ? <p style={{ color: "#666" }}>Loading…</p> : users.length === 0 ? (
                <EmptyState message="No users yet. Add your first user." />
            ) : (
                <table style={tableStyle}>
                    <thead>
                        <tr>
                            {["Email", "Role", "Status", "Created"].map((h) => (
                                <th key={h} style={thStyle}>{h}</th>
                            ))}
                            <th style={thStyle} />
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((u) => (
                            <tr key={u.id} style={{ opacity: u.isActive ? 1 : 0.45 }}>
                                <td style={tdStyle}>{u.email}</td>
                                <td style={tdStyle}>{u.roleName ?? (u.isSuperAdmin ? "Superadmin" : "—")}</td>
                                <td style={tdStyle}>
                                    <span style={{ ...badge, background: u.isActive ? "#14532d" : "#3b1f1f", color: u.isActive ? "#4ade80" : "#f87171" }}>
                                        {u.isActive ? "Active" : "Inactive"}
                                    </span>
                                </td>
                                <td style={tdStyle}>{new Date(u.createdAt).toLocaleDateString()}</td>
                                <td style={{ ...tdStyle, textAlign: "right" }}>
                                    {!u.isSuperAdmin && (
                                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                                            <button style={ghostBtn} onClick={() => setEditUser(u)}>Edit</button>
                                            <button style={ghostBtn} onClick={() => handleReset(u.id, u.email)}>Reset pwd</button>
                                            {u.isActive && (
                                                <button style={{ ...ghostBtn, color: "#f87171", borderColor: "#3b1f1f" }} onClick={() => setConfirmDeactivate(u)}>
                                                    Deactivate
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {showAdd && <AddUserModal roles={roles} onSave={handleAdd} onClose={() => setShowAdd(false)} />}
            {editUser && <EditUserModal user={editUser} roles={roles} onSave={handleEdit} onClose={() => setEditUser(null)} />}
            {confirmDeactivate && (
                <ConfirmModal
                    message={`Deactivate ${confirmDeactivate.email}? They will immediately lose access.`}
                    onConfirm={() => handleDeactivate(confirmDeactivate.id)}
                    onClose={() => setConfirmDeactivate(null)}
                />
            )}
            {addResult && (
                <CredentialModal
                    title="User Created"
                    email={addResult.email}
                    password={addResult.password}
                    onClose={() => setAddResult(null)}
                />
            )}
            {resetResult && (
                <CredentialModal
                    title="Password Reset"
                    email={resetResult.email}
                    password={resetResult.password}
                    onClose={() => setResetResult(null)}
                />
            )}
        </>
    );
}

// ── Roles Tab ─────────────────────────────────────────────────────────────────

function RolesTab() {
    const [roles, setRoles] = useState<Role[]>([]);
    const [allPages, setAllPages] = useState<AppPage[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const [r, p] = await Promise.all([
            authedFetch("/roles").then((r) => r.json()),
            authedFetch("/roles/pages").then((r) => r.json()),
        ]);
        setRoles(r);
        setAllPages(p);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    async function handleAdd(name: string, pages: { pageId: number; position: number }[]) {
        const res = await authedFetch("/roles", {
            method: "POST",
            body: JSON.stringify({ name, pages }),
        });
        if (!res.ok) { const d = await res.json(); alert(d.error); return; }
        setShowAdd(false);
        load();
    }

    return (
        <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <span style={{ color: "#666", fontSize: 13 }}>{roles.length} role{roles.length !== 1 ? "s" : ""}</span>
                <button onClick={() => setShowAdd(true)} style={primaryBtn}>+ Add Role</button>
            </div>

            {loading ? <p style={{ color: "#666" }}>Loading…</p> : roles.length === 0 ? (
                <EmptyState message="No roles yet. Create a role before adding users." />
            ) : (
                <table style={tableStyle}>
                    <thead>
                        <tr>
                            {["Role Name", "Pages", "Users"].map((h) => (
                                <th key={h} style={thStyle}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {roles.map((r) => (
                            <tr key={r.id}>
                                <td style={tdStyle}>{r.name}</td>
                                <td style={tdStyle}>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                        {r.pages.map((p, i) => (
                                            <span key={p.pageId} style={{ ...badge, background: "#1e3a5f", color: "#93c5fd" }}>
                                                {i === 0 && <span style={{ opacity: 0.6, marginRight: 3 }}>↳</span>}
                                                {p.label}
                                            </span>
                                        ))}
                                    </div>
                                </td>
                                <td style={tdStyle}>{r.userCount}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            {showAdd && <AddRoleModal allPages={allPages} onSave={handleAdd} onClose={() => setShowAdd(false)} />}
        </>
    );
}

// ── Modals ─────────────────────────────────────────────────────────────────────

function AddUserModal({ roles, onSave, onClose }: { roles: Role[]; onSave: (email: string, roleId: number | null) => void; onClose: () => void }) {
    const [email, setEmail] = useState("");
    const [roleId, setRoleId] = useState<string>("");
    return (
        <Modal title="Add User" onClose={onClose}>
            <label style={labelStyle}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} autoFocus />
            <label style={labelStyle}>Role</label>
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)} style={inputStyle}>
                <option value="">— Select role —</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button style={{ ...primaryBtn, marginTop: 20, width: "100%" }} onClick={() => onSave(email, roleId ? Number(roleId) : null)}>
                Create User
            </button>
        </Modal>
    );
}

function EditUserModal({ user, roles, onSave, onClose }: { user: User; roles: Role[]; onSave: (id: string, email: string, roleId: number | null) => void; onClose: () => void }) {
    const [email, setEmail] = useState(user.email);
    const [roleId, setRoleId] = useState<string>(user.roleId?.toString() ?? "");
    return (
        <Modal title="Edit User" onClose={onClose}>
            <label style={labelStyle}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            <label style={labelStyle}>Role</label>
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)} style={inputStyle}>
                <option value="">— No role —</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button style={{ ...primaryBtn, marginTop: 20, width: "100%" }} onClick={() => onSave(user.id, email, roleId ? Number(roleId) : null)}>
                Save Changes
            </button>
        </Modal>
    );
}

function AddRoleModal({ allPages, onSave, onClose }: { allPages: AppPage[]; onSave: (name: string, pages: { pageId: number; position: number }[]) => void; onClose: () => void }) {
    const [name, setName] = useState("");
    const [selected, setSelected] = useState<number[]>([]);
    const dragPage = useRef<number | null>(null);

    function toggle(id: number) {
        setSelected((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    }

    function handleDragStart(id: number) { dragPage.current = id; }
    function handleDrop(targetId: number) {
        if (dragPage.current === null || dragPage.current === targetId) return;
        setSelected((prev) => {
            const from = prev.indexOf(dragPage.current!);
            const to = prev.indexOf(targetId);
            if (from === -1 || to === -1) return prev;
            const next = [...prev];
            next.splice(from, 1);
            next.splice(to, 0, dragPage.current!);
            return next;
        });
        dragPage.current = null;
    }

    const firstLabel = selected.length > 0
        ? allPages.find((p) => p.id === selected[0])?.label
        : null;

    return (
        <Modal title="Add Role" onClose={onClose}>
            <label style={labelStyle}>Role Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus placeholder="e.g. Marketing" />

            <label style={{ ...labelStyle, marginTop: 16 }}>Pages</label>
            {firstLabel && (
                <p style={{ fontSize: 12, color: "#60a5fa", margin: "4px 0 8px" }}>
                    Default landing: {firstLabel}
                </p>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {allPages.map((page) => {
                    const isChecked = selected.includes(page.id);
                    const pos = selected.indexOf(page.id);
                    return (
                        <div
                            key={page.id}
                            draggable={isChecked}
                            onDragStart={() => handleDragStart(page.id)}
                            onDragOver={(e) => { e.preventDefault(); }}
                            onDrop={() => handleDrop(page.id)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "8px 10px",
                                background: isChecked ? "#1e3a5f22" : "#111",
                                border: `1px solid ${isChecked ? "#3b82f6" : "#2a2a2a"}`,
                                borderRadius: 5,
                                cursor: isChecked ? "grab" : "default",
                            }}
                        >
                            <input type="checkbox" checked={isChecked} onChange={() => toggle(page.id)} style={{ accentColor: "#3b82f6" }} />
                            <span style={{ flex: 1, fontSize: 14, color: "#e8e8e8" }}>{page.label}</span>
                            <span style={{ fontSize: 11, color: "#555" }}>{page.path}</span>
                            {isChecked && pos === 0 && (
                                <span style={{ fontSize: 10, color: "#60a5fa", background: "#1e3a5f", padding: "2px 6px", borderRadius: 3 }}>
                                    Default
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>

            <button
                style={{ ...primaryBtn, marginTop: 20, width: "100%" }}
                onClick={() => onSave(name, selected.map((id, i) => ({ pageId: id, position: i + 1 })))}
                disabled={!name.trim() || selected.length === 0}
            >
                Create Role
            </button>
        </Modal>
    );
}

function ConfirmModal({ message, onConfirm, onClose }: { message: string; onConfirm: () => void; onClose: () => void }) {
    return (
        <Modal title="Confirm" onClose={onClose}>
            <p style={{ color: "#ccc", fontSize: 14, margin: "0 0 20px" }}>{message}</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button style={ghostBtn} onClick={onClose}>Cancel</button>
                <button style={{ ...primaryBtn, background: "#dc2626" }} onClick={onConfirm}>Confirm</button>
            </div>
        </Modal>
    );
}

function CredentialModal({ title, email, password, onClose }: { title: string; email: string; password: string; onClose: () => void }) {
    const [copied, setCopied] = useState(false);
    function copy() {
        navigator.clipboard.writeText(password);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }
    return (
        <Modal title={title} onClose={onClose}>
            <p style={{ color: "#aaa", fontSize: 13, margin: "0 0 16px" }}>
                Share these credentials with <strong style={{ color: "#e8e8e8" }}>{email}</strong>. The password is shown only once.
            </p>
            <div style={{ background: "#111", border: "1px solid #333", borderRadius: 5, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <code style={{ fontSize: 18, letterSpacing: 2, color: "#60a5fa" }}>{password}</code>
                <button style={ghostBtn} onClick={copy}>{copied ? "Copied!" : "Copy"}</button>
            </div>
            <button style={{ ...primaryBtn, marginTop: 20, width: "100%" }} onClick={onClose}>Done</button>
        </Modal>
    );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
            <div style={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, padding: "28px 24px", width: "100%", maxWidth: 460 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontSize: 17, color: "#e8e8e8" }}>{title}</h3>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: "#666", fontSize: 20, cursor: "pointer" }}>×</button>
                </div>
                {children}
            </div>
        </div>
    );
}

function EmptyState({ message }: { message: string }) {
    return (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#555", fontSize: 14 }}>
            {message}
        </div>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const tableStyle: React.CSSProperties = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
};

const thStyle: React.CSSProperties = {
    textAlign: "left",
    padding: "8px 10px",
    color: "#666",
    borderBottom: "1px solid #222",
    fontWeight: 500,
};

const tdStyle: React.CSSProperties = {
    padding: "10px 10px",
    borderBottom: "1px solid #1a1a1a",
    color: "#ccc",
    verticalAlign: "middle",
};

const badge: React.CSSProperties = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 3,
    fontSize: 11,
    fontWeight: 500,
};

const primaryBtn: React.CSSProperties = {
    background: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: 5,
    padding: "7px 14px",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: 500,
};

const ghostBtn: React.CSSProperties = {
    background: "none",
    border: "1px solid #333",
    color: "#aaa",
    borderRadius: 4,
    padding: "5px 10px",
    fontSize: 12,
    cursor: "pointer",
};

const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    color: "#888",
    marginBottom: 4,
    marginTop: 10,
};

const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    background: "#111",
    border: "1px solid #333",
    borderRadius: 4,
    color: "#e8e8e8",
    fontSize: 14,
    boxSizing: "border-box",
};
