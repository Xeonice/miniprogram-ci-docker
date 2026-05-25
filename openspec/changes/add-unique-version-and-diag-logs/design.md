## Context

`miniprogram-ci-docker` 是 frontend-app 等多个微信小程序项目共用的 base 镜像源。镜像内 `/ci/scripts/upload-mp.js` 是上传主脚本，封装 `miniprogram-ci` 调用并集成 OSS 二维码上传、日志、版本管理等能力。

近期 frontend-app 在反复部署中暴露两个独立问题：

1. **同版本号上传触发 miniprogram-ci 内部 race condition**：`Promise.all([ci.upload, ci.preview])` 并发调用底层 `innerUpload`，共享进程级 `compilerInstance` 单例和 `project.setting` 副作用。当微信侧因版本号已记录而快速响应时，两个 promise 几乎同时进入 compile 阶段，`AppGraph.this.conf.app` 处于半初始化状态导致 `TypeError: Cannot read properties of undefined (reading 'functionalPages')`。`miniprogram-ci@2.1.26` 无 `force/overwrite/skipVersionCheck` 参数可绕过。

2. **catch 块只输出 `error.message`**：当错误对象是 `miniprogram-ci` 内部 `CodeError`/`CustomError`（含 `errCode`/`errMsg` 而无标准 `.message`）时输出 `undefined`，运维定位全靠猜。frontend-app 已经用运行时 `string.replace` patch（`ci-patch/patch-upload-mp.js`）打补丁，但是技术债：
   - 字符串数组拼接代码不可 lint / 不可格式化
   - anchor 字符串若被 base 镜像更新打破会静默失败
   - 每个下游项目都要复制粘贴

本次把两个修复直接做进 base 镜像源码，下游项目只升 tag 即可受益。

## Goals / Non-Goals

**Goals:**
- 让 frontend-app 那侧的 `ci-patch/` 运行时 patch 可以**整目录下线**。
- 任何 build 上传到微信侧的 version 都是**全局唯一**的字符串，规避同版本号重复上传触发的 race。
- upload/preview 失败时 catch 块输出**完整的错误诊断**（含错误对象所有字段 + 出口公网 IP），不再丢失错误信息。
- 实现用**正常 JavaScript 源码**写（不是 string replace），可 lint、可格式化、可单测。
- 复用项目现有 `this.logger` 抽象，符合 codebase 风格。
- 不引入新 npm 依赖（Node 内置 `crypto` + 镜像已装的 `curl`）。

**Non-Goals:**
- 不修复 miniprogram-ci 的 race condition 本质（要改 miniprogram-ci 源码）。本变更通过 unique version 规避其**触发条件**而不是其**根因**。
- 不把 `Promise.all` 改为 sequential — 并发能力是 upload-mp.js 现有设计选择，sequential 会让所有部署慢一倍。
- 不破坏 `getRecommendedVersion` 现有行为，方法签名和返回值保持不变。
- 不暴露 unique version 开关 — 开关意味着有人会关，关掉就再踩同样坑。
- 不限制微信侧 version 字段的具体格式（已实测 prerelease tag 形式可接受）。
- 不在本变更内重构 docker-entrypoint.sh — `BUILD_MODE` 读取方式沿用现有约定。

## Decisions

### D1: UUID 后缀格式 `{semver}-{BUILD_MODE}-{hex8}-{hex8}`

**选择**：在 `utils/version.js` 新增 `generateUniqueVersion(baseVersion, buildMode)`，返回字符串：
```
{baseVersion}-{buildMode}-{hex.slice(0,8)}-{hex.slice(8,16)}

例：
  3.8.0-production-a1b2c3d4-e5f67890       (35 字符)
  3.8.0-pre-a1b2c3d4-e5f67890              (28 字符)
  3.8.0-test-a1b2c3d4-e5f67890             (29 字符)
```

`hex` 由 `crypto.randomBytes(8).toString('hex')` 生成，即 16 位十六进制字符。

**为什么**：
- 16 hex 字符的 2^64 ≈ 1.8×10^19 唯一空间，CI 每秒部署一次连续 10 亿年都不会撞。
- 8-8 分割（中间 `-`）提高肉眼可读性，方便运维在日志/微信后台对照。
- 直接复用 `process.env.BUILD_MODE`（值集 `production / pre / test`，最长 10 字符）作为环境标记，无需新增映射表或参数。BUILD_MODE 未设置时默认 `production`（与 `docker-entrypoint.sh:89` 现有兜底一致）。
- 最长 ~35 字符，远低于实测的微信 version 字段安全长度（社区上传 `1.0.0-20231015103045` 等较长字符串均成功）。

**备选**：
- 完整 UUID v4（36 字符）→ 总长破 50，担心微信 version 上限。
- 时间戳 `Date.now()` → 同毫秒理论可撞，并且没有"全局唯一"语义保证。
- nanoid → 引入新依赖。

### D2: BUILD_MODE 来源用 `process.env.BUILD_MODE`，不加新参数

**选择**：`generateUniqueVersion(baseVersion, buildMode)` 的 `buildMode` 参数在 `upload-mp.js` 调用处用 `process.env.BUILD_MODE || 'production'` 拼。**不**通过命令行 `--build-mode` 新参数或 `this.env` 字段传递。

**为什么**：
- `BUILD_MODE` 已是 `docker-entrypoint.sh` 暴露的环境变量约定（line 89 默认 `production`），所有调用方都已经透传。
- 增加命令行参数会让 upload-mp.js 的接口扩面，需要同步改 docker-entrypoint.sh，新增同步点。
- `this.env` 在 upload-mp.js 现有语义是 `--env`（development/staging/production），跟 `BUILD_MODE`（production/pre/test）不完全是同一概念，混用易乱。

**备选**：
- 加 `--build-mode` 参数 → 多一处可遗漏的接口。
- 复用 `this.env` → 语义混淆。

### D3: catch 增强抽两个私有 helper 方法

**选择**：在 `MiniProgramUploader` 类内新增：
- `_logDiagnosticError(error, version)` — 同步输出错误对象全部字段
- `_probeEgressIp()` — 异步探测公网出口 IP（`execSync curl`，5s 超时 × 3 服务）

`uploadWithPreview` 和 `preview` 两处 catch 都改为：
```js
} catch (error) {
  this.logger.error('上传或预览失败:');
  this._logDiagnosticError(error, version);
  await this._probeEgressIp();
  throw error;
}
```

**为什么**：
- 两处 catch 共享同一诊断逻辑，DRY 原则。
- helper 方法可独立单测，未来加新字段不动 catch。
- `_` 前缀符合项目惯例，区分公共与私有。
- 走 `this.logger.error`，跟 codebase 现有日志风格统一，不直接 console.* 。
- IP 探测放在 helper 而非 catch 内联，便于未来扩展（如加 `_probeDns()`、`_probeWechatReachability()`）。

**备选**：
- 整段塞 catch 内 → 两处复制，DRY 违反。
- 用 mixin / 外部模块 → 跨文件，可读性下降。
- 直接 console.* → 绕过 logger 抽象，跟 frontend-app 之前 patch 的 v1 一样错。

### D4: catch 内异步 IP 探测可接受

**选择**：`_probeEgressIp()` 用 `execSync` 同步阻塞调用 curl（5s 超时 × 最多 3 服务，最坏 15s 阻塞）。catch 内 `await this._probeEgressIp()` 把异步包装一层（虽然内部是 sync 调用，但形式上 await 不影响）。

**为什么**：
- 错误已经发生，慢 5-15s 出诊断不影响业务。
- `execSync` 比 `child_process.spawn + Promise` 代码量少 4 倍。
- 5s 是各公共服务（ifconfig.me/ipinfo.io/icanhazip.com）的典型响应上限，单次失败立即试下一个，整体可控。

**备选**：
- 用 `http.get` 异步实现 → 代码量增加；catch 内异步链路更复杂。
- 跳过 IP 探测 → 失败时不知道走的哪条出口，IP 白名单类问题排查回退。

### D5: 唯一 version 时机在 `uploadWithPreview` 入口，**只生成一次**

**选择**：在 `uploadWithPreview()` 函数开头调用一次 `generateUniqueVersion`，把结果保存到 `version` 局部变量后传给 `ci.upload({version})`。`preview` 那侧内部强制 `version = "0.0.1"`（miniprogram-ci 源码已锁定），不需要也无法注入 UUID。

**为什么**：
- 一次生成保证 upload 调用使用的 version 字符串确定且单一（不会因为多次调用 randomBytes 产生漂移）。
- preview 强制 0.0.1 是上游设计，不在本变更修改范围。
- 用户传入版本号 `this.version` 通过现有 `getRecommendedVersion` 解析为 baseVersion，再二次加工，保留所有现有版本号解析逻辑。

**调用链**：
```
this.version (用户 --version 或 build-info)
   ↓ getRecommendedVersion(this.version)         ← 已有逻辑不变
baseVersion (例如 "3.8.0")
   ↓ generateUniqueVersion(baseVersion, BUILD_MODE)  ← 新增
version (例如 "3.8.0-production-a1b2c3d4-e5f67890")
   ↓ ci.upload({version})                          ← 传给 miniprogram-ci
```

### D6: 日志体现两个版本号

**选择**：`uploadWithPreview` 入口的 logger.info 同时打两行：
```
this.logger.info(`用户版本: ${baseVersion}`);
this.logger.info(`实际上传: ${version}`);
```

诊断日志的 `_logDiagnosticError` 第一行也打 `version`：
```
[ERROR] 上传或预览失败:
[ERROR]   version    = 3.8.0-pre-a1b2c3d4-e5f67890
[ERROR]   message    = ...
```

**为什么**：
- 运维在微信小程序后台看到 `3.8.0-pre-a1b2c3d4-e5f67890` 时，能在 CI 日志里 grep 这个唯一版本号找到对应 build。
- 诊断时第一时间看到实际 version，对比微信侧记录。

### D7: Base 镜像 minor bump `1.0.2 → 1.1.0`

**选择**：在 `public/Dockerfile.base` 和 `private/Dockerfile.base` 内涉及 `1.0.2` 字符串的注释/标签都改为 `1.1.0`。`README.md` / `CLAUDE.md` 同步。

**为什么**：
- 新增能力（unique version + 内置诊断），符合 semver minor 语义。
- 1.0.x 仍可用作旧版本回滚（不删 tag）。
- 下游项目可以按需选择何时升级。

**备选**：patch（1.0.3）→ 误传"只是修 bug"，但其实有新功能；major（2.0.0）→ 没有 breaking change。

## Risks / Trade-offs

- **Risk：微信小程序后台 / 审核同事看到非 semver 版本号** → **Mitigation**: 上线前文档周知；如果审核流程真要求纯 semver，可在 production 环境下额外添加 BUILD_MODE 排除规则（但 D5 决定先不暴露开关）。
- **Risk：BUILD_MODE 取值未来扩展（如 `staging`/`canary`）导致版本号长度超 50** → **Mitigation**: 当前最长 `production`（10）+ semver（10）+ hex（17）+ 3 个 `-` ≈ 40，预留充分。如果出现 `staging`（7）等也安全。
- **Risk：catch 内 `execSync` 阻塞 ≤15s 让用户感觉慢** → **Mitigation**: 错误路径慢 15s 可接受；正常路径不受影响。
- **Risk：base 镜像 1.1.0 push 后，旧 1.0.2 镜像仍被某些项目引用** → **Mitigation**: 1.0.2 不删，向后兼容；frontend-app 在本 change Phase 2 升级 FROM tag。
- **Risk：Node 18 之前的环境没 `crypto.randomBytes`（实际上有，是 Node 8+ 内置）** → **Mitigation**: 项目 base 镜像是 Node 22 Alpine，无问题。
- **Trade-off：诊断信息每次错误日志多 ~15 行** → 错误路径才输出，**接受**。
- **Trade-off：上传给微信的 version 字符串长度增加** → 实测 ≤ 35 字符安全，**接受**。

## Migration Plan

跨仓库 / 两阶段：

```
Phase 1: miniprogram-ci-docker 主体改动 + 镜像发布
  1.1 在 main 分支基础上切 feat 分支（具体名 apply 阶段确认）
  1.2 改代码 + commit + push
  1.3 docker build & push base:1.1.0（公网 + 内网各一次）

Phase 2: frontend-app 升级 FROM + 撤 patch
  2.1 在 fix/runtime-and-product-bugs-2026-05-22 分支
  2.2 Dockerfile.build FROM 改 :1.1.0
  2.3 删 ci-patch/ 目录 + 删 COPY/RUN 两行
  2.4 commit + push

Phase 3: 验证
  3.1 触发 frontend-app CI 部署
  3.2 日志看到 "用户版本: X" + "实际上传: X-MODE-yyyyyyyy-zzzzzzzz" 即 OK
  3.3 微信小程序后台「开发版本」列表确认 version 字符串
  3.4 重复部署 3-5 次确认不再触发 race condition
```

## Open Questions

- **Phase 1 用哪个分支？** main 直接改还是 feat 分支？（apply 阶段确认；按团队 git 流程一般是 feat 分支）
- **frontend-app 撤 patch 与 base 1.1.0 升级合并到一个 commit 还是分开？** 倾向一个 commit（原子升级），方便回滚。apply 阶段确认。
- **docker build & push 是 CI 自动还是手工？** apply 阶段确认；如果是手工，tasks 里要包含具体命令；如果是 CI 自动，触发条件需写清楚。
