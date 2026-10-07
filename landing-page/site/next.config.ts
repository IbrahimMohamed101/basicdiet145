import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Only the existing allowlisted proxy accepts query strings.
    localPatterns: [
      { pathname: "/api/meal-image" },
      { pathname: "/meals/**", search: "" },
      { pathname: "/brand/**", search: "" },
    ],
  },
};

export default nextConfig;
