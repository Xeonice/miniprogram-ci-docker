## ADDED Requirements

### Requirement: upload-mp.js SHALL 上传带 BUILD_MODE + UUID 后缀的唯一版本号

`scripts/upload-mp.js` 的 `uploadWithPreview()` 方法在调用 `ci.upload({version})` 前 SHALL 把用户/CI 输入的基础版本号扩展为全局唯一的字符串，格式为：

```
{baseVersion}-{BUILD_MODE}-{hex8}-{hex8}
```

字段约束：
- `baseVersion` SHALL 来自 `VersionManager.getRecommendedVersion(this.version)` 的现有返回值（用户 `--version` > Git tag > package.json，逻辑不变）。
- `BUILD_MODE` SHALL 从 `process.env.BUILD_MODE` 读取；未设置时 SHALL 兜底为 `production`（与 `scripts/docker-entrypoint.sh:89` 现有兜底一致）。
- `hex8`（两段）SHALL 由 `crypto.randomBytes(8).toString('hex')` 生成的 16 位十六进制字符串切前 8 位 + 后 8 位，中间用 `-` 连接。
- 分隔符 SHALL 全部使用 `-`，组合后字符串只含 `[a-z0-9.-]`。

唯一性 SHALL 由 16 位 hex（2^64 空间）保证，同一进程内多次调用 SHALL 返回不同字符串。

#### Scenario: 默认 production 模式生成 unique version

- **GIVEN** 用户 `--version 3.8.0`、`process.env.BUILD_MODE` 未设置
- **WHEN** `uploadWithPreview()` 计算 version
- **THEN** 生成的字符串 SHALL 形如 `3.8.0-production-{8hex}-{8hex}`
- **AND** 字符长度 SHALL ≤ 40

#### Scenario: pre 模式生成 unique version

- **GIVEN** 用户 `--version 3.8.0`、`process.env.BUILD_MODE=pre`
- **WHEN** `uploadWithPreview()` 计算 version
- **THEN** 生成的字符串 SHALL 形如 `3.8.0-pre-{8hex}-{8hex}`

#### Scenario: 同进程多次调用得到不同字符串

- **GIVEN** 同一 `VersionManager` 实例
- **WHEN** 连续调用 `generateUniqueVersion('3.8.0', 'pre')` 两次
- **THEN** 两次返回值 SHALL 不相同（hex 部分由 randomBytes 决定）

### Requirement: `getRecommendedVersion` 行为 SHALL 保持向后兼容

新增 `generateUniqueVersion` 方法 SHALL 不修改 `VersionManager.getRecommendedVersion` 的签名、参数、返回值。`getRecommendedVersion` 现有调用方（如 `uploadWithPreview` 在重构前的代码、`preview` 方法、未来其他调用方）SHALL 拿到与本变更前完全相同的字符串。

#### Scenario: getRecommendedVersion 行为不变

- **GIVEN** 用户 `--version 3.8.0`
- **WHEN** 调用 `versionManager.getRecommendedVersion('3.8.0')`
- **THEN** 返回值 SHALL 是 `'3.8.0'`（不含 UUID 后缀）

### Requirement: upload-mp.js SHALL 日志输出两个版本号

`uploadWithPreview()` 入口日志 SHALL 同时输出 `用户版本` 和 `实际上传` 两行 info 级别日志，方便运维在微信小程序后台看到唯一版本号后能在 CI 日志里 grep 出对应 baseVersion 与 build。

#### Scenario: 日志同时显示两个版本号

- **GIVEN** 用户 `--version 3.8.0`、BUILD_MODE=pre
- **WHEN** `uploadWithPreview()` 开始执行
- **THEN** 日志 SHALL 包含 `用户版本: 3.8.0`
- **AND** 日志 SHALL 包含 `实际上传: 3.8.0-pre-{8hex}-{8hex}`

### Requirement: preview 内部 version 字段不受本规范影响

`scripts/upload-mp.js:uploadWithPreview()` 中 `ci.preview()` 那条 promise 的 version 由 miniprogram-ci 库内部强制为 `"0.0.1"`（见 `dist/ci/preview.js`）。本规范 SHALL NOT 试图修改这个值，preview 二维码使用 `0.0.1` 是 miniprogram-ci 的上游设计。

#### Scenario: preview 二维码使用 0.0.1

- **GIVEN** 任意 baseVersion 和 BUILD_MODE
- **WHEN** `ci.preview()` 内部发出 testSourceURL 请求
- **THEN** 请求 URL 的 `version` 参数 SHALL 是 `0.0.1`（由 miniprogram-ci 内部设定）
- **AND** 本变更代码 SHALL NOT 干预 preview 的 version
