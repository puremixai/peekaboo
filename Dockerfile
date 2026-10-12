# ---------- 阶段 1：构建 React 前端 ----------
FROM node:22-alpine AS web
WORKDIR /web

# 先只拷贝依赖清单，让 npm install 这一层能被 Docker 缓存
COPY web/package.json web/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
    else npm install --no-audit --no-fund; fi

COPY web/ ./
RUN npm run build


# ---------- 阶段 2：构建 Go 后端 ----------
FROM golang:1.25-alpine AS api
WORKDIR /src

COPY server/go.mod ./
RUN go mod download

COPY server/ ./
# CGO_ENABLED=0 出静态二进制，才能丢进 alpine/scratch 跑
# -trimpath 去掉构建机的绝对路径；-s -w 去掉符号表，体积减半
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/navserver .


# ---------- 阶段 3：运行镜像 ----------
FROM alpine:3.20

# ca-certificates：调用高德 HTTPS 接口必需
# tzdata：日志时间用本地时区
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -u 10001 app

WORKDIR /app
COPY --from=api /out/navserver /app/navserver
COPY --from=web /web/dist        /app/web

# 数据打包进镜像，开箱即用。
# 想更新数据不必重新构建镜像：docker-compose.yml 里把 ./data 挂载到 /app/data，
# 宿主机改完文件调一次 POST /api/admin/reload 即可生效。
COPY data/ /app/data/

ENV DATA_DIR=/app/data \
    WEB_DIR=/app/web \
    ADDR=:8080

EXPOSE 8080

# 用非 root 运行；数据只读，不需要写权限
USER app

# busybox 自带 wget，不用额外装
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/app/navserver"]
