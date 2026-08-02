<script setup lang="ts">
import { ref, computed, onMounted, nextTick, getCurrentInstance } from 'vue'
import type { CellPos } from '../core/types'

/**
 * GridBoard 网格连线交互组件（对齐详细设计 §6/§7.4）
 * - 8 向相邻连线，支持回退（滑回倒数第二格）
 * - touch + mouse 双输入（移动端 + H5 PC 测试）
 * - 选中格高亮 + 序号 + 连线段
 */
interface Props {
  grid: string[][]
  selectedCells: CellPos[]
  /** 已找到词的格子 "row,col" 集合，轻微高亮 */
  foundCells: Set<string>
}

const props = defineProps<Props>()
const emit = defineEmits<{
  select: [cell: CellPos]
  retreat: []
  submit: []
  clear: []
}>()

interface BoardRect { left: number; top: number; width: number; height: number }

const size = computed(() => props.grid.length)
const boardRect = ref<BoardRect>({ left: 0, top: 0, width: 0, height: 0 })
const cellSize = computed(() => (size.value > 0 ? boardRect.value.width / size.value : 0))

// 测量网格位置（mount + nextTick 确保 rpx 布局完成）
onMounted(async () => {
  await nextTick()
  const instance = getCurrentInstance()
  const query = instance?.proxy
    ? uni.createSelectorQuery().in(instance.proxy)
    : uni.createSelectorQuery()
  query
    .select('.board')
    .boundingClientRect((rect: BoardRect | null) => {
      if (rect) {
        boardRect.value = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }
      }
    })
    .exec()
})

function hitTest(x: number, y: number): CellPos | null {
  const cs = cellSize.value
  if (cs <= 0) return null
  const col = Math.floor((x - boardRect.value.left) / cs)
  const row = Math.floor((y - boardRect.value.top) / cs)
  if (row < 0 || row >= size.value || col < 0 || col >= size.value) return null
  return { row, col }
}

function sameCell(a: CellPos, b: CellPos): boolean {
  return a.row === b.row && a.col === b.col
}

// 8 方向扇区（atan2 角度顺序：右、右下、下、左下、左、左上、上、右上）
const DIRS8: ReadonlyArray<readonly [number, number]> = [
  [0, 1], // 0  右
  [1, 1], // 1  右下
  [1, 0], // 2  下
  [1, -1], // 3  左下
  [0, -1], // 4  左
  [-1, -1], // 5  左上
  [-1, 0], // 6  上
  [-1, 1], // 7  右上
]

// 统一指针处理
function handleStart(x: number, y: number) {
  const cell = hitTest(x, y)
  if (!cell) return
  emit('clear')
  emit('select', cell)
}

/**
 * 命中 + 方向一致模型
 * 必须进入其他格子（hitTest 命中），且命中格方向与手指移动方向一致才选中。
 * 解决：未进入格子即选中、边界闪烁、斜向误触。
 */
function handleMove(x: number, y: number) {
  if (props.selectedCells.length === 0) return
  const cells = props.selectedCells
  const current = cells[cells.length - 1]
  const cs = cellSize.value
  if (cs <= 0) return

  // 1. 必须命中其他格子（进入方格才考虑）
  const hit = hitTest(x, y)
  if (!hit || sameCell(hit, current)) return

  // 2. 手指相对 current 中心的位移（用于方向判定）
  const cx = current.col * cs + cs / 2
  const cy = current.row * cs + cs / 2
  const dx = x - boardRect.value.left - cx
  const dy = y - boardRect.value.top - cy
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist < cs * 0.2) return // 位移太小，方向不可靠

  // 3. 方向一致性：命中格方向 == 手指移动方向
  const hitDirRow = Math.sign(hit.row - current.row)
  const hitDirCol = Math.sign(hit.col - current.col)
  const angle = Math.atan2(dy, dx)
  const a = (angle + Math.PI * 2) % (Math.PI * 2)
  const sector = Math.floor((a + Math.PI / 8) / (Math.PI / 4)) % 8
  const [moveDr, moveDc] = DIRS8[sector]
  if (hitDirRow !== moveDr || hitDirCol !== moveDc) return // 方向不一致，忽略

  // 4. 必须相邻（防跳格）
  if (Math.abs(hit.row - current.row) > 1 || Math.abs(hit.col - current.col) > 1) return

  // 5. 回退 / 已选 / 追加
  if (cells.length >= 2 && sameCell(hit, cells[cells.length - 2])) {
    emit('retreat')
    return
  }
  if (cells.some((c) => sameCell(c, hit))) return
  emit('select', hit)
}

function handleEnd() {
  emit('submit')
}

// touch 事件（移动端 + H5 触屏）
interface TouchLike {
  touches: Array<{ clientX: number; clientY: number }>
}
function onTouchStart(e: TouchLike) {
  const t = e.touches[0]
  if (t) handleStart(t.clientX, t.clientY)
}
function onTouchMove(e: TouchLike) {
  const t = e.touches[0]
  if (t) handleMove(t.clientX, t.clientY)
}
function onTouchEnd() {
  handleEnd()
}

// mouse 事件（H5 PC 测试）
interface MouseLike {
  clientX: number
  clientY: number
}
let mouseDown = false

// H5：全局 mouseup 监听，防止在 board 外松开丢失提交（修复已知技术债）
function onWindowMouseUp() {
  if (mouseDown) {
    handleEnd()
    mouseDown = false
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('mouseup', onWindowMouseUp)
  }
}

function onMouseDown(e: MouseLike) {
  mouseDown = true
  handleStart(e.clientX, e.clientY)
  if (typeof window !== 'undefined') {
    window.addEventListener('mouseup', onWindowMouseUp)
  }
}
function onMouseMove(e: MouseLike) {
  if (mouseDown) handleMove(e.clientX, e.clientY)
}
function onMouseUp() {
  if (mouseDown) {
    handleEnd()
    mouseDown = false
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('mouseup', onWindowMouseUp)
  }
}

function isSelected(row: number, col: number): boolean {
  return props.selectedCells.some((c) => c.row === row && c.col === col)
}
function selectedOrder(row: number, col: number): number {
  return props.selectedCells.findIndex((c) => c.row === row && c.col === col)
}
function isFound(row: number, col: number): boolean {
  return props.foundCells.has(`${row},${col}`)
}

// 连线段（每对相邻选中格一条线）
interface LineSeg {
  left: number
  top: number
  width: number
  angle: number
}
const lines = computed<LineSeg[]>(() => {
  const cs = cellSize.value
  if (cs <= 0 || props.selectedCells.length < 2) return []
  const result: LineSeg[] = []
  for (let i = 1; i < props.selectedCells.length; i++) {
    const a = props.selectedCells[i - 1]
    const b = props.selectedCells[i]
    const ax = a.col * cs + cs / 2
    const ay = a.row * cs + cs / 2
    const bx = b.col * cs + cs / 2
    const by = b.row * cs + cs / 2
    const dx = bx - ax
    const dy = by - ay
    const len = Math.sqrt(dx * dx + dy * dy)
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI
    result.push({ left: ax, top: ay, width: len, angle })
  }
  return result
})
</script>

<template>
  <view
    class="board"
    @touchstart.prevent="onTouchStart"
    @touchmove.prevent="onTouchMove"
    @touchend="onTouchEnd"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
  >
    <view v-for="(row, ri) in grid" :key="ri" class="row">
      <view
        v-for="(ch, ci) in row"
        :key="ci"
        class="cell"
        :class="{
          'cell-selected': isSelected(ri, ci),
          'cell-found': isFound(ri, ci) && !isSelected(ri, ci),
        }"
      >
        <text class="char">{{ ch }}</text>
        <text v-if="isSelected(ri, ci)" class="order">{{ selectedOrder(ri, ci) + 1 }}</text>
      </view>
    </view>
    <view class="lines-overlay">
      <view
        v-for="(ln, i) in lines"
        :key="i"
        class="line"
        :style="{
          left: ln.left + 'px',
          top: ln.top + 'px',
          width: ln.width + 'px',
          transform: 'rotate(' + ln.angle + 'deg)',
        }"
      />
    </view>
  </view>
</template>

<style scoped>
.board {
  position: relative;
  width: 620rpx;
  height: 620rpx;
  display: flex;
  flex-direction: column;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
.row {
  flex: 1;
  display: flex;
  flex-direction: row;
}
.cell {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  border: 1rpx solid #d4c8b8;
  background: #faf6ef;
  box-sizing: border-box;
}
.cell-selected {
  background: #4a90d9;
  border-color: #2a70b9;
}
.cell-found {
  background: #e8f0e8;
}
.char {
  font-size: 52rpx;
  font-weight: bold;
  color: #3a2e2e;
}
.cell-selected .char {
  color: #ffffff;
}
.order {
  position: absolute;
  top: 4rpx;
  right: 8rpx;
  font-size: 22rpx;
  color: #ffffff;
  opacity: 0.85;
}
.lines-overlay {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.line {
  position: absolute;
  height: 8rpx;
  background: rgba(74, 144, 217, 0.55);
  transform-origin: 0 50%;
  border-radius: 4rpx;
}
</style>
