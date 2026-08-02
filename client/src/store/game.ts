import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CellPos, FoundWord, GamePhase, Rarity } from '../core/types'
import { fetchGrid, submitWord, endGame as endGameApi } from '../api'

/**
 * 单局状态机（迭代2改造：调后端 API，移除本地 gridGen/wordCheck/score）
 * 对齐迭代2详细设计 §8.3
 */
const GAME_DURATION = 180 // 兜底默认，实际以后端返回 duration 为准

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

  const currentWord = computed(() => {
    if (grid.value.length === 0) return ''
    return selectedCells.value
      .map((c) => grid.value[c.row][c.col])
      .join('')
  })

  function clearTimer() {
    if (timerId !== null) {
      clearInterval(timerId)
      timerId = null
    }
  }

  /** 开始新一局：从后端拉网格、重置状态、启动倒计时 */
  async function startGame() {
    clearTimer()
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

  /** 松开提交：调后端校验计分 */
  async function submitSelection() {
    if (phase.value !== 'playing') return
    const cells = [...selectedCells.value]
    const word = currentWord.value
    selectedCells.value = []

    if (cells.length < 2) {
      // 单字：静默忽略（未完成的无效操作，不触发失败判定与背景闪烁）
      return
    }

    try {
      const res = await submitWord(matchSessionId.value, word, cells)
      if (res.valid && res.score !== undefined) {
        foundWords.value.push({
          word,
          cells,
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
      } else if (res.reason === 'duplicate') {
        lastFeedback.value = 'duplicate'
      } else {
        lastFeedback.value = 'fail'
      }
    } catch (e) {
      console.error('submitWord failed', e)
      lastFeedback.value = 'fail'
    }
  }

  /** 结束对局：调后端结算 */
  async function endGame() {
    clearTimer()
    phase.value = 'finished'
    try {
      const res = await endGameApi(matchSessionId.value)
      score.value = res.score
      comboScore.value = res.comboScore
      maxCombo.value = res.maxCombo
      potentialCount.value = res.potentialCount
      foundWords.value = res.foundWords.map((f) => ({
        word: f.word,
        cells: [],
        score: f.score,
        rarity: f.rarity as Rarity,
      }))
    } catch (e) {
      console.error('endGame failed', e)
    }
  }

  function restart() {
    clearTimer()
    phase.value = 'idle'
    matchSessionId.value = ''
    grid.value = []
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
  }

  function clearFeedback() {
    lastFeedback.value = null
    lastFloatScore.value = null
    lastFoundRarity.value = null
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
    currentWord,
    startGame,
    tick,
    selectCell,
    retreat,
    clearSelection,
    submitSelection,
    endGame,
    restart,
    clearFeedback,
  }
})
