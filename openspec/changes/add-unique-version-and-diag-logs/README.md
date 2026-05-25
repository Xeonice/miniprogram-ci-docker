# add-unique-version-and-diag-logs

为 upload-mp.js 增加 BUILD_MODE+UUID 后缀的唯一版本号生成，并把 upload/preview catch 增强为打印完整错误详情 + 公网出口 IP 探测；解决并发 race condition 和错误信息丢失
