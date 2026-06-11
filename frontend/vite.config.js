import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error - node types might be missing
import path from "path";
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            // @ts-expect-error - Using process.cwd() as safe fallback for ESM/CJS
            "@": path.resolve(process.cwd(), "./src"),
        },
    },
    server: {
        port: 3000,
        proxy: {
            "/api/v1": {
                target: "http://localhost:8000",
                changeOrigin: true,
            },
        },
    },
    build: {
        // Performance optimizations
        target: 'es2020',
        // Use default 'esbuild' minification (faster, no extra deps)
        minify: 'esbuild',
        rollupOptions: {
            output: {
                // Code splitting for better caching
                manualChunks: {
                    'vendor-react': ['react', 'react-dom', 'react-router-dom'],
                    'vendor-mui': ['@mui/material', '@mui/icons-material'],
                    'vendor-data': ['@tanstack/react-query', 'axios', 'zustand'],
                    'vendor-charts': ['recharts'],
                    'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
                    'vendor-date': ['date-fns'],
                },
            },
        },
        chunkSizeWarningLimit: 1000,
    },
});
