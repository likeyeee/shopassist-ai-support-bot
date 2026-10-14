import type { NextConfig } from 'next';
const config: NextConfig = { output: 'export', basePath: process.env.NEXT_PUBLIC_BASE_PATH || '', images: { unoptimized: true }, poweredByHeader: false };
export default config;
