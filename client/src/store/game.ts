import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { CellPos, DictWord, FoundWord, GamePhase, GeneratedGrid } from '../core/types'
import { generateGrid } from '../core/gridGen'
import { checkWord, type WordCheckContext } from '../core/wordCheck'
import dictionary from '../data/dictionary.json'

// 词库索引（启动时构建一次）
const dict = dictionary as DictWord[]
const wordSet = new Set(dict.map((d) => d.word))
const wordMap = new Map(dict.map((d) => [d.word, d]))

const GAME_DURATION = 180 // 3 分钟（对齐 GDD §2.5）
const GRID_SIZE = 5

// 模块级定时器引用（避免响应式包裹）
let timerId: ReturnType<typeof setInterval> | null = null

/**
 * 单局状态机（对齐详细设计 §5.4）
 * 职责：网格生成、连线选中维护、提词提交计分、倒计时、阶段流转
 */
export const useGameStore = defineStore('game', () => {
  const phase = ref<GamePhase>('idle')
  const grid = ref<GeneratedGrid | null>(null)
  const selectedCells = ref<CellPos[]>([])
  const foundWords = ref<FoundWord[]>([])
  const score = ref(0)
  const timeLeft = ref(GAME_DURATION)
  const lastFeedback = ref<'success' | 'fail' | 'duplicate' | null>(null)
  const lastFloatScore = ref<number | null>(null)
  const lastFoundRarity = ref<string | null>(null)

  // 当前已选词（由 selectedCells 在网格上拼成）
  const currentWord = computed(() => {
    if (!grid.value) return ''
    return selectedCells.value
      .map((c) => grid.value!.grid[c.row][c.col])
      .join('')
  })

  function clearTimer() {
    if (timerId !== null) {
      clearInterval(timerId)
      timerId = null
    }
  }

  /** 开始新一局：生成网格、重置状态、启动倒计时 */
  function startGame() {
    clearTimer()
    grid.value = generateGrid(GRID_SIZE, dict)
    selectedCells.value = []
    foundWords.value = []
    score.value = 0
    timeLeft.value = GAME_DURATION
    lastFeedback.value = null
    lastFloatScore.value = null
    lastFoundRarity.value = null
    phase.value = 'playing'
    timerId = setInterval(tick, 1000)
  }

  /** 每秒倒计时，到点结束 */
  function tick() {
    if (phase.value !== 'playing') return
    timeLeft.value--
    if (timeLeft.value <= 0) {
      endGame()
    }
  }

  /** 连线交互：追加一个格子（由 GridBoard 判定相邻后调用） */
  function selectCell(cell: CellPos) {
    if (phase.value !== 'playing') return
    selectedCells.value.push(cell)
  }

  /** 连线交互：回退最后一个格子（手指滑回倒数第二格时） */
  function retreat() {
    if (phase.value !== 'playing') return
    selectedCells.value.pop()
  }

  /** 清空当前选中（不提交，用于异常恢复） */
  function clearSelection() {
    selectedCells.value = []
  }

  /** 松开提交：拼词 -> 校验 -> 计分 / 反馈 -> 清空选中 */
  function submitSelection() {
    if (phase.value !== 'playing') return
    const cells = [...selectedCells.value]
    const word = currentWord.value
    selectedCells.value = []

    if (cells.length < 2) {
      lastFeedback.value = 'fail'
      return
    }

    const ctx: WordCheckContext = {
      wordSet,
      wordMap,
      foundWords: foundWords.value,
    }
    const result = checkWord(word, cells, ctx)

    if (result.valid && result.score !== undefined && result.rarity) {
      foundWords.value.push({
        word,
        cells,
        score: result.score,
        rarity: result.rarity,
      })
      score.value += result.score
      lastFeedback.value = 'success'
      lastFloatScore.value = result.score
      lastFoundRarity.value = result.rarity
    } else if (result.reason === 'duplicate') {
      lastFeedback.value = 'duplicate'
    } else {
      lastFeedback.value = 'fail'
    }
  }

  /** 结束对局（时间到或主动结束） */
  function endGame() {
    clearTimer()
    phase.value = 'finished'
  }

  /** 重置回 idle（返回首页） */
  function restart() {
    clearTimer()
    phase.value = 'idle'
    grid.value = null
    selectedCells.value = []
    foundWords.value = []
    score.value = 0
    timeLeft.value = GAME_DURATION
    lastFeedback.value = null
    lastFloatScore.value = null
    lastFoundRarity.value = null
  }

  /** 清除一次性反馈（飘字/提示），供 UI 消费后重置 */
  function clearFeedback() {
    lastFeedback.value = null
    lastFloatScore.value = null
    lastFoundRarity.value = null
  }

  return {
    // state
    phase,
    grid,
    selectedCells,
    foundWords,
    score,
    timeLeft,
    lastFeedback,
    lastFloatScore,
    lastFoundRarity,
    // computed
    currentWord,
    // actions
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
