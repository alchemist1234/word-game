// 核心类型定义（对齐详细设计 §3）
// 框架无关的纯类型，uni-app / uni-app x 通用

/** 稀有度（对齐 GDD §2.4.2） */
export type Rarity = 'common' | 'normal' | 'rare' | 'idiom'

/** 词库条目（对齐 GDD §3.1.1，本迭代去掉 frequency/tags） */
export interface DictWord {
  /** 词语本体，如 "春暖花开" */
  word: string
  /** 字数 */
  length: number
  /** 稀有度 */
  rarity: Rarity
  /** 拆字数组，用于网格生成索引，如 ["春","暖","花","开"] */
  chars: string[]
}

/** 格子坐标 */
export interface CellPos {
  row: number
  col: number
}

/** 网格生成结果 */
export interface GeneratedGrid {
  /** 字符矩阵 grid[row][col] */
  grid: string[][]
  /** 生成时保证可连的目标词（本迭代仅生成用，不下发显示） */
  targetWords: string[]
  /** 网格尺寸 */
  size: number
}

/** 已找到的词 */
export interface FoundWord {
  word: string
  /** 连线路径 */
  cells: CellPos[]
  score: number
  rarity: Rarity
}

/** 提词校验结果 */
export interface CheckResult {
  valid: boolean
  reason?: 'not_in_dict' | 'path_invalid' | 'duplicate'
  score?: number
  rarity?: Rarity
}

/** 游戏阶段 */
export type GamePhase = 'idle' | 'playing' | 'finished'
