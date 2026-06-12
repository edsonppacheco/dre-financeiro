import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Não empacota o pdf-parse no bundle; é carregado via require em runtime,
  // com seus arquivos auxiliares incluídos pelo file tracing da Vercel.
  serverExternalPackages: ['pdf-parse'],
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3001'] },
  },
};

export default nextConfig;
