"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../contexts/AuthContext";
import ChangePasswordModal from "./ChangePasswordModal";

const PUBLIC_PATHS = ["/login", "/unauthorized"];

export default function AuthGuard({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth();
    const pathname = usePathname();
    const router = useRouter();
    const [ready, setReady] = useState(false);

    useEffect(() => {
        if (loading) return;

        const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

        if (!user) {
            if (!isPublic) router.replace("/login");
            else setReady(true);
            return;
        }

        // Authenticated user on login page → push to their home
        if (pathname.startsWith("/login")) {
            const home = user.isSuperAdmin
                ? "/"
                : (user.role?.pages[0]?.path ?? "/unauthorized");
            router.replace(home);
            return;
        }

        if (isPublic) {
            setReady(true);
            return;
        }

        // Check route authorisation for non-superadmins
        if (!user.isSuperAdmin) {
            const allowed = user.role?.pages.map((p) => p.path) ?? [];
            const normalised = pathname.replace(/\/$/, "") || "/";
            const isAllowed = allowed.some(
                (p) => p === normalised || p === pathname
            );
            if (!isAllowed) {
                router.replace("/unauthorized?reason=forbidden");
                return;
            }
        }

        setReady(true);
    }, [loading, user, pathname, router]);

    if (!ready) return null;

    return (
        <>
            {children}
            {user?.mustChangePassword && <ChangePasswordModal />}
        </>
    );
}
