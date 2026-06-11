"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../../contexts/AuthContext";

export default function UnauthorizedPage() {
    const { user } = useAuth();
    const params = useSearchParams();
    const reason = params.get("reason");

    const isForbidden = reason === "forbidden";
    const dashboardPath =
        user?.isSuperAdmin ? "/" : (user?.role?.pages[0]?.path ?? "/");

    return (
        <div style={pageStyle}>
            <div style={cardStyle}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
                {isForbidden ? (
                    <>
                        <h2 style={headingStyle}>Access Denied</h2>
                        <p style={msgStyle}>
                            You don&apos;t have permission to view this page.
                        </p>
                        <Link href={dashboardPath} style={btnStyle}>
                            Go to Dashboard
                        </Link>
                    </>
                ) : (
                    <>
                        <h2 style={headingStyle}>No Pages Assigned</h2>
                        <p style={msgStyle}>
                            Your account doesn&apos;t have any pages assigned yet. Reach out
                            to your administrator to get access.
                        </p>
                    </>
                )}
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
    padding: "40px 32px",
    width: "100%",
    maxWidth: 400,
    textAlign: "center",
};

const headingStyle: React.CSSProperties = {
    margin: "0 0 12px",
    fontSize: 20,
    color: "#e8e8e8",
};

const msgStyle: React.CSSProperties = {
    margin: "0 0 24px",
    color: "#888",
    fontSize: 14,
    lineHeight: 1.6,
};

const btnStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "10px 20px",
    background: "#3b82f6",
    color: "#fff",
    textDecoration: "none",
    borderRadius: 5,
    fontSize: 14,
    fontWeight: 500,
};
