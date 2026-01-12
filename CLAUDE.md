# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是微信小程序 CI Docker 化方案，将微信小程序的构建和上传流程容器化，支持公网和内网两种部署环境。

## 架构

### 两层镜像架构

1. **基础镜像** (`Dockerfile.base`): 包含 Node.js 22 Alpine、系统工具（git, curl, bash, gcompat）、全局 npm 依赖（miniprogram-ci, axios 等）、CI 脚本和配置文件
2. **项目镜像** (`Dockerfile.build`): 继承基础镜像，添加项目 package.json、node_modules、源码和 build-info.json

### 目录结构

- `public/` - 公网版 Dockerfile（使用 Docker Hub）
- `private/` - 内网版 Dockerfile（使用 Artifactory）
- `scripts/` - CI 脚本
  - `docker-entrypoint.sh` - 容器入口，协调整个构建上传流程
  - `upload-mp.js` - 上传主脚本，封装 miniprogram-ci 调用
  - `generate-build-info.js` - 从 Git 提取构建信息
  - `utils/` - 日志、版本管理、OSS 上传工具
- `config/ci.config.js` - 环境配置（development/staging/production）

### 运行时流程

容器启动后 `docker-entrypoint.sh` 依次执行：
1. 环境变量检查（`MP_PRIVATE_KEY_URL` 必需）
2. 项目目录验证（package.json、project.config.json、src/）
3. 依赖安装（可通过 `SKIP_INSTALL=true` 跳过）
4. 读取 build-info.json 获取版本和 Git 信息
5. Taro 构建（`BUILD_MODE=production` 用 `npm run build`，否则用 `npm run build:pre`）
6. 验证 dist 目录
7. 下载私钥到 `/app/private.{appid}.key`
8. 调用 `upload-mp.js` 执行上传或预览
9. 清理私钥

## 常用命令

### 构建基础镜像

```bash
# 公网版
docker build -f public/Dockerfile.base -t your-registry/miniprogram-ci-base:1.0.2 .

# 内网版
docker build -f private/Dockerfile.base -t artifacts.iflytek.com/cbg-docker-private/xfyun_webdev/miniprogram-ci-base:1.0.2 .
```

### 构建项目镜像

```bash
docker build -f public/Dockerfile.build \
  --build-arg PROJECT_DIR="." \
  --build-arg BUILD_VERSION="1.0.0" \
  --build-arg BUILD_DESC="版本描述" \
  --build-arg BUILDER="构建人" \
  -t miniprogram:v1.0.0 .
```

### 运行上传

```bash
# 上传到微信平台
docker run --rm \
  -e MP_PRIVATE_KEY_URL="https://cdn.example.com/private.key" \
  -e BUILD_MODE="production" \
  -e BUILD_ENV="production" \
  miniprogram:v1.0.0

# 生成预览二维码
docker run --rm \
  -v $(pwd)/output:/app/output \
  -e MP_PRIVATE_KEY_URL="https://cdn.example.com/private.key" \
  -e ACTION="preview" \
  miniprogram:v1.0.0
```

### 本地测试脚本

```bash
# 直接运行上传脚本
node scripts/upload-mp.js --env development --action upload --verbose

# 查看帮助
node scripts/upload-mp.js --help
```

## 关键环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| `MP_PRIVATE_KEY_URL` | 是 | 私钥文件 CDN 下载地址 |
| `ACTION` | 否 | `upload` 或 `preview`，默认 `upload` |
| `BUILD_MODE` | 否 | `production`/`pre`/`test`，决定构建命令 |
| `BUILD_ENV` | 否 | `development`/`staging`/`production` |
| `ROBOT` | 否 | 机器人编号 1-30，默认 `1` |
| `ROBOT_N_NAME` | 否 | 自定义机器人名称，如 `ROBOT_1_NAME="迭代A"` |
| `SKIP_INSTALL` | 否 | 跳过 npm install |
| `SKIP_BUILD` | 否 | 跳过 Taro 构建 |

## 机器人配置

预设 5 个机器人用于多迭代并行上传测试，通过 `ROBOT` 环境变量指定编号（1-30），通过 `ROBOT_N_NAME` 自定义名称：

```bash
# 使用机器人 2，自定义名称为"迭代B"
docker run --rm \
  -e MP_PRIVATE_KEY_URL="..." \
  -e ROBOT=2 \
  -e ROBOT_2_NAME="迭代B" \
  miniprogram:v1.0.0

# 并行上传多个迭代
docker run -d -e ROBOT=1 -e ROBOT_1_NAME="迭代A" ...
docker run -d -e ROBOT=2 -e ROBOT_2_NAME="迭代B" ...
docker run -d -e ROBOT=3 -e ROBOT_3_NAME="迭代C" ...
```

`config/ci.config.js` 提供辅助函数：
- `getRobotInfo(id)` - 获取机器人信息 `{ id, name }`
- `listRobots()` - 列出所有预设机器人

## 配置系统

`config/ci.config.js` 通过 `getConfig(env)` 合并通用配置和环境配置：
- 二维码输出路径
- 构建命令映射（`BUILD_MODE`）

## 目标小程序项目要求

- `package.json` 中需包含 `npm run build` 和 `npm run build:pre` 脚本
- 构建产物输出到 `./dist` 目录
- 包含 `project.config.json` 和 `src/` 目录
