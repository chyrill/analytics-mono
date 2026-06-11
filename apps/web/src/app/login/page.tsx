"use client";

import { useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { apiLogin } from "../../lib/auth";

export default function LoginPage() {
    const { login } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError("");
        setLoading(true);
        try {
            const result = await apiLogin(email, password);
            await login(result.token, result.redirectTo, result.mustChangePassword);
        } catch {
            setError("Having trouble? Contact your administrator.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={pageStyle}>
            <div style={cardStyle}>
                <h1 style={{ margin: "0 0 4px", fontSize: 22, color: "#e8e8e8" }}>
                    Harvest Analytics
                </h1>
                <p style={{ margin: "0 0 28px", fontSize: 13, color: "#666" }}>
                    Internal dashboard
                </p>
                <form onSubmit={handleSubmit}>
                    <label style={labelStyle}>Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        autoFocus
                        style={inputStyle}
                    />
                    <label style={labelStyle}>Password</label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                        style={inputStyle}
                    />
                    {error && (
                        <p style={{ color: "#fbbf24", fontSize: 13, margin: "10px 0 0" }}>
                            {error}
                        </p>
                    )}
                    <button type="submit" disabled={loading} style={btnStyle}>
                        {loading ? "Signing in…" : "Sign in"}
                    </button>
                </form>
            </div>
        </div>
    );
}

const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0f0f0f",
};

const cardStyle: React.CSSProperties = {
    background: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderRadius: 10,
    padding: "36px 32px",
    width: "100%",
    maxWidth: 360,
};

const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 13,
    color: "#aaa",
    marginBottom: 5,
    marginTop: 14,
};

const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 11px",
    background: "#111",
    border: "1px solid #333",
    borderRadius: 5,
    color: "#e8e8e8",
    fontSize: 14,
    boxSizing: "border-box",
};

const btnStyle: React.CSSProperties = {
    marginTop: 22,
    width: "100%",
    padding: "11px",
    background: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: 5,
    fontSize: 15,
    cursor: "pointer",
    fontWeight: 500,
};
