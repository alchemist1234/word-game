/**
 * 网格命中纯逻辑（core 层，可独立单测）
 * 行列分别按宽/高等分：board 非正方形（布局拉伸）时，
 * 格子视觉行高 = height/size，若用单一宽度 cs 算行索引会系统性偏差
 * （点击行上半部分被算到上方格子）
 */

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface HitCell {
  row: number
  col: number
}

/**
 * 命中测试：给定棋盘矩形与网格大小，返回点击坐标命中的格子
 * @returns null 表示越界或矩形无效
 */
export function hitCell(
  rect: Rect,
  size: number,
  x: number,
  y: number,
): HitCell | null {
  if (size <= 0 || rect.width <= 0 || rect.height <= 0) return null
  // 列按宽度等分、行按高度等分（格子视觉尺寸由各自方向决定）
  const csW = rect.width / size
  const csH = rect.height / size
  const col = Math.floor((x - rect.left) / csW)
  const row = Math.floor((y - rect.top) / csH)
  if (row < 0 || row >= size || col < 0 || col >= size) return null
  return { row, col }
}
