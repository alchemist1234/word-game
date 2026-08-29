import { hitCell } from './gridHit'
import { describe, it, expect } from 'vitest'

const square = { left: 0, top: 0, width: 400, height: 400 }

describe('hitCell：正方形棋盘（宽=高）', () => {
  it('点击各行中心命中对应行', () => {
    for (let row = 0; row < 4; row++) {
      const y = row * 100 + 50
      expect(hitCell(square, 4, 50, y)?.row).toBe(row)
    }
  })

  it('点击列中心命中对应列', () => {
    for (let col = 0; col < 4; col++) {
      const x = col * 100 + 50
      expect(hitCell(square, 4, x, 50)?.col).toBe(col)
    }
  })

  it('行上半部分（视觉内）仍命中该行', () => {
    // 第 1 行视觉范围 y ∈ [100, 200)，点击 y=105（上半部分）→ 行 1
    expect(hitCell(square, 4, 50, 105)?.row).toBe(1)
  })

  it('越界返回 null', () => {
    expect(hitCell(square, 4, 0, 400)).toBeNull()
    expect(hitCell(square, 4, 400, 0)).toBeNull()
    expect(hitCell(square, 4, -1, 0)).toBeNull()
  })
})

describe('hitCell：非正方形棋盘（高 < 宽，布局拉伸）', () => {
  // 宽 400 高 300：csW=100, csH=75（格子视觉行高 75 < 列宽 100）
  const wide = { left: 0, top: 0, width: 400, height: 300 }

  it('点击第 1 行上半部分命中第 1 行（修复：行按高度等分）', () => {
    // 第 1 行视觉范围 y ∈ [75, 150)，点击 y=85（上半部分）
    // 旧逻辑（宽度 cs=100）：floor(85/100)=0 → 错误命中上方格子
    expect(hitCell(wide, 4, 50, 85)?.row).toBe(1)
  })

  it('点击第 1 行顶部 1px 内仍命中第 1 行', () => {
    expect(hitCell(wide, 4, 50, 75.5)?.row).toBe(1)
  })

  it('点击行边界上方 1px 命中上一行（边界正确）', () => {
    expect(hitCell(wide, 4, 50, 74.5)?.row).toBe(0)
  })

  it('点击最后一行底部越界', () => {
    expect(hitCell(wide, 4, 50, 300)).toBeNull()
  })

  it('列索引仍按宽度等分', () => {
    expect(hitCell(wide, 4, 250, 50)?.col).toBe(2)
  })
})

describe('hitCell：非法矩形', () => {
  it('宽高为 0 或 size 为 0 返回 null', () => {
    expect(hitCell({ left: 0, top: 0, width: 0, height: 0 }, 4, 10, 10)).toBeNull()
    expect(hitCell(square, 0, 10, 10)).toBeNull()
  })
})
