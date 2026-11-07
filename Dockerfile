# dsh-ee 单镜像：前端构建后嵌进 Go 二进制，运行镜像里只有这一个文件。
#   docker build --build-arg VERSION=$(git describe --tags --always) -t dsh-ee .

FROM node:22-alpine AS web
WORKDIR /src/web
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
# 网页版应用和 DSH 共用接入插件里的工作台渲染
COPY dsh-plugin/src/workbench.ts dsh-plugin/src/workbench-view.ts /src/dsh-plugin/src/
RUN pnpm build

FROM golang:1.27-alpine AS server
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY --from=web /src/web/dist/ ./internal/webui/build/
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/dsh-ee ./cmd/dsh-ee

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata \
 && adduser -D -H -u 10001 dsh-ee \
 && mkdir -p /data && chown dsh-ee /data
COPY --from=server /out/dsh-ee /usr/local/bin/dsh-ee
USER dsh-ee
ENV DSH_EE_ADDR=0.0.0.0:8080 \
    DSH_EE_DATA_DIR=/data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/dsh-ee"]
