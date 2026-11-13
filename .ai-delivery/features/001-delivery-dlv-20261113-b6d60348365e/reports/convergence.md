# Coding 后 Convergence 报告

## Candidate 与证据范围

- Active Feature：`.ai-delivery/features/001-delivery-dlv-20261113-b6d60348365e`。
- 已审查 Constitution、全部批准制品与通过门禁、实现、测试、实施报告、`Dockerfile` 和 runtime 就绪制品，并重新检查上一轮 `CVG-001`～`CVG-003`。
- 本门禁早于平台 CI、image publication、远程部署、Independent QA、UAT、发布审批、Review 与 Merge；这些未来结果不参与阻塞判定。

## 结论

`Repair Required`

上一轮 3 个阻塞项已有修复证据；当前仍有 2 个 HIGH 实现缺口，均由既有任务负责并路由 `coding-repair`。

## 问题摘要

### CRITICAL

无。

### HIGH

1. **CVG-004（`contradicts`）**：`createAudioCapture` 对每次 AudioWorklet 回调独立分帧，未跨回调累计 PCM。正常回调重采样后远小于 3,200 bytes，数据被丢弃，停止时也未刷新短尾，生产浏览器无法可靠发送语音。
2. **CVG-005（`partial`）**：首次 Speech recognizer 创建或启动失败会直接抛错；WebSocket `session.start` 路径未捕获、未以 `1011` 关闭，也未保证清理，违背批准的失败终态。

### MEDIUM

无。

### LOW

1. `IQA-003` 读取并记录 Candidate identity，但只断言 `deliveryId`，未断言预期 `candidateSha`；建议随既有 T016 修复补齐，不单独阻塞。

## 制品到实现与测试的可追溯关系

| 来源 | 实现路径 | 测试/证据路径 | 结论 |
|---|---|---|---|
| FR-001、FR-003、TD-003、T006/T017 | `src/client/audio/` | `tests/unit/audio-capture.test.ts` | 阻塞：纯函数测试未覆盖生产回调间累计和停止短尾 |
| FR-001～FR-004、TD-005、T012/T013/T024 | `src/server/session/orchestrator.ts`、`src/server/main.ts` | orchestrator/resource tests | `CVG-001` 已解决：生产已接入单 worker、16 queued 边界和严格顺序 |
| FR-001、FR-002、TD-004、T008/T011/T021/T024 | Speech adapter、orchestrator、`main.ts` | Speech adapter/recovery tests | `CVG-002` 的 Continuous LID 与一次重建已接入；首次启动失败仍不完整 |
| IQA-001、IQA-002、T005/T016 | client/server 完整应用 | 两项 Playwright 场景、fixture manifest | `CVG-003` 内容断言部分已解决 |
| IQA-003、AC-004、T016 | orchestrator、client | IQA-003、audio-input support | `CVG-003` 会话恢复部分已解决：同一会话顺序输入两个 fixture |
| TD-006、T009/T010/T022/T023 | Foundry adapter、startup contract | 对应 contract tests | 本地契约就绪；真实 provider 结果延后 |
| TD-008、T029/T030 | `Dockerfile`、deployment contract、identity route | container build 记录 | CI 前就绪制品存在 |
| TD-010、TD-012、T014/T025/T031/T033 | config、safe logger、runbook | 脱敏测试与实施扫描 | 未发现无追踪服务、内容持久化或 secret 成功声明 |

## 开发者验证独立复核

- `deployment.json` 的 setup 为 `npm ci`，验证对象准确包含五个已声明类别，命令非空且非 no-op。
- 最新 Coding 记录为 Node.js 24 static analysis、build、12 files/64 tests 和 container build通过；Azure integration 与 3 项 Playwright 场景明确 skip，未冒充通过。
- 静态复核确认上一轮队列、Continuous LID、一次重建、字幕内容断言和同会话恢复已接线；但 suite 未覆盖连续小 AudioWorklet 块，也未覆盖首次 Speech 创建/启动失败的 production gateway 终态，不能消除本轮阻塞。

## 用户可见行为比较

- 页面无源语言选择，目标固定为中文字幕；未发现 Teams、语音播报、账户/RBAC、数据库、额外 telemetry backend 或长期存储。
- `CVG-004` 在语音进入 WebSocket 前丢弃输入，直接阻断 FR-001、FR-003 和全部 IQA。
- `CVG-005` 在 Speech 首次不可用时留下未闭合连接和不确定页面状态，违背批准的失败与清理 invariant。

## 架构、Contract、运维与任务覆盖

`translation.v1`、Foundry 固定模型与关闭 reasoning、Continuous LID、readiness、Candidate identity、Dockerfile、deployment contract、functional script 和 runbook 均存在。`CVG-004` 已由 T006/T017 负责，`CVG-005` 已由 T011/T024/T026 负责；不存在 Feature 规划缺口，不提出新任务。

## 延后平台证据

最终集成 SHA、registry digest、QA target、真实 Azure 结果、部署后 Playwright artifact、Independent QA、UAT、发布审批、Review 与 Merge 均为非阻塞的未来平台证据。修复后仍须针对同一不可变 Candidate 执行已声明检查。

## 阻塞项

### CVG-004 浏览器音频未跨回调累计

- **严重性：** `HIGH`
- **分类：** `contradicts`
- **来源制品：** `spec.md` FR-001、FR-003、IQA-001～IQA-003；`design.md` TD-003；任务 T006、T017
- **实现或证据路径：** `src/client/audio/capture.ts`、`src/client/audio/pcm-worklet.ts`、`tests/unit/audio-capture.test.ts`
- **修复路由：** `coding-repair`
- **所需证据：** 生产路径跨多个小回调累计 PCM，每满 3,200 bytes 发送一帧，停止时仅发送一次非空短尾；测试证明无丢失、重复或乱序。

### CVG-005 Speech 首次启动失败未闭合

- **严重性：** `HIGH`
- **分类：** `partial`
- **来源制品：** `design.md` Speech adapter contract 与生命周期；任务 T011、T024、T026
- **实现或证据路径：** `src/server/session/orchestrator.ts`、`src/server/routes/translation-websocket.ts`、`src/server/main.ts`、`tests/contract/speech-recovery.contract.test.ts`
- **修复路由：** `coding-repair`
- **所需证据：** production-path tests 分别触发首次创建和启动失败，证明 `1011` 关闭、资源只释放一次、不发送 `session.ready` 且无未处理 rejection。

## 警告与剩余风险

LOW：为 `IQA-003` 补齐预期 Candidate SHA 断言。真实 Azure 与远程完整流程仍按批准责任矩阵延后，其尚未运行不构成阻塞或通过声明。

## 最终判定依据

`CVG-004` 阻断核心语音输入，`CVG-005` 使强制启动失败终态不完整；两个 HIGH 阻塞项均路由现有任务的 `coding-repair`，故判定 `Repair Required`。Convergence 未修改生产代码、测试、任务或批准制品。
