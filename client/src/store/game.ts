import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CellPos, FoundWord, GamePhase, Rarity } from '../core/types'
import {
  fetchGrid,
  endGame as endGameApi,
  startLevel as startLevelApi,
  submitLevel as submitLevelApi,
  type SubmitWordResponse,
} from '../api'
import { connectSocket, sendWs, type WsMessage } from '../api/socket'

const GAME_DURATION = 90

let timerId: ReturnType<typeof setInterval> | null = null

export const useGameStore = defineStore('game', () => {
  const phase = ref<GamePhase>('idle')
  const matchSessionId = ref<string>('')
  const grid = ref<string[][]>([])
  const selectedCells = ref<CellPos[]>([])
  const foundWords = ref<FoundWord[]>([])
  const score = ref(0)
  const timeLeft = ref(GAME_DURATION)
  const lastFeedback = ref<'success' | 'fail' | 'duplicate' | null>(null)
  const lastFloatScore = ref<number | null>(null)
  const lastFoundRarity = ref<string | null>(null)
  const loading = ref(false)
  const errorMsg = ref<string | null>(null)
  const combo = ref(0)
  const comboBonus = ref(0)
  const comboScore = ref(0)
  const maxCombo = ref(0)
  const potentialCount = ref(0)
  // 闯关模式
  const levelMode = ref(false)
  const levelId = ref<string>('')
  const levelTitle = ref<string>('')
  const objective = ref<{ type: string; target?: number; score?: number; char?: string } | null>(null)
  const lastStars = ref(0)
  const canNext = ref(false)
  const nextLevelId = ref<string | null>(null)
  const perfect = ref(false)
  const perfectBonus = ref(0)
  const unfoundWords = ref<Array<{ word: string; rarity: string }>>([])
  const isBossLevel = ref(false)
  // 对战模式（迭代6：实时 1v1）
  const matchMode = ref(false)
  const matchId = ref('')
  const mySid = ref('')
  const opponent = ref<{
    nickname: string
    rankTier: number
    score: number
    combo: number
  } | null>(null)
  const matchRemaining = ref(0)
  const matchPhase = ref<'idle' | 'queuing' | 'countdown' | 'playing' | 'finished'>('idle')
  const matchEnd = ref<{
    winnerUserId: number | null
    my: MatchPlayerView
    opponent: MatchPlayerView
  } | null>(null)
  const wsConnected = ref(false)
  const opponentDelta = ref<{ delta: number; total: number } | null>(null)

  interface MatchPlayerView {
    score: number
    rareCount: number
    maxCombo: number
    foundWords: Array<{ word: string; score: number; rarity: string }>
  }
  interface MatchStartData {
    matchId: string
    grid: string[][]
    size: number
    duration: number
    mySid: string
    opponent: { nickname: string; rankTier: number }
  }

  /** 应用对战开局数据（WS match_start 广播或轮询 matched 兜底） */
  function applyMatchStartData(d: MatchStartData) {
    matchMode.value = true
    matchId.value = d.matchId
    mySid.value = d.mySid
    matchSessionId.value = d.mySid
    grid.value = d.grid
    score.value = 0
    combo.value = 0
    foundWords.value = []
    matchRemaining.value = d.duration
    matchPhase.value = 'countdown'
    phase.value = 'playing'
    opponent.value = { ...d.opponent, score: 0, combo: 0 }
  }
  // WebSocket 提词待匹配队列（消息有序，FIFO 匹配结果到提交的词）
  const pendingWords = ref<Array<{ word: string; cells: CellPos[] }>>([])

  const currentWord = computed(() => {
    if (grid.value.length === 0) return ''
    return selectedCells.value.map((c) => grid.value[c.row][c.col]).join('')
  })

  function clearTimer() {
    if (timerId !== null) {
      clearInterval(timerId)
      timerId = null
    }
  }

  function resetState() {
    selectedCells.value = []
    foundWords.value = []
    score.value = 0
    timeLeft.value = GAME_DURATION
    lastFeedback.value = null
    lastFloatScore.value = null
    lastFoundRarity.value = null
    errorMsg.value = null
    combo.value = 0
    comboBonus.value = 0
    comboScore.value = 0
    maxCombo.value = 0
    potentialCount.value = 0
    lastStars.value = 0
    perfect.value = false
    perfectBonus.value = 0
    unfoundWords.value = []
    pendingWords.value = []
    isBossLevel.value = false
  }

  /** 自由模式：开始新一局 */
  async function startGame() {
    clearTimer()
    resetState()
    levelMode.value = false
    levelId.value = ''
    objective.value = null
    loading.value = true
    phase.value = 'playing'
    try {
      const res = await fetchGrid(5, 'standard')
      matchSessionId.value = res.matchSessionId
      grid.value = res.grid
      timeLeft.value = res.duration
      timerId = setInterval(tick, 1000)
    } catch (e) {
      errorMsg.value = '网格加载失败，请确认后端服务已启动'
      console.error('fetchGrid failed', e)
      phase.value = 'idle'
    } finally {
      loading.value = false
    }
  }

  /** 闯关模式：开始关卡 */
  async function startLevel(id: string) {
    clearTimer()
    resetState()
    levelMode.value = true
    levelId.value = id
    canNext.value = false
    nextLevelId.value = null
    loading.value = true
    phase.value = 'playing'
    try {
      const res = await startLevelApi(id)
      matchSessionId.value = res.matchSessionId
      grid.value = res.grid
      timeLeft.value = res.duration
      objective.value = res.objective
      levelTitle.value = res.title
      isBossLevel.value = res.boss ?? false
      timerId = setInterval(tick, 1000)
    } catch (e) {
      errorMsg.value = '关卡加载失败'
      console.error('startLevel failed', e)
      phase.value = 'idle'
    } finally {
      loading.value = false
    }
  }

  function tick() {
    if (phase.value !== 'playing') return
    timeLeft.value--
    if (timeLeft.value <= 0) {
      endGame()
    }
  }

  function selectCell(cell: CellPos) {
    if (phase.value !== 'playing') return
    selectedCells.value.push(cell)
  }

  function retreat() {
    if (phase.value !== 'playing') return
    selectedCells.value.pop()
  }

  function clearSelection() {
    selectedCells.value = []
  }

  /** WebSocket 提词：发送后不阻塞，结果通过 handleWordResult 异步回调 */
  function submitSelection() {
    if (phase.value !== 'playing') return
    const cells = [...selectedCells.value]
    const word = currentWord.value
    selectedCells.value = []

    if (cells.length < 2) return

    // 记录待匹配的词（WebSocket 消息有序，FIFO 匹配结果）
    pendingWords.value.push({ word, cells })
    // cells 压缩为 [[r,c],...] 省字节
    sendWs('submit_word', {
      sid: matchSessionId.value,
      word,
      cells: cells.map((c) => [c.row, c.col]),
    })
  }

  /** 处理 WebSocket 返回的提词结果 */
  function handleWordResult(res: SubmitWordResponse) {
    const pending = pendingWords.value.shift()
    if (!pending) return

    if (res.valid && res.score !== undefined) {
      foundWords.value.push({
        word: pending.word,
        cells: pending.cells,
        score: res.score,
        rarity: (res.rarity ?? 'common') as Rarity,
      })
      score.value = res.totalScore ?? score.value + res.score
      combo.value = res.combo ?? 0
      comboBonus.value = res.comboBonus ?? 0
      maxCombo.value = Math.max(maxCombo.value, combo.value)
      lastFeedback.value = 'success'
      lastFloatScore.value = res.score
      lastFoundRarity.value = res.rarity ?? null
      // 完美通关：提前结束并结算（剩余时间加成）
      if (res.perfect) {
        perfect.value = true
        perfectBonus.value = res.perfectBonus ?? 0
        void endGame()
      }
    } else if (res.reason === 'duplicate') {
      lastFeedback.value = 'duplicate'
    } else {
      lastFeedback.value = 'fail'
    }
  }

  /** WebSocket 消息分发 */
  function handleWsMessage(msg: WsMessage) {
    if (msg.event === 'word_result') {
      handleWordResult(msg.data as SubmitWordResponse)
      return
    }
    // 对战事件（迭代6）
    if (msg.event === 'match_start') {
      applyMatchStartData(msg.data as MatchStartData)
      return
    }
    if (msg.event === 'match_countdown') {
      matchPhase.value = 'countdown'
      return
    }
    if (msg.event === 'match_tick') {
      const d = msg.data as {
        remainingSec: number
        myScore: number
        opponentScore: number
        myCombo: number
        opponentCombo: number
      }
      matchRemaining.value = d.remainingSec
      score.value = d.myScore
      combo.value = d.myCombo
      phase.value = 'playing'
      if (opponent.value) {
        opponent.value.score = d.opponentScore
        opponent.value.combo = d.opponentCombo
      }
      matchPhase.value = 'playing'
      return
    }
    if (msg.event === 'match_opponent_score') {
      opponentDelta.value = msg.data as { delta: number; total: number }
      return
    }
    if (msg.event === 'match_restore') {
      const d = msg.data as {
        matchId: string
        remainingSec: number
        myScore: number
        opponentScore: number
        grid: string[][]
        size: number
        mySid: string
        opponent: { nickname: string; rankTier: number }
      }
      matchMode.value = true
      matchId.value = d.matchId
      mySid.value = d.mySid
      matchSessionId.value = d.mySid
      grid.value = d.grid
      matchRemaining.value = d.remainingSec
      score.value = d.myScore
      matchPhase.value = 'playing'
      phase.value = 'playing'
      opponent.value = { ...d.opponent, score: d.opponentScore, combo: 0 }
      return
    }
    if (msg.event === 'match_end') {
      matchEnd.value = msg.data as {
        winnerUserId: number | null
        my: MatchPlayerView
        opponent: MatchPlayerView
      }
      matchPhase.value = 'finished'
      phase.value = 'idle'
      matchRemaining.value = 0
      return
    }
    // pong / error: 无需特殊处理
  }

  /** 建立 WebSocket 连接（登录后调用） */
  function connectWs() {
    const token = uni.getStorageSync('token')
    if (token) {
      connectSocket(token, handleWsMessage, (connected) => {
        wsConnected.value = connected
        // 断线重连成功且在对局中：发送 match_join 恢复房间
        if (connected && matchMode.value && matchId.value && matchPhase.value !== 'finished') {
          sendWs('match_join', { matchId: matchId.value })
        }
      })
    }
  }

  /** 结束对局：闯关模式调 submitLevel（含星级），自由模式调 endGame */
  async function endGame() {
    clearTimer()
    phase.value = 'finished'
    try {
      if (levelMode.value) {
        const res = await submitLevelApi(matchSessionId.value)
        score.value = res.score
        comboScore.value = res.comboScore
        maxCombo.value = res.maxCombo
        potentialCount.value = res.potentialCount
        lastStars.value = res.stars
        canNext.value = res.canNext
        nextLevelId.value = res.nextLevelId
        perfect.value = res.perfect
        perfectBonus.value = res.perfectBonus
        unfoundWords.value = res.unfoundWords
        foundWords.value = res.foundWords.map((f) => ({
          word: f.word,
          cells: [],
          score: f.score,
          rarity: f.rarity as Rarity,
        }))
      } else {
        const res = await endGameApi(matchSessionId.value)
        score.value = res.score
        comboScore.value = res.comboScore
        maxCombo.value = res.maxCombo
        potentialCount.value = res.potentialCount
        perfect.value = res.perfect
        perfectBonus.value = res.perfectBonus
        unfoundWords.value = res.unfoundWords
        foundWords.value = res.foundWords.map((f) => ({
          word: f.word,
          cells: [],
          score: f.score,
          rarity: f.rarity as Rarity,
        }))
      }
    } catch (e) {
      console.error('endGame failed', e)
    }
  }

  function restart() {
    clearTimer()
    phase.value = 'idle'
    matchSessionId.value = ''
    grid.value = []
    resetState()
    clearMatchState()
    levelMode.value = false
    levelId.value = ''
    objective.value = null
    levelTitle.value = ''
    canNext.value = false
    nextLevelId.value = null
    isBossLevel.value = false
  }

  /** 离开对局页清理：未结算时重置（再次进入重新开始），已结算保留数据给结算页 */
  function abandon() {
    clearTimer()
    if (phase.value === 'playing') {
      phase.value = 'idle'
      matchSessionId.value = ''
      grid.value = []
      resetState()
      clearMatchState()
      levelMode.value = false
      levelId.value = ''
      objective.value = null
      levelTitle.value = ''
      canNext.value = false
      nextLevelId.value = null
      isBossLevel.value = false
    }
  }

  function clearFeedback() {
    lastFeedback.value = null
    lastFloatScore.value = null
    lastFoundRarity.value = null
  }
  /** 清理对战状态（离开对战/重开时） */
  function clearMatchState() {
    matchMode.value = false
    matchId.value = ''
    mySid.value = ''
    opponent.value = null
    matchRemaining.value = 0
    matchPhase.value = 'idle'
    matchEnd.value = null
    opponentDelta.value = null
  }

  /** 对战结束/离开时清理（页面调用） */
  function resetMatch() {
    clearTimer()
    matchSessionId.value = ''
    grid.value = []
    foundWords.value = []
    score.value = 0
    combo.value = 0
    clearMatchState()
  }

  return {
    phase,
    matchSessionId,
    grid,
    selectedCells,
    foundWords,
    score,
    timeLeft,
    lastFeedback,
    lastFloatScore,
    lastFoundRarity,
    loading,
    errorMsg,
    combo,
    comboBonus,
    comboScore,
    maxCombo,
    potentialCount,
    levelMode,
    levelId,
    levelTitle,
    objective,
    lastStars,
    canNext,
    nextLevelId,
    perfect,
    perfectBonus,
    unfoundWords,
    isBossLevel,
    matchMode,
    matchId,
    mySid,
    opponent,
    matchRemaining,
    matchPhase,
    matchEnd,
    wsConnected,
    opponentDelta,
    currentWord,
    startGame,
    startLevel,
    tick,
    selectCell,
    retreat,
    clearSelection,
    submitSelection,
    endGame,
    restart,
    abandon,
    resetMatch,
    applyMatchStartData,
    clearFeedback,
    connectWs,
  }
})
