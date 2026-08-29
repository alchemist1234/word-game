<script setup lang="ts">
import { ref } from 'vue'
import { login, sendSmsCode, setToken, getToken } from '../../api'
import { disconnectSocket } from '../../api/socket'
import { useGameStore } from '../../store/game'

const phone = ref('')
const code = ref('')
const loading = ref(false)
const errorMsg = ref('')

async function onSendCode() {
  if (!phone.value || phone.value.length < 6) {
    errorMsg.value = '请输入正确的手机号'
    return
  }
  try {
    await sendSmsCode(phone.value)
    errorMsg.value = '验证码已发送（mock：1234）'
  } catch (e) {
    errorMsg.value = '发送失败'
  }
}

async function onLogin() {
  if (!phone.value || !code.value) {
    errorMsg.value = '请输入手机号和验证码'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await login('h5', phone.value, code.value)
    setToken(res.token)
    // 建立 WebSocket 连接（划词判定走长连接）
    disconnectSocket()
    useGameStore().connectWs()
    uni.reLaunch({ url: '/pages/Home/index' })
  } catch (e) {
    errorMsg.value = '登录失败，请检查验证码'
  } finally {
    loading.value = false
  }
}

// 已登录则跳章节
if (getToken()) {
  useGameStore().connectWs()
  uni.reLaunch({ url: '/pages/Home/index' })
}
</script>

<template>
  <view class="login">
    <text class="title">字海寻词</text>
    <view class="form">
      <input v-model="phone" class="input" type="number" placeholder="手机号" />
      <view class="code-row">
        <input v-model="code" class="input code-input" type="number" placeholder="验证码" />
        <button class="code-btn" @tap="onSendCode">获取</button>
      </view>
      <text v-if="errorMsg" class="error">{{ errorMsg }}</text>
      <button class="login-btn" :disabled="loading" @tap="onLogin">
        {{ loading ? '登录中...' : '登录' }}
      </button>
      <text class="hint">mock 验证码：1234</text>
    </view>
  </view>
</template>

<style scoped>
.login {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 200rpx;
  min-height: 100vh;
  background: linear-gradient(180deg, #f5f0e8 0%, #ede4d3 100%);
}
.title {
  font-size: 72rpx;
  font-weight: bold;
  color: #3a2e2e;
  margin-bottom: 80rpx;
}
.form {
  width: 600rpx;
  display: flex;
  flex-direction: column;
}
.input {
  height: 88rpx;
  background: #ffffff;
  border-radius: 12rpx;
  padding: 0 24rpx;
  font-size: 32rpx;
  margin-bottom: 24rpx;
  border: 2rpx solid #d4c8b8;
}
.code-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 24rpx;
}
.code-input {
  flex: 1;
  margin-bottom: 0;
  margin-right: 16rpx;
}
.code-btn {
  width: 160rpx;
  height: 88rpx;
  line-height: 88rpx;
  background: #e8e0d0;
  color: #3a2e2e;
  font-size: 26rpx;
  border-radius: 12rpx;
  border: none;
}
.code-btn::after { border: none; }
.error {
  font-size: 24rpx;
  color: #d94a4a;
  margin-bottom: 16rpx;
}
.login-btn {
  height: 88rpx;
  line-height: 88rpx;
  background: #4a90d9;
  color: #ffffff;
  font-size: 34rpx;
  border-radius: 44rpx;
  border: none;
  margin-top: 16rpx;
}
.login-btn::after { border: none; }
.hint {
  font-size: 22rpx;
  color: #b0a090;
  text-align: center;
  margin-top: 24rpx;
}
</style>
