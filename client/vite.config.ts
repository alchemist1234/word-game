import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

// uni-app 构建配置（H5 / 微信小程序）
// 单测配置见 vitest.config.ts（不加载 uni 插件，保持 core 逻辑干净）
export default defineConfig({
  plugins: [uni()],
  server: {
    // H5 开发代理 /api -> Nest.js（:3000）
    // 不 rewrite：Nest.js 已设 globalPrefix('api')，完整路径 /api/game/... 匹配
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
