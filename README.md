# 微信小程序 CI Docker 化方案

[![Docker](https://img.shields.io/badge/Docker-20.10+-blue.svg)](https://www.docker.com/)
[![Node.js](https://img.shields.io/badge/Node.js-20-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

将微信小程序的构建和上传流程容器化，支持**公网**和**内网**两种部署环境。

## 特性

- ✅ **分离式架构**：构建和上传完全解耦，支持跨服务器部署
- ✅ **依赖内置**：`miniprogram-ci` 等依赖预装到镜像，容器即时启动
- ✅ **双版本支持**：公网版（Docker Hub）和内网版（Artifactory）
- ✅ **制品最小化**：只打包必要文件，体积减少 50%
- ✅ **安全设计**：私钥运行时下载，不打包进镜像

## 目录结构

```
miniprogram-ci-docker/
├── public/                     # 公网版本 Dockerfile
│   ├── Dockerfile.build        # 构建阶段镜像
│   └── Dockerfile.upload       # 上传阶段镜像
├── private/                    # 内网版本 Dockerfile
│   ├── Dockerfile.build        # 构建阶段镜像（内网源）
│   └── Dockerfile.upload       # 上传阶段镜像（内网源）
├── scripts/
│   └── docker-upload-entrypoint.sh  # 上传入口脚本
├── config/
│   └── .env.example            # 环境变量示例
├── examples/
│   ├── docker-compose.yml      # 本地测试配置
│   └── gitlab-ci.yml           # GitLab CI/CD 配置示例
├── .dockerignore               # Docker 忽略文件
└── README.md                   # 使用文档
```

## 快速开始

### 1. 构建阶段

```bash
# 公网版本
docker build -f public/Dockerfile.build \
  --build-arg BUILD_VERSION="1.0.0" \
  --build-arg BUILD_DESCRIPTION="新功能发布" \
  --build-arg GIT_BRANCH="main" \
  --build-arg GIT_COMMIT="a1b2c3d" \
  --build-arg BUILD_MODE="production" \
  -t miniprogram-builder:latest .

# 导出制品
mkdir -p output
docker run --rm -v $(pwd)/output:/output miniprogram-builder:latest

# 上传到制品库
curl -u user:password \
  -T output/build-artifact.tar.gz \
  "https://artifactory.example.com/miniprogram/builds/1.0.0/build-artifact.tar.gz"
```

### 2. 上传阶段

```bash
# 构建上传镜像（只需构建一次）
docker build -f public/Dockerfile.upload -t miniprogram-uploader:latest .

# 执行上传
docker run --rm \
  -v $(pwd)/logs:/app/logs \
  -v $(pwd)/output:/app/output \
  -e ARTIFACT_URL="https://artifactory.example.com/miniprogram/builds/1.0.0/build-artifact.tar.gz" \
  -e ARTIFACT_USER="ciuser" \
  -e ARTIFACT_PASSWORD="password" \
  -e MP_PRIVATE_KEY_URL="https://cdn.example.com/private.key" \
  -e ACTION="upload" \
  -e BUILD_MODE="production" \
  -e ROBOT="1" \
  miniprogram-uploader:latest
```

### 3. 预览模式（生成二维码）

```bash
docker run --rm \
  -v $(pwd)/logs:/app/logs \
  -v $(pwd)/output:/app/output \
  -e ARTIFACT_URL="https://artifactory.example.com/build-artifact.tar.gz" \
  -e MP_PRIVATE_KEY_URL="https://cdn.example.com/private.key" \
  -e ACTION="preview" \
  -e UPLOAD_OSS="true" \
  miniprogram-uploader:latest
```

## 环境变量

### 构建阶段（Dockerfile.build）

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| BUILD_VERSION | ✅ | - | 版本号 |
| BUILD_DESCRIPTION | ❌ | - | 版本描述 |
| GIT_BRANCH | ❌ | - | Git 分支名 |
| GIT_COMMIT | ❌ | - | Git Commit SHA |
| BUILD_MODE | ❌ | production | 构建模式（production/pre） |

### 上传阶段（Dockerfile.upload）

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| ARTIFACT_URL | ✅ | - | 制品下载地址 |
| ARTIFACT_USER | ❌ | - | 制品库用户名 |
| ARTIFACT_PASSWORD | ❌ | - | 制品库密码 |
| MP_PRIVATE_KEY_URL | ✅ | - | 私钥文件 CDN 地址 |
| ACTION | ❌ | upload | 操作类型（upload/preview） |
| BUILD_MODE | ❌ | production | 构建模式 |
| ROBOT | ❌ | - | 机器人编号（1-30） |
| UPLOAD_OSS | ❌ | true | 是否上传二维码到 OSS |
| API_COOKIE | ❌ | - | OSS 上传所需的 Cookie |
| QRCODE_PATH | ❌ | /app/output/preview-qrcode.png | 二维码保存路径 |

## 内网版本使用

内网版本使用科大讯飞内部 Registry：

```bash
# 基础镜像
artifacts.iflytek.com/cbg-docker-private/xfyun_webdev/node:20-alpine

# 构建
docker build -f private/Dockerfile.build -t miniprogram-builder:latest .

# 上传
docker build -f private/Dockerfile.upload -t miniprogram-uploader:latest .
```

## 性能对比

| 指标 | 原 Shell 方案 | Docker 方案 | 优化幅度 |
|------|--------------|------------|---------|
| 上传阶段 npm install | 3 分钟 | 0 秒（依赖内置） | **100%** |
| 上传阶段 taro build | 2 分钟 | 0 秒（已在构建阶段完成） | **100%** |
| 制品体积 | 50 MB | 25 MB | **50%** |
| 总耗时 | ~13 分钟 | ~7 分钟 | **46%** |

## 架构说明

```
┌─────────────────────────────────────────────┐
│  构建服务器                                  │
│  ┌─────────────────────────────────────┐    │
│  │ Dockerfile.build                     │    │
│  │  - npm install                       │    │
│  │  - taro build                        │    │
│  │  - 生成 build-artifact.tar.gz        │    │
│  └─────────────────────────────────────┘    │
│                    ↓                        │
│            上传到 Artifactory               │
└─────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│  上传服务器                                  │
│  ┌─────────────────────────────────────┐    │
│  │ Dockerfile.upload                    │    │
│  │  - 下载制品                          │    │
│  │  - 下载私钥                          │    │
│  │  - 执行 upload-mp.js                 │    │
│  └─────────────────────────────────────┘    │
│                    ↓                        │
│            上传到微信平台                    │
└─────────────────────────────────────────────┘
```

## CI/CD 集成

参见 `examples/gitlab-ci.yml` 获取完整的 GitLab CI/CD 配置示例。

## 注意事项

1. **私钥安全**：私钥文件不要打包进镜像，通过 `MP_PRIVATE_KEY_URL` 运行时下载
2. **Alpine 兼容性**：Alpine 使用 musl libc，已添加 `libc6-compat` 兼容包
3. **日志持久化**：通过 `-v $(pwd)/logs:/app/logs` 挂载日志目录

## 许可证

MIT License
