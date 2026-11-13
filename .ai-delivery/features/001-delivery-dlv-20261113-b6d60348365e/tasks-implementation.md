# 实现流式翻译实施任务

## 任务规则

- 每项任务使用格式：`- [ ] T001 [P?] [US?] 描述（准确仓库路径）`
- 每项任务必须引用来源 Intent、Specification 场景、Contract 或技术决策。
- 测试任务必须位于对应生产实现任务之前。
- CI、部署、Independent QA、UAT、发布、Review 和 Merge 结果属于下游平台证据。

## 依赖关系

- Phase 1 无前置依赖；`T001` 与 `T002` 修改不同文件，可并行执行。
- Phase 2 依赖 `T001`；`T003` 先固定共享协议契约，`T004` 再实现协议。
- Phase 3 依赖 `T002`、`T004`。`T005`～`T016` 先创建全部 focused unit、contract、integration、functional 和 end-to-end 测试及 fixture；`T017`～`T028` 再按任务内直接依赖实施生产代码。
- Phase 4 依赖完整应用与测试自动化；`T029` 与 `T031` 可并行准备互不冲突的候选制品，`T030` 等待容器契约确定，`T032` 执行本地 Coding 验证，`T033` 最终检查等待全部候选制品和验证完成。

## Phase 1：Setup

- [ ] T001 [P] 创建 Node.js 24 LTS、TypeScript 5.x、React 19、Vite、Fastify 5、Vitest 与 Playwright 的锁定 npm 工程；在 `package.json` 一次性声明 `react`、`react-dom`、`fastify`、`@fastify/static`、`@fastify/websocket`、`microsoft-cognitiveservices-speech-sdk`、`openai`、`@azure/identity`、`ajv` 及批准的 TypeScript/Vite/Vitest/Playwright/React/Node 开发依赖，生成完整 `package-lock.json`，配置 client/server 构建入口和 static analysis、build、developer test、integration test、functional test 脚本；以 clean checkout 执行 `npm ci` 不改写 manifest/lockfile、配置可加载且各分类脚本可启动至既定环境边界作为完成证据（`package.json`、`package-lock.json`、`index.html`、`tsconfig.json`、`tsconfig.client.json`、`tsconfig.server.json`、`vite.config.ts`、`vitest.config.ts`、`playwright.config.ts`；来源：TD-001、TD-002、TD-009、TD-011，design“Technical Context”“Component 边界与项目结构”“验证环境责任矩阵”；依赖：无）
- [ ] T002 [P] 创建批准的 Git 与容器构建忽略规则，排除依赖、构建/覆盖率/Playwright 结果、本地环境值、临时音频、Git 元数据和 Delivery 制品，同时保留锁文件；以 ignore 规则检查且无 secret 或运行产物被纳入候选上下文作为完成证据（`.gitignore`、`.dockerignore`；来源：TD-007，design“Component 边界与项目结构”；依赖：无）

## Phase 2：Foundational

- [ ] T003 编写 `translation.v1` WebSocket discriminated union、JSON schema validation、binary PCM 帧、UUID/sequence/revision、未知字段、事件终态和 close code 的 contract tests；以测试先因协议实现缺失而失败、并覆盖全部 client/server event 作为完成证据（`tests/contract/protocol.contract.test.ts`；来源：design“Browser—server WebSocket”“HTTP 与 schema”；依赖：T001）
- [ ] T004 实现前后端共享的 `translation.v1` 类型、运行时 schema validator、稳定错误枚举和协议常量，使 `T003` 通过（`src/shared/protocol.ts`；来源：design“Browser—server WebSocket”“HTTP 与 schema”；依赖：T003）

## Phase 3：US1 - 通过流式中文字幕理解会议发言

### 测试

- [ ] T005 [P] [US1] 创建获准、无敏感内容且可重复的两种 Azure Speech 可识别非中文语音及不可识别输入 fixture，并记录机器可读的 fixture id、语言用途、公开预期文本和目标场景，不写入真实会议内容或凭据（`tests/fixtures/audio/manifest.json`、`tests/fixtures/audio/recognized-language-a.wav`、`tests/fixtures/audio/recognized-language-b.wav`、`tests/fixtures/audio/unrecognized.wav`；来源：IQA-001、IQA-002、IQA-003、TD-012，design“安全、隐私、身份与 Secret”“验证环境责任矩阵”；依赖：T002）
- [ ] T006 [P] [US1] 编写 AudioWorklet 重采样、PCM16LE/16 kHz/mono、100 ms/3,200-byte 帧和停止时短尾帧的 focused unit tests；以正常采样、重采样和边界帧断言先失败作为完成证据（`tests/unit/audio-capture.test.ts`；来源：FR-003、TD-003，design“数据流、状态、并发与生命周期”；依赖：T001）
- [ ] T007 [P] [US1] 编写客户端字幕 reducer 与 WebSocket 生命周期的 focused unit tests，覆盖按 sequence 定位、revision 替换、final 后忽略迟到 delta、重复/旧事件、sequence gap 关闭以及 stop/unload 释放媒体轨；以全部状态转换断言先失败作为完成证据（`tests/unit/subtitle-reducer.test.ts`、`tests/unit/client-session.test.ts`；来源：AC-002、FR-004，design“Browser—server WebSocket”“安全、隐私、身份与 Secret”；依赖：T004）
- [ ] T008 [P] [US1] 编写 Speech adapter contract tests，覆盖 push stream、continuous recognition、continuous language identification、稳定/不可识别/canceled 映射、候选语言校验和幂等释放；以 fake 只证明端口契约且不声明 Azure 集成通过作为完成证据（`tests/contract/speech-adapter.contract.test.ts`；来源：FR-001、FR-002、FR-004、TD-004，design“Speech adapter contract”；依赖：T004）
- [ ] T009 [P] [US1] 编写 Foundry adapter contract tests，锁定 `gpt-sol-6.1`、单稳定片段输入、简体中文 system instruction、`stream:true`、`reasoning.effort="none"`、SSE delta/completed/error 映射、未知事件失败及允许的一次瞬时重试边界；以请求和流式事件契约先失败作为完成证据（`tests/contract/foundry-adapter.contract.test.ts`；来源：FR-003、NFR-001、TD-006，design“Foundry adapter contract”“SLO、限制、扩缩容、重试与恢复”；依赖：T004）
- [ ] T010 [P] [US1] 编写启动 contract probe tests，以 scriptable Foundry port 固定非敏感输入、`gpt-sol-6.1`、`stream:true`、`reasoning.effort="none"`，逐项覆盖允许事件、非空 delta/completed、认证或配置错误、参数拒绝、空流、error、未知/畸形事件、断流和超时，并断言 probe 为 `pending|failed` 时 readiness 返回 `503`、仅 `passed` 且未 draining 时返回 `200`；以全部通过/拒绝行为先失败且不访问 Azure 作为完成证据（`tests/contract/startup-contract.test.ts`；来源：TD-006，design“Foundry adapter contract”“HTTP 与 schema”；依赖：T004）
- [ ] T011 [P] [US1] 编写 Speech 连接级恢复 contract tests，以可脚本化 fake 覆盖首次 transient cancellation 后仅重建一次 recognizer、重建成功继续接收后续帧、创建或启动失败关闭、第二次取消关闭、认证/配置错误不重建、取消与 stop/disconnect/SIGTERM 竞态终止优先，并断言无音频/segment/字幕重放、sequence 连续和所有 recognizer/stream/callback 仅释放一次；以恢复边界先失败作为完成证据（`tests/contract/speech-recovery.contract.test.ts`；来源：FR-003、FR-004、TD-005，design“Speech adapter contract”；依赖：T004）
- [ ] T012 [P] [US1] 编写 session orchestrator focused unit tests，覆盖 final STT 才建 segment、同会话单并发递增队列、累计字幕 revision、失败不伪装成功、后续 segment 恢复、stop/drain/abort 清理及不重放已交付字幕；以状态机、顺序和恢复断言先失败作为完成证据（`tests/unit/session-orchestrator.test.ts`；来源：FR-003、FR-004、AC-002、AC-004、TD-005，design“领域与数据模型”“数据流、状态、并发与生命周期”；依赖：T004）
- [ ] T013 [P] [US1] 编写会话资源 contract tests：长会话连续完成至少 `2 × (16 + 1)` 个稳定 segment 并断言单 active request、queued 不超过 16、sequence/final 严格递增且无丢失重复；独立溢出运行在 1 个 active 加 16 个 queued 后由第 17 个 queued 触发资源保护关闭；两次运行均以 fake resource registry 断言 drain、abort 或 recognizer 重建后 frame、text、queue、callback、timer、recognizer 和 stream 的可达引用归零；以测试先失败且不使用进程 heap 阈值作为完成证据（`tests/contract/session-resource.contract.test.ts`；来源：TD-005、TD-007，design“SLO、限制、扩缩容、重试与恢复”；依赖：T004）
- [ ] T014 [P] [US1] 编写 Fastify gateway、配置、readiness、安全和日志 focused tests，覆盖精确 origin/子协议、控制消息与帧 allowlist、会话状态、draining、缺失配置仅报 key、日志不含音频/文本/token/secret、异常连接释放和 `/health/ready` 仅表达配置与启动 contract 状态；以安全边界和脱敏断言先失败作为完成证据（`tests/unit/server-gateway.test.ts`、`tests/unit/config-and-logging.test.ts`；来源：TD-010，design“HTTP 与 schema”“安全、隐私、身份与 Secret”“配置、可观测性与运维”；依赖：T004）
- [ ] T015 [US1] 编写真实 Azure integration tests，使用 `T005` fixture 验证 continuous language identification 的实际候选范围、两种可识别语言、不可识别输入、启动 probe、流式 Responses schema、`gpt-sol-6.1`、关闭 reasoning、身份与稳定错误映射；测试由显式环境开关启用，只将 fixture id、request id、断言和状态写入普通报告，缺少 Azure 环境时明确 skip 而不得报告通过（`tests/integration/azure-translation.integration.test.ts`；来源：IQA-001、IQA-002、IQA-003、TD-004、TD-006、TD-012，design“验证环境责任矩阵”“Quickstart”；依赖：T005、T008、T009、T010）
- [ ] T016 [US1] 编写 Playwright/Chromium 完整用户流程自动化，分别覆盖无需手选语言的可识别发言期间持续中文字幕、第二种可识别语言和不可识别后恢复；使用 `T005` 的可重复浏览器音频输入，采集标有 fixture id、场景、candidate identity 和事件顺序的受控 trace/video/screenshot，普通报告仅记录 artifact 引用、断言和状态，禁止以页面加载、mock、health 或 build 替代真实 Azure 结果（`tests/e2e/iqa-001-streaming-subtitles.spec.ts`、`tests/e2e/iqa-002-second-language.spec.ts`、`tests/e2e/iqa-003-unrecognized-recovery.spec.ts`、`tests/e2e/support/audio-input.ts`；来源：IQA-001、IQA-002、IQA-003、AC-001～AC-004、TD-009、TD-012，Constitution 四，design“安全、隐私、身份与 Secret”；依赖：T005、T004）

### 实现

- [ ] T017 [P] [US1] 实现 AudioWorklet 音频采集、重采样、PCM16LE 帧化和 stop/unload 媒体资源释放，使 `T006` 通过（`src/client/audio/pcm-worklet.ts`、`src/client/audio/capture.ts`；来源：FR-003、TD-003，design“Browser client”“数据流、状态、并发与生命周期”；依赖：T006）
- [ ] T018 [P] [US1] 实现客户端 `translation.v1` WebSocket 会话与字幕 reducer，严格执行 ready 后发送音频、sequence/revision 更新、final 终态、gap 关闭和状态清理，使 `T007` 通过（`src/client/protocol/translation-client.ts`、`src/client/protocol/subtitle-reducer.ts`；来源：FR-003、FR-004、AC-002、AC-004，design“Browser—server WebSocket”；依赖：T007）
- [ ] T019 [US1] 实现无源语言选择控件的 React 页面，提供用户触发的开始/停止采集、会话状态及按 segment 顺序持续更新的中文字幕，并接入 `T017`、`T018`（`src/client/App.tsx`、`src/client/main.tsx`；来源：US-001、FR-002、FR-003、AC-001、AC-002、AC-003；依赖：T017、T018）
- [ ] T020 [P] [US1] 实现一次性环境配置解析、精确 origin、Speech endpoint/region 与候选语言校验、固定 Foundry deployment 检查、managed identity/受批准 secret reference 选择和不泄值错误，使 `T014` 的配置测试通过（`src/server/config/environment.ts`；来源：TD-004、TD-006、TD-010，design“配置、可观测性与运维”；依赖：T014）
- [ ] T021 [US1] 实现 Microsoft Speech SDK adapter，建立每会话 push stream/recognizer、开启 continuous recognition 与 continuous language identification、只上报稳定结果、映射不可识别/取消状态并幂等释放资源，使 `T008` 通过（`src/server/adapters/speech-recognizer.ts`；来源：FR-001、FR-002、FR-004、TD-004；依赖：T008、T020）
- [ ] T022 [US1] 实现 Azure AI Foundry Responses streaming adapter，固定 `gpt-sol-6.1`、简体中文、`reasoning.effort="none"`，使用 `DefaultAzureCredential` 或受批准 secret reference，执行流式事件映射和限定重试，使 `T009` 通过（`src/server/adapters/foundry-translator.ts`；来源：FR-003、NFR-001、TD-006；依赖：T009、T020）
- [ ] T023 [US1] 实现进程启动时仅执行一次的 Foundry contract probe，固定批准的非敏感输入及生产请求参数，将全部拒绝条件映射为持续 `failed` 且不由 readiness 重试，使 `T010` 通过（`src/server/adapters/startup-contract.ts`；来源：TD-006，design“Foundry adapter contract”；依赖：T010、T022）
- [ ] T024 [US1] 实现内存 `TranslationSession` 状态机和 orchestrator，串联 Speech 与 Foundry adapter，执行稳定片段过滤、单 worker 严格顺序、16 个 queued segment backpressure、累计 revision、失败/不可识别终态、后续恢复、首次 transient cancellation 的单次 recognizer 重建、终止竞态、drain 和有界资源清理，使 `T011`～`T013` 通过（`src/server/session/translation-session.ts`、`src/server/session/orchestrator.ts`；来源：FR-001～FR-004、AC-001～AC-004、TD-005、TD-007，design“Speech adapter contract”“SLO、限制、扩缩容、重试与恢复”；依赖：T011、T012、T013、T021、T022）
- [ ] T025 [P] [US1] 实现不含会议内容的结构化日志及稳定错误类别，只记录批准的 correlation/session hash、阶段、语言状态、sequence、request id、耗时和关闭类别，使 `T014` 的日志脱敏测试通过（`src/server/session/safe-logger.ts`；来源：TD-010，design“安全、隐私、身份与 Secret”“配置、可观测性与运维”；依赖：T014）
- [ ] T026 [US1] 实现 WebSocket route 的 origin、`translation.v1` 子协议、消息/帧/状态校验、每连接独占会话、标准 close code 与异常资源释放，使 gateway 测试通过并连接 `T024`（`src/server/routes/translation-websocket.ts`；来源：FR-001～FR-004，design“Browser—server WebSocket”“安全、隐私、身份与 Secret”；依赖：T014、T024、T025）
- [ ] T027 [US1] 实现 readiness route，只在配置 schema 与 `T023` 的启动 probe 为 `passed` 且进程未 draining 时返回 ready，其他状态返回 `503`，不把 health 当作功能验收（`src/server/routes/readiness.ts`；来源：design“Foundry adapter contract”“HTTP 与 schema”、technical baseline“运行与生命周期约束”；依赖：T010、T014、T020、T023）
- [ ] T028 [US1] 组装 Fastify 同源静态 Web app、WebSocket、readiness、SIGTERM 拒绝新会话及限时 drain 生命周期；以 `T006`～`T016` 均可针对完整应用执行、本地 unit/contract tests 可通过且 Azure 场景保持既定环境边界作为完成证据（`src/server/main.ts`；来源：US-001、TD-001、TD-002、TD-008，design“架构概览”“数据流、状态、并发与生命周期”；依赖：T019、T026、T027）

## Phase 4：Polish

- [ ] T029 [P] 创建 Node.js 24 LTS slim multi-stage production container，使用非 root runtime user、锁定依赖、只携带 server 与静态构建产物、监听 `PORT` 且不写持久数据；以本地 container build 和用户/文件清单检查作为 Coding 完成证据（`Dockerfile`；来源：TD-008，design“部署拓扑、迁移、Rollout 与 Rollback”；依赖：T028）
- [ ] T030 创建 active Feature 的部署契约，按平台 schema 声明幂等 clean-runner `developerSetupCommands`，并以唯一分类对象准确提供 `staticAnalysis`、`build`、`developerTests`、`integrationTests`、`functionalTests` 非空命令数组，同时声明 schema 要求的 Container Apps、health、identity/secret reference、revision rollout/rollback 和 candidate identity 输入；以 schema 校验、命令非 no-op 且分类顺序可执行作为完成证据，不要求最终 SHA、digest 或 QA target 已产生（`.ai-delivery/features/001-delivery-dlv-20261113-b6d60348365e/runtime/deployment.json`；来源：design“治理与技术约束”“部署拓扑、迁移、Rollout 与 Rollback”“验证环境责任矩阵”；依赖：T001、T015、T016、T029）
- [ ] T031 [P] 编写批准范围内的运维 runbook，覆盖 endpoint/deployment、managed identity/secret reference、候选语言能力依据、连接/乱序/限额诊断、无内容证据采集、drain、revision rollback 与首次部署失败停止，不增加 provider、SLO、保留策略或产品行为（`.ai-delivery/features/001-delivery-dlv-20261113-b6d60348365e/runtime/runbook.md`；来源：design“支持 Runbook”、technical baseline“运行与生命周期约束”；依赖：T028）
- [ ] T032 执行本地 Coding 验证：锁定依赖安装、TypeScript static analysis、production build、Vitest unit/contract tests 和 production container build；保存真实命令、stdout/stderr 与退出码，任何首次失败即停止且不得把未执行的 Azure integration 或 Playwright 真实流程记为通过（`package.json`、`package-lock.json`、`Dockerfile`、`.ai-delivery/features/001-delivery-dlv-20261113-b6d60348365e/runtime/deployment.json`；来源：design“验证环境责任矩阵”“Quickstart”；依赖：T028、T029、T030）
- [ ] T033 检查实现与自动化的 secret/会议内容泄漏、依赖安全问题、协议安全边界和批准根路径清单；确认所有实际改动均位于批准路径、固定 fixture 无敏感内容、受控验收 artifact 边界未被普通报告或仓库破坏且 `.github/workflows/` 未变，以扫描结果和完整变更清单作为完成证据（`package.json`、`package-lock.json`、`src/`、`tests/`、`Dockerfile`、`.dockerignore`、`.gitignore`、`.ai-delivery/features/001-delivery-dlv-20261113-b6d60348365e/runtime/`；来源：Constitution 三、TD-010、TD-012，design“安全、隐私、身份与 Secret”“Component 边界与项目结构”“部署拓扑、迁移、Rollout 与 Rollback”；依赖：T030、T031、T032）

## 完成证据

- Setup 与 Foundational 在 Coding 中以锁定的完整依赖、可调用的分类脚本、配置加载、先失败后通过的共享协议 contract tests 和 ignore 检查为证据。
- US1 在 Coding 中以先行 unit/contract tests、可执行的 Azure integration 与 Playwright 自动化、生产构建及本地无凭据验证结果为证据；fake、health、build 或页面 smoke 均不替代真实 Azure 完整流程。
- 真实 Azure integration、远程 Playwright、candidate image publication、最终 SHA/digest/QA target 一致性、Independent QA、UAT、发布审批、Review 和 Merge 的实际结果由后续平台阶段产生；Coding 只交付可执行测试、批准 fixture、受控 artifact 采集逻辑、`Dockerfile`、部署契约和 runbook。
- 真实会议音频、STT text、中文字幕、authorization header、token 和 secret 不得进入持久化证据。获准固定 fixture 生成的字幕、trace、video 和 screenshot 只能进入平台现有受限 QA artifact 存储；普通报告仅保存 fixture id、artifact 引用、断言、状态及批准的 request/correlation id。
