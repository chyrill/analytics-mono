import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_API_BASE:
      process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
    NEXT_PUBLIC_LEADS_API_BASE:
      process.env.NEXT_PUBLIC_LEADS_API_BASE ?? "http://localhost:3001",
    NEXT_PUBLIC_ZOHO_DATACENTER: process.env.NEXT_PUBLIC_ZOHO_DATACENTER ?? "com",
    NEXT_PUBLIC_ZOHO_ORG_ID: process.env.NEXT_PUBLIC_ZOHO_ORG_ID ?? "",
  },
};

export default nextConfig;
