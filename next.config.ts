import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Keep the Playwright driver external — it is a Node library loaded at runtime by the PDF
  // export route (lib/pdf/generate-doc-pdf.ts), not something to bundle into the server build.
  serverExternalPackages: ["playwright"],
};

export default nextConfig;
