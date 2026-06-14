/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["sql.js"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb"
    }
  }
};

export default nextConfig;
