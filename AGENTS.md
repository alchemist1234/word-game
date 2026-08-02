# AGENTS.md — 字海寻词项目 AI Agent 指引

> 本文件是 AI coding agent 的项目入口。开始任何工作前必读。
> 完整设计见 `doc/` 下文档，本文件只做索引 + 关键约束 + 工作规则。

---

## 1. 项目概述

**字海寻词**：基于汉字网格的实时连线组词休闲竞技游戏。n×n 网格中每个格子一个汉字，玩家连接相邻汉字组成中文词语，按词长与稀有度积分。支持单人闯关与多人实时竞赛。

- **目标平台**：多端（微信/支付宝/抖音/百度/QQ/快手小程序 + 快应用 + H5 + Android/iOS）
- **当前状态**：迭代 2 已完成（后端 Nest.js + PG + Redis + 词库 5500 + 网格生成服务端权威）

---

## 2. 文档索引（doc/）

| 文档 | 内容 | 何时查 |
|---|---|---| 
| `doc/游戏设计文档.md` (GDD v0.2) | 玩法、词库、网格生成、模式、成长经济、UI、多端架构、运营 | 需要产品设计细节 |
| `doc/迭代计划.md` | 10 个增量可运行迭代 + 验收标准 + 技术债 | 规划下一步、查验收门禁 |
| `doc/迭代1-详细设计.md` | 迭代1的类型定义、算法、组件规格、连线交互模型 | 改迭代1代码前必读 |
| `doc/迭代2-详细设计.md` | 迭代2的三服务架构、数据模型、Go/Nest.js 设计、前端改造 | 改迭代2代码前必读 |
| `doc/迭代3-详细设计.md` | 迭代3的连击系统、难度校准、连击UI、结算页、音效 | 改迭代3代码前必读 |


---

## 3. 技术栈（版本已锁定，勿擅自升级）

| 层 | 技术 | 版本 | 锁定理由 |
|---|---|---|---|
| 前端框架 | uni-app（Vue3 + Vite + TS） | `@dcloudio/*: 3.0.0-alpha-5020320260731001` | vue3 dist-tag；latest 是 uni-app x(Vue2 线) |
| 构建 | Vite | `5.2.8` | `@dcloudio/vite-plugin-uni` peerDep 强制 |
| Vue | vue | `^3.5.40` | 满足 pinia 4 的 peerDep |
| 状态 | Pinia | `^4.0.2` | |
| 测试 | Vitest | `~3.2.7` | 兼容 vite 5（不用 4.x） |
| TypeScript | typescript | `~5.9.3` | 不用激进的 7.x |
| 类型 | @dcloudio/types | `3.4.31` | uni-app peerDep |

**关键决策：用标准 uni-app，不用 uni-app x。** uni-app x 不支持纯 CLI（必须 HBuilderX），而迭代 1-9 目标端是 H5+小程序（非原生 App），uni-app x 的 UTS 原生编译优势用不上。core 逻辑框架无关，迭代 9 App 端再迁 uni-app x（官方有 12 步迁移指南，有成本但可行）。详见 GDD §7、迭代计划 §0.2。

> 本地环境：GitHub 不通，npm 走 npmmirror 镜像。勿用 degit/GitHub 模板。

---

## 4. 代码结构

```
word-game/
├── AGENTS.md                # 本文件
├── doc/                     # 设计文档（GDD + 迭代计划 + 详细设计）
├── docker-compose.yml       # 本地 PG + Redis（镜像走 DaoCloud 加速）
├── client/                  # uni-app 前端（H5 + 微信小程序）
│   ├── vite.config.ts       # 构建配置 + H5 代理 /api -> :3000
│   ├── vitest.config.ts     # 独立单测配置
│   └── src/
│       ├── core/types.ts    # 共享类型（DictWord/CellPos/GamePhase...）
│       ├── api/index.ts     # 后端 API 层（fetch，H5）
│       ├── store/game.ts    # Pinia 单局状态机（调后端 API）
│       ├── components/GridBoard.vue  # 网格连线交互
│       └── pages/           # Home/Game/Result
└── server/                  # Nest.js 后端（:3000）
    ├── src/
    │   ├── grid-gen/        # ★ 网格生成（TS 实现，原 Go 工作）
    │   │   ├── trie.ts      # Trie 词库索引
    │   │   ├── grid-gen.ts  # 回溯生成（保证可解）
    │   │   ├── potential.ts # 潜在词池 DFS 枚举
    │   │   └── grid-gen.test.ts
    │   ├── dictionary/      # 词库 entity + service
    │   ├── grid-pool/       # 网格池（Redis + PG + cron 补充）
    │   ├── game/            # game API（grid/word/end）+ check.ts 提词校验/计分
    │   ├── common/          # config + redis module
    │   └── scripts/import-dict.ts  # 词库导入（@node-rs/jieba）
    └── package.json
```

> 迭代 2 架构调整：原设计 Go grid-service 并入 Nest.js（`server/src/grid-gen/` 用 TS 实现），少一个独立服务。

---

## 5. 开发命令

```bash
# 基础设施（PG + Redis，需 Docker Desktop 已启动）
docker compose up -d     # 镜像走 DaoCloud 加速（docker-compose.yml 已配置）
# docker 命令不可用时先加 PATH：
#   C:\Users\zhanchen\AppData\Local\Programs\DockerDesktop\resources\bin

# 后端（server/）
cd server
npm install --legacy-peer-deps        # typeorm 的 ioredis peerOptional 冲突
npx ts-node src/scripts/import-dict.ts # 导入词库 5500 词到 PG（仅首次）
npm run start:dev                      # 启动后端（:3000）
npm test                               # 后端单测（jest，26 个）

# 前端（client/）
cd client
npm run dev:h5           # H5 开发（:5173，/api 代理到 :3000）
npm run dev:mp-weixin    # 微信小程序
npm run build:h5         # 构建 H5
npm run build:mp-weixin  # 构建微信小程序
```

> 启动顺序：docker compose up → 导入词库 → 后端 → 前端。词库仅需导入一次。

---

## 6. 关键架构决策（勿推翻）

### 6.1 逻辑分层（迭代2调整）
迭代 2 起，核心逻辑迁移到后端：
- **网格生成**：`server/src/grid-gen/`（Trie + 回溯 + 潜在词池，TS 实现，原 Go 工作）
- **提词校验/计分**：`server/src/game/check.ts`（路径校验 + 计分，对齐 GDD §2.4）
- **前端**：只保留 `core/types.ts`（共享类型），store 调后端 API，无本地词库/生成逻辑
- 单测：后端 jest（26 个）覆盖可解性 + 校验计分

### 6.2 vitest 独立配置
`vitest.config.ts` 不加载 `@dcloudio/vite-plugin-uni`，避免 uni 插件干扰 core 单测。`vite.config.ts` 才加载 uni 插件用于构建。两套配置各司其职。

### 6.3 连线交互模型（迭代1定稿，勿改回命中模型）
GridBoard 的 `handleMove` 采用 **"命中 + 方向一致"模型**：
1. `hitTest` 命中其他格子（必须进入方格）
2. 位移 ≥ `cellSize × 0.2`（方向可靠）
3. 命中格方向 == 手指移动方向（`atan2` 归 8 扇区），不一致则忽略
4. 相邻校验（防跳格）
5. 回退/已选/追加

这是经过三轮迭代调优的定稿，解决了：未进格子即选中、边界闪烁、斜向误触三个问题。改 GridBoard 交互逻辑前先理解为何这样设计。

### 6.4 网格生成（服务端权威）
`server/src/grid-gen/` 回溯生成保证目标词可连，计算潜在词池（Trie 剪枝 DFS）。网格池预生成（Redis + PG + cron 补充），对局从池取用。提词校验含**拼字校验**（路径上的字必须拼成提交的词，防作弊刷分）。

### 6.5 计分公式（对齐 GDD §2.4）
`score = round(字数基础分 × 稀有度系数)`。迭代1无连击（连击迭代3加）。基础分：2字=2, 3字=5, 4字=10, 5字=20, 6+字=35。稀有度：common×1.0, normal×1.3, rare×1.8, idiom×2.5。

---

## 7. 编码约定与硬约束

### 硬约束（禁止）
- **禁止 `any` / `@ts-ignore` / `@ts-expect-error`** — 全栈严格类型
- **禁止空 catch** — `catch(e) {}`
- **禁止删除单测来"通过"** — 单测是质量底线
- **禁止跨迭代改动** — 只做当前迭代范围内的事
- **禁止引入架构外技术选型** — 技术栈见 §3，新增依赖先查 GDD §7

### 约定
- core/ 用相对路径导入（`./types`、`../core/...`）；勿引入 `@/` 别名（uni 别名行为不稳）
- 页面/组件 import core 用相对路径，注意层级（pages/ 下是 `../../core/`，components/ 下是 `../core/`）
- 函数式 Pinia store（`defineStore('name', () => {...})`）
- Vue3 `<script setup lang="ts">` + Composition API
- uni-app 事件用 `@tap`（不用 `@click`）；触摸用 `@touchstart/@touchmove/@touchend`
- 样式用 `rpx`（响应式单位，750rpx = 屏宽）；不用 `vw/vh` 混用
- 提词/计分当前在客户端（技术债 #3），迭代 2 起服务端权威

---

## 8. 技术债清单（活文档，见迭代计划附录A）

| # | 描述 | 偿还迭代 |
|---|---|---|
| 1 | 网格生成前端简化版 | ✅ 2 已偿（server/src/grid-gen） |
| 2 | 词库 60 词本地内置 | ✅ 2 已偿（PG 5500 词） |
| 3 | 提词/计分客户端化 | ✅ 2 已偿（服务端权威 + 拼字校验） |
| 4 | 无连击系统 | 3 |
| 5 | 网格生成难度校准待打磨（潜在词池区间可能偏差） | 3/5 调参 |
| 6 | 词库 5500，成语占比待提升（目标 2 万） | 8 |
| 7 | 前端 fetch 仅 H5，小程序需改 uni.request | 6（切真机时） |
| — | 音效未实现 | 后续增强 |
| — | H5 PC 鼠标拖出 board 松开可能丢失提交 | 小缺陷 |

> 改动引入新技术债时，在迭代计划附录 A 登记。

---

## 9. 迭代开发指引

- **按迭代顺序执行，不跳迭代**。当前在迭代 2（已完成），下一步迭代 3。
- 每个迭代结束必须是**端到端可运行可玩**状态，过验收 checklist（见迭代计划各迭代「验收标准」）才进入下一迭代。
- 迭代 2 已完成：后端三件套 + 词库 5500 + 网格生成服务端权威 + 前端调 API。grid-service 已并入 Nest.js（无独立 Go 服务）。
- 起步端策略：迭代 1-5 用 H5 开发验证（调试快），迭代 6（实时对战）切微信真机。
- 每个迭代的详细任务与验收见 `doc/迭代计划.md`。

---

## 10. AI Agent 工作规则

1. **改动前先查文档**：改代码前，先读 `doc/` 对应文档（GDD 查设计、迭代计划查范围与验收、迭代1详细设计查实现细节）。
2. **改 core 必跑单测**：`npm test` 必须全绿。新增 core 逻辑必须配单测。
3. **改完必验证构建**：`npm run build:h5` 通过；涉及小程序时 `npm run build:mp-weixin` 通过。
4. **不扩大范围**：bug 修复不做重构，重构不加功能。只改请求范围内的事。
5. **匹配代码风格**：改前读相邻代码，遵循已有命名/结构/路径约定。
6. **类型安全**：禁止 any 类抑制。与第三方类型边界用结构类型或 `unknown` + 收窄。
7. **记录决策**：做了 GDD 未覆盖的设计分叉，在迭代说明里记录（不改 GDD 除非用户要求）。
8. **遇到环境问题**：GitHub 不通用 npmmirror；版本冲突查 peerDep；uni-app 相关问题查 `doc/` 或 context7 官方文档。
9. **不要自作主张**：升级依赖版本、换框架、改架构决策（§6）前必须问用户。

---

## 11. 常见坑位

- **@dcloudio 版本**：用 `vue3` dist-tag（`3.0.0-alpha-...`），不是 `latest`（那是 uni-app x/Vue2 线 `2.0.2-...`）
- **vite 版本**：必须 `5.2.8`，不是 latest（vite 8 不被插件支持）
- **esbuild postinstall**：npm 12 会阻止，但 esbuild 0.20.2 已用平台包，阻止无影响
- **import 路径层级**：components/ 到 core/ 是 `../core/`（一级），pages/xxx/ 到 core/ 是 `../../core/`（两级）— 搞错会 build 失败
- **rpx vs px**：布局用 rpx，hitTest/连线坐标用 px（boundingClientRect 返回 px），cellSize = boardRect.width(px) / size
- **Docker 命令不可用**：docker.exe 在 `AppData\Local\Programs\DockerDesktop\resources\bin`，先加 PATH（含 docker-credential-desktop，否则 pull 报错）
- **Docker Hub 拉镜像超时**：国内走 DaoCloud 镜像源 `docker.m.daocloud.io/library/xxx`（docker-compose.yml 已配置）
- **typeorm + ioredis peerDep 冲突**：npm install 用 `--legacy-peer-deps`（ioredis 是 typeorm 的 peerOptional，可选不影响）
- **DTO/entity 属性 TS2564**：class-validator/TypeORM 字段需 `!` 断言（由框架填充，不经构造器）
- **@node-rs/jieba dict**：导出 Uint8Array，需 `Buffer.from(dict).toString('utf-8')` 解析
