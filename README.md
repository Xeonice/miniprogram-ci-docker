# 微信小程序 CI Docker 化方案

[![Docker](https://img.shields.io/badge/Docker-20.10+-blue.svg)](https://www.docker.com/)
[![Node.js](https://img.shields.io/badge/Node.js-22-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

将微信小程序的构建和上传流程容器化，支持**公网**和**内网**两种部署环境。

## 特性

- **两层镜像架构**：基础镜像 + 项目镜像，复用依赖，加速构建
- **依赖内置**：`miniprogram-ci` 等依赖预装到基础镜像，项目镜像即时启动
- **双版本支持**：公网版（Docker Hub）和内网版（Artifactory）
- **Git 信息自动提取**：构建时自动从 .git 提取 commit、branch 信息
- **安全设计**：私钥运行时下载，不打包进镜像
- **灵活配置**：支持构建时和运行时参数覆盖
- **多机器人支持**：预设 5 个机器人，支持多迭代并行上传测试，可自定义机器人名称

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        两层镜像架构                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  基础镜像 (Dockerfile.base)                              │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │  node:22-alpine                                  │    │   │
│  │  │  + git, curl, bash, gcompat                      │    │   │
│  │  │  + miniprogram-ci, axios, chalk...               │    │   │
│  │  │  + CI 脚本 (/ci/scripts/)                        │    │   │
│  │  │  + 配置文件 (/ci/config/)                        │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↓ FROM                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  项目镜像 (Dockerfile.build)                             │   │
│  │  ┌─────────────────────────────────────────────────┐    │   │
│  │  │  + 项目 package.json & node_modules              │    │   │
│  │  │  + 项目源码 (/app/)                              │    │   │
│  │  │  + build-info.json (Git信息)                     │    │   │
│  │  └─────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 运行时流程

```
┌──────────────────────────────────────────────────────────────────┐
│  docker run miniprogram:v1.0.0                                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  docker-entrypoint.sh                                            │
│       │                                                          │
│       ├─→ 1. 检查环境变量                                         │
│       │                                                          │
│       ├─→ 2. 验证项目目录 (/app)                                  │
│       │                                                          │
│       ├─→ 3. 安装依赖 (可选，SKIP_INSTALL=true 跳过)              │
│       │                                                          │
│       ├─→ 4. 读取 build-info.json (版本、描述、Git信息)           │
│       │                                                          │
│       ├─→ 5. 执行 Taro 构建 (可选，SKIP_BUILD=true 跳过)          │
│       │       └─→ BUILD_MODE=production → npm run build          │
│       │       └─→ BUILD_MODE=pre/test  → npm run build:pre       │
│       │                                                          │
│       ├─→ 6. 验证构建产物 (/app/dist)                             │
│       │                                                          │
│       ├─→ 7. 下载私钥 (MP_PRIVATE_KEY_URL)                        │
│       │                                                          │
│       ├─→ 8. 执行上传/预览 (upload-mp.js)                         │
│       │       └─→ ACTION=upload  → 上传到微信平台                 │
│       │       └─→ ACTION=preview → 生成预览二维码                 │
│       │                                                          │
│       └─→ 9. 清理私钥文件                                         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 目录结构

```
miniprogram-ci-docker/
├── public/                          # 公网版本 Dockerfile
│   ├── Dockerfile.base              # 基础镜像（使用 Docker Hub）
│   └── Dockerfile.build             # 项目镜像模板
├── private/                         # 内网版本 Dockerfile
│   ├── Dockerfile.base              # 基础镜像（使用内网 Registry）
│   └── Dockerfile.build             # 项目镜像模板
├── scripts/
│   ├── docker-entrypoint.sh         # 容器入口脚本
│   ├── upload-mp.js                 # 上传主脚本
│   ├── generate-build-info.js       # 构建信息生成脚本
│   ├── generate-key.js              # 私钥管理脚本
│   └── utils/
│       ├── logger.js                # 日志工具
│       ├── oss-uploader.js          # OSS 上传工具
│       └── version.js               # 版本管理工具
├── config/
│   └── ci.config.js                 # CI 配置文件
├── .dockerignore                    # Docker 忽略文件
└── README.md                        # 使用文档
```

## 快速开始

### 1. 构建基础镜像（一次性）

```bash
# 公网版本
docker build -f public/Dockerfile.base \
  -t your-registry/miniprogram-ci-base:1.0.2 \
  .

# 内网版本
docker build -f private/Dockerfile.base \
  -t artifacts.iflytek.com/cbg-docker-private/xfyun_webdev/miniprogram-ci-base:1.0.2 \
  .

# 推送基础镜像
docker push your-registry/miniprogram-ci-base:1.0.2
```

### 2. 构建项目镜像

```bash
# 构建项目镜像
docker build -f private/Dockerfile.build \
  --build-arg PROJECT_DIR="frontend-app" \
  --build-arg BUILD_VERSION="1.0.0" \
  --build-arg BUILD_DESC="新功能发布" \
  --build-arg BUILDER="张三" \
  -t miniprogram:v1.0.0 \
  .
```

### 3. 运行上传

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
  -e UPLOAD_OSS="true" \
  -e API_COOKIE="your-cookie" \
  miniprogram:v1.0.0
```

## 配置参数

### 构建参数 (--build-arg)

在 `docker build` 时通过 `--build-arg` 传入，会固化到镜像中：

| 参数名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `PROJECT_DIR` | 否 | `.` | 项目目录路径（相对于构建上下文） |
| `BUILD_VERSION` | 否 | 从 package.json 读取 | 版本号 |
| `BUILD_DESC` | 否 | 从 Git commit message 读取 | 版本描述 |
| `BUILDER` | 否 | 空 | 构建人名称 |

### 运行时环境变量 (-e)

在 `docker run` 时通过 `-e` 传入，可覆盖构建时的默认值：

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `MP_PRIVATE_KEY_URL` | **是** | - | 私钥文件 CDN 下载地址 |
| `ACTION` | 否 | `upload` | 操作类型：`upload` / `preview` |
| `BUILD_MODE` | 否 | `production` | 构建模式：`production` / `pre` / `test` |
| `BUILD_ENV` | 否 | `development` | 部署环境：`development` / `staging` / `production` |
| `BUILD_VERSION` | 否 | 构建时值 | 版本号（覆盖构建时值） |
| `BUILD_DESC` | 否 | 构建时值 | 版本描述（覆盖构建时值） |
| `BUILDER` | 否 | 构建时值 | 构建人名称（覆盖构建时值） |
| `ROBOT` | 否 | `1` | CI 机器人编号（1-30） |
| `ROBOT_N_NAME` | 否 | `CI机器人N` | 自定义机器人名称，如 `ROBOT_1_NAME="迭代A"` |
| `UPLOAD_OSS` | 否 | `true` | 是否上传二维码到 OSS |
| `API_COOKIE` | 否 | - | OSS 上传所需的 Cookie |
| `QRCODE_PATH` | 否 | `/app/output/preview-qrcode.png` | 二维码保存路径 |
| `SKIP_INSTALL` | 否 | `false` | 跳过 npm install |
| `SKIP_BUILD` | 否 | `false` | 跳过 Taro 构建 |

### 机器人配置

微信小程序 CI 支持 1-30 号机器人，本项目预设 5 个机器人用于多迭代并行上传测试：

| 机器人编号 | 默认名称 | 自定义环境变量 |
|-----------|---------|---------------|
| 1 | CI机器人1 | `ROBOT_1_NAME` |
| 2 | CI机器人2 | `ROBOT_2_NAME` |
| 3 | CI机器人3 | `ROBOT_3_NAME` |
| 4 | CI机器人4 | `ROBOT_4_NAME` |
| 5 | CI机器人5 | `ROBOT_5_NAME` |

**使用示例：**

```bash
# 使用机器人 2，自定义名称
docker run --rm \
  -e MP_PRIVATE_KEY_URL="https://cdn.example.com/private.key" \
  -e ROBOT=2 \
  -e ROBOT_2_NAME="迭代B" \
  miniprogram:v1.0.0

# 多迭代并行上传（使用不同机器人避免冲突）
docker run -d -e MP_PRIVATE_KEY_URL="..." -e ROBOT=1 -e ROBOT_1_NAME="迭代A" miniprogram:v1.0.0
docker run -d -e MP_PRIVATE_KEY_URL="..." -e ROBOT=2 -e ROBOT_2_NAME="迭代B" miniprogram:v1.0.0
docker run -d -e MP_PRIVATE_KEY_URL="..." -e ROBOT=3 -e ROBOT_3_NAME="迭代C" miniprogram:v1.0.0
```

> **注意**：机器人编号 6-30 也可使用，通过 `ROBOT_N_NAME` 环境变量自定义名称。

### 上传描述格式

上传到微信平台的描述格式：

```
[环境标识] 版本描述 | 构建人 (Git提交)
```

示例：
- 有构建人：`[生产环境] 新功能发布 | 张三 (a9d9422)`
- 无构建人：`[生产环境] 新功能发布 (a9d9422)`
- 测试环境：`[测试/预发布] 修复登录问题 | 李四 (b8c7d33)`

## CI/CD 集成示例

### GitLab CI

```yaml
stages:
  - build
  - deploy

variables:
  DOCKER_REGISTRY: artifacts.iflytek.com/cbg-docker-private/xfyun_webdev
  IMAGE_NAME: miniprogram
  CI_BASE_IMAGE: ${DOCKER_REGISTRY}/miniprogram-ci-base:1.0.2

# 构建项目镜像
build:
  stage: build
  script:
    - docker build -f private/Dockerfile.build
        --build-arg PROJECT_DIR="."
        --build-arg BUILD_VERSION="${CI_COMMIT_TAG:-$CI_COMMIT_SHORT_SHA}"
        --build-arg BUILD_DESC="${CI_COMMIT_MESSAGE}"
        --build-arg BUILDER="${GITLAB_USER_NAME}"
        -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${CI_COMMIT_SHORT_SHA}
        .
    - docker push ${DOCKER_REGISTRY}/${IMAGE_NAME}:${CI_COMMIT_SHORT_SHA}

# 部署到体验版
deploy-dev:
  stage: deploy
  script:
    - docker run --rm
        -e MP_PRIVATE_KEY_URL="${MP_PRIVATE_KEY_URL}"
        -e BUILD_MODE="pre"
        -e ROBOT=1
        -e ROBOT_1_NAME="${CI_COMMIT_REF_NAME}"
        -e ACTION="upload"
        ${DOCKER_REGISTRY}/${IMAGE_NAME}:${CI_COMMIT_SHORT_SHA}
  environment:
    name: development

# 部署到生产环境
deploy-prod:
  stage: deploy
  script:
    - docker run --rm
        -e MP_PRIVATE_KEY_URL="${MP_PRIVATE_KEY_URL}"
        -e BUILD_MODE="production"
        -e ROBOT=1
        -e ACTION="upload"
        ${DOCKER_REGISTRY}/${IMAGE_NAME}:${CI_COMMIT_SHORT_SHA}
  environment:
    name: production
  when: manual
  only:
    - tags

# 多迭代并行上传示例（使用不同机器人）
deploy-parallel:
  stage: deploy
  parallel:
    matrix:
      - ROBOT: [1, 2, 3]
        ROBOT_NAME: ["迭代A", "迭代B", "迭代C"]
  script:
    - docker run --rm
        -e MP_PRIVATE_KEY_URL="${MP_PRIVATE_KEY_URL}"
        -e BUILD_MODE="pre"
        -e ROBOT="${ROBOT}"
        -e ROBOT_${ROBOT}_NAME="${ROBOT_NAME}"
        ${DOCKER_REGISTRY}/${IMAGE_NAME}:${CI_COMMIT_SHORT_SHA}
  when: manual
```

### Jenkins Pipeline

```groovy
pipeline {
    agent any

    environment {
        DOCKER_REGISTRY = 'artifacts.iflytek.com/cbg-docker-private/xfyun_webdev'
        IMAGE_NAME = 'miniprogram'
        MP_PRIVATE_KEY_URL = credentials('mp-private-key-url')
    }

    stages {
        stage('Build Image') {
            steps {
                script {
                    def version = env.TAG_NAME ?: env.GIT_COMMIT.take(7)
                    sh """
                        docker build -f private/Dockerfile.build \
                            --build-arg BUILD_VERSION="${version}" \
                            --build-arg BUILD_DESC="${env.GIT_COMMIT_MESSAGE}" \
                            --build-arg BUILDER="${env.BUILD_USER}" \
                            -t ${DOCKER_REGISTRY}/${IMAGE_NAME}:${version} \
                            .
                    """
                }
            }
        }

        stage('Deploy') {
            steps {
                sh """
                    docker run --rm \
                        -e MP_PRIVATE_KEY_URL="${MP_PRIVATE_KEY_URL}" \
                        -e BUILD_MODE="production" \
                        -e ROBOT=1 \
                        ${DOCKER_REGISTRY}/${IMAGE_NAME}:${version}
                """
            }
        }
    }
}
```

## 注意事项

1. **私钥安全**：私钥文件通过 `MP_PRIVATE_KEY_URL` 运行时下载，运行结束后自动清理，不会保留在镜像或容器中

2. **Git 信息**：构建时会复制 `.git` 目录用于提取 commit 信息，生成 `build-info.json` 后自动删除

3. **Alpine 兼容性**：Alpine 使用 musl libc，已添加 `libc6-compat` 和 `gcompat` 兼容包

4. **Taro 兼容**：已自动安装 `@tarojs/binding-linux-x64-musl` 以支持 Alpine 环境

5. **日志持久化**：可通过 `-v $(pwd)/logs:/app/logs` 挂载日志目录

6. **二维码输出**：预览模式生成的二维码保存在 `/app/output/` 目录，可通过挂载获取

7. **构建指令要求**：项目的 `package.json` 中需要包含以下构建脚本：
   - `npm run build` - 生产环境构建（`BUILD_MODE=production` 时执行）
   - `npm run build:pre` - 测试/预发布环境构建（`BUILD_MODE=pre` 或 `BUILD_MODE=test` 时执行）

   构建产物需要输出到 `./dist` 目录

## 故障排查

### 构建信息显示 "unknown"

确保 `.git` 目录在构建上下文中，检查 `.dockerignore` 是否排除了 `.git`。

### 私钥下载失败

检查 `MP_PRIVATE_KEY_URL` 是否正确，确保 URL 可访问。

### Taro 构建失败

确保已安装 `@tarojs/binding-linux-x64-musl`，这是 Alpine 环境必需的。

### 上传失败

1. 检查私钥文件是否正确
2. 检查 `project.config.json` 中的 appid 是否匹配
3. 查看日志文件 `/app/logs/miniprogram-ci-*.log`

## 许可证

MIT License
