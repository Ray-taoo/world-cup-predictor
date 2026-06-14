/** @type {import('next').NextConfig} */
const isGithubPagesExport = process.env.GITHUB_PAGES_EXPORT === "1";

const nextConfig = {
  output: isGithubPagesExport ? "export" : undefined,
  basePath: isGithubPagesExport ? "/world-cup-predictor" : undefined,
  assetPrefix: isGithubPagesExport ? "/world-cup-predictor/" : undefined,
  images: {
    unoptimized: true
  },
  serverExternalPackages: ["sql.js"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb"
    }
  }
};

export default nextConfig;
