# 实时流式翻译运维 Runbook

## 部署与配置边界

- 部署目标为 Azure Container Apps，公网入口仅提供 HTTPS/WSS。
- 应用监听平台注入的 `PORT`，readiness endpoint 为 `/health/ready`，Candidate identity endpoint 为 `/candidate-identity`。
- 必需配置为 `APP_ORIGIN`、`AZURE_SPEECH_REGION`、`AZURE_SPEECH_LANGUAGE_CANDIDATES`、`AZURE_FOUNDRY_ENDPOINT` 和 `AZURE_FOUNDRY_MODEL_DEPLOYMENT=gpt-sol-6.1`。
- 优先使用 Container Apps managed identity。仅当目标 adapter 不支持该身份时，才使用平台批准的 Key Vault secret reference；不得把 credential 值写入仓库、日志、报告或浏览器。
- `AZURE_SPEECH_LANGUAGE_CANDIDATES` 必须来自目标 Speech 服务 continuous language identification 能力的真实验证结果，不作为产品静态语言清单。

## 发布、Drain 与回退

1. 确认 image digest、Candidate SHA 和 QA target 指向同一不可变 Candidate。
2. 创建新 Container Apps revision，配置 identity、endpoint、model deployment、language candidates、secret reference 和 health probe。
3. 先完成 startup contract、readiness、真实 Azure integration 和 Playwright 完整流程验证，再切换流量。
4. 终止时先使 readiness 失败并拒绝新 WebSocket，在平台 grace period 内 drain 现有连接；不得迁移会话或重放已交付字幕。
5. 验证失败时停止向新 revision 切流，并回切上一不可变 revision。首次部署没有上一 revision 时停止发布并保留无内容诊断证据。

## 诊断

### 应用未就绪

核对必需配置 key、managed identity 或 secret reference、Speech region、Foundry endpoint/deployment、候选语言和 reasoning contract probe。仅记录缺失 key、状态和 provider request id，不记录配置值或 response body。

### 连接、字幕中断或乱序

按 correlation id 检查 WebSocket origin、`translation.v1` 子协议、close code、sequence/revision、backpressure 和 Foundry stream category。已输出 delta 的 segment 不得重放；后续 segment 仅按状态机恢复。

### 无法识别比例异常

检查 PCM16LE/16 kHz/mono 音频格式、Speech cancel category、source locale 状态、continuous language identification 能力与候选配置。不得把无法识别段改作成功字幕，也不得静默扩大语言清单。

### 限额或外部连接异常

检查 Azure 原生 quota、request id、replica 活动连接数和 throttling category。仅依据目标环境容量验证调整 Container Apps 配置或 Azure quota，不据此声明新的产品 SLO。

### Secret 暴露怀疑

停止受影响 revision，轮换 provider secret 或撤销身份授权，并检查脱敏日志和构建 artifact。不得把真实会议音频、STT text、中文字幕、authorization header、token 或 secret 复制到工单、报告或诊断文件。

## 无内容证据

普通运维证据仅记录 Candidate、revision、fixture id、request/correlation id、状态、时间、错误类别、断言结果和受控 artifact 引用。批准固定样本产生的字幕、trace、video 和 screenshot 只能进入平台现有的受限 QA artifact 存储；真实会议内容不得采集或持久化。
