import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Set by the Next.js security upgrade (16.4.3 → 16.4.6).
    agentUpgrade: "security",
  },
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk", "@modelcontextprotocol/sdk", "@earendil-works/pi-ai", "@earendil-works/pi-agent-core"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
