import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The import form posts a whole export file through a server action.
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default nextConfig;
