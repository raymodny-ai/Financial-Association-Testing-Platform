import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // api_gateway 开发代理（T06 起服务监听 8787；Render 上由 CORS 配置接管）
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // G7：vendor 分割——AntD 系（含图标/字体库）与 React 系各自独立缓存，
        // 业务代码变更不再使巨型依赖 chunk 缓存失效（关闭 N1）
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (
            id.includes('antd') ||
            id.includes('@ant-design') ||
            id.includes('dayjs') ||
            /[/\\](rc-|@rc-component[/\\])/.test(id)
          ) {
            return 'vendor-antd';
          }
          if (id.includes('react') || id.includes('scheduler')) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
});
