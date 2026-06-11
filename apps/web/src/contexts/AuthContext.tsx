"use client";

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";
import {
    type AuthUser,
    apiGetMe,
    clearAuth,
    getStoredUser,
    getToken,
    storeAuth,
} from "../lib/auth";

interface AuthContextValue {
    user: AuthUser | null;
    token: string | null;
    loading: boolean;
    login: (token: string, redirectTo: string, mustChangePassword: boolean) => Promise<void>;
    logout: () => void;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    // Boot: restore from localStorage
    useEffect(() => {
        const storedToken = getToken();
        const storedUser = getStoredUser();
        if (storedToken && storedUser) {
            setToken(storedToken);
            setUser(storedUser);
            // Re-validate in background to catch deactivated users
            apiGetMe(storedToken)
                .then((freshUser) => {
                    setUser(freshUser);
                    storeAuth(storedToken, freshUser);
                })
                .catch(() => {
                    clearAuth();
                    setToken(null);
                    setUser(null);
                })
                .finally(() => setLoading(false));
        } else {
            setLoading(false);
        }
    }, []);

    const login = useCallback(
        async (newToken: string, redirectTo: string, mustChangePassword: boolean) => {
            const freshUser = await apiGetMe(newToken);
            storeAuth(newToken, freshUser);
            setToken(newToken);
            setUser({ ...freshUser, mustChangePassword });
            // Redirect handled by AuthGuard after state update
            window.location.href = redirectTo;
        },
        []
    );

    const logout = useCallback(() => {
        clearAuth();
        setToken(null);
        setUser(null);
        window.location.href = "/login";
    }, []);

    const refreshUser = useCallback(async () => {
        const t = getToken();
        if (!t) return;
        const freshUser = await apiGetMe(t);
        storeAuth(t, freshUser);
        setUser(freshUser);
    }, []);

    return (
        <AuthContext.Provider value={{ user, token, loading, login, logout, refreshUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}
