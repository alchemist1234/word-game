<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'
import { useGameStore } from './store/game'
import { getToken } from './api'

// App 根组件：启动时若已登录则建立全局 WebSocket 连接（迭代6：对战广播依赖长连接）
onLaunch(() => {
  if (getToken()) {
    useGameStore().connectWs()
  }
})
</script>

<template>
  <view />
</template>
