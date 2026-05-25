## Why

线上 frontend-app 在用本镜像上传微信小程序时反复触发两个独立问题：

1. **同版本号重复上传时本地编译崩溃** —— `Promise.all([ci.upload, ci.preview])` 并发跑底层 `innerUpload`，两个并发调用共享同一 `compilerInstance`（miniprogram-ci 模块级单例）+ `cacheManager.clean()` 副作用 + `project.setting` mutation，触发 `AppGraph.this.conf.app === undefined` 的 race condition。在版本号已被微信侧记录的场景下，服务端响应时序紧凑，两侧 innerUpload 几乎同步进入 compile 阶段，命中 race。错误是 `TypeError: Cannot read properties of undefined (reading 'functionalPages')`，3 秒就挂，**没到网络层**。社区报告同样症状，但官方未修复，且无 `force` / `overwrite` / `skipVersionCheck` 参数可绕过。

2. **upload-mp.js 的 catch 块丢失错误信息** —— 现有 `this.logger.error('上传或预览失败: ${error.message}')` 在错误对象不是标准 `Error` 时（miniprogram-ci 实际抛 `CodeError` / `CustomError`，含 `errCode/errMsg` 但无 `.message`）输出 `undefined`，运维定位耗时翻倍。frontend-app 用运行时 string-replace patch（`ci-patch/patch-upload-mp.js`）临时缓解，但是技术债：脆弱、不可 lint、容易因 base 镜像版本变化 anchor 失效。

本次变更把两块直接做进 base 镜像源码，让 frontend-app 那侧的运行时 patch 可以下线。

## What Changes

- **新增唯一版本号生成**：`utils/version.js` 加 `generateUniqueVersion(baseVersion, buildMode)`，返回 `{baseVersion}-{buildMode}-{8hex}-{8hex}` 格式（`crypto.randomBytes(8).toString('hex')` 切两半）。`upload-mp.js:uploadWithPreview()` 入口调用，把上传给微信的 version 改为带 UUID 后缀的字符串。`buildMode` 从 `process.env.BUILD_MODE` 读取（与 `docker-entrypoint.sh` 现有约定一致），默认 `production`。
- **catch 块增强为标准 helper 方法**：`upload-mp.js` 新增私有方法 `_logDiagnosticError(error, version)` 和 `_probeEgressIp()`，两处 catch（`uploadWithPreview` / `preview`）替换为调用这两个 helper。诊断输出包含 version / message / code / type / constructor / errCode / errMsg / 完整 JSON / 出口公网 IP / stack。
- **Base 镜像 minor bump**：`public/Dockerfile.base` 与 `private/Dockerfile.base` 内涉及的版本标识从 `1.0.2` 升到 `1.1.0`，README/CLAUDE.md 中所有 1.0.2 引用同步更新。
- **frontend-app 侧同步**（Phase 2，跨仓库 task）：将 frontend-app 的 `Dockerfile.build` `FROM` 升至 `:1.1.0`，删除 `ci-patch/` 目录与对应 `COPY/RUN` 行。

**不在范围内**（明确划界）：
- 不修改 `Promise.all` 为 sequential — race 本质问题留给 miniprogram-ci 维护方，本变更通过 unique version 规避其触发条件。
- 不引入新 npm 依赖 — UUID 用 Node 内置 `crypto`，IP 探测用 `child_process.execSync + curl`。
- 不改 `getRecommendedVersion` 现有行为 — 保留方法签名与返回值，新方法独立。
- 不暴露 unique version 开关 — 默认所有 build 都生成 unique version，避免再次踩坑。

## Capabilities

### New Capabilities
- `unique-version-suffix`: 描述 `upload-mp.js` 在上传时如何把用户传入的 semver 版本号拼接成全局唯一的 version 字符串，包含 BUILD_MODE 标记、UUID 后缀格式、生成时机与日志可见性约束。
- `upload-mp-diagnostics`: 描述 `upload-mp.js` 在 upload/preview 失败时必须输出的诊断信息集合（错误详情 + 出口 IP 探测），以及 catch 块的实现规范（走 logger 抽象、抽 helper 方法、不直接 console.*）。

### Modified Capabilities
（无 — 项目此前无 openspec，此次新建 capability）

## Impact

- **本仓库代码**：3 文件改动
  - `scripts/utils/version.js` — 加 1 个方法（+15 行）
  - `scripts/upload-mp.js` — 改 2 处 catch + 加 2 个 helper（约 +60 行 / -2 行）
  - `public/Dockerfile.base` + `private/Dockerfile.base` — 版本号字符串
  - `README.md` / `CLAUDE.md` — 文档同步
- **Base 镜像**：tag bump 至 `1.1.0`，需重新 build & push（公网 + 内网各一次）。
- **下游仓库**（frontend-app）：升级 FROM tag + 删除 `ci-patch/` 目录与 Dockerfile 中相关 COPY/RUN 行。
- **运行时行为变化**：
  - 微信小程序后台「开发版本」列表显示的 version 字符串将从纯 semver 变为 `{semver}-{BUILD_MODE}-{hex8}-{hex8}` 格式（最长 ~35 字符）。运维 / QA 看到的版本号格式变化，需周知。
  - 任何 build 都不会再因「同 BUILD_VERSION 重新上传」触发本地编译 race。
  - 上传失败时日志体积略增（多 10-15 行诊断），但只在 catch 路径生效。
- **回归风险**：极低
  - `getRecommendedVersion` 行为不变
  - `generateUniqueVersion` 是新方法
  - catch 增强只影响错误路径
  - 微信小程序后台对 version 字段无明确 semver 校验（实测 prerelease tag 形式可被接受）
