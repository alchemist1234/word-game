import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

// uni-app 构建配置（H5 / 微信小程序）
// 单测配置见 vitest.config.ts（不加载 uni 插件，保持 core 逻辑干净）
export default defineConfig({
  plugins: [uni()],
})
