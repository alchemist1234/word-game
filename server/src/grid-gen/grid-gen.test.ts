import { describe, it, expect, beforeAll } from '@jest/globals'
import { generateGrid } from './grid-gen'
import { Trie } from './trie'
import { computePotential } from './potential'
import type { CellPos, DictWord } from './types'

// 测试用小词库（验证逻辑，不依赖真实 5000 词库）
// 至少 13 个成语以满足 hard（6x6，idiomRatio 0.4 → 需要约 8 个 idiom 候选）
const testDict: DictWord[] = [
  { word: '中国', length: 2, frequency: 0.9, rarity: 'common', chars: ['中', '国'] },
  { word: '朋友', length: 2, frequency: 0.85, rarity: 'common', chars: ['朋', '友'] },
  { word: '时间', length: 2, frequency: 0.88, rarity: 'common', chars: ['时', '间'] },
  { word: '快乐', length: 2, frequency: 0.82, rarity: 'common', chars: ['快', '乐'] },
  { word: '今天', length: 2, frequency: 0.8, rarity: 'common', chars: ['今', '天'] },
  { word: '我们', length: 2, frequency: 0.92, rarity: 'common', chars: ['我', '们'] },
  { word: '生活', length: 2, frequency: 0.78, rarity: 'common', chars: ['生', '活'] },
  { word: '工作', length: 2, frequency: 0.75, rarity: 'common', chars: ['工', '作'] },
  { word: '学习', length: 2, frequency: 0.72, rarity: 'common', chars: ['学', '习'] },
  { word: '世界', length: 2, frequency: 0.7, rarity: 'common', chars: ['世', '界'] },
  { word: '国家', length: 2, frequency: 0.68, rarity: 'common', chars: ['国', '家'] },
  { word: '文化', length: 2, frequency: 0.5, rarity: 'common', chars: ['文', '化'] },
  { word: '犹豫', length: 2, frequency: 0.3, rarity: 'normal', chars: ['犹', '豫'] },
  { word: '漫步', length: 2, frequency: 0.25, rarity: 'normal', chars: ['漫', '步'] },
  { word: '宁静', length: 2, frequency: 0.2, rarity: 'normal', chars: ['宁', '静'] },
  { word: '智慧', length: 2, frequency: 0.28, rarity: 'normal', chars: ['智', '慧'] },
  { word: '勇敢', length: 2, frequency: 0.26, rarity: 'normal', chars: ['勇', '敢'] },
  { word: '温柔', length: 2, frequency: 0.24, rarity: 'normal', chars: ['温', '柔'] },
  { word: '自来水', length: 3, frequency: 0.4, rarity: 'common', chars: ['自', '来', '水'] },
  { word: '说明书', length: 3, frequency: 0.35, rarity: 'common', chars: ['说', '明', '书'] },
  { word: '计算机', length: 3, frequency: 0.45, rarity: 'common', chars: ['计', '算', '机'] },
  { word: '图书馆', length: 3, frequency: 0.3, rarity: 'common', chars: ['图', '书', '馆'] },
  { word: '工程师', length: 3, frequency: 0.32, rarity: 'common', chars: ['工', '程', '师'] },
  { word: '科学家', length: 3, frequency: 0.28, rarity: 'common', chars: ['科', '学', '家'] },
  { word: '艺术家', length: 3, frequency: 0.22, rarity: 'normal', chars: ['艺', '术', '家'] },
  { word: '春暖花开', length: 4, frequency: 0.08, rarity: 'idiom', chars: ['春', '暖', '花', '开'] },
  { word: '画蛇添足', length: 4, frequency: 0.07, rarity: 'idiom', chars: ['画', '蛇', '添', '足'] },
  { word: '守株待兔', length: 4, frequency: 0.06, rarity: 'idiom', chars: ['守', '株', '待', '兔'] },
  { word: '亡羊补牢', length: 4, frequency: 0.07, rarity: 'idiom', chars: ['亡', '羊', '补', '牢'] },
  { word: '山清水秀', length: 4, frequency: 0.05, rarity: 'idiom', chars: ['山', '清', '水', '秀'] },
  { word: '一帆风顺', length: 4, frequency: 0.09, rarity: 'idiom', chars: ['一', '帆', '风', '顺'] },
  { word: '步步高升', length: 4, frequency: 0.08, rarity: 'idiom', chars: ['步', '步', '高', '升'] },
  { word: '马到成功', length: 4, frequency: 0.07, rarity: 'idiom', chars: ['马', '到', '成', '功'] },
  { word: '龙飞凤舞', length: 4, frequency: 0.05, rarity: 'idiom', chars: ['龙', '飞', '凤', '舞'] },
  { word: '鸟语花香', length: 4, frequency: 0.06, rarity: 'idiom', chars: ['鸟', '语', '花', '香'] },
  { word: '欣欣向荣', length: 4, frequency: 0.05, rarity: 'idiom', chars: ['欣', '欣', '向', '荣'] },
  { word: '心想事成', length: 4, frequency: 0.08, rarity: 'idiom', chars: ['心', '想', '事', '成'] },
  { word: '万事如意', length: 4, frequency: 0.09, rarity: 'idiom', chars: ['万', '事', '如', '意'] },
  { word: '风和日丽', length: 4, frequency: 0.07, rarity: 'idiom', chars: ['风', '和', '日', '丽'] },
  { word: '千山万水', length: 4, frequency: 0.06, rarity: 'idiom', chars: ['千', '山', '万', '水'] },
  { word: '花好月圆', length: 4, frequency: 0.07, rarity: 'idiom', chars: ['花', '好', '月', '圆'] },
  { word: '风调雨顺', length: 4, frequency: 0.05, rarity: 'idiom', chars: ['风', '调', '雨', '顺'] },
  { word: '国泰民安', length: 4, frequency: 0.06, rarity: 'idiom', chars: ['国', '泰', '民', '安'] },
  { word: '海阔天空', length: 4, frequency: 0.05, rarity: 'idiom', chars: ['海', '阔', '天', '空'] },
  { word: '百折不挠', length: 4, frequency: 0.04, rarity: 'idiom', chars: ['百', '折', '不', '挠'] },
  { word: '阳光', length: 2, frequency: 0.6, rarity: 'common', chars: ['阳', '光'] },
  { word: '雨露', length: 2, frequency: 0.45, rarity: 'common', chars: ['雨', '露'] },
  { word: '春风', length: 2, frequency: 0.4, rarity: 'common', chars: ['春', '风'] },
  { word: '秋月', length: 2, frequency: 0.35, rarity: 'common', chars: ['秋', '月'] },
  { word: '江山', length: 2, frequency: 0.5, rarity: 'common', chars: ['江', '山'] },
  { word: '明月', length: 2, frequency: 0.55, rarity: 'common', chars: ['明', '月'] },
  { word: '清风', length: 2, frequency: 0.4, rarity: 'common', chars: ['清', '风'] },
  { word: '飞鸟', length: 2, frequency: 0.35, rarity: 'common', chars: ['飞', '鸟'] },
  { word: '流水', length: 2, frequency: 0.5, rarity: 'common', chars: ['流', '水'] },
  { word: '花开', length: 2, frequency: 0.4, rarity: 'common', chars: ['花', '开'] },
  { word: '人山', length: 2, frequency: 0.3, rarity: 'normal', chars: ['人', '山'] },
  { word: '海角', length: 2, frequency: 0.3, rarity: 'normal', chars: ['海', '角'] },
  { word: '天涯', length: 2, frequency: 0.35, rarity: 'normal', chars: ['天', '涯'] },
  { word: '海风', length: 2, frequency: 0.3, rarity: 'normal', chars: ['海', '风'] },
  { word: '阳光明媚', length: 4, frequency: 0.1, rarity: 'idiom', chars: ['阳', '光', '明', '媚'] },
  { word: '春光明媚', length: 4, frequency: 0.09, rarity: 'idiom', chars: ['春', '光', '明', '媚'] },
  { word: '秋高气爽', length: 4, frequency: 0.08, rarity: 'idiom', chars: ['秋', '高', '气', '爽'] },
  { word: '蓝天', length: 2, frequency: 0.55, rarity: 'common', chars: ['蓝', '天'] },
  { word: '白云', length: 2, frequency: 0.5, rarity: 'common', chars: ['白', '云'] },
  { word: '大地', length: 2, frequency: 0.55, rarity: 'common', chars: ['大', '地'] },
  { word: '山河', length: 2, frequency: 0.5, rarity: 'common', chars: ['山', '河'] },
  { word: '金色', length: 2, frequency: 0.4, rarity: 'common', chars: ['金', '色'] },
  { word: '红色', length: 2, frequency: 0.4, rarity: 'common', chars: ['红', '色'] },
  { word: '绿色', length: 2, frequency: 0.4, rarity: 'common', chars: ['绿', '色'] },
  { word: '海洋', length: 2, frequency: 0.45, rarity: 'common', chars: ['海', '洋'] },
  { word: '森林', length: 2, frequency: 0.4, rarity: 'common', chars: ['森', '林'] },
  { word: '花朵', length: 2, frequency: 0.4, rarity: 'common', chars: ['花', '朵'] },
  { word: '草原', length: 2, frequency: 0.35, rarity: 'common', chars: ['草', '原'] },
  { word: '雪山', length: 2, frequency: 0.3, rarity: 'normal', chars: ['雪', '山'] },
  { word: '月亮', length: 2, frequency: 0.5, rarity: 'common', chars: ['月', '亮'] },
  { word: '星星', length: 2, frequency: 0.5, rarity: 'common', chars: ['星', '星'] },
  { word: '彩虹', length: 2, frequency: 0.35, rarity: 'normal', chars: ['彩', '虹'] },
  { word: '风景', length: 2, frequency: 0.4, rarity: 'common', chars: ['风', '景'] },
  { word: '美丽', length: 2, frequency: 0.45, rarity: 'common', chars: ['美', '丽'] },
  { word: '可爱', length: 2, frequency: 0.4, rarity: 'common', chars: ['可', '爱'] },
  { word: '开心', length: 2, frequency: 0.45, rarity: 'common', chars: ['开', '心'] },
  { word: '幸运', length: 2, frequency: 0.4, rarity: 'common', chars: ['幸', '运'] },
  { word: '幸福', length: 2, frequency: 0.5, rarity: 'common', chars: ['幸', '福'] },
  { word: '平安', length: 2, frequency: 0.45, rarity: 'common', chars: ['平', '安'] },
  { word: '健康', length: 2, frequency: 0.5, rarity: 'common', chars: ['健', '康'] },
  { word: '成功', length: 2, frequency: 0.45, rarity: 'common', chars: ['成', '功'] },
  { word: '胜利', length: 2, frequency: 0.4, rarity: 'common', chars: ['胜', '利'] },
  { word: '希望', length: 2, frequency: 0.45, rarity: 'common', chars: ['希', '望'] },
  { word: '梦想', length: 2, frequency: 0.4, rarity: 'common', chars: ['梦', '想'] },
  { word: '未来', length: 2, frequency: 0.4, rarity: 'common', chars: ['未', '来'] },
  { word: '公园', length: 2, frequency: 0.4, rarity: 'common', chars: ['公', '园'] },
  { word: '花园', length: 2, frequency: 0.4, rarity: 'common', chars: ['花', '园'] },
  { word: '校园', length: 2, frequency: 0.4, rarity: 'common', chars: ['校', '园'] },
  { word: '田园', length: 2, frequency: 0.35, rarity: 'common', chars: ['田', '园'] },
  { word: '果园', length: 2, frequency: 0.35, rarity: 'common', chars: ['果', '园'] },
  { word: '春天', length: 2, frequency: 0.5, rarity: 'common', chars: ['春', '天'] },
  { word: '夏天', length: 2, frequency: 0.45, rarity: 'common', chars: ['夏', '天'] },
  { word: '秋天', length: 2, frequency: 0.5, rarity: 'common', chars: ['秋', '天'] },
  { word: '冬天', length: 2, frequency: 0.5, rarity: 'common', chars: ['冬', '天'] },
  { word: '早晨', length: 2, frequency: 0.45, rarity: 'common', chars: ['早', '晨'] },
  { word: '黄昏', length: 2, frequency: 0.35, rarity: 'normal', chars: ['黄', '昏'] },
  { word: '夜晚', length: 2, frequency: 0.45, rarity: 'common', chars: ['夜', '晚'] },
  { word: '午时', length: 2, frequency: 0.3, rarity: 'normal', chars: ['午', '时'] },
  { word: '山川', length: 2, frequency: 0.4, rarity: 'common', chars: ['山', '川'] },
  { word: '河流', length: 2, frequency: 0.4, rarity: 'common', chars: ['河', '流'] },
  { word: '湖面', length: 2, frequency: 0.35, rarity: 'common', chars: ['湖', '面'] },
  { word: '海滨', length: 2, frequency: 0.3, rarity: 'normal', chars: ['海', '滨'] },
  { word: '天涯海角', length: 4, frequency: 0.05, rarity: 'idiom', chars: ['天', '涯', '海', '角'] },
  { word: '千姿百态', length: 4, frequency: 0.04, rarity: 'idiom', chars: ['千', '姿', '百', '态'] },
  { word: '五光十色', length: 4, frequency: 0.05, rarity: 'idiom', chars: ['五', '光', '十', '色'] },
  { word: '山高水长', length: 4, frequency: 0.04, rarity: 'idiom', chars: ['山', '高', '水', '长'] },
]

let trie: Trie
beforeAll(() => {
  trie = new Trie()
  for (const w of testDict) trie.insert(w.word)
})

/** 独立 DFS 验证词在网格上可连（不依赖生成器内部） */
function canFindWord(grid: string[][], word: string): boolean {
  const chars = word.split('')
  const size = grid.length
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === chars[0]) {
        if (dfs(grid, chars, 0, { row: r, col: c }, new Set([`${r},${c}`]))) {
          return true
        }
      }
    }
  }
  return false
}

function dfs(grid: string[][], chars: string[], idx: number, cell: CellPos, visited: Set<string>): boolean {
  if (grid[cell.row][cell.col] !== chars[idx]) return false
  if (idx === chars.length - 1) return true
  const size = grid.length
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue
      const nr = cell.row + dr
      const nc = cell.col + dc
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue
      const k = `${nr},${nc}`
      if (visited.has(k)) continue
      visited.add(k)
      if (dfs(grid, chars, idx + 1, { row: nr, col: nc }, visited)) return true
      visited.delete(k)
    }
  }
  return false
}

describe('generateGrid', () => {
  it('生成 5x5 网格（standard）', () => {
    const g = generateGrid('standard', testDict, trie)
    expect(g.size).toBe(5)
    expect(g.grid).toHaveLength(5)
    expect(g.grid[0]).toHaveLength(5)
  })

  it('网格无空格且均为单字', () => {
    const g = generateGrid('standard', testDict, trie)
    for (const row of g.grid) {
      for (const cell of row) {
        expect(typeof cell).toBe('string')
        expect(cell.length).toBe(1)
      }
    }
  })

  it('每个目标词在网格上确实可连（核心可解性，跑10次）', () => {
    for (let i = 0; i < 10; i++) {
      const g = generateGrid('standard', testDict, trie)
      expect(g.targetWords.length).toBeGreaterThanOrEqual(3)
      for (const w of g.targetWords) {
        expect(canFindWord(g.grid, w)).toBe(true)
      }
    }
  })

  it('潜在词池包含所有目标词', () => {
    const g = generateGrid('standard', testDict, trie)
    for (const w of g.targetWords) {
      expect(g.potentialWords).toContain(w)
    }
  })

  it('潜在词池数 >= 目标词数', () => {
    const g = generateGrid('standard', testDict, trie)
    expect(g.potentialCount).toBeGreaterThanOrEqual(g.targetWords.length)
  })

  it('potentialCount 与 potentialWords 长度一致', () => {
    const g = generateGrid('standard', testDict, trie)
    expect(g.potentialCount).toBe(g.potentialWords.length)
  })

  it('多次生成有随机性', () => {
    const g1 = generateGrid('standard', testDict, trie)
    const g2 = generateGrid('standard', testDict, trie)
    expect(JSON.stringify(g1.grid)).not.toEqual(JSON.stringify(g2.grid))
  })

  it('easy(4x4) 也能生成且可解', () => {
    const g = generateGrid('easy', testDict, trie)
    expect(g.size).toBe(4)
    for (const w of g.targetWords) {
      expect(canFindWord(g.grid, w)).toBe(true)
    }
  })

  it('多轮选优后潜在词池稳定且 >= 目标词数（难度校准不破坏可解性）', () => {
    for (let i = 0; i < 10; i++) {
      const g = generateGrid('standard', testDict, trie)
      expect(g.potentialCount).toBeGreaterThanOrEqual(g.targetWords.length)
      expect(g.potentialCount).toBeGreaterThan(0)
      for (const w of g.targetWords) {
        expect(canFindWord(g.grid, w)).toBe(true)
      }
    }
  })
})

describe('generateGrid hard', () => {
  it('生成 6x6 网格（hard）', () => {
    const g = generateGrid('hard', testDict, trie)
    expect(g.size).toBe(6)
    expect(g.grid).toHaveLength(6)
    expect(g.grid[0]).toHaveLength(6)
    for (const row of g.grid) {
      for (const cell of row) {
        expect(typeof cell).toBe('string')
        expect(cell.length).toBe(1)
      }
    }
  })

  it('hard 网格目标词可解（跑10次）', () => {
    for (let i = 0; i < 10; i++) {
      const g = generateGrid('hard', testDict, trie)
      expect(g.targetWords.length).toBeGreaterThanOrEqual(3)
      for (const w of g.targetWords) {
        expect(canFindWord(g.grid, w)).toBe(true)
      }
    }
  })

  it('hard 潜在词池 >= 目标词数', () => {
    const g = generateGrid('hard', testDict, trie)
    expect(g.potentialCount).toBeGreaterThanOrEqual(g.targetWords.length)
    expect(g.potentialCount).toBeGreaterThan(0)
  })
})

describe('computePotential', () => {
  it('对已知网格正确枚举潜在词', () => {
    // 简单 2x2 网格：中 国 朋 友 -> 可成"中国""朋友"
    const grid = [['中', '国'], ['朋', '友']]
    const words = computePotential(grid, trie)
    expect(words).toContain('中国')
    expect(words).toContain('朋友')
  })
})
