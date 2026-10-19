# Lightsail 控制台

中文单页控制台，运行在 Cloudflare Worker。自动发现并控制第一台 Lightsail 实例，支持查看状态、开机、关机、更换公网 IPv4，并同步 Clash 与 sing-box 订阅。

## 本地运行

需要 Node.js 22.12+、AWS IAM 凭证和 Cloudflare 账户。

```sh
npm install
cp .dev.vars.example .dev.vars   # 填入 AWS 凭证和至少 8 位管理密码
npm run dev                      # http://localhost:8787
```

`AWS_REGIONS` 留空时自动发现全部区域，也可填写逗号分隔的区域列表。IAM 模板见 `iam-policy.json`。

## 部署

```sh
npx wrangler login
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
npx wrangler secret put ADMIN_PASSWORD
# 临时 AWS 凭证再设置 AWS_SESSION_TOKEN
npm run deploy
```

不要提交 `.dev.vars`。部署配置见 `wrangler.jsonc`，`npm run deploy` 会自动构建 Worker 与静态资源。

## 验证与预览

```sh
npm run verify   # 类型检查、Lint、测试、构建
npm run preview  # 模拟实例，http://localhost:8788
```

预览支持 `?scenario=login`、`stopped`、`static`、`error`、`empty`、`minimal` 等状态。

## 行为与限制

- 仅控制返回顺序中的第一台实例；刷新时直接读取当前实例。
- 换 IP 会先关机、再开机。正常流程最长 15 分钟，操作期间请保持页面打开。
- 静态 IP 不可更换；操作记录只保留在当前页面内存中，最多 100 条。
- 订阅同步更新 KV `SUB` 中 `clash` 和 `sing-box` 的第一个代理 `server`，失败不影响换 IP。
- 登录 Cookie 有效期 12 小时；写接口校验 Origin，错误不返回 AWS 细节。请使用随机强密码。
- 登录限流仅在单个 Worker isolate 内生效，不提供跨设备操作锁。

## API

`POST /api/login`、`POST /api/logout`、`GET /api/session`、`GET /api/instances`、`GET /api/instance`、`POST /api/action`、`POST /api/sub`。

参考：[AWS Lightsail](https://docs.aws.amazon.com/lightsail/)、[Cloudflare Workers](https://developers.cloudflare.com/workers/)、[shadcn/ui](https://ui.shadcn.com/)。
