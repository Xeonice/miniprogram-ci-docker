#!/bin/bash
# ==================== 微信小程序 CI 入口脚本 ====================
# 功能：
#   1. 安装项目依赖（如果需要）
#   2. 根据 BUILD_MODE 执行 Taro 构建
#   3. 下载私钥
#   4. 执行上传/预览操作
#
# 环境变量：
#   MP_PRIVATE_KEY_URL  - 私钥文件 CDN 地址（必需）
#   ACTION              - 操作类型：upload / preview（默认 upload）
#   BUILD_VERSION       - 版本号（可选，覆盖 build-info.json 中的版本）
#   BUILD_DESC          - 版本描述（可选，覆盖 build-info.json 中的描述）
#   BUILD_MODE          - 构建模式：production / pre / test（默认 production）
#   BUILD_ENV           - 部署环境标识（可选，传给 upload-mp.js 的 --env 参数）
#   ROBOT               - 机器人编号（可选）
#   BUILDER             - 构建人名称（可选，会显示在上传描述中）
#   QRCODE_PATH         - 二维码保存路径（preview 模式）
#   UPLOAD_OSS          - 是否上传到 OSS：true / false（默认 true）
#   API_COOKIE          - API Cookie（OSS 上传需要）
#   SKIP_INSTALL        - 跳过 npm install（默认 false）
#   SKIP_BUILD          - 跳过构建步骤（默认 false）

set -e

# ==================== 路径配置 ====================
CI_SCRIPTS_PATH="${CI_SCRIPTS_PATH:-/ci/scripts}"
CI_CONFIG_PATH="${CI_CONFIG_PATH:-/ci/config}"
WORK_DIR="/app"

# ==================== 颜色定义 ====================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
print_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
print_error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }
print_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }

# ==================== 清理函数 ====================
PRIVATE_KEY_PATH=""

cleanup() {
    if [ -n "$PRIVATE_KEY_PATH" ] && [ -f "$PRIVATE_KEY_PATH" ]; then
        print_info "清理私钥文件..."
        rm -f "$PRIVATE_KEY_PATH"
        print_success "私钥文件已清理"
    fi
}

# 设置退出时清理（无论成功或失败）
trap cleanup EXIT

# ==================== 脚本开始 ====================
echo "=================================================="
echo "微信小程序 CI 工具镜像"
echo "=================================================="
echo ""

# ==================== 1. 环境变量检查 ====================
print_info "检查环境变量..."

echo "========== 环境变量状态 =========="
echo "MP_PRIVATE_KEY_URL: ${MP_PRIVATE_KEY_URL:+已设置}"
echo "ACTION: ${ACTION:-upload}"
echo "BUILD_VERSION: ${BUILD_VERSION:-从build-info.json读取}"
echo "BUILD_DESC: ${BUILD_DESC:-从build-info.json读取}"
echo "BUILD_MODE: ${BUILD_MODE:-production}"
echo "BUILD_ENV: ${BUILD_ENV:-development}"
echo "ROBOT: ${ROBOT:-1}"
echo "BUILDER: ${BUILDER:-未指定}"
echo "UPLOAD_OSS: ${UPLOAD_OSS:-true}"
echo "API_COOKIE: ${API_COOKIE:+已设置}"
echo "SKIP_INSTALL: ${SKIP_INSTALL:-false}"
echo "SKIP_BUILD: ${SKIP_BUILD:-false}"
echo "CI_SCRIPTS_PATH: ${CI_SCRIPTS_PATH}"
echo "---------- 机器人名称配置 ----------"
echo "ROBOT_1_NAME: ${ROBOT_1_NAME:-CI机器人1}"
echo "ROBOT_2_NAME: ${ROBOT_2_NAME:-CI机器人2}"
echo "ROBOT_3_NAME: ${ROBOT_3_NAME:-CI机器人3}"
echo "ROBOT_4_NAME: ${ROBOT_4_NAME:-CI机器人4}"
echo "ROBOT_5_NAME: ${ROBOT_5_NAME:-CI机器人5}"
echo "=================================="
echo ""

if [ -z "$MP_PRIVATE_KEY_URL" ]; then
    print_error "环境变量 MP_PRIVATE_KEY_URL 未设置"
fi

# 设置默认值
ACTION="${ACTION:-upload}"
BUILD_MODE="${BUILD_MODE:-production}"
BUILD_ENV="${BUILD_ENV:-development}"
UPLOAD_OSS="${UPLOAD_OSS:-true}"
SKIP_INSTALL="${SKIP_INSTALL:-false}"
SKIP_BUILD="${SKIP_BUILD:-false}"

# ==================== 2. 验证项目目录 ====================
print_info "验证项目目录..."

cd "$WORK_DIR"

# 验证必要文件存在
for file in package.json project.config.json; do
    if [ ! -f "$WORK_DIR/$file" ]; then
        print_error "缺少文件: $file（请确保项目目录已挂载到 /app）"
    fi
done

# 验证 src 目录存在
if [ ! -d "$WORK_DIR/src" ]; then
    print_error "缺少 src 目录"
fi

print_success "项目目录验证通过"
echo ""

# ==================== 3. 安装依赖 ====================
if [ "$SKIP_INSTALL" != "true" ]; then
    if [ ! -d "$WORK_DIR/node_modules" ]; then
        print_info "安装项目依赖..."
        npm ci --include=optional || npm install

        # 安装 Taro Linux 兼容包（Alpine）
        npm install @tarojs/binding-linux-x64-musl --save-optional --ignore-scripts 2>/dev/null || true

        print_success "依赖安装完成"
    else
        print_info "node_modules 已存在，跳过安装"
    fi
else
    print_info "SKIP_INSTALL=true，跳过依赖安装"
fi
echo ""

# ==================== 4. 读取构建信息 ====================
print_info "读取构建信息..."

# 优先从 build-info.json 读取（构建时已生成）
if [ -f "./build-info.json" ]; then
    FILE_VERSION=$(node -pe "JSON.parse(require('fs').readFileSync('./build-info.json', 'utf8')).version" 2>/dev/null || echo "unknown")
    FILE_DESC=$(node -pe "JSON.parse(require('fs').readFileSync('./build-info.json', 'utf8')).description" 2>/dev/null || echo "")
    GIT_COMMIT=$(node -pe "JSON.parse(require('fs').readFileSync('./build-info.json', 'utf8')).git?.commitShort || ''" 2>/dev/null || echo "")
    GIT_BRANCH=$(node -pe "JSON.parse(require('fs').readFileSync('./build-info.json', 'utf8')).git?.branch || ''" 2>/dev/null || echo "")
    BUILD_TIME=$(node -pe "JSON.parse(require('fs').readFileSync('./build-info.json', 'utf8')).buildTime || ''" 2>/dev/null || echo "")

    print_success "成功读取构建信息"
    print_info "版本号: $FILE_VERSION"
    print_info "描述: $FILE_DESC"
    print_info "Git分支: $GIT_BRANCH"
    print_info "Git提交: $GIT_COMMIT"
    print_info "构建时间: $BUILD_TIME"
else
    print_warning "构建信息文件不存在，将使用默认值"
    FILE_VERSION="1.0.0"
    FILE_DESC=""
    GIT_COMMIT=""
    GIT_BRANCH=""
    BUILD_TIME=""
fi

# 运行时环境变量可以覆盖（如果用户明确传入）
# 注意：BUILD_VERSION 和 BUILD_DESC 可能已经在 Dockerfile ENV 中设置过
# 只有当运行时通过 -e 明确传入非空值时才覆盖
if [ -n "$BUILD_VERSION" ] && [ "$BUILD_VERSION" != "$FILE_VERSION" ]; then
    print_info "运行时覆盖版本号: $BUILD_VERSION"
else
    BUILD_VERSION="$FILE_VERSION"
fi

if [ -n "$BUILD_DESC" ] && [ "$BUILD_DESC" != "$FILE_DESC" ]; then
    print_info "运行时覆盖描述: $BUILD_DESC"
else
    BUILD_DESC="$FILE_DESC"
fi

# 如果描述为空，使用默认描述
if [ -z "$BUILD_DESC" ]; then
    BUILD_DESC="自动构建上传"
fi

echo ""
print_info "最终使用版本号: ${BUILD_VERSION}"
print_info "最终使用描述: ${BUILD_DESC}"
echo ""

# ==================== 5. 执行 Taro 构建 ====================
if [ "$SKIP_BUILD" != "true" ]; then
    print_info "执行 Taro 构建..."
    print_info "构建模式: ${BUILD_MODE}"

    BUILD_START_TIME=$(date +%s)

    # 根据 BUILD_MODE 执行不同的构建命令
    if [ "$BUILD_MODE" = "pre" ] || [ "$BUILD_MODE" = "test" ]; then
        print_info "执行预发布/测试构建: npm run build:pre"
        npm run build:pre
    else
        print_info "执行生产构建: npm run build"
        npm run build
    fi

    BUILD_END_TIME=$(date +%s)
    BUILD_DURATION=$((BUILD_END_TIME - BUILD_START_TIME))

    print_success "Taro 构建完成，耗时: ${BUILD_DURATION} 秒"
else
    print_info "SKIP_BUILD=true，跳过构建步骤"
    BUILD_DURATION=0
fi
echo ""

# ==================== 6. 验证构建产物 ====================
print_info "验证构建产物..."

if [ ! -d "$WORK_DIR/dist" ]; then
    print_error "构建失败：缺少 dist 目录"
fi

if [ -z "$(ls -A $WORK_DIR/dist)" ]; then
    print_error "构建失败：dist 目录为空"
fi

# 复制构建信息到 dist
cp build-info.json dist/ 2>/dev/null || true

print_success "构建产物验证通过"
echo ""

# ==================== 7. 下载私钥 ====================
print_info "下载私钥文件..."

APPID=$(node -pe "JSON.parse(require('fs').readFileSync('project.config.json', 'utf8')).appid")
PRIVATE_KEY_PATH="$WORK_DIR/private.${APPID}.key"

print_info "AppID: ${APPID}"
print_info "从 CDN 下载私钥: ${MP_PRIVATE_KEY_URL}"

curl -fsSL -o "$PRIVATE_KEY_PATH" "$MP_PRIVATE_KEY_URL"

if [ $? -ne 0 ]; then
    print_error "下载私钥文件失败"
fi

# 检查文件是否存在且不为空
if [ ! -s "$PRIVATE_KEY_PATH" ]; then
    print_error "私钥文件为空或下载失败"
fi

chmod 400 "$PRIVATE_KEY_PATH"
print_success "私钥文件下载成功: $PRIVATE_KEY_PATH"
echo ""

# ==================== 8. 构建上传命令 ====================
print_info "准备执行 ${ACTION} 操作..."

# 根据 BUILD_MODE 添加环境标识到描述
if [ "$BUILD_MODE" = "pre" ] || [ "$BUILD_MODE" = "test" ]; then
    ENV_TAG="[测试/预发布]"
else
    ENV_TAG="[生产环境]"
fi

# 构建完整描述：环境标识 + 描述 + 构建人(可选) + Git提交
if [ -n "$BUILDER" ]; then
    FULL_DESC="${ENV_TAG} ${BUILD_DESC} | ${BUILDER} (${GIT_COMMIT})"
else
    FULL_DESC="${ENV_TAG} ${BUILD_DESC} (${GIT_COMMIT})"
fi

# 使用 CI 脚本目录中的上传脚本
UPLOAD_SCRIPT="${CI_SCRIPTS_PATH}/upload-mp.js"

if [ ! -f "$UPLOAD_SCRIPT" ]; then
    print_error "上传脚本不存在: $UPLOAD_SCRIPT"
fi

# 构建上传命令
UPLOAD_CMD="node ${UPLOAD_SCRIPT} --verbose"
UPLOAD_CMD="$UPLOAD_CMD --env ${BUILD_ENV}"
UPLOAD_CMD="$UPLOAD_CMD --action ${ACTION}"
UPLOAD_CMD="$UPLOAD_CMD --version \"${BUILD_VERSION}\""
UPLOAD_CMD="$UPLOAD_CMD --desc \"${FULL_DESC}\""
UPLOAD_CMD="$UPLOAD_CMD --private-key \"${PRIVATE_KEY_PATH}\""

# 二维码配置（预览模式）
if [ "$ACTION" = "preview" ]; then
    if [ -z "$QRCODE_PATH" ]; then
        QRCODE_PATH="/app/output/preview-qrcode.png"
    fi
    UPLOAD_CMD="$UPLOAD_CMD --qrcode \"${QRCODE_PATH}\""
    print_info "二维码将保存到: ${QRCODE_PATH}"
fi

# OSS 上传配置
if [ "$UPLOAD_OSS" != "false" ]; then
    UPLOAD_CMD="$UPLOAD_CMD --upload-oss true"
    if [ -n "$API_COOKIE" ]; then
        UPLOAD_CMD="$UPLOAD_CMD --cookie \"${API_COOKIE}\""
    fi
    print_info "OSS 上传已启用"
else
    UPLOAD_CMD="$UPLOAD_CMD --upload-oss false"
    print_info "OSS 上传已禁用"
fi

# 机器人编号
if [ -n "$ROBOT" ]; then
    UPLOAD_CMD="$UPLOAD_CMD --robot ${ROBOT}"
    print_info "使用机器人: ${ROBOT}"
fi

# 设置日志文件
mkdir -p /app/logs
export LOG_FILE="/app/logs/miniprogram-ci-$(date +%Y%m%d-%H%M%S).log"
print_info "日志文件: ${LOG_FILE}"
echo ""

# ==================== 9. 执行上传 ====================
echo "=================================================="
print_info "执行命令: $UPLOAD_CMD"
echo "=================================================="
echo ""

eval $UPLOAD_CMD 2>&1 | tee -a "$LOG_FILE"

UPLOAD_RESULT=${PIPESTATUS[0]}

# ==================== 10. 处理结果 ====================
echo ""
echo "=================================================="

if [ $UPLOAD_RESULT -eq 0 ]; then
    print_success "${ACTION} 操作成功完成！"

    # 检查是否生成了二维码（预览模式）
    if [ "$ACTION" = "preview" ]; then
        QRCODE_FILE="${QRCODE_PATH:-./preview-qrcode.png}"
        if [ -f "$QRCODE_FILE" ]; then
            print_info "预览二维码已生成: $QRCODE_FILE"
        fi
    fi

    # 检查是否有 CDN URL
    if [ -f "preview-qrcode-url.txt" ]; then
        CDN_URL=$(cat preview-qrcode-url.txt)
        echo ""
        print_success "CDN 地址:"
        echo "$CDN_URL"
        echo ""
        print_info "CDN 地址已保存到: preview-qrcode-url.txt"
    fi

    echo ""
    print_success "========== 操作摘要 =========="
    print_info "构建模式: ${BUILD_MODE}"
    print_info "部署环境: ${BUILD_ENV}"
    print_info "构建耗时: ${BUILD_DURATION} 秒"
    print_info "版本: ${BUILD_VERSION}"
    print_info "描述: ${FULL_DESC}"
    print_info "操作: ${ACTION}"
    if [ -n "$ROBOT" ]; then
        print_info "机器人: ${ROBOT}"
    else
        print_info "机器人: 默认"
    fi
    print_success "=============================="

    echo ""
    print_success "所有步骤完成！"
else
    print_error "${ACTION} 操作失败，退出码: ${UPLOAD_RESULT}"
fi

echo "=================================================="
print_info "日志文件: ${LOG_FILE}"
echo "=================================================="

exit $UPLOAD_RESULT
