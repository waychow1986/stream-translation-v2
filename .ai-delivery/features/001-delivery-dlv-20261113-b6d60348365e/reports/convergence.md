# Coding 后 Convergence 报告

## Candidate 与证据范围

- Active Feature：`.ai-delivery/features/001-delivery-dlv-20261113-b6d60348365e`
- 审查对象：Constitution、`intent.md`、`spec.md`、`technical-baseline.md`、`design.md`、`tasks-implementation.md`、全部已通过阶段门禁、当前实现与测试、`reports/implementation.md` 及 runtime 就绪制品。
- 阶段边界：本门禁位于平台 CI、image publication、远程部署、Independent QA、UAT、发布审批、Review 与 Merge 之前；这些未来结果不参与当前阻塞判定。
- 复核方式：逐项静态核对批准契约、生产组装路径、测试断言与 Coding 记录的命令/退出结果。Coding 报告记录 Node.js 24 下 static analysis、build、61 项 developer test 和两次 container build通过；真实 Azure integration 与 3 项 Playwright 场景均明确 skip，未被计为通过。

## 结论

`Repair Required`

当前 Candidate 存在 3 个 HIGH 阻塞项：生产会话未落实批准的串行队列与资源边界；生产 Speech 路径未落实 continuous language identification 和连接恢复；Playwright 就绪脚本没有证明字幕表达固定发言内容，且恢复场景通过重载拆成两个会话。它们均已有明确任务负责，修复路由为 `coding-repair`。

## 问题摘要

### CRITICAL

无。

### HIGH

1. **CVG-001（`contradicts`）**：生产 `createSessionOrchestrator` 对每个稳定识别结果立即启动独立异步翻译，`main.ts` 的识别回调又以 `void` 并发调用；批准的单 worker、最多 16 个 queued segment、严格顺序和溢出关闭没有接入生产会话。独立的 `createResourceTrackedSession` 测试辅助实现未被生产路径使用。
2. **CVG-002（`partial`）**：生产 Speech 组装仅创建 `AutoDetectSourceLanguageConfig`，未设置 continuous LID mode，也未注册 canceled/sessionStopped 映射或接入已测试的 `createRecoveringSpeechConnection`。因此批准的 continuous language identification、首次 transient cancellation 单次重建及终止竞态不在真实应用路径中。
3. **CVG-003（`test-gap`）**：3 项 Playwright 场景只断言字幕非空、locale 或终态，没有将字幕与 fixture 的公开预期内容比较；`IQA-003` 还通过 `page.reload()` 开启新会话验证“恢复”，没有证明同一会议字幕会话中不可识别段后的后续发言恢复。

### MEDIUM

无。

### LOW

无。

## 制品到实现与测试的可追溯关系

| 来源 | 实现路径 | 测试/证据路径 | 结论 |
|---|---|---|---|
| FR-001、FR-002、AC-001、AC-003、TD-004、T008/T015/T021 | `src/server/main.ts`、`src/server/adapters/speech-recognizer.ts` | `tests/contract/speech-adapter.contract.test.ts`、`tests/integration/azure-translation.integration.test.ts` | 部分覆盖；production 未启用 continuous LID，integration 按单文件新建 recognizer，不能覆盖该生产缺口 |
| FR-003、FR-004、AC-002、AC-004、TD-005、T011～T013/T024 | `src/server/session/orchestrator.ts`、`src/server/main.ts` | `tests/unit/session-orchestrator.test.ts`、`tests/contract/session-resource.contract.test.ts`、`tests/contract/speech-recovery.contract.test.ts` | 不一致；queue/resource/recovery helper 的通过未证明其接入生产路径 |
| IQA-001、AC-001、AC-002、T016 | `src/client/App.tsx`、`src/server/main.ts` | `tests/e2e/iqa-001-streaming-subtitles.spec.ts` | 场景可执行，但未验证字幕表达 fixture 发言内容 |
| IQA-002、AC-001、AC-003、T016 | 同上 | `tests/e2e/iqa-002-second-language.spec.ts` | 场景可执行，但仅验证 locale、非空和 final |
| IQA-003、AC-004、T016 | `src/server/session/orchestrator.ts`、`src/client/App.tsx` | `tests/e2e/iqa-003-unrecognized-recovery.spec.ts` | 场景不完整；重载页面后开启新会话，未证明同会话恢复 |
| TD-006、T009/T010/T022/T023 | `src/server/adapters/foundry-translator.ts`、`src/server/adapters/startup-contract.ts` | `tests/contract/foundry-adapter.contract.test.ts`、`tests/contract/startup-contract.test.ts` | 本地 contract 路径具备；真实 provider 结果正确延后 |
| TD-008、T029/T030 | `Dockerfile`、`runtime/deployment.json`、`src/server/main.ts` | `reports/implementation.md` 的 container build 与 identity route 记录 | CI 前就绪制品存在 |
| TD-010、TD-012、T014/T025/T031/T033 | `src/server/config/environment.ts`、`src/server/session/safe-logger.ts`、`runtime/runbook.md` | `tests/unit/config-and-logging.test.ts`、实施报告扫描记录 | 未发现无追踪外部服务、内容持久化或 secret 成功声明 |

## 开发者验证独立复核

- `runtime/deployment.json` 的 `developerSetupCommands` 为 `npm ci`；`developerValidationCommands` 以唯一分类对象声明 `staticAnalysis`、`build`、`developerTests`、`integrationTests`、`functionalTests`，命令均非空且不是 no-op。
- Coding 记录显示 `npm run format:check`、`npm run static:check`、`npm run build`、`npm run test:developer`、`npm audit --audit-level=high` 与 `docker build` 成功；developer suite 为 12 files、61 tests，无 skip。
- 代码复核发现 61 项 developer tests 的若干通过结论只覆盖独立 helper：`session-resource.contract.test.ts` 调用 `createResourceTrackedSession`，`speech-recovery.contract.test.ts` 调用 `createRecoveringSpeechConnection`，而 `src/server/main.ts` 未使用两者。因此这些真实本地测试结果不能证明对应 production invariant。
- `npm run test:integration` 的 3 项测试和 `npm run test:functional` 的 3 项场景因缺少批准平台输入而 skip；记录诚实，属于环境边界而非通过证据。
- `runtime/developer-functional-run.sh`、固定音频 fixture、Playwright 配置和 3 项 IQA 文件均存在，但 CVG-003 使功能验收就绪证据仍不完整。

## 用户可见行为比较

- 页面没有源语言选择控件，具备开始/停止、字幕增量呈现、不可识别提示和 Candidate identity 检查入口，方向与 FR-001～FR-004 一致。
- CVG-001 允许多个稳定片段并发翻译，可能使后续 sequence 先完成并触发客户端 gap 关闭，违背 AC-002 的持续字幕和设计规定的严格顺序。
- CVG-002 使生产路径不能证明发言过程中持续自动识别语言及批准的连接级恢复，不足以保证 AC-001、AC-003 和恢复边界。
- CVG-003 使现有 E2E 自动化无法证明中文字幕表达发言内容，也不能证明 AC-004 的同一流程恢复。
- 未发现 Teams 集成、其他目标语言、语音播报、账户/RBAC、数据库、额外 telemetry backend 或长期字幕存储等未请求行为。

## 架构、Contract、运维与任务覆盖

- `translation.v1`、Foundry `gpt-sol-6.1`、`stream:true`、`reasoning.effort="none"`、readiness、Candidate identity、Dockerfile、deployment contract 和 runbook 均有对应实现或就绪制品。
- WebSocket origin/子协议、帧大小、配置 key、非 root image 和无持久层边界已有实现及辅助测试。
- 生产组装没有采用同仓库中已测试的 Speech adapter/recovery 与资源队列边界，形成“测试对象存在但实际应用未接线”的隐藏假设。
- `T021`、`T024` 已明确负责 CVG-001/CVG-002，`T016` 已明确负责 CVG-003；不存在 Feature 规划缺口，不提出 append-only Convergence 任务。

## 延后平台证据

以下证据尚未产生是正常阶段边界，均为非阻塞：最终集成 commit SHA、registry image digest、远程 QA target、真实 Azure continuous-LID/Foundry 结果、部署后 Playwright artifact、Independent QA、UAT、发布审批、GitHub Review 与 Merge。修复当前阻塞项后，平台仍须以同一不可变 Candidate 执行已声明的 integration 与 functional 命令。

## 阻塞项

### CVG-001 生产翻译未落实单 worker 与资源队列

- **严重性：** `HIGH`
- **分类：** `contradicts`
- **来源制品：** `design.md`“数据流、状态、并发与生命周期”“SLO、限制、扩缩容、重试与恢复”；`tasks-implementation.md` T012、T013、T024
- **实现或证据路径：** `src/server/session/orchestrator.ts`、`src/server/main.ts`、`src/server/session/translation-session.ts`、`tests/contract/session-resource.contract.test.ts`
- **修复路由：** `coding-repair`
- **所需证据：** 生产 WebSocket 会话实际使用单 worker 队列并执行 16 queued 边界；并发稳定 segment 的 production-path 测试证明 active translation 始终为 1、字幕 sequence/final 严格递增、溢出关闭且清理后引用归零。

### CVG-002 生产 Speech 路径缺少 continuous LID 与批准恢复

- **严重性：** `HIGH`
- **分类：** `partial`
- **来源制品：** `technical-baseline.md` 技术要求与测试环境基线；`design.md` TD-004、Speech adapter contract；`tasks-implementation.md` T008、T011、T021、T024
- **实现或证据路径：** `src/server/main.ts`、`src/server/adapters/speech-recognizer.ts`、`src/server/session/orchestrator.ts`、`tests/contract/speech-recovery.contract.test.ts`
- **修复路由：** `coding-repair`
- **所需证据：** production-path contract test 证明 recognizer 明确采用 Continuous language identification；canceled 分类接入首次 transient 单次重建，第二次或非 transient 关闭，stop/disconnect/SIGTERM 优先，且不重放音频、segment 或字幕。

### CVG-003 Playwright 必需功能证据不完整

- **严重性：** `HIGH`
- **分类：** `test-gap`
- **来源制品：** `spec.md` IQA-001～IQA-003、AC-001～AC-004 及测试策略；`tasks-implementation.md` T005、T016
- **实现或证据路径：** `tests/e2e/iqa-001-streaming-subtitles.spec.ts`、`tests/e2e/iqa-002-second-language.spec.ts`、`tests/e2e/iqa-003-unrecognized-recovery.spec.ts`、`tests/fixtures/audio/manifest.json`
- **修复路由：** `coding-repair`
- **所需证据：** Playwright 对两种固定可识别发言断言中文字幕与 fixture 公开预期内容相符；IQA-003 在同一用户流程和会话内依次输入不可识别与可识别片段，证明前者无成功字幕、后者恢复；保留批准的 Candidate identity、操作和事件顺序元数据。

## 警告与剩余风险

当前无非阻塞警告。真实 Azure 服务能力、身份、provider contract 与远程完整用户流程仍需下游环境执行，但其结果尚未产生本身不是风险接受或通过声明。

## 最终判定依据

3 个 HIGH 问题均会使当前 Candidate 无法满足批准的 runtime invariant 或必需可执行功能证据，因此 `blockers` 非空，判定 `Repair Required`。问题均是已有任务的实施或测试不完整，应直接返回独立 Coding Session 修复；不修改批准任务，不创建 Feature 新任务，不返回业务澄清，也不创建平台事件。
