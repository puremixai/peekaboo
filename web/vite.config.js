import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发时前端跑在 5173，/api 代理到本地 Go 服务（8080），
// 这样前端代码里一律用相对路径 /api/xxx，生产环境同源部署无需改动。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
})
