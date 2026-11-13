# Task Planning 阶段门禁报告

## 门禁信息

- **阶段：** `task-planning`
- **检查轮次：** 1
- **当前制品：** `tasks-implementation.md`
- **直接前置制品：** `design.md`
- **结论：** `需要修复`

## 内部自检

已完整检查任务分阶段结构、直接依赖、并行标记、准确路径、测试先行顺序、生产实现覆盖、验证责任和完成证据。任务总体覆盖了主要应用结构、协议、Azure adapter、完整用户流程、容器及运行时制品，但仍有批准依赖未纳入 Setup、若干明确技术义务没有对应的先失败测试或实现任务，且 Phase 4 的依赖关系不能保证最终检查覆盖全部计划制品，因此尚未达到可执行交接状态。

## 直接前置一致性检查

已逐项对照批准的 `design.md`，并仅使用 `spec.md` 核对 `IQA-001` 至 `IQA-003` 的继承验收证据。Tasks 保留了 Web app、服务端中继、自动语言识别、流式中文字幕、失败恢复、无持久化、真实 Azure integration、Playwright 完整流程和生产候选边界，但遗漏了 Design 明确规定的依赖及恢复、启动探针和长会话验证义务。

此外，Design 对验收证据有实质矛盾：一处禁止测试报告包含字幕，另一处又要求 Playwright 字幕 artifact 和字幕截图。该矛盾直接影响 Tasks 能否定义合规且足以证明用户可见行为的完成证据，Task Planning 无权替 Technical Solution 选择其中一项义务。

## 阻塞项

### TPL-SELF-001 Setup 未覆盖批准技术栈的必要依赖

- **严重性：** `high`
- **范围：** `self`
- **制品：** `tasks-implementation.md`
- **责任 Agent：** `task-planning`
- **路由：** `current_stage`
- **原因类型：** `incomplete`
- **证据：** `design.md` 第 11 行明确固定 `@fastify/websocket`、`microsoft-cognitiveservices-speech-sdk`、`openai` 和 `@azure/identity`；`T001` 仅列 Node.js、TypeScript、React、Vite、Fastify、Vitest 与 Playwright，后续 `T018`、`T019` 只列源代码路径，没有任何任务负责把上述包加入 `package.json` 和锁文件。
- **修复建议：** 在负责 npm 工程和锁文件的任务中明确纳入全部批准 runtime 依赖及其锁定证据，确保后续 adapter 与 WebSocket 实现无需隐式修改仓库控制文件。

### TPL-SELF-002 启动 contract probe 缺少测试先行任务

- **严重性：** `high`
- **范围：** `self`
- **制品：** `tasks-implementation.md`
- **责任 Agent：** `task-planning`
- **路由：** `current_stage`
- **原因类型：** `coverage`
- **证据：** `design.md` 第 150 至 152 行规定启动探针必须以无会议内容的固定请求验证 endpoint、deployment、流式 schema 和 `reasoning.effort="none"`，任一不满足均不 ready；`T019` 直接创建 `src/server/adapters/startup-contract.ts`，但先行的 `T009` 只锁定 adapter 请求与 SSE 映射，`T011` 只把探针状态作为 readiness 输入，没有任务先验证探针自身的通过和拒绝行为。
- **修复建议：** 在 `T019` 之前增加或扩充明确的先失败测试，覆盖启动探针的固定输入、全部 contract 条件和不 ready 结果，并让实现任务依赖该测试。

### TPL-SELF-003 Speech 连接级恢复义务未形成可执行任务

- **严重性：** `high`
- **范围：** `self`
- **制品：** `tasks-implementation.md`
- **责任 Agent：** `task-planning`
- **路由：** `current_stage`
- **原因类型：** `coverage`
- **证据：** `design.md` 第 184 行要求连接级 SDK 取消时重建 recognizer 一次，重建失败则关闭会话；`T008` 仅测试 canceled 映射，`T018` 仅实现取消状态映射和资源释放，`T010`、`T020` 的恢复描述也未包含 recognizer 单次重建及失败关闭。
- **修复建议：** 增加对应的先失败测试及实现覆盖，明确一次重建边界、重建成功后的会话行为、重建失败关闭和资源释放，并建立直接依赖。

### TPL-SELF-004 资源上限变更所需长会话验证缺失

- **严重性：** `high`
- **范围：** `self`
- **制品：** `tasks-implementation.md`
- **责任 Agent：** `task-planning`
- **路由：** `current_stage`
- **原因类型：** `coverage`
- **证据：** `design.md` 第 182 行明确规定 16 个待处理 segment 的资源保护上限必须同时通过长会话内存与顺序 contract test；`T010` 只列 focused unit test 的队列上限、顺序及恢复断言，没有长会话内存验证或对应 contract test，其他测试任务也未覆盖该义务。
- **修复建议：** 在生产实现之前加入可重复的长会话资源与顺序验证任务，明确其路径、边界断言和完成证据，并让 orchestrator 实现依赖该测试。

### TPL-SELF-005 Phase 4 依赖不能保证最终检查覆盖 runbook

- **严重性：** `high`
- **范围：** `self`
- **制品：** `tasks-implementation.md`
- **责任 Agent：** `task-planning`
- **路由：** `current_stage`
- **原因类型：** `contradiction`
- **证据：** `T029` 声称检查 `runtime/` 和“所有实际改动”，但仅依赖 `T028`；`T027` 创建同一 `runtime/` 下的 runbook 且只依赖 `T024`，并被标为可并行，因此允许 `T029` 在 `T027` 完成前结束。类似地，`T025`、`T026` 同时标记 `[P]`，但 `T026` 又直接依赖 `T025`，并行标记与直接依赖不一致。
- **修复建议：** 修正 Phase 4 的直接依赖和并行标记，使最终范围、安全与 secret 检查明确等待 runbook 及全部候选制品完成，并保证每个 `[P]` 标记只用于无直接依赖冲突的任务。

### TPL-PRED-001 Design 的字幕验收证据规则相互矛盾

- **严重性：** `high`
- **范围：** `predecessor`
- **制品：** `design.md`
- **责任 Agent：** `technical-solution`
- **路由：** `upstream_exception`
- **原因类型：** `contradiction`
- **证据：** `design.md` 第 165 行禁止测试报告包含中文字幕，但第 201 至 203 行要求 Playwright 字幕 artifact，第 213 行又要求汇总字幕截图；继承的 `spec.md` 第 104 至 126 行要求可核验发言内容及对应字幕结果。该矛盾已在 `tasks-implementation.md` 中表现为 `T013` 要采集 trace/video/screenshot，而第 68 行又禁止所有证据包含中文字幕，无法同时满足。
- **修复建议：** 由 Technical Solution 明确区分禁止记录的真实会议内容、日志或非授权产物，与使用获准非敏感固定样本生成的受控验收 artifact，并统一安全处理、可见内容和证据保留规则；Task Planning 再据此定义一致的测试及完成证据。

## 通过条件

以上当前阶段问题全部修复，Technical Solution 消除验收证据规则的上游矛盾后，重新完成 Task Planning 内部自检与直接前置一致性检查；仅当没有审批阻塞项时方可通过。
