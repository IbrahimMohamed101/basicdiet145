import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
  images: {
    // Only the existing allowlisted proxy accepts query strings.
    localPatterns: [
      { pathname: "/api/meal-image" },
      { pathname: "/meals/**", search: "" },
      { pathname: "/menu-images/**", search: "" },
      { pathname: "/brand/**", search: "" },
    ],
  },
};

export default nextConfig;
