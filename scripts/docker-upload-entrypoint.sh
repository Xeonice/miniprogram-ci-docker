#!/bin/bash
# ==================== 微信小程序上传入口脚本 ====================
# 功能：
#   1. 从制品库下载构建产物
#   2. 解压并验证制品完整性
#   3. 下载私钥文件
#   4. 执行上传到微信平台
#   5. 清理敏感文件
#
# 环境变量：
#   ARTIFACT_URL        - 制品下载地址（必需）
#   ARTIFACT_USER       - 制品库用户名（可选）
#   ARTIFACT_PASSWORD   - 制品库密码（可选）
#   MP_PRIVATE_KEY_URL  - 私钥文件 CDN 地址（必需）
#   ACTION              - 操作类型：upload / preview（默认 upload）
#   BUILD_MODE          - 构建模式：production / pre（默认 production）
#   ROBOT               - 机器人编号（可选）
#   QRCODE_PATH         - 二维码保存路径（preview 模式）
#   UPLOAD_OSS          - 是否上传到 OSS：true / false（默认 true）
#   API_COOKIE          - API Cookie（OSS 上传需要）

set -e

# ==================== 颜色定义 ====================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ==================== 打印函数 ====================
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# ==================== 脚本开始 ====================
echo "=================================================="
echo "微信小程序上传脚本 (Docker 版)"
echo "=================================================="
echo ""

# ==================== 1. 环境变量检查 ====================
print_info "检查环境变量..."

echo "========== 环境变量状态 =========="
echo "ARTIFACT_URL: ${ARTIFACT_URL:+已设置}"
echo "MP_PRIVATE_KEY_URL: ${MP_PRIVATE_KEY_URL:+已设置}"
echo "ACTION: ${ACTION:-upload}"
echo "BUILD_MODE: ${BUILD_MODE:-production}"
echo "ROBOT: ${ROBOT:-默认}"
echo "UPLOAD_OSS: ${UPLOAD_OSS:-true}"
echo "=================================="
echo ""

if [ -z "$ARTIFACT_URL" ]; then
    print_error "环境变量 ARTIFACT_URL 未设置"
fi

if [ -z "$MP_PRIVATE_KEY_URL" ]; then
    print_error "环境变量 MP_PRIVATE_KEY_URL 未设置"
fi

# 设置默认值
ACTION="${ACTION:-upload}"
BUILD_MODE="${BUILD_MODE:-production}"
UPLOAD_OSS="${UPLOAD_OSS:-true}"

# ==================== 2. 下载构建产物 ====================
print_info "从制品库下载构建产物..."
print_info "URL: ${ARTIFACT_URL}"

CURL_OPTS="-fsSL"

# 如果提供了认证信息
if [ -n "$ARTIFACT_USER" ] && [ -n "$ARTIFACT_PASSWORD" ]; then
    CURL_OPTS="$CURL_OPTS -u ${ARTIFACT_USER}:${ARTIFACT_PASSWORD}"
    print_info "使用认证信息下载"
fi

curl $CURL_OPTS -o /tmp/build-artifact.tar.gz "$ARTIFACT_URL"

if [ $? -ne 0 ]; then
    print_error "下载制品失败"
fi

print_success "制品下载成功"
echo ""

# ==================== 3. 解压制品 ====================
print_info "解压构建产物..."

tar -xzf /tmp/build-artifact.tar.gz -C /app/artifact

if [ $? -ne 0 ]; then
    print_error "解压制品失败"
fi

rm /tmp/build-artifact.tar.gz
print_success "解压完成"

# 显示解压内容
print_info "制品内容:"
ls -la /app/artifact/
echo ""

# ==================== 4. 验证制品完整性 ====================
print_info "验证构建产物..."

# 验证目录存在
for dir in dist; do
    if [ ! -d "/app/artifact/$dir" ]; then
        print_error "缺少目录: $dir"
    fi
done

# 验证文件存在
for file in build-info.json project.config.json; do
    if [ ! -f "/app/artifact/$file" ]; then
        print_error "缺少文件: $file"
    fi
done

# 验证 dist 目录非空
if [ -z "$(ls -A /app/artifact/dist)" ]; then
    print_error "dist 目录为空"
fi

print_success "制品验证通过"
echo ""

# ==================== 5. 读取构建信息 ====================
print_info "读取构建信息..."

cd /app/artifact

BUILD_VERSION=$(node -pe "JSON.parse(require('fs').readFileSync('./build-info.json', 'utf8')).version" 2>/dev/null || echo "unknown")
BUILD_DESC=$(node -pe "JSON.parse(require('fs').readFileSync('./build-info.json', 'utf8')).description" 2>/dev/null || echo "")
GIT_COMMIT=$(node -pe "JSON.parse(require('fs').readFileSync('./build-info.json', 'utf8')).git?.commitShort || ''" 2>/dev/null || echo "")

print_success "版本号: ${BUILD_VERSION}"
print_info "描述: ${BUILD_DESC}"
print_info "Git提交: ${GIT_COMMIT}"
echo ""

# ==================== 6. 下载私钥 ====================
print_info "下载私钥文件..."

APPID=$(node -pe "JSON.parse(require('fs').readFileSync('project.config.json', 'utf8')).appid")
PRIVATE_KEY_PATH="./private.${APPID}.key"

print_info "AppID: ${APPID}"

curl -fsSL -o "$PRIVATE_KEY_PATH" "$MP_PRIVATE_KEY_URL"

if [ $? -ne 0 ] || [ ! -s "$PRIVATE_KEY_PATH" ]; then
    print_error "私钥文件下载失败"
fi

chmod 400 "$PRIVATE_KEY_PATH"
print_success "私钥文件下载成功"
echo ""

# ==================== 7. 构建上传命令 ====================
print_info "准备执行 ${ACTION} 操作..."

# 根据 BUILD_MODE 添加环境标识到描述
if [ "$BUILD_MODE" = "pre" ] || [ "$BUILD_MODE" = "test" ]; then
    FULL_DESC="[测试/预发布] ${BUILD_DESC} (${GIT_COMMIT})"
else
    FULL_DESC="[生产环境] ${BUILD_DESC} (${GIT_COMMIT})"
fi

# 检查上传脚本是否存在
UPLOAD_SCRIPT=""
if [ -f "/app/scripts/upload-mp.js" ]; then
    UPLOAD_SCRIPT="/app/scripts/upload-mp.js"
elif [ -f "/app/artifact/scripts/upload-mp.js" ]; then
    UPLOAD_SCRIPT="/app/artifact/scripts/upload-mp.js"
else
    print_error "上传脚本 upload-mp.js 不存在"
fi

UPLOAD_CMD="node ${UPLOAD_SCRIPT} --verbose"
UPLOAD_CMD="$UPLOAD_CMD --action ${ACTION}"
UPLOAD_CMD="$UPLOAD_CMD --version \"${BUILD_VERSION}\""
UPLOAD_CMD="$UPLOAD_CMD --desc \"${FULL_DESC}\""
UPLOAD_CMD="$UPLOAD_CMD --private-key \"${PRIVATE_KEY_PATH}\""

# 二维码配置（预览模式）
if [ "$ACTION" = "preview" ]; then
    QRCODE_PATH="${QRCODE_PATH:-/app/output/preview-qrcode.png}"
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
export LOG_FILE="/app/logs/miniprogram-ci-$(date +%Y%m%d-%H%M%S).log"
print_info "日志文件: ${LOG_FILE}"
echo ""

# ==================== 8. 执行上传 ====================
echo "=================================================="
print_info "执行命令: $UPLOAD_CMD"
echo "=================================================="
echo ""

eval $UPLOAD_CMD 2>&1 | tee -a "$LOG_FILE"

UPLOAD_RESULT=${PIPESTATUS[0]}

# ==================== 9. 清理私钥 ====================
if [ -f "$PRIVATE_KEY_PATH" ]; then
    rm -f "$PRIVATE_KEY_PATH"
    print_info "私钥文件已清理"
fi

# ==================== 10. 处理结果 ====================
echo ""
echo "=================================================="

if [ $UPLOAD_RESULT -eq 0 ]; then
    print_success "${ACTION} 操作成功完成！"

    # 检查 CDN URL（预览和上传都可能有）
    if [ -f "preview-qrcode-url.txt" ]; then
        CDN_URL=$(cat preview-qrcode-url.txt)
        echo ""
        print_success "CDN 地址: ${CDN_URL}"
    fi

    echo ""
    print_success "========== 操作摘要 =========="
    print_info "环境: ${BUILD_MODE}"
    print_info "版本: ${BUILD_VERSION}"
    print_info "描述: ${FULL_DESC}"
    print_info "操作: ${ACTION}"
    if [ -n "$ROBOT" ]; then
        print_info "机器人: ${ROBOT}"
    fi
    print_success "=============================="
else
    print_error "${ACTION} 操作失败，退出码: ${UPLOAD_RESULT}"
fi

echo "=================================================="
print_info "日志文件: ${LOG_FILE}"
echo "=================================================="

exit $UPLOAD_RESULT
