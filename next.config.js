/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pins the workspace root to this project so Next.js doesn't get confused
  // by an unrelated package-lock.json higher up in the user's home folder.
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        // Trimble Connect fetches the manifest cross-origin before installing
        // the extension, so it must be readable from any origin.
        source: "/:manifest(manifest|manifest-validacion).json",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
