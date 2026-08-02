# iter5-stages4-7 - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**What you'll get:** 迭代5的剩余部分完工：Boss 关（每章第5关，靠更高目标挑战而非AI）、第4-6章（节气节日/历史典故/山川地理）共15个新关卡、6×6 高难网格验证、词库从 5500 扩到 1.5 万。前端章节地图和游戏页显示 Boss 关的红色标识。全部经过双端编译和真实游戏流程验证。

**Why this approach:** 你已批准的设计——Boss 关用更高目标阈值（非AI对抗），WebSocket+内存优化已在阶段1-3完成并验证。剩余工作按"后端配置先行、前端展示依赖后端字段、数据与联调最后"的依赖顺序分3波并行推进。

**What it will NOT do:** 不实现AI对手（挪到迭代8）；不做主题词库精确切片（迭代8）；不做微信小程序真机验证（迭代6）；不动已完成的WebSocket/内存优化代码（除非联调暴露缺陷）。

**Effort:** Medium
**Risk:** Medium - 词库扩容与手动QA依赖本地docker环境；Boss 关目标值（如1-5找3个含"大"的词）能否达成需真实词库验证，不可达则回调目标值
**Decisions to sanity-check:** 1) Boss 目标值（大×3/春×2/花×3/4-5分70/5-5成语5/6-5分100）；2) 词库构成（3750成语+11250普通）；3) 词库导入会清空重导 dictionary 表（既有脚本行为）

Your next move: run `$start-work iter5-stages4-7` to execute, or run a high-accuracy review first. Full execution detail follows below.

---

> TL;DR (machine): Medium effort, Medium risk - C1‖C3 → C2‖C4 → C5, 6 todos + 4 final verifiers

## Scope
### Must have
- C1: `server/src/level/levels.json` 追加第4-6章15关（4-5/5-5/6-5 为 boss）+ 1-3章第5关 boss:true + 目标提升；`server/src/level/level.service.ts` `LevelConfig.boss?: boolean` + `CHAPTER_TITLES` 扩6章 + `getChapters`/`startLevel` 响应透传 boss；`client/src/api/index.ts` 类型同步（ChaptersResponse levels + LevelStartResponse + store isBossLevel）
- C2: `client/src/pages/Chapters/index.vue` Boss 节点红色边框 + "Boss"标签；`client/src/pages/Game/index.vue` Boss 目标标签
- C3: `server/src/grid-gen/grid-gen.test.ts` 加 hard(6×6) 结构化测试；必要时 `grid-gen.ts` 调参（candidateCount 20→24 / maxRounds 10→15）
- C4: `server/src/scripts/import-dict.ts` slice 数量调至 15000（3750 成语 + 11250 普通），导入验证成语占比
- C5: 双端编译 + docker 全链路手动 QA（登录 → WebSocket 提词 → Boss 关 → 通关结算）

### Must NOT have (guardrails, anti-slop, scope boundaries)
- ❌ AI 对手实现（迭代8）
- ❌ 主题词库精确切片（theme 字段，迭代8）
- ❌ 微信小程序真机验证（迭代6）
- ❌ WebSocket 房间/推送/实时对战（迭代6）
- ❌ 改动已完成的阶段1-3逻辑（内存优化/WebSocket/前端socket）除非集成暴露缺陷
- ❌ 修改 .omo/ 下已存在的 draft/plan 外的其他文件（AGENTS.md/迭代计划/迭代5-详细设计 已有改动，属工作区既有状态，不覆盖）

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD（C3 先写失败测试）+ tests-after（C1/C4 配置/数据变更）
- Framework: server=jest（已有 32 测试），client=build:h5
- Evidence: `.omo/evidence/<task>-iter5-stages4-7.<ext>`（每 todo 的 QA 场景产物）

## Execution strategy
### Parallel execution waves
- Wave 1 (parallel): Todo 1 (C1) ‖ Todo 2 (C3)
- Wave 2 (parallel): Todo 3 (C2, blocked by 1) ‖ Todo 4 (C4)
- Wave 3: Todo 5 (C5a 双端编译) → Todo 6 (C5b 手动 QA，需 docker)

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 (C1) | - | 3 | 2 |
| 2 (C3) | - | - | 1 |
| 3 (C2) | 1 (boss 字段契约) | - | 4 |
| 4 (C4) | docker up | 6 | 3 |
| 5 (C5a) | 1,2,3 | 6 | - |
| 6 (C5b) | 4,5 | - | - |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [ ] 1. C1 后端关卡配置：levels.json 扩容 + LevelConfig.boss + CHAPTER_TITLES + 类型同步
  What to do / Must NOT do:
  - `server/src/level/levels.json`：追加第4-6章15关（值见 doc/迭代5-详细设计.md §6.2，4-5/5-5/6-5 加 `"boss": true`）；修改 1-5（大 target 2→3）、2-5（春 target 1→2）、3-5（花 target 2→3）各加 `"boss": true`
  - `server/src/level/level.service.ts`：`LevelConfig` 接口加 `boss?: boolean`（15-25行）；`CHAPTER_TITLES` 加 4:'节气节日' 5:'历史典故' 6:'山川地理'（28-32行）；`getChapters` 的 levels 数组加 `boss` 字段（74-79行）；`startLevel` 返回加 `boss`（118-126行）
  - `client/src/api/index.ts`：`LevelStartResponse` 加 `boss?: boolean`（123-131行）；`ChaptersResponse` levels 加 `boss?: boolean`（139-146行）
  - `client/src/store/game.ts`：加 `isBossLevel` ref；`startLevel` 里存 `isBossLevel.value = res.boss ?? false`（103-127行）；`resetState`/`restart`/`abandon` 三处重置（G5）
  - MUST NOT: 不改 objective 判定逻辑；不改已有关卡 type
  Parallelization: Wave 1 | Blocked by: - | Blocks: 3
  References (executor has NO interview context - be exhaustive): `doc/迭代5-详细设计.md` §4.2 §6.2 §6.4; `server/src/level/levels.json:1-17`; `server/src/level/level.service.ts:15-32,44-51,74-79,98-127`; `client/src/api/index.ts:123-146`; `client/src/store/game.ts:34-76,103-127,236-265`
  Acceptance criteria (agent-executable): `cd server && npm run build` exit 0; `cd client && npm run build:h5` exit 0; 新增单测 `server/src/level/levels.test.ts` 断言 LEVELS 含 6 章、每章 5 关、第 5 关 boss:true、目标值正确 → `npm test` 全绿
  QA scenarios (name the exact tool + invocation): happy = 运行 `npm test` 断言 levels.test.ts 通过；failure = 手动把 1 个 boss 标记移除再跑测试断言其红。Evidence `.omo/evidence/1-iter5-stages4-7.txt`
  Commit: Y | feat(server): 迭代5 Boss关配置 + 第4-6章关卡扩容

- [ ] 2. C3 6×6 grid-gen 结构化测试 + 调参
  What to do / Must NOT do:
  - `server/src/grid-gen/grid-gen.test.ts`：先扩充 testDict 至 ≥30 词含 8+ 成语（G1，当前 25 词 5 成语不足 hard 的 minTarget=14/idiomRatio=0.4），再加 `describe('generateGrid hard')`：跑 10 次断言 size=6、grid 6×6 无空格、targetWords 非空时每个可连（复用 canFindWord）、potentialCount >= targetWords.length。**若 hard 用扩充后词典仍生成失败率高** → `server/src/grid-gen/grid-gen.ts` 调参（`candidateCount` 20→24 / `maxRounds` 10→15，types.ts:42），改后测试仍红则进一步扩词典或放宽断言为 targetWords>=3
  - MUST NOT: 不删减 existing 测试；不断言 potential 60-100（小词典达不到，G 已知，留 C5 真实词库验证）
  Parallelization: Wave 1 | Blocked by: - | Blocks: -
  References: `server/src/grid-gen/grid-gen.test.ts:8-33,77-146`; `server/src/grid-gen/types.ts:39-43`; `server/src/grid-gen/grid-gen.ts:174-235`
  Acceptance criteria (agent-executable): `cd server && npm test` 全绿，其中新 hard describe 通过
  QA scenarios: happy = `npm test` 断言 hard describe 10 次全过；failure = 临时把 testDict 还原为 25 词断言 hard 测试红（证明词典扩充必要）。Evidence `.omo/evidence/2-iter5-stages4-7.txt`
  Commit: Y | test(server): 迭代5 6×6 网格生成测试

- [ ] 3. C2 前端 Boss UI
  What to do / Must NOT do:
  - `client/src/pages/Chapters/index.vue`：level-node 循环里 `lv.boss` 为 true 时加 `boss` class + "Boss"标签（57-71行）；样式加 `.level-node.boss { border-color: #d94a4a; }` 红色边框 + `.boss-tag` 标签样式
  - `client/src/pages/Game/index.vue`：**先完整读取该文件**确认 objective 顶部显示位置（G4），Boss 关（store.isBossLevel）时目标旁加红色 "Boss"标签
  - MUST NOT: 不改 GridBoard 交互；不改 store 判定逻辑
  Parallelization: Wave 2 | Blocked by: 1 (boss 字段契约) | Blocks: -
  References: `client/src/pages/Chapters/index.vue:57-71,100-114`; `client/src/pages/Game/index.vue`（先完整读）; `client/src/store/game.ts` isBossLevel
  Acceptance criteria (agent-executable): `cd client && npm run build:h5` exit 0; 用 visual-qa/playwright 验证 Chapters 页第5关显示 Boss 红色样式（需起 dev 服务）
  QA scenarios: happy = `npm run dev:h5` 打开 Chapters 页截图断言 4-5/5-5/6-5 有 Boss 标签；failure = 断言非 boss 关卡无 Boss 标签。Evidence `.omo/evidence/3-iter5-stages4-7.png`
  Commit: Y | feat(client): 迭代5 Boss 关 UI 标识

- [ ] 4. C4 词库扩容至 15000
  What to do / Must NOT do:
  - `server/src/scripts/import-dict.ts`：`idioms.slice(0, 1500)` → `slice(0, 3750)`；`nonIdioms.slice(0, 4000)` → `slice(0, 11250)`（49-50行）
  - 运行导入（先 `docker compose up -d`，G7）：`cd server && npx ts-node src/scripts/import-dict.ts`
  - 验证：PG 查询 `SELECT rarity, COUNT(*) FROM dictionary GROUP BY rarity`；断言 total≈15000 且 idiom 占比≥25%（G9）；若 jieba dict 成语不足 3750 则按实际最大数导入并报告偏差
  - MUST NOT: 不改 rarity 计算逻辑；不手动改 PG 数据
  Parallelization: Wave 2 | Blocked by: docker up | Blocks: 6
  References: `server/src/scripts/import-dict.ts:39-58,62-83,100-120`; docker-compose.yml
  Acceptance criteria (agent-executable): 导入脚本 exit 0；`npx ts-node -e "..."` 或 psql 查询断言 dictionary 表 total≥14500 且 idiom≥25%
  QA scenarios: happy = 运行导入命令 + 查询统计；failure = 先跑 `docker compose stop` 再运行断言导入失败提示清晰。Evidence `.omo/evidence/4-iter5-stages4-7.txt`
  Commit: Y | feat(server): 迭代5 词库扩容至 1.5 万

- [ ] 5. C5a 双端编译验证
  What to do / Must NOT do:
  - `cd server && npm run build` exit 0；`cd server && npm test` 全绿
  - `cd client && npm run build:h5` exit 0
  - MUST NOT: 跳过任一编译；不改代码（纯验证）
  Parallelization: Wave 3 | Blocked by: 1,2,3 | Blocks: 6
  References: 各 todo 的产出文件
  Acceptance criteria (agent-executable): 三条命令均 exit 0
  QA scenarios: happy = 三命令输出 PASS；failure = 故意引入一个 TS 错误断言 build 失败（改回）。Evidence `.omo/evidence/5-iter5-stages4-7.txt`
  Commit: N（纯验证）

- [ ] 6. C5b 手动 QA 全链路
  What to do / Must NOT do:
  - 环境：`docker compose up -d` → 若 C4 未执行则先导入词库 → **重启后端**（G6：内存缓存/网格池需重新加载）`cd server && npm run start:dev` → `cd client && npm run dev:h5`
  - 流程（用 playwright/浏览器）：登录（mock 1234）→ Chapters 页确认 6 章、Boss 关样式 → 打 1-1 确认 WebSocket 提词（DevTools Network 断言无 /game/word HTTP 请求，WS 帧有 submit_word/word_result）→ 打 1-5（Boss）确认目标为 大×3 且可达成（G2 验证，不可达则回调目标值并记录）→ 通关结算页星级/词列表正常
  - MUST NOT: 不改代码除非暴露集成缺陷（此时记录缺陷并最小修复）
  Parallelization: Wave 3 | Blocked by: 4,5 | Blocks: -
  References: client/vite.config.ts (ws:true 代理); server/src/game/game.gateway.ts; store/game.ts submitSelection
  Acceptance criteria (agent-executable): 全链路无 console error；WS 提词成功加分；Boss 关目标显示正确
  QA scenarios: happy = 登录→Boss关→提词→结算全流程截图/日志；failure = 断网后提词断言错误提示而非静默失败。Evidence `.omo/evidence/6-iter5-stages4-7.<ext>`
  Commit: N（除非修复缺陷，则 feat/fix 提交）

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
- [ ] F3. Real manual QA
- [ ] F4. Scope fidelity

## Commit strategy
- 每 todo 一个原子 commit（1/2/3/4 各一，5/6 无），message 中文匹配仓库风格（git log 参考：feat/fix/test(server|client): 中文描述）
- 只提交计划内文件 + 该 todo 产出；不提交 .omo/run-continuation、不覆盖工作区既有改动

## Success criteria
- levels.json 含 6 章 × 5 关，第 5 关均 boss:true
- CHAPTER_TITLES 6 章，getChapters/startLevel 响应带 boss 字段，前端 Chapters/Game 页正确显示
- grid-gen hard(6×6) 测试全绿；集成时真实词库验证潜在词池 60-100
- dictionary 表 15000 词，成语占比≥25%
- server build+tests、client build:h5 全过
- 手动 QA 全链路（登录→WS 提词→Boss 关→结算）通过
