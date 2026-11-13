# Coding 后 Convergence 报告

## Candidate 与证据范围

- Active Feature：`.ai-delivery/features/001-delivery-dlv-20261113-b6d60348365e`。
- 已审查 Constitution、技术基线、全部批准 Markdown 制品、通过的阶段门禁、当前实现与测试、实施报告、`Dockerfile` 和 runtime 就绪制品。
- 已重新检查上一轮 `CVG-004`、`CVG-005`；本门禁早于平台 CI、image publication、远程部署、Independent QA、UAT、发布审批、Review 与 Merge，未来平台结果不参与阻塞判定。

## 结论

`Repair Required`

上一轮 2 个 HIGH 阻塞项已有实现与测试证据；当前仍有 1 个 HIGH 测试就绪缺口，由既有 `T015` 负责并路由 `coding-repair`。

## 问题摘要

### CRITICAL

无。

### HIGH

1. **CVG-006（`test-gap`）**：真实 Azure Speech integration 入口没有配置任何 Speech credential 或 managed identity token，也没有设置 Continuous LID 模式，却把结果作为 continuous language identification 证据。该入口在批准环境中无法形成 T015 要求的真实身份与 Continuous LID 证据。

### MEDIUM

无。

### LOW

1. `IQA-003` 读取并记录 Candidate identity，但只断言 `deliveryId`，未断言预期 `candidateSha`；同一 functional run 的 `IQA-001`、`IQA-002` 已断言 SHA，因此保留为非阻塞警告。

## 制品到实现与测试的可追溯关系

| 来源 | 实现路径 | 测试/证据路径 | 结论 |
|---|---|---|---|
| FR-001、FR-003、TD-003、T006/T017 | `src/client/audio/capture.ts`、`src/client/audio/pcm-worklet.ts` | `tests/unit/audio-capture.test.ts` | `CVG-004` 已解决：生产路径跨小回调累计 PCM，满 3,200 bytes 发送并幂等刷新短尾 |
| FR-001～FR-004、AC-001～AC-004、TD-005、T012/T013/T024 | `src/server/session/orchestrator.ts`、`src/server/main.ts` | orchestrator 与 resource contract tests | 单 worker、16 queued 边界、严格顺序、失败与后续恢复已接入 |
| FR-001、FR-002、TD-004、T008/T011/T021/T024 | `src/server/adapters/speech-recognizer.ts`、orchestrator、`main.ts` | Speech adapter/recovery tests | 生产 Continuous LID、单次重建及首次启动失败终态已覆盖；真实 integration 入口仍有 `CVG-006` |
| IQA-001、IQA-002、T005/T016 | client/server 完整应用 | 两项 Playwright 场景、fixture manifest | 已断言无手选语言、固定发言含义、流式/最终中文字幕及 Candidate SHA |
| IQA-003、AC-004、T016 | orchestrator、client | IQA-003、audio-input support | 同一媒体流与会话顺序输入不可识别和可识别 fixture，并断言恢复；Candidate SHA 仅为 LOW 警告 |
| TD-006、T009/T010/T022/T023 | Foundry adapter、startup contract | 对应 contract 与 integration tests | 本地契约及远程执行入口存在；真实 provider 结果延后 |
| TD-008、T029/T030 | `Dockerfile`、deployment contract、identity route | container build 记录 | CI 前 Candidate 就绪制品存在 |
| TD-010、TD-012、T014/T025/T031/T033 | config、safe logger、runbook | 脱敏测试与实施扫描 | 未发现无追踪外部服务、内容持久化或 secret 成功声明 |

## 开发者验证独立复核

- `runtime/deployment.json` 的 setup 为幂等 `npm ci`；`developerValidationCommands` 是唯一分类对象，准确包含 `staticAnalysis`、`build`、`developerTests`、`integrationTests`、`functionalTests`，各命令非空、分类内唯一且非 no-op。
- 最新 Coding 记录显示 Node.js 24 static analysis、production build、12 files/68 developer tests、container build及 `npm audit` 通过；Azure integration 与 3 项 Playwright 场景明确 skip，未冒充真实功能通过。
- 静态独立复核确认 `CVG-004` 的 accumulator 与停止短尾测试、`CVG-005` 的首次创建/启动失败 `1011`、不发送 ready 和幂等清理测试均已接入生产路径。
- `tests/integration/azure-translation.integration.test.ts` 虽可发现 3 项真实 Azure 场景，但其 Speech helper 使用无 credential 的 `SpeechConfig.fromEndpoint(...)`，且未设置 `SpeechServiceConnection_LanguageIdMode=Continuous`；因此该必需远程测试尚不是可执行的批准证据。

## 用户可见行为比较

- 页面无源语言选择，目标固定为中文字幕；未发现 Teams、语音播报、账户/RBAC、database、额外 telemetry backend 或长期存储等未请求行为。
- 本地实现与 focused contract 覆盖持续字幕、不同可识别语言、无法识别不伪装成功及后续恢复。
- `CVG-006` 不直接改变页面实现，但会阻止平台用真实 Azure 证明源语言自动识别范围和 Continuous LID，故批准行为的强制可执行证据仍实质不完整。

## 架构、Contract、运维与任务覆盖

`translation.v1`、Foundry 固定模型与关闭 reasoning、生产 Continuous LID、readiness、Candidate identity、Dockerfile、deployment contract、functional script 和 runbook 均存在。未发现无批准追踪关系的 provider、服务、身份产品、telemetry/logging backend、告警、保留策略或运维依赖。`CVG-006` 已由 T015 明确负责，不存在 Feature 规划缺口，不提出 append-only Convergence 任务。

## 延后平台证据

最终集成 SHA、registry digest、QA target、真实 Azure 执行结果、部署后 Playwright artifact、Independent QA、UAT、发布审批、Review 与 Merge 均为非阻塞的未来平台证据。Coding 已准备容器、部署契约、identity endpoint 与功能脚本；修复 `CVG-006` 后，平台仍须针对同一不可变 Candidate 执行已声明检查。

## 阻塞项

### CVG-006 Azure Speech integration 入口不能证明批准的身份与 Continuous LID

- **严重性：** `HIGH`
- **分类：** `test-gap`
- **来源制品：** `design.md`“Speech adapter contract”“验证环境责任矩阵”；任务 T015；technical baseline“测试与环境基线”
- **实现或证据路径：** `src/server/adapters/speech-recognizer.ts`、`tests/integration/azure-translation.integration.test.ts`
- **修复路由：** `coding-repair`
- **所需证据：** 既有 T015 真实 integration 入口使用批准的 managed identity 或 secret reference 完成 Speech 认证，显式启用 Continuous LID，并在无 credential 时明确失败；针对两种固定语言和不可识别输入的远程执行可核验 locale/status/request id，且不把 mock、skip 或单次默认语言识别记为 Continuous LID 通过。

## 警告与剩余风险

LOW：为 `IQA-003` 补齐预期 Candidate SHA 断言。真实 Azure、远程完整用户流程和全部后续审批仍按批准责任矩阵延后；尚未运行不构成阻塞或通过声明。

## 最终判定依据

`CVG-004`、`CVG-005` 已解决，但 `CVG-006` 使强制真实 Azure Continuous LID integration 证据当前不可执行，属于 HIGH `test-gap`。该缺口由现有 T015 负责，故路由 `coding-repair` 并判定 `Repair Required`；Convergence 未修改生产代码、测试、任务或批准制品。
