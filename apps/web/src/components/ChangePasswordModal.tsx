"use client";

import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { apiChangePassword, getToken } from "../lib/auth";

export default function ChangePasswordModal() {
    const { refreshUser } = useAuth();
    const [newPassword, setNewPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        if (newPassword.length < 8) {
            setError("Password must be at least 8 characters.");
            return;
        }
        if (newPassword !== confirm) {
            setError("Passwords do not match.");
            return;
        }
        const token = getToken();
        if (!token) return;
        try {
            setSaving(true);
            await apiChangePassword(token, newPassword);
            await refreshUser();
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : "Something went wrong.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div style={overlay}>
            <div style={modal}>
                <h2 style={{ margin: "0 0 8px", fontSize: 20, color: "#e8e8e8" }}>
                    Set Your Password
                </h2>
                <p style={{ margin: "0 0 20px", color: "#999", fontSize: 14 }}>
                    Please set a new password before continuing.
                </p>
                <form onSubmit={handleSubmit}>
                    <label style={labelStyle}>New Password</label>
                    <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        style={inputStyle}
                        autoFocus
                    />
                    <label style={labelStyle}>Confirm Password</label>
                    <input
                        type="password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        style={inputStyle}
                    />
                    {error && <p style={{ color: "#f87171", fontSize: 13, margin: "8px 0 0" }}>{error}</p>}
                    <button type="submit" disabled={saving} style={btnStyle}>
                        {saving ? "Saving…" : "Set Password"}
                    </button>
                </form>
            </div>
        </div>
    );
}

const overlay: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.75)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
};

const modal: React.CSSProperties = {
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: 8,
    padding: "32px 28px",
    width: "100%",
    maxWidth: 380,
};

const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 13,
    color: "#aaa",
    marginBottom: 4,
    marginTop: 12,
};

const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    background: "#111",
    border: "1px solid #444",
    borderRadius: 4,
    color: "#e8e8e8",
    fontSize: 14,
    boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = {
    marginTop: 20,
    width: "100%",
    padding: "10px",
    background: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    fontSize: 15,
    cursor: "pointer",
};
