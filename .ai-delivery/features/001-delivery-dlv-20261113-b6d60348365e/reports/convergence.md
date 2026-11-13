# Coding 后 Convergence 报告

## Candidate 与证据范围

- Active Feature：`.ai-delivery/features/001-delivery-dlv-20261113-b6d60348365e`
- 审查对象：Constitution、全部已批准 Markdown 制品、已通过阶段门禁、当前生产实现与测试、`reports/implementation.md`、`Dockerfile` 及 active Feature 的 runtime 就绪制品。
- 本轮重新检查上一轮 `CVG-001`～`CVG-003`，并对修复后的生产接线和测试证据执行独立静态复核。
- 本门禁位于平台 CI、image publication、远程部署、Independent QA、UAT、发布审批、Review 与 Merge 之前；这些未来结果不参与当前阻塞判定。

## 结论

`Repair Required`

上一轮 3 个阻塞项已有对应修复证据，但当前 Candidate 仍有 2 个 HIGH 阻塞项：浏览器生产采集路径会丢弃正常 AudioWorklet 小块，无法形成并发送语音帧；首次 Speech recognizer 创建或启动失败时没有执行批准的关闭与清理行为。两项均由现有任务负责，修复路由为 `coding-repair`。

## 问题摘要

### CRITICAL

无。

### HIGH

1. **CVG-004（`contradicts`）**：`createAudioCapture` 对每次 AudioWorklet 回调独立执行 `framePcm`，没有跨回调累计 PCM。AudioWorklet 通常每次只提供一个 render quantum；重采样后的数据远小于 3,200 bytes，`framePcm(..., false)` 返回空数组并永久丢弃该块，停止时也未刷新短尾帧。生产浏览器因此无法可靠发送会议语音，直接阻断 FR-001、FR-003 和 IQA-001～IQA-003。
2. **CVG-005（`partial`）**：`createRecoveringSpeechConnection.start()` 在首次 recognizer 创建或启动失败时直接抛错；WebSocket route 的 `session.start` 分支没有捕获该错误，也未以 `1011` 关闭连接或释放会话。批准的 Speech contract 明确要求创建或启动失败关闭并清理资源，现有恢复测试没有覆盖首次启动失败。

### MEDIUM

无。

### LOW

1. `IQA-003` 会读取并记录 Candidate identity，但只断言 `deliveryId`，未像 `IQA-001`、`IQA-002` 一样断言 `candidateSha`。下游仍应依赖平台 Candidate 绑定，并建议在既有 T016 修复中补齐该防误测断言；本轮不单独将其计为阻塞项。

## 制品到实现与测试的可追溯关系

| 来源 | 实现路径 | 测试/证据路径 | 结论 |
|---|---|---|---|
| FR-001、FR-003、AC-002、TD-003、T006/T017 | `src/client/audio/capture.ts`、`src/client/audio/pcm-worklet.ts` | `tests/unit/audio-capture.test.ts` | 阻塞；纯函数测试覆盖大块分帧，但未覆盖生产回调间累计与停止短尾刷新 |
| FR-001～FR-004、AC-001～AC-004、TD-005、T012/T013/T024 | `src/server/session/orchestrator.ts`、`src/server/main.ts` | `tests/unit/session-orchestrator.test.ts`、`tests/contract/session-resource.contract.test.ts` | 上一轮 `CVG-001` 已解决；生产 orchestrator 已接入单 worker、16 queued 边界和严格 sequence |
| FR-001、FR-002、AC-001、AC-003、TD-004、T008/T011/T021/T024 | `src/server/adapters/speech-recognizer.ts`、`src/server/session/orchestrator.ts`、`src/server/main.ts` | `tests/contract/speech-adapter.contract.test.ts`、`tests/contract/speech-recovery.contract.test.ts` | continuous LID 与一次重建已接入；首次创建/启动失败路径仍不完整 |
| IQA-001、IQA-002、AC-001～AC-003、T005/T016 | `src/client/App.tsx`、`src/server/main.ts` | `tests/e2e/iqa-001-streaming-subtitles.spec.ts`、`tests/e2e/iqa-002-second-language.spec.ts`、`tests/fixtures/audio/manifest.json` | 上一轮内容断言缺口已解决；两种固定发言均断言公开预期中文字幕词 |
| IQA-003、AC-004、T016 | `src/server/session/orchestrator.ts`、`src/client/App.tsx` | `tests/e2e/iqa-003-unrecognized-recovery.spec.ts`、`tests/e2e/support/audio-input.ts` | 上一轮会话重载缺口已解决；同一页面、媒体流和 WebSocket 会话依次输入不可识别与可识别 fixture |
| TD-006、T009/T010/T022/T023 | `src/server/adapters/foundry-translator.ts`、`src/server/adapters/startup-contract.ts` | `tests/contract/foundry-adapter.contract.test.ts`、`tests/contract/startup-contract.test.ts` | 本地 contract 就绪；真实 provider 结果正确延后 |
| TD-008、T029/T030 | `Dockerfile`、`runtime/deployment.json`、`src/server/main.ts` | `reports/implementation.md` 的 container build 与 Candidate identity 记录 | CI 前就绪制品存在 |
| TD-010、TD-012、T014/T025/T031/T033 | `src/server/config/environment.ts`、`src/server/session/safe-logger.ts`、`runtime/runbook.md` | `tests/unit/config-and-logging.test.ts`、实施报告扫描记录 | 未发现无追踪外部服务、内容持久化或 secret 成功声明 |

## 开发者验证独立复核

- `runtime/deployment.json` 以唯一分类对象声明 `staticAnalysis`、`build`、`developerTests`、`integrationTests`、`functionalTests`；各命令非空且不是 no-op，`developerSetupCommands` 为幂等 `npm ci`。
- 最新 Coding 记录显示 Node.js 24 下 `format:check`、`static:check`、production build、12 files/64 tests 的 developer suite 及 production container build通过；该记录未把真实 Azure integration 或 Playwright skip 冒充为通过。
- 代码级复核确认上一轮生产队列、Continuous LID、一次重建、固定内容断言和同会话恢复均已接线；同时发现 developer suite 未以生产 AudioWorklet 小块序列验证帧累计，也未覆盖首次 Speech 创建/启动失败的 gateway 终态，因此现有通过结果不能消除 `CVG-004`、`CVG-005`。
- 3 项 Azure integration 与 3 项 Playwright 场景在 Coding 环境因缺少批准平台输入而 skip，属于批准的环境责任边界；其真实结果必须由下游执行。

## 用户可见行为比较

- 页面没有源语言选择控件，固定目标为中文字幕；未发现 Teams 集成、语音播报、其他目标语言、账户/RBAC、数据库、额外 telemetry backend 或长期字幕存储。
- 修复后的服务端路径可按序处理稳定片段、标记不可识别片段并恢复后续片段，方向与 FR-002～FR-004 一致。
- `CVG-004` 发生在用户语音进入 WebSocket 之前，会使正常麦克风/fixture 音频不产生完整帧，因而当前 Candidate 不能满足发言期间形成中文字幕的核心用户行为。
- `CVG-005` 会在 Speech 首次不可用时留下未闭合连接和不确定页面状态，违背已批准的失败终态与资源释放 invariant。

## 架构、Contract、运维与任务覆盖

- `translation.v1`、Foundry `gpt-sol-6.1`、`stream:true`、`reasoning.effort="none"`、Continuous LID、readiness、Candidate identity、Dockerfile、deployment contract、functional script 和 runbook 均存在。
- WebSocket origin/子协议、帧大小、配置 key、非 root image、无持久层及安全日志边界有实现和辅助测试。
- `CVG-004` 已由 T006/T017 明确负责，`CVG-005` 已由 T011/T024/T026 明确负责；两项是现有任务实施或证据不完整，不是 Feature 规划缺口，不提出 append-only Convergence 任务。

## 延后平台证据

以下证据尚未产生是正常阶段边界，均为非阻塞：最终集成 commit SHA、registry image digest、远程 QA target、真实 Azure continuous-LID/Foundry 结果、部署后 Playwright artifact、Independent QA、UAT、发布审批、GitHub Review 与 Merge。修复当前阻塞项后，平台仍须以同一不可变 Candidate 执行已声明的 integration 与 functional 检查。

## 阻塞项

### CVG-004 浏览器音频回调数据未跨块累计

- **严重性：** `HIGH`
- **分类：** `contradicts`
- **来源制品：** `spec.md` FR-001、FR-003、IQA-001～IQA-003；`design.md` TD-003 与“数据流、状态、并发与生命周期”；`tasks-implementation.md` T006、T017
- **实现或证据路径：** `src/client/audio/capture.ts`、`src/client/audio/pcm-worklet.ts`、`tests/unit/audio-capture.test.ts`
- **修复路由：** `coding-repair`
- **所需证据：** 生产采集路径跨连续 AudioWorklet 回调累计重采样 PCM，每满 3,200 bytes 发送一帧，停止时只发送一次允许的非空短尾；测试以多个均小于一帧的回调块证明无丢失、无重复且最终字节顺序正确。

### CVG-005 Speech 首次创建或启动失败未闭合会话

- **严重性：** `HIGH`
- **分类：** `partial`
- **来源制品：** `design.md`“Speech adapter contract”与“数据流、状态、并发与生命周期”；`tasks-implementation.md` T011、T024、T026
- **实现或证据路径：** `src/server/session/orchestrator.ts`、`src/server/routes/translation-websocket.ts`、`src/server/main.ts`、`tests/contract/speech-recovery.contract.test.ts`
- **修复路由：** `coding-repair`
- **所需证据：** production-path contract test 分别触发首次 recognizer 创建失败和启动失败，证明连接以 `1011` 关闭、已创建资源仅释放一次、会话不进入 listening、不会发送 `session.ready`，且无未处理 rejection。

## 警告与剩余风险

- LOW：`IQA-003` 建议补齐预期 `candidateSha` 断言，避免仅凭同一 Delivery ID 接受错误 Candidate；该项与既有 T016 同属测试加固，不进入本轮 `blockers`。
- 真实 Azure 服务能力、身份、provider contract 与远程完整用户流程仍须按批准责任矩阵由下游环境执行；这些结果尚未产生不构成当前阻塞或通过声明。

## 最终判定依据

`CVG-004` 直接阻断核心语音输入，`CVG-005` 使强制 Speech 启动失败终态和资源清理不完整；两项均为 HIGH 且由现有任务负责。因此当前 `blockers` 非空，判定 `Repair Required`，路由均为 `coding-repair`。Convergence 不修改生产代码、测试、任务或批准制品。
