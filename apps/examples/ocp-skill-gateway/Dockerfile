# syntax=docker/dockerfile:1.7
#
# OCP Skill Gateway —— 给 LLM Agent 平台用的 HTTP 适配层。
# 上游默认走 ocp.deeplumen.io/mcp(OCP 注册中心),无需任何本地 catalog。
#
# 构建上下文 = 仓库根目录(因为 monorepo 的 .dockerignore 在根):
#   docker build -f apps/examples/ocp-skill-gateway/Dockerfile -t ocp-skill-gateway:0.1.0 .
#
# 运行:
#   docker run -d --name skill-gateway \
#     -p 4330:4330 \
#     -e SKILL_GATEWAY_API_KEYS=sk_prod_xxx \
#     -e SKILL_GATEWAY_PUBLIC_BASE_URL=https://gateway.example.com \
#     ocp-skill-gateway:0.1.0
#
# 注:故意不复用 monorepo 根 bun.lock。skill-gateway 的 3 个依赖(elysia / @elysiajs/cors /
# zod)都是纯外部包,跟其它 workspace 无 cross-ref,所以可以独立安装,Dockerfile 简单很多。

# ---------- Stage 1: bundle ----------
FROM oven/bun:1.3-alpine AS builder
WORKDIR /build

# 只拷 skill-gateway 自己的 package.json,以独立包形式安装
COPY apps/examples/ocp-skill-gateway/package.json ./package.json
RUN bun install --production=false

# 拷源码(不拷 tsconfig.json,因为它 extends 上级文件,容器里没有上级)
# bun build 内置 TS 支持,无 tsconfig 也能正确处理本仓库的源码
COPY apps/examples/ocp-skill-gateway/src ./src

# bun build 会把 elysia / zod / @elysiajs/cors 全部内联,产物是单文件 ~1.3 MB
RUN bun build src/index.ts \
      --outfile /build/gateway.js \
      --target bun \
      --minify

# ---------- Stage 2: runtime ----------
FROM oven/bun:1.3-alpine
WORKDIR /app

# 只拷打好的单文件 + package.json(运维巡检看版本号用)
COPY --from=builder /build/gateway.js ./gateway.js
COPY --from=builder /build/package.json ./package.json

# 默认 env(运行时可覆盖)
ENV SKILL_GATEWAY_PORT=4330
ENV SKILL_GATEWAY_UPSTREAM=ocp_mcp
ENV SKILL_GATEWAY_OCP_MCP_URL=https://ocp.deeplumen.io/mcp
ENV SKILL_GATEWAY_FANOUT_TIMEOUT_MS=8000
# 这两个必须运行时传入,留空启动会被 zod 拒掉,故意的:
#   SKILL_GATEWAY_API_KEYS=sk_prod_xxx,sk_prod_yyy
#   SKILL_GATEWAY_PUBLIC_BASE_URL=https://gateway.your-domain.com

EXPOSE 4330

# 容器自检:30 秒一次打 /health,3 次失败就标 unhealthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:4330/health || exit 1

# 非 root 跑(oven/bun 镜像自带 bun 用户)
USER bun

CMD ["bun", "gateway.js"]
