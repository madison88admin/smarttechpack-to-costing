/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Separate the dev-server cache from production build output. Running
  // `npm run dev` (NODE_ENV=development) and `npm run build` (production)
  // against the same .next directory corrupted the dev server on this
  // OneDrive box (missing webpack chunks, EINVAL readlink). Each mode now
  // owns its own directory, so they can never clobber each other.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next"
};

export default nextConfig;
