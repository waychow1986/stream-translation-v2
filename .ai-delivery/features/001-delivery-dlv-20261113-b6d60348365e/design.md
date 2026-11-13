# 实现流式翻译技术方案

## 实施就绪状态

`implementationReady: true`

## 技术上下文（Technical Context）

本迭代从空应用仓库交付浏览器 Web app。浏览器采集会议麦克风音频，单体 Node.js 服务通过同源 WebSocket 中继音频，使用 Microsoft Speech SDK 调用 Azure AI Speech/STT 的实时连续识别与 continuous language identification，再将稳定的非中文 STT 片段按序提交给 Azure AI Foundry 的 `gpt-sol-6.1` deployment，以关闭 reasoning 的流式请求生成中文字幕。应用不集成会议平台，不保存会议内容，也不提供手动源语言选择。

技术栈固定为 Node.js 24 LTS、TypeScript 5.x、React 19、Vite、Fastify 5、`@fastify/static`、`@fastify/websocket`、`microsoft-cognitiveservices-speech-sdk`、`openai`、`@azure/identity` 和 `ajv`。前后端共享 TypeScript 协议类型，`ajv` 执行共享 JSON schema 的 runtime validation；生产构建由 Fastify 同源提供静态前端和 WebSocket。单个 Linux container 部署到 Azure Container Apps，目标 runtime、外部服务和验证环境均来自已批准 technical baseline。

当前仓库只有 `README.md` 和 Delivery 制品，没有既有应用、依赖、数据或兼容 API。实现所需 Azure endpoint、deployment、identity、Speech region 及自动语言识别候选范围在部署环境提供；这些是部署配置，不是未解决产品决策。真实 Azure integration 环境必须在发布前证明所选 STT 配置的实际可识别范围、continuous language identification、模型可用性及 reasoning 关闭参数。

## 治理与技术约束

- Constitution 的范围受控与简单架构要求落实为单体 Web 服务、内存会话状态和直接事件管道；不增加 database、queue、Teams 集成、用户账户、RBAC 产品行为、额外 telemetry backend 或内容存储。
- 数据安全要求落实为服务端持有 Azure 身份、仅使用 HTTPS/WSS、不记录或持久化音频和文本、限制 WebSocket origin/协议/帧、连接结束立即释放 SDK 资源。浏览器永不接收 Azure credential。
- Playwright 是完整用户流程的强制 E2E 工具；unit、contract、build 与 health 仅作辅助证据，不能替代真实 Azure 环境下的 `IQA-001` 至 `IQA-003`。
- technical baseline 固定 Node.js 24 LTS、React 19 + Vite、Fastify 5、服务端音频中继、Azure Container Apps、Microsoft Speech SDK、`gpt-sol-6.1`、关闭 reasoning 和 revision rollout；本方案具体化这些约束，不另选 provider。
- Specification 不给出数值延迟、吞吐、并发、可用率或准确率门槛。本方案只定义协议完整性、资源保护和平台可配置边界，不把内部参数变成产品承诺或验收阈值。
- 生产候选必须包含 `Dockerfile` 与本 Feature 的 `runtime/deployment.json`；后者按平台 schema 声明幂等 `developerSetupCommands` 及唯一分类对象 `developerValidationCommands`，必选类别为 `staticAnalysis`、`build`、`developerTests`，并在候选实际具备后声明 `integrationTests`、`functionalTests`。

## 架构概览（Architecture）

系统采用四个边界：

1. **Browser client**：React 页面负责用户启动/停止采集、`getUserMedia`、AudioWorklet PCM 转换、WebSocket 会话和按 `segmentId`/`sequence` 渲染中文流式字幕；页面不提供源语言选择。
2. **Session gateway**：Fastify 提供静态资源、`GET /health/ready` 和 `GET /ws/translation`。网关校验 origin、子协议、消息顺序和二进制帧，建立每连接独占的内存会话。
3. **Speech adapter**：把 16 kHz、单声道、16-bit little-endian PCM 推送给 Speech SDK，开启 continuous recognition 和 continuous language identification，将识别中间结果用于内部进度，将稳定结果及语言识别状态交给 orchestrator。识别失败的发言段不进入翻译。
4. **Translation adapter/orchestrator**：按会话串行消费稳定 STT segment，调用 Azure AI Foundry Responses streaming API，固定目标语言为简体中文并显式关闭 reasoning；SSE token 转换为 WebSocket 字幕事件。orchestrator 是 segment 顺序、终态和恢复的唯一所有者。

每个 WebSocket 只服务一个活动会议字幕会话，活动状态不跨实例共享或迁移。Azure SDK adapter 置于接口后，测试使用本地 fake 只验证应用契约；真实服务能力只能由 Azure integration 验证。

## 技术决策与替代方案

| 决策 ID | 选择 | 理由 | 已考虑替代方案 | 来源 |
|---|---|---|---|---|
| TD-001 | 服务端中继的 Node.js 单体 Web 服务 | 凭据、语言识别、顺序及错误边界集中，且只需一套 toolchain | 浏览器直连 STT 会增加 token 端点和可篡改配置；Python 后端增加第二套 toolchain | technical baseline；FR-001～FR-004 |
| TD-002 | React 19 + Vite 与 Fastify 5 同源部署 | 满足 Web app，并让 WSS origin 和发布单元保持简单 | 独立静态站点增加 CORS、双部署和版本协调 | technical baseline；Constitution 二 |
| TD-003 | Web Audio API + AudioWorklet 输出 16 kHz 单声道 PCM16LE，100 ms 一帧 | Speech push stream 可直接消费；短帧支持持续处理；AudioWorklet 避免主线程采样抖动 | MediaRecorder 的压缩容器需服务端解码；浏览器 Speech SDK 直连不采用 | FR-003；technical baseline |
| TD-004 | Speech SDK continuous recognition + continuous language identification；候选语言由部署配置提供 | 不要求用户手选语言，并让范围服从目标服务实际能力 | 固定产品语言清单违反批准范围；每段一次性识别不满足流式 | FR-001、FR-002；AC-001、AC-003 |
| TD-005 | 仅稳定 STT result 创建 segment；同会话翻译单并发、严格递增序列 | 防止 partial 重复翻译，保证字幕顺序和恢复边界 | 并行翻译吞吐更高但会乱序；翻译 partial STT 会产生反复修订 | FR-003、FR-004；technical baseline |
| TD-006 | Azure AI Foundry Responses streaming API，deployment 为 `gpt-sol-6.1`，请求显式 `reasoning.effort="none"` | 满足指定模型、流式输出和关闭 reasoning；启动 contract probe 拒绝不支持的部署 | 默认 reasoning 不可证明关闭；非流式调用延后用户结果 | technical baseline；FR-003、NFR-001 |
| TD-007 | 无持久层；会话、segment 和字幕仅驻留内存至连接关闭 | 已批准范围不要求历史字幕，降低会议内容暴露与架构复杂度 | database、cache 或 queue 均无批准依据 | Constitution 一至三；spec 范围边界 |
| TD-008 | 单 container、Container Apps revision rollout | 与批准 hosting 一致，支持不可变 candidate、流量切换和回退 | 多服务拆分无当前需求；桌面应用被明确排除 | technical baseline |
| TD-009 | Vitest 做 unit/contract，Playwright + Chromium 做真实完整流程 | 保持快速开发反馈并满足 Constitution 的 E2E 强制要求 | 仅 mock、health 或页面 smoke 不能证明用户行为 | Constitution 四；IQA-001～IQA-003 |
| TD-010 | DefaultAzureCredential/managed identity 优先；不支持时由 Key Vault secret reference 注入 | credential 不进入浏览器、仓库或日志，并符合目标平台身份模型 | 浏览器 key、仓库 secret 或自建凭据服务均不接受 | Constitution 三；technical baseline |
| TD-011 | `package.json` 统一声明全部 runtime/build/test 依赖，`package-lock.json` 锁定完整 transitive graph | adapter、gateway、schema、构建与验证不能在后续实现任务中隐式改变仓库依赖 | 按组件临时安装会破坏 clean-runner 可重复性；多 package workspace 对当前单体无收益 | technical baseline 的锁文件约束；TD-001、TD-002、TD-009 |
| TD-012 | 验收内容分为“禁止采集的真实会议内容”和“允许进入受控 QA artifact 的批准非敏感固定样本结果” | 同时满足会议内容保护与 `IQA-001`～`IQA-003` 对可核验发言、字幕及顺序证据的要求 | 完全禁止字幕 artifact 无法证明用户行为；记录真实会议内容风险不可接受 | Constitution 三、四；spec IQA-001～IQA-003 |

## 领域与数据模型

所有模型均为进程内临时对象，不写入磁盘。

- `TranslationSession`：`sessionId`（随机 UUID）、`correlationId`、`state`、`nextSegmentSequence`、`lastDeliveredSequence`、`speechConnectionId?`、`createdAt`、`abortController`。不包含用户身份或会议元数据。
- `AudioFrame`：WebSocket binary payload；格式固定为 PCM16LE/16 kHz/mono，帧序由单连接 TCP/WebSocket 保证，不单独持久化。
- `SpeechSegment`：`segmentId = sessionId:sequence`、`sequence`、`sourceLocale`、`recognitionStatus`、`stableText`。仅 `recognized` 且 source locale 为可识别非中文的 segment 可进入翻译。
- `SubtitleSegment`：`segmentId`、`sequence`、`sourceLocale`、`revision`、`text`、`isFinal`。`text` 只存在于向当前浏览器发送的短生命周期事件及 adapter 内存。
- `FailureRecord`：`segmentId?`、`stage`、`category`、`retryable`、Azure request id/correlation id；禁止包含音频、STT text、subtitle text、token 或 authorization header。

会话状态为 `connecting → listening → draining → closed`，任何状态均可因不可恢复的协议/外部错误进入 `closing → closed`。segment 状态为 `detecting → recognized → translating → completed`，语言不可识别时为 `detecting → unrecognized`；外部失败为 `recognized|translating → failed`。只有 `completed` 是成功翻译终态；`unrecognized`、`failed` 不得转换成 `completed`。后续新 segment 独立从 `detecting` 开始。

## Component 边界与项目结构

Coding 获准创建或修改的根路径清单如下；不在清单中的 Feature 目录和 `.github/workflows/` 不得修改：

- `./package.json`
- `./package-lock.json`
- `./index.html`
- `./tsconfig.json`
- `./tsconfig.client.json`
- `./tsconfig.server.json`
- `./vite.config.ts`
- `./vitest.config.ts`
- `./playwright.config.ts`
- `./Dockerfile`
- `./.dockerignore`
- `./.gitignore`
- `src/`
- `tests/`
- `.ai-delivery/features/001-delivery-dlv-20261113-b6d60348365e/runtime/`

项目结构：

```text
src/
├── client/
│   ├── audio/              # AudioWorklet、重采样与 PCM 帧
│   ├── protocol/           # WebSocket client 与字幕 reducer
│   ├── App.tsx
│   └── main.tsx
├── server/
│   ├── adapters/           # Azure Speech 与 Foundry adapter
│   ├── config/             # 环境配置解析与启动 contract check
│   ├── routes/             # health、WebSocket upgrade
│   ├── session/            # orchestrator、状态机、清理
│   └── main.ts
└── shared/
    └── protocol.ts         # discriminated union、版本与 schema validator
tests/
├── unit/
├── contract/
├── integration/            # 真实 Azure；由显式环境开关启用
├── e2e/                    # Playwright IQA-001～IQA-003
└── fixtures/audio/         # 获准、无敏感内容的可重复测试音频
```

`.gitignore` 忽略 `node_modules/`、`dist/`、`coverage/`、`playwright-report/`、`test-results/`、本地 `.env*`（保留无值示例时仅允许 `.env.example`）及音频处理临时输出；`.dockerignore` 排除相同本地产物、测试报告、`.git/` 与 `.ai-delivery/`。锁文件必须提交。

`package.json` 是依赖和验证脚本的唯一 owner。production dependencies 必须一次性包含 `react`、`react-dom`、`fastify`、`@fastify/static`、`@fastify/websocket`、`microsoft-cognitiveservices-speech-sdk`、`openai`、`@azure/identity`、`ajv`；development dependencies 必须包含 TypeScript 5.x、Vite、React Vite plugin、Vitest、Playwright test runner 及 React/Node 所需类型包。`engines.node` 固定 Node.js 24；React 与 Fastify 分别保持批准的 major 19 与 5，其余包选择与 Node.js 24 兼容的当前版本，确切解析版本全部由提交的 `package-lock.json` 锁定。Setup 必须同时完成 manifest、lockfile 以及 static analysis、production build、developer/unit-contract、integration、Playwright functional 分类脚本；后续 component 实现不得隐式安装 package 或改写锁文件。完成证据是 clean checkout 上 `npm ci` 不改动 manifest/lockfile，随后所有分类脚本均可解析并启动到其既定环境边界。

## 数据流、状态、并发与生命周期

1. 页面在用户触发下取得麦克风权限，建立 `translation.v1` WebSocket，发送 `session.start`；服务端完成校验后返回 `session.ready`，客户端才发送 binary audio。
2. AudioWorklet 将浏览器输入重采样成 PCM16LE/16 kHz/mono，每 100 ms 形成 3,200-byte binary frame；单帧必须恰为该大小，停止时允许最后一帧较短。服务端拒绝空帧、超出 3,200 bytes 的帧或非 listening 状态帧，并关闭该异常连接。
3. 每会话持有一个 Speech SDK push stream/recognizer。SDK partial result 仅用于内部活动状态；final result 才创建递增 `sequence`。语言缺失、unknown、中文或服务判定不可识别时，不调用模型并发送不含伪字幕的 `segment.unrecognized` 状态事件。
4. audio ingestion 与 translation worker 解耦，recognizer 在翻译期间继续消费音频。recognized segment 进入按 sequence 排序的单 worker 队列；队列最多保留 16 个尚未开始翻译的稳定 segment，达到上限即以资源保护错误终止会话而不是丢弃、乱序或伪造字幕。一个 segment 完成或失败后才消费下一个稳定 segment。
5. translation adapter 以固定 system instruction 要求忠实翻译成简体中文、只返回译文；输入只含当前稳定 STT segment。每收到一个 token 即形成当前 segment 的完整累计中文快照，以递增 `revision` 发送，客户端按 `sequence` 定位 segment、按 revision 替换而非追加文本，`subtitle.final` 后不可再修改。
6. 用户停止时客户端发送 `session.stop` 并停止音频；服务端结束 push stream，等待 SDK final result 和当前翻译完成后发送 `session.closed`。浏览器断开、超时、进程终止或不可恢复错误时，统一 abort Speech/HTTP stream、清空文本引用并释放监听器。
7. 并发单位是 WebSocket 会话；同一会话内翻译严格串行，不跨实例共享。Container Apps 的实例并发和连接容量通过集成环境容量观测配置，不在本方案虚构产品阈值。
8. SIGTERM 后 readiness 变为失败并拒绝新 WebSocket；已有连接在平台 termination grace period 内 draining，期限到达后 abort。活动会话不迁移、不自动重放已交付字幕。

## Interface 与契约（Contract）

### Browser—server WebSocket

- Endpoint：同源 `GET /ws/translation`，仅接受 WSS 生产流量。
- 子协议：`translation.v1`；不匹配即拒绝 upgrade。协议版本变更采用新子协议，v1 event 不作破坏性字段复用。
- 文本消息均为 UTF-8 JSON，包含 `type`、`protocolVersion: 1`、`sessionId`（ready 后）及 event-specific fields；未知 type、额外控制字段、无效 UUID/sequence/revision 或不合状态的消息构成 protocol error。
- client events：
  - `session.start`：`{type, protocolVersion, audio:{encoding:"pcm_s16le",sampleRateHz:16000,channels:1}}`
  - `session.stop`：`{type, protocolVersion, sessionId}`
  - binary frame：仅在 ready/listening 后允许，内容为上述 PCM。
- server events：
  - `session.ready`：`{type, protocolVersion, sessionId}`
  - `segment.detected`：`{type, protocolVersion, sessionId, segmentId, sequence, sourceLocale}`；不包含 STT text。
  - `subtitle.delta`：`{type, protocolVersion, sessionId, segmentId, sequence, revision, text, isFinal:false}`
  - `subtitle.final`：`{type, protocolVersion, sessionId, segmentId, sequence, revision, text, isFinal:true}`
  - `segment.unrecognized`：`{type, protocolVersion, sessionId, segmentId, sequence}`；明确不是成功字幕。
  - `segment.failed`：`{type, protocolVersion, sessionId, segmentId, sequence, category}`；`category` 为稳定枚举，不含 provider 原始消息。
  - `session.closed`：`{type, protocolVersion, sessionId, reason}`。

客户端 reducer 必须忽略已完成 segment 的迟到 delta、低于等于已应用 revision 的重复 event，以及低于 `lastDeliveredSequence` 的新 segment；遇到 sequence gap 时停止将后续 segment 标为 final 并关闭连接，避免乱序字幕。服务端 WebSocket close code 使用标准 `1000` 表示正常停止、`1001` 表示实例终止、`1002` 表示协议错误、`1008` 表示 origin/policy 失败、`1011` 表示不可恢复的服务端或外部依赖错误。

### Speech adapter contract

`SpeechRecognizerPort.start(config, callbacks, signal)` 接收 push audio stream 配置和 deployment-provided language candidates；callback 仅暴露 `recognizing`、`recognized`、`unrecognized`、`canceled`、`sessionStopped`。adapter 将 provider reason/error 映射为内部枚举，关闭时必须幂等 dispose recognizer 与 stream。

orchestrator 拥有连接级恢复，不把重建逻辑留在 route 或 SDK callback：同一会话第一次收到被映射为 transient connection cancellation 的 `canceled` 时，先停止向旧 push stream 写入、移除 callback 并 dispose 旧 recognizer/stream，再用原配置创建且启动一个新 recognizer；不重放已经消费的音频、STT segment 或字幕，`nextSegmentSequence` 保持单调递增。新 recognizer 成功启动后会话回到 `listening` 并继续接收后续帧。创建或启动失败、同一会话再次发生 connection cancellation，或 cancellation 属于认证、配置、contract 等非 transient 类时，不再重建，以 `1011` 关闭会话并 abort/dispose 新旧资源。disconnect、`session.stop` 或 SIGTERM 与重建并发时，终止信号优先且不得创建新 recognizer。adapter contract fake 必须可确定性触发“首次取消后重建成功”“重建失败”“第二次取消”和“取消与终止竞态”，验证创建次数、无重放、序列连续、关闭码及所有资源仅释放一次；真实 Azure integration 只证明 provider 映射与连接行为，不以 fake 宣称 Azure 恢复通过。

候选语言配置 `AZURE_SPEECH_LANGUAGE_CANDIDATES` 是由目标 Speech 服务真实 continuous-LID 能力验证后的 BCP-47 列表，不显示给用户，也不构成静态产品语言清单。启动检查拒绝空列表、中文目标被误作需翻译源语言、SDK 不支持的 locale 或超出目标服务候选限制的配置；integration evidence 记录服务支持依据而非扩大产品承诺。

### Foundry adapter contract

服务端使用 `openai` package 的 Azure client 调用 Azure AI Foundry OpenAI-compatible Responses endpoint：deployment 固定由 `AZURE_FOUNDRY_MODEL_DEPLOYMENT` 指向 `gpt-sol-6.1`；请求设置 `stream:true`、`reasoning:{effort:"none"}`，system instruction 固定目标为简体中文并禁止添加解释，input 为单个稳定 STT segment。managed identity 认证由 `@azure/identity` 的 `DefaultAzureCredential` 与 `https://cognitiveservices.azure.com/.default` bearer token provider 提供；仅在目标服务不支持该身份时从 secret reference 取得 API credential。

启动/部署 contract check 使用仓库内批准的非敏感固定文本“`The meeting has started.`”作为唯一输入，沿用生产 system instruction、deployment、`stream:true` 与 `reasoning:{effort:"none"}`，但不把输入或输出写入日志或报告。只有 endpoint 可访问、实际 deployment 为配置的 `gpt-sol-6.1`、请求参数被接受、流中只出现允许的 text delta/completed 事件、至少一个非空 text delta 且正常 completed 时探针通过；认证/配置错误、参数拒绝、空流、error、未知事件、schema 缺字段、中途断流或超时均失败，不改用默认 reasoning、其他模型或非流式请求。探针状态只有 `pending|passed|failed`，`pending` 或 `failed` 均使应用不 ready；进程生命周期内启动时执行一次，失败保持不 ready，不由 readiness 请求重复调用模型。

启动探针必须先由 `tests/contract/startup-contract.test.ts` 固定上述请求和全部通过/拒绝条件，再实现探针。测试使用 scriptable Foundry port，不访问 Azure，逐项断言固定输入、deployment、stream、reasoning、允许事件、空流/error/未知或畸形事件、断流/超时，以及探针 `pending`/`failed` 时 `GET /health/ready` 返回 `503`、仅 `passed` 且未 draining 时返回 `200`。真实 integration 再对同一探针 contract 取证；本地 fake 结果不代表 deployment 已通过。

### HTTP 与 schema

`GET /health/ready` 成功时返回 `200 {"status":"ready"}`，仅证明进程、配置 schema 和启动 contract check 已通过；draining 或配置无效返回 `503 {"status":"not_ready"}`。它不发送真实会议音频，也不代表功能验收。

shared protocol 以 TypeScript discriminated unions 定义，并在服务端运行时 schema validation。contract tests 锁定 v1 JSON、binary format、Azure adapter 映射、reasoning 参数、SSE delta、顺序和错误映射；任何破坏 v1 的变更必须发布新子协议并同步客户端。

## 安全、隐私、身份与 Secret

- 浏览器到应用只允许 HTTPS/WSS；Fastify 仅信任平台终止 TLS 后提供的受控 forwarded headers。WebSocket upgrade 校验精确部署 origin，不使用通配 CORS。
- 麦克风采集只在用户触发和活动页面会话期间进行；stop、disconnect、page unload 均停止 media tracks 与 AudioWorklet。
- Azure 访问优先使用 Container Apps managed identity。必要 credential 由 Key Vault secret reference 注入环境变量；配置错误消息只列缺失 key 名，不打印值。
- 真实 secret 或 authorization header 禁止进入源代码、fixture、snapshot、构建产物、日志、protocol event、测试报告和验收 artifact。实时产品流程允许当前连接的内存 protocol event 携带中文字幕，这是批准行为；但任何真实会议音频、STT text 或中文字幕均不得持久化到日志、测试输入、trace、video、screenshot、报告、artifact 或诊断文件。
- 仓库可提交获准的合成/非敏感固定音频 fixture 及其公开预期文本；由这些固定样本在远程 QA 中生成的字幕、trace、video 和 screenshot 仅可作为受控验收 artifact。artifact 必须标记 fixture id、场景、candidate identity 和事件顺序，不包含 credential、authorization header、provider body 或真实会议内容；普通测试报告只记录 artifact 引用、断言和状态，不复制音频或字幕正文。
- 受控验收 artifact 只进入平台现有的访问受限 QA artifact 存储并服从其既有保留/删除策略，不上传应用存储、不复制到日志、工单或仓库，也不在本方案新增保留期限。若平台不能提供该受控边界，则该次 QA 不得使用真实会议内容替代，必须停止并保留不含内容的阻塞状态。
- 内存中音频帧消费后立即丢弃；segment text 在终态发送或失败后解除引用；连接关闭销毁全部会话状态。不建立持久化、备份、analytics 或 transcript 下载。
- 对文本消息、binary 帧格式/大小、会话状态、origin 和子协议执行 allowlist 校验。日志与错误响应使用稳定类别，provider 原始 body 仅在内存中映射后丢弃。
- 未定义用户身份或访问角色；部署环境通过既有网络入口限制访问，不在产品中新增账户、RBAC 或会议授权语义。

## 配置、可观测性与运维

必需配置经启动 schema 一次性解析：`PORT`、`APP_ORIGIN`、`AZURE_SPEECH_REGION`/受支持 endpoint、`AZURE_SPEECH_LANGUAGE_CANDIDATES`、`AZURE_FOUNDRY_ENDPOINT`、`AZURE_FOUNDRY_MODEL_DEPLOYMENT=gpt-sol-6.1`。身份优先由 managed identity 自动发现；仅受批准 secret reference 可提供 provider credential。配置文件不携带环境值，开发环境使用未提交的 `.env.local`。

结构化 stdout 日志只包含 timestamp、level、correlation/session hash、stage、event category、source locale（不含内容）、sequence、Azure request id、duration 和 close/error category。不得记录 frame body、recognized text、translated text、请求/响应 body、token 或 secret。Container Apps 原生日志与 revision/replica 指标承担诊断，不增加 telemetry backend。

运维关注 active WebSocket count、session/segment 终态计数、unrecognized/failed category、adapter duration、Azure throttling/connection error 和 graceful-drain outcome；这些是诊断信号而非产品 SLO。correlation id 串联浏览器 session event、应用日志与 Azure request id。

## SLO、限制、扩缩容、重试与恢复

已批准范围没有数值 SLO，方案不创建延迟、可用率、吞吐或准确率承诺。功能边界仍是发言期间持续出现字幕，而非会后批处理；真实 Azure E2E 以事件顺序证明确认。

协议帧固定为 100 ms/3,200-byte PCM，服务端不聚合无界音频。每连接最多一个 recognizer、一个活动 translation request 和 16 个待处理稳定 segment；达到边界时明确失败，禁止静默丢弃或无界积压。该上限是进程资源保护参数，不是产品吞吐承诺。Container Apps CPU、memory、replica min/max、per-replica connection target 和 WebSocket idle timeout 由目标环境容量验证及 Azure quota 配置，不能硬编码为产品目标。

资源上限或队列实现变更前，`tests/contract/session-resource.contract.test.ts` 必须以 fake Speech/Foundry ports 执行两个相互隔离的可重复运行。长会话运行连续完成至少两个完整队列窗口（`2 × (16 + 1)` 个）稳定 segment，逐个释放 translation，并断言任一时刻只有一个 active request、queued 不超过 16、sequence/final 严格递增且无丢失/重复。溢出运行受控暂停 active translation，先观察 16 个 queued + 1 个 active 的允许边界，再以第 17 个 queued segment 触发资源保护关闭。两个运行在 drain、abort 或连接级 recognizer 重建后，均断言 audio frame、segment text、queue entry、callback、timer、recognizer 和 stream 的可达引用计数回到零。测试以显式生命周期计数和 fake resource registry 判定有界释放，不以易波动的进程 heap 数值制造产品阈值。该 contract 必须先失败，再由 orchestrator 实现使其通过，并成为修改 16-segment 上限的必需回归证据。

只在尚未发出任何 `subtitle.delta` 的 segment 上对 provider 明确标为 transient 的连接建立失败重试一次，并使用 Azure SDK/response 指示的 retry delay；缺少指示时不自动重试。已输出 delta、语言不可识别、认证/配置、contract 或 validation 错误均不重试。重试保持同一 segment id，绝不重放已交付字幕。失败 segment 进入 `failed`，后续 segment 仍可新建；连接级 SDK 取消则重建一次 recognizer，重建失败关闭该会话。这里的重试是内部恢复选择，不新增用户可见可靠性承诺。

## 部署拓扑、迁移、Rollout 与 Rollback

Vite 生成静态资源，TypeScript server 生成 Node.js 产物；multi-stage `Dockerfile` 使用 Node.js 24 LTS slim 构建并以非 root runtime user 运行，生产层仅含锁定的 production dependencies、server 与静态资源。容器监听 `PORT`，不写本地持久数据。

Azure Container Apps revision 通过 managed identity 访问 Azure AI Speech/Foundry；若某 adapter 不支持 managed identity，则 Container Apps 通过 Key Vault secret reference 注入。公网浏览器只到 Container App HTTPS/WSS endpoint；应用向 Azure 服务发起 TLS egress。当前无 database/schema/data migration；首次部署只配置 identity、endpoint、model deployment、language candidates、secret reference 和平台 health probe。

候选 image 由不可变 digest 标识，`runtime/deployment.json` 的 image、candidate SHA 和 QA target 必须指向同一 candidate。rollout 创建新 revision，先通过 startup contract、health、真实 Azure integration 和 Playwright 完整流程，再切换流量。失败时停止新 revision 流量并回切上一不可变 revision；回退不迁移活动会话，切换前先 draining。首次部署没有上一 revision 时停止发布并保留诊断证据。

Coding 的候选制品闭合顺序固定为：完整应用与自动化测试先完成；其后构建 `Dockerfile`；再生成引用既定分类命令和容器契约的 `runtime/deployment.json`，同时可独立编写 `runtime/runbook.md`；最后的范围、secret、会议内容、依赖安全和根路径检查必须等待 `Dockerfile`、`runtime/deployment.json`、`runtime/runbook.md` 及全部应用/测试文件完成后执行。存在直接依赖的候选制品不得标记为并行；最终检查未覆盖 runbook 或任一候选文件时，Coding 不得宣告完成。

## 验证环境责任矩阵（Verification Environment）

| 验证类型 | 责任阶段 | 环境来源 | 依赖/凭据 | Coding 证据 | 下游结果 |
|---|---|---|---|---|---|
| TypeScript static analysis 与 protocol/unit tests | Coding | 本地 Node.js 24 LTS，锁定 `package-lock.json` | 无 Azure credential；使用 adapter fake | 命令、退出码、测试报告，覆盖状态机、顺序、失败恢复、日志脱敏 | Coding 阶段可获得通过/失败 |
| production build 与 container build | 平台 CI | clean runner 与 container runtime | 锁定 npm 依赖；无运行时 secret | `runtime/deployment.json` 声明命令、构建日志、image metadata | CI 后获得 clean build 与候选 image 结果 |
| Azure adapter contract/integration | 远程 integration | 已批准的 Azure Speech、`gpt-sol-6.1` deployment 和受控 Web app | managed identity/secret reference；可识别的不同语言与不可识别音频 | contract/integration tests、无敏感内容的 fixture、证据采集逻辑 | 运行后获得 continuous-LID 范围、reasoning 关闭、流式 schema 与错误映射证据 |
| `IQA-001` 可识别外语完整流程 | Independent QA | 与 candidate digest 对应的远程 QA target，Playwright Chromium | 获准非敏感固定音频的麦克风替换/虚拟输入；真实 Azure 身份 | Playwright 场景及受控 artifact 采集逻辑，记录 fixture id、无手选语言、按序字幕变化并执行 TD-012 边界 | QA 后在受限存储获得发言期间持续中文字幕证据 |
| `IQA-002` 第二种可识别语言 | Independent QA | 同一远程 QA target | 与 IQA-001 不同、有服务支持依据的获准非敏感固定音频 | Playwright 场景、语言能力依据及符合 TD-012 的字幕 artifact | QA 后在受限存储获得无需预设语言的真实结果 |
| `IQA-003` 无法识别后恢复 | Independent QA | 同一远程 QA target | 获准非敏感的不可识别固定音频后接可识别固定音频 | Playwright 场景、两个 segment 顺序和符合 TD-012 的状态/字幕 artifact | QA 后在受限存储获得未伪装成功且后续恢复的结果 |
| revision rollout/rollback | release verification | Azure Container Apps target | 部署身份、candidate digest、上一 revision（如存在） | health、drain、revision 切换与 rollback 命令定义 | 发布验证后获得切流或回退结果 |

## 快速验证指南（Quickstart）

1. 使用 Node.js 24 LTS，在 clean checkout 执行锁定依赖安装；准备未提交的本地环境配置。没有 Azure 访问权时只运行 static analysis、build、unit/contract tests，不把 fake 结果报告为 integration 通过。
2. 执行 TypeScript static analysis、production build、Vitest unit/contract tests，确认 v1 protocol、session/segment 状态机、严格顺序、无法识别分支、后续恢复、reasoning 参数及日志脱敏。
3. 构建并以非 root 用户运行 container，传入 `PORT` 与 Azure 配置；检查 `/health/ready`。该结果只证明 readiness。
4. 在批准的 Azure integration 环境执行 adapter integration：验证 continuous language identification 的实际候选范围、不同可识别语言、不可识别输入、启动探针、Responses streaming schema、`gpt-sol-6.1` 及 `reasoning.effort="none"`。普通报告只保留 fixture id、request id、断言与状态，不保留真实会议内容、探针文本/输出或 credential。
5. 部署同一 candidate digest 到 QA target。Playwright/Chromium 只使用获准非敏感固定音频输入依次执行 `IQA-001`、`IQA-002`、`IQA-003`；断言没有源语言手选控件、字幕在发言期间按序变化、不可识别段没有成功字幕且下一可识别段恢复。
6. 对照 `AC-001` 至 `AC-004` 将 fixture id、按序 protocol 状态及含固定样本字幕的 Playwright trace/video/screenshot 写入 TD-012 定义的受控 QA artifact；普通测试报告仅保存 artifact 引用和断言结果。只有同一 candidate 的真实 Azure 完整流程结果可作为功能验收证据。

## 支持 Runbook

- **应用不 ready**：核对配置 key 是否齐全、managed identity/secret reference、Speech region/endpoint、Foundry endpoint/deployment、language candidates 与 reasoning contract probe；仅记录缺失项和 provider request id，不输出值或 response body。
- **无法识别比例异常**：按 correlation id 检查音频格式、Speech cancel category、source locale 状态、目标服务 continuous-LID 能力与候选配置；不得把无法识别段手工改作成功字幕或静默扩展语言清单。
- **字幕中断/乱序**：检查 sequence/revision、backpressure、Foundry stream category 和 WebSocket close code；遇到已输出 delta 的 segment 不重放，后续 segment 依状态机恢复。
- **Azure 限额或连接异常**：查看 Azure 原生 quota、request id、replica 连接数和 throttling category；按已验证容量调整 Container Apps 配置或 Azure quota，不宣称新的产品 SLO。
- **secret 暴露怀疑**：停止受影响 revision，轮换 provider secret/撤销身份授权，检查脱敏日志与构建 artifact；不得复制会议内容到工单或诊断文件。
- **部署失败**：停止向新 revision 切流，drain 后回切上一不可变 revision；确认 candidate digest、配置引用和 QA target 一致，再重新验证。
- **终止与证据**：SIGTERM 期间确认 readiness 失败、新连接被拒绝、现有连接在 grace period 内释放；运维证据只保留 candidate、revision、request/correlation id、状态、时间和错误类别。验收证据仅允许 TD-012 定义的固定样本受控 artifact，真实会议内容始终禁止采集。

## 开放决策

无。
