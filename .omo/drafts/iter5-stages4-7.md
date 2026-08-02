---
slug: iter5-stages4-7
status: awaiting-approval
intent: clear
review_required: false
pending-action: write .omo/plans/iter5-stages4-7.md after user approval
approach: Finish 迭代5 remaining stages 4-7 per approved 详细设计 — backend Boss config + chapters 4-6 expansion, frontend Boss UI, 6×6 grid-gen validation, dictionary expansion to 15k, then dual-build + end-to-end integration verification.
---

# Draft: iter5-stages4-7

## Components (topology ledger)
| id | outcome | status |
|---|---|---|
| C1 backend 关卡配置 | levels.json 含第4-6章15关 + 1-3章第5关 boss:true；LevelConfig.boss 字段透传；CHAPTER_TITLES 6章 | active |
| C2 frontend Boss UI | Chapters 页 Boss 节点红色样式；Game 页 Boss 标签 | active |
| C3 6×6 grid-gen | 单测断言 size=6/可解/potential≥targets；调参候选 | active |
| C4 词库扩容 | import-dict 数量调至 15000（3750 成语 + 11250 普通），导入验证 | active |
| C5 集成验证 | 双端编译 + docker/PG 手动 QA 全链路 | active |

## Open assumptions (announced defaults)
| assumption | adopted default | rationale | reversible? |
|---|---|---|---|
| 词库构成 | 3750 成语(pos='i') + 11250 普通 = 15000，成语占比 25% | 设计说"成语≥25%"，数量内部可调 | yes（改 slice 数字重导入） |
| Boss 目标值 | 1-5 大×3 / 2-5 春×2 / 3-5 花×3 / 4-5 score70 / 5-5 idiom5 / 6-5 score100 | 设计 §4.2 已批准 | yes（改 levels.json） |
| 6×6 单测范围 | 只断言 size/可解/potential≥targets；60-100 区间留集成时用真实词库验证 | 测试词典仅 25 词，无法达到 potentialMin 60 | yes |
| 前端 Boss 样式 | 红色边框 + "Boss" 标签 | 设计 §4.4，细节实现时定 | yes |

## Findings (cited - path:lines)
- 词库数据源已在本地：`import-dict.ts:9` 用 `@node-rs/jieba/dict` 的 dict.txt（35万词条，pos='i' 标记成语）。扩容无需 GitHub，只改 `import-dict.ts:49-50` 的 slice 数量（当前 1500+4000=5500）。
- `grid-gen.test.ts` 用 25 词小词库（`grid-gen.test.ts:8-33`）；hard 档 `potentialMin:60`（`grid-gen/types.ts:42`）在小词库下不可达 → 单测只断言结构性属性。
- Boss 字段链路：`levels.json` → `LevelConfig`（`level.service.ts:15-25`）→ `getChapters`/`startLevel` 响应 → 前端 `ChaptersResponse`/`LevelStartResponse`（`client/src/api/index.ts`）。
- 前端 Chapters 页渲染结构在 `client/src/pages/Chapters/index.vue:57-71`（level-node 循环），Boss 样式加 class 即可。
- 现有 `calcStars`（`level.service.ts:229-238`）对 Boss 关复用（目标阈值更高），无需改逻辑。

## Decisions (with rationale)
- D1: 词库扩容仅改 import-dict slice 数量，不清空重导逻辑之外的任何表。`repo.clear()` 清 dictionary 表是既有行为；grid_pool / user_progress / user_found_words 不受影响。
- D2: 6×6 调参（candidateCount/idiomRatio/maxRounds）只在单测失败（小词库 hard 生成失败率高）时调整，否则不动 `DIFFICULTIES.hard`。
- D3: WebSocket 已实现（阶段1-3完成），本计划不含 WebSocket 新增逻辑；集成验证覆盖它即可。
- D4: 1-3章第5关改目标值 + boss:true，保留既有 user_progress（levelId 不变）。新玩家面对更高目标，既有玩家进度保留。

## Scope IN
- levels.json 第4-6章 15 关（含 4-5/5-5/6-5 boss:true）+ 1-3章第5关 boss 标记与目标提升
- level.service.ts：LevelConfig.boss 字段 + CHAPTER_TITLES 6 章 + getChapters/startLevel 透传 boss
- client：api 类型 + Chapters/Game 页 Boss 样式 + store isBossLevel
- grid-gen.test.ts 加 hard(6×6) 测试；必要时调参
- import-dict.ts 数量调至 15000 并导入（需 docker+PG）+ 验证统计
- 双端编译 + 手动 QA 全链路（登录→WS 提词→Boss 关显示→通关结算）

## Scope OUT (Must NOT have)
- ❌ AI 对手实现（迭代8）
- ❌ 主题词库精确切片（theme 字段，迭代8）
- ❌ 微信小程序真机验证（迭代6）
- ❌ WebSocket 房间/推送/实时对战（迭代6）
- ❌ 修改已完成的阶段1-3 WebSocket/内存优化逻辑（除非集成暴露缺陷）

## Open questions
- 无阻塞性疑问。词库导入（清空重导 dictionary 表）为既有脚本行为，需 docker+PG 运行。

## Approval gate
status: approved (user: "批准计划，$start-work 执行")
pending-action: write .omo/plans/iter5-stages4-7.md

## Process deviation log
- Metis 差距分析两次启动失败：`ProviderModelNotFoundError: Model not found: opencode-go/kimi-k3`（子代理模型配置无效，基础设施问题，非分析内容）。已重试一次仍失败。
- 回退：由规划者（Prometheus）自行完成同等严格的差距分析（见下），结果整合进正式计划。

## Planner gap analysis (replaces Metis)
| # | severity | gap | fix |
|---|---|---|---|
| G1 | blocker | C3 测试词典仅 25 词，hard 需 minTarget=14/candidateCount=20/idiomRatio=0.4（需 8 成语但词典仅 5）→ 生成可能失败，测试断言 potentialCount>=targetWords 可能红 | 扩充 testDict 至 30+ 词含 8+ 成语，或 hard 测试只断言 size=6+网格填充+targetWords 非空时可解 |
| G2 | important | 1-3 章第 5 关 specificWord 目标提升（大×3/春×2/花×3）依赖 4×4 网格确实含 N 个该字词，未验证 | C5 集成时用真实词库实际打 1-5/2-5/3-5 验证可达；不可达则回调目标值（记录到迭代说明） |
| G3 | important | boss 字段需贯穿 client api 类型（ChaptersResponse levels + LevelStartResponse），否则前端取不到 | C1 明确列出 client/src/api/index.ts 类型同步 |
| G4 | important | Game/index.vue 顶部 objective 显示逻辑未完整确认（codegraph 只显示部分） | C2 执行时先读完整 Game/index.vue 再改；C5 联调验证 |
| G5 | important | store isBossLevel 需在 resetState/restart/abandon 重置，否则上关状态泄漏 | C2 明确三处重置 |
| G6 | important | 词库扩容后 DictionaryService 内存缓存/grid-pool trie 是 onModuleInit 加载 → 需重启后端才生效 | C5 明确"导入后重启后端" |
| G7 | important | import-dict 需 docker+PG 运行；若 docker 不可用 C4/C5 阻塞 | C4/C5 QA 首步 `docker compose up -d`；不可用则报告阻塞不伪造 |
| G8 | minor | `nonIdiomOrdered.indexOf(e)` O(n²)（11250² 次比较），导入可能慢 | 可接受；改为 Map<word,idx> 优化（可选） |
| G9 | minor | jieba dict pos='i' 成语数未验证 ≥3750 | 导入时统计并断言 idiom 占比≥25%，不足则报告 |
| G10 | dirty | worktree 已有改动（AGENTS.md/迭代计划/详细设计/阶段1-3 代码/.omo） | 计划 Scope 注明；worker 只改计划内文件，不覆盖 |
