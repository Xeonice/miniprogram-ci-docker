## ADDED Requirements

### Requirement: upload/preview 失败时 SHALL 输出完整诊断信息

`scripts/upload-mp.js` 的 `uploadWithPreview()` 和 `preview()` 两个方法的 catch 块在捕获错误时 SHALL 调用统一的诊断 helper 方法输出以下字段（按顺序）：

1. `version` — 实际上传的版本号字符串（含 UUID 后缀）
2. `message` — `error?.message ?? '(无 message)'`
3. `code` — `error?.code`
4. `type` — `typeof error`
5. `ctor` — `error?.constructor?.name`（如 `Error` / `CodeError` / `CustomError`）
6. 若 `error.errCode` 存在：`errCode` 和 `errMsg`（微信侧返回的结构）
7. `ownProps` — `Object.getOwnPropertyNames(error).join(', ')`
8. `JSON` — `JSON.stringify(error, ownProps, 2)`（包含不可枚举属性的完整序列化）
9. 若 `error.stack` 存在：完整 stack trace

所有诊断输出 SHALL 走 `this.logger.error(...)`，**不得**直接 `console.error` / `process.stderr.write`。

#### Scenario: CodeError 抛出时输出完整字段

- **GIVEN** ci.upload 抛出 `CodeError { code: 20003, message: 'Error: socket hang up' }`
- **WHEN** catch 块捕获并调用 `_logDiagnosticError(error, version)`
- **THEN** 日志 SHALL 包含 `version = ...`
- **AND** 日志 SHALL 包含 `code = 20003`
- **AND** 日志 SHALL 包含 `ctor = CodeError`
- **AND** 日志 SHALL 包含完整 stack

#### Scenario: 非标准错误对象（无 message）

- **GIVEN** 抛出 `{ errCode: 80005, errMsg: 'ip not in whitelist' }`（无 `.message` 字段）
- **WHEN** catch 块捕获
- **THEN** 日志 SHALL 包含 `message = (无 message)`
- **AND** 日志 SHALL 包含 `errCode = 80005, errMsg = ip not in whitelist`
- **AND** 日志 SHALL 包含 `ownProps = errCode, errMsg`

### Requirement: 错误时 SHALL 探测并输出公网出口 IP

catch 块在调用 `_logDiagnosticError` 之后 SHALL 调用 `_probeEgressIp()` 异步探测公网出口 IP 并输出。探测方式：

- SHALL 依次尝试 `ifconfig.me` / `ipinfo.io/ip` / `icanhazip.com` 三个公共服务
- 每次探测 SHALL 用 `curl -sS --max-time 5 https://{service}`
- 任一服务返回非空 IP 字符串 SHALL 立即采纳并输出 `公网出口IP = {ip} (via {service})`
- 三个全部失败 SHALL 输出 `公网出口IP = (无法获取)`，不抛异常

#### Scenario: 成功探测到 IP

- **GIVEN** 容器内 curl 能通且 ifconfig.me 响应正常
- **WHEN** `_probeEgressIp()` 执行
- **THEN** 日志 SHALL 包含 `公网出口IP = X.X.X.X (via ifconfig.me)`
- **AND** SHALL NOT 抛异常给 catch 上层

#### Scenario: 全部探测服务失败

- **GIVEN** 容器无外网或公共服务受限
- **WHEN** `_probeEgressIp()` 执行三次 curl 全部超时
- **THEN** 日志 SHALL 包含 `公网出口IP = (无法获取)`
- **AND** 函数 SHALL 正常返回，不抛异常

### Requirement: 诊断逻辑 SHALL 抽为私有 helper 方法

`scripts/upload-mp.js` 的诊断输出 SHALL 实现为 `MiniProgramUploader` 类的两个私有方法：

- `_logDiagnosticError(error, version)` — 同步输出错误详情
- `_probeEgressIp()` — 异步探测出口 IP

两处 catch 块（`uploadWithPreview` 和 `preview`）SHALL 调用同一对 helper，不得复制粘贴诊断逻辑。

helper 方法 SHALL 使用 `_` 前缀表示私有。**禁止** 用字符串数组拼接 / `Function` 构造等动态写法 — 必须是普通 JavaScript 方法源码，可被 IDE 高亮、可被 lint。

#### Scenario: 两个 catch 调同一组 helper

- **GIVEN** `uploadWithPreview` 抛错和 `preview` 抛错
- **WHEN** 各自 catch 执行
- **THEN** 两个 catch SHALL 都调用 `this._logDiagnosticError(error, version)`
- **AND** 两个 catch SHALL 都 `await this._probeEgressIp()`
- **AND** SHALL NOT 在 catch 内联诊断逻辑（保持 DRY）

#### Scenario: 不允许字符串拼接动态注入

- **WHEN** 评审一个 PR 试图用 `string.replace` 或 patch 脚本注入诊断代码到 upload-mp.js
- **THEN** SHALL 拒绝该方式
- **AND** 评审意见 SHALL 引用本约束，要求改为直接编辑 helper 方法

### Requirement: 诊断输出 SHALL 复用项目 logger 抽象

所有诊断日志 SHALL 通过 `this.logger.error(...)` 输出，SHALL NOT 直接调用 `console.log` / `console.error` / `process.stdout.write` / `process.stderr.write`。这保持与项目其他日志的格式、时间戳、日志文件落盘行为一致。

#### Scenario: 评审 PR 用 console.error 绕过 logger

- **WHEN** 评审 PR 在 catch 块直接 `console.error(error)`
- **THEN** SHALL 要求改为 `this.logger.error(...)`
- **AND** 评审意见 SHALL 引用本约束
