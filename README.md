# Lightsail 云端控制台

中文 React + shadcn/ui 网页，单个 Cloudflare Worker 托管静态资源和 API。自动查找所有 Lightsail 区域，控制返回顺序中的第一台实例，支持查看状态、开机、关机、一键更换公网 IPv4。

Clash 与 sing-box 订阅配置保存在 Cloudflare KV（绑定 `SUB`，键分别为 `clash` 和 `sing-box`）；AWS 密钥和管理密码使用 Worker 自身的 Secrets 配置。其余功能不使用 D1、Durable Objects 或 Workflows。

## 运行与部署

需要 Node.js 22.12+、npm、Cloudflare 账户和 AWS IAM 凭证。

1. 安装依赖：`npm install`。
2. `wrangler.jsonc` 的 `AWS_REGIONS` 留空，自动发现所有 Lightsail 区域并读取第一台实例（区域列表按凭证缓存 5 分钟，实例状态实时查询）；如需缩小查询范围，可填写逗号分隔的区域列表。
3. 复制 `.dev.vars.example` 为 `.dev.vars`，填写 AWS 凭证和至少 8 位的随机管理密码。不要提交该文件。
4. 执行 `npm run dev`（即 `wrangler dev`），打开 http://localhost:8787 。Wrangler 自动构建前端，并在同一端口提供页面和 API；按 Ctrl+C 停止。
5. 修改 `src`、`index.html` 或 Vite 配置后，Wrangler 自动重新构建；构建完成后刷新浏览器。开发服务运行时，可执行 `npm run test:dev` 检查同源接口。
6. 运行 `npm run verify`（依次执行 `check`、`lint`、`test`、`build`）。单独检查格式用 `npm run format:check`，自动修复用 `npm run format`。
   前端使用 shadcn/ui（Radix Nova）、Tailwind CSS v4 和 Lucide 图标，从零构建。极简布局与 `#FA70AB` 粉色主题，采用单页布局，支持深色主题、手机适配和键盘操作；主题选择保存在本地。
7. `npx wrangler login` 后配置远端 Secrets：
   ```sh
   npx wrangler secret put AWS_ACCESS_KEY_ID
   npx wrangler secret put AWS_SECRET_ACCESS_KEY
   npx wrangler secret put ADMIN_PASSWORD
   # 仅使用临时 AWS 凭证时需要：
   npx wrangler secret put AWS_SESSION_TOKEN
   npm run deploy
   ```
8. 访问部署返回的 workers.dev HTTPS 地址，输入管理密码。

`npm run build` 单独构建前端；`npm run deploy` 即 `wrangler deploy`，会通过配置中的构建命令自动构建再部署。采用 [Cloudflare 官方自定义构建流程](https://developers.cloudflare.com/workers/wrangler/custom-builds/)，无需单独启动 Vite 或配置代理。

无需绑定额外服务或自有域名。临时 AWS 凭证过期后需要重新设置 Secrets。IAM 策略模板见 `iam-policy.json`，替换账户 ID；自动发现区域需要 `lightsail:GetRegions`，查询实例列表需要 `lightsail:GetInstances`，均使用 Resource *。模板允许读取和停启该账户所有区域的实例；旧策略若限定东京，需要同步更新。

## Clash 与 sing-box 订阅同步

- `SUB` KV 的 `clash` 键保存 Clash 配置（YAML）。换 IP 或开机获得新的公网 IPv4 后，页面自动调用 `POST /api/sub`，按 `proxies` 顺序，把第一个具有非空 `server` 地址的代理节点更新为新 IP，其余内容原样保留。同时更新 `sing-box` 键中 JSON 配置的 `outbounds`：按顺序选择第一个具有非空 `server` 地址的代理节点，仅修改其 `server`，不依赖节点名称或标签；两种配置均跳过 direct、reject/block、selector 等非服务器节点，保留 DNS、端口、UUID、TLS 和路由等字段。
- sub-manager 把名称、访问限制等存在 KV 的 key metadata 中。写入时先 `getWithMetadata` 合并原 metadata，只刷新 `size`、`sha256`、`updatedAt`，不会丢失名称或限制。目标地址未变化时保留原文与 metadata，跳过 KV 写入。
- 两份配置独立同步，一份失败不会阻止另一份更新。更新失败只会在页面提示具体配置和原因，不影响换 IP 结果；配置未保存时返回 404，没有可更新的代理服务器或配置格式无效时返回 422。KV 不支持跨键事务，因此可能出现部分成功。
- 不再提供公开的 `/clash` 订阅接口，配置由其他订阅服务读取同一个 KV。

## 操作行为

- 首次进入时扫描区域并选择第一台实例，之后的状态刷新直接读取当前实例，减少跨区域请求；实例不存在时重新发现。临时读取失败保留已有信息，显示实际错误并禁用操作，刷新成功后恢复。
- 换 IP：检查当前运行状态和静态 IP → 正常停止 → 每 10 秒查询 → 启动 → 等待运行并比较 IP。不会删除实例、强制关机或调用 reboot。
- **操作期间保持网页打开。** 页面内存承担流程编排；Worker 只完成单次 AWS 请求。刷新、关闭、设备休眠、网络断开可能使流程停在关机阶段，重新打开后检查状态并手动开机。浏览器离开提示只是辅助，不能保证拦截关闭。会话失效或页面卸载会取消未完成的请求与等待，防止旧流程继续发起操作；已经送达 AWS 的命令不会被撤销。
- 正常流程 15 分钟超时，临时请求失败最多尝试 5 次；参数错误、权限错误等不可恢复的 4xx 请求不重试（429 除外），达到截止时间后不再发起重试。换 IP 失败后在页面仍可运行时尝试恢复开机，恢复等待最多 5 分钟（网络请求和重试会带来少量额外耗时）。
- 绑定静态 IP 时不允许更换，也不会自动解绑。已停止实例只能开机。新旧 IP 相同会如实显示“IP 未变化”，不循环停启。
- 当前页面按钮锁和 Web Locks 避免同一浏览器多个标签页重复操作。**无跨浏览器、跨设备分布式锁或持久化幂等保证，请勿同时从多个设备控制同一实例。** 后端读取 AWS 状态以容忍重复停启请求，但无法原子锁定 AWS 操作。
- 操作记录只在当前页面内存中保留最近 100 条，刷新即清空。没有任务恢复、服务端历史或定时任务。
- 服务恢复以 AWS 报告 running 且分配公网 IP 为准，不代表实例内应用完成启动。

## 登录与安全边界

- AWS 签名只在 Worker 中进行；前端构建不包含凭证。凭证必须使用 Secrets，不能放入 Vite 环境变量。
- HMAC 签名 Cookie 有效期 12 小时，HttpOnly / Secure / SameSite=Strict。退出删除当前浏览器 Cookie；无服务端存储，所以不能撤销已复制的旧 Cookie。修改 ADMIN_PASSWORD 使所有旧 Cookie 失效。
- 登录失败限制为单 Worker isolate 内同 IP 15 分钟 5 次，仅尽力保护，冷启动和不同 isolate 不共享计数；不是全局限流。必须使用足够长的随机管理密码。
- 所有管理接口要求登录，写请求检查 Origin；响应 no-store。错误不返回原始 AWS 错误或凭证。实例响应只包含界面所需字段，不返回 ARN、标签、端口规则等元数据。AWS 权限、资源不存在和参数错误分别映射为 403、404、400，避免对永久错误重复请求；连接失败及超时返回 503。异常分页 token 会终止查询。
- 真实 AWS 停启会中断服务，本项目测试使用模拟 API，不自动操作真实实例。

## API

- `POST /api/login`：`{password}`；`POST /api/logout`；`GET /api/session`。
- `GET /api/instances`：自动发现区域，按区域和 AWS 返回顺序选择第一台实例；返回该实例及实际区域，无实例时返回各区域读取错误。
- `GET /api/instance?region=…&name=…`：读取单台最新状态。
- `POST /api/action?region=…&name=…`：`{action: "start" | "stop", rotate: boolean}`。返回 accepted 仅表示命令已接受，客户端需要继续查询状态。
- `POST /api/sub`：`{ip}`。把 `SUB` KV 中 `clash` 和 `sing-box` 配置里第一个代理服务器节点的 `server` 更新为该 IP。

参考：[AWS 公网 IP](https://docs.aws.amazon.com/lightsail/latest/userguide/understanding-public-ip-and-private-ip-addresses-in-amazon-lightsail.html)、[Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/)、[shadcn/ui](https://ui.shadcn.com/docs)。

## 本地界面预览

无需 AWS 凭证，可先构建并运行：

```sh
npm run build
npx wrangler dev --config tests/wrangler.preview.jsonc --port 8788 --inspector-port 9230
```

此测试入口展示一台新加坡模拟实例，停启和换 IP 仅在本地模拟，不连接 AWS。生产部署必须使用根目录的默认配置。

打开 http://localhost:8788 查看默认界面，也可以使用 `npm run preview` 一步构建并启动。控制台采用极简单页布局：

- 顶部显示实例状态和公网 IPv4，可复制地址、开机、关机和换 IP。停机与换 IP 使用确认对话框；操作期间锁定刷新、退出和重复操作。
- 服务器配置、网络地址和 SSH 命令直接显示在同一页，未知信息显示为 `—`。
- 下方显示本次会话最近 100 条操作结果、时间与地址变化；刷新或退出后清空。

无侧栏、视图切换或标签页，仅保留基本标签和实际状态。主题色为 `#FA70AB`；手机布局自动调整，界面使用本地字体。

添加 `?scenario=stopped`、`stopping`、`pending`、`static`、`error`、`empty`、`multiple`、`action-error`、`minimal`、`long-name` 或 `refresh-error` 可检查对应状态；`?scenario=login` 可检查登录页（输入任意八位以上测试密码）。多实例时仍只控制第一台；无法读取实例时不提供控制操作。

开发工具链对 sharp、source-map-js、brace-expansion 和 undici 7 使用安全补丁版本 override，均不打包进生产 Worker。生产依赖的 `npm audit --omit=dev` 未报告已知漏洞。开发依赖仍有 [braces 的上游漏洞](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)，截至 2026-10-11 没有发布修复版本；完整 audit 的 7 条告警来自它与 shadcn 工具链中的传递依赖。

## 前端结构

- `src/app.tsx`：会话入口与单页内容。
- `src/components/console-layout.tsx`、`login.tsx`、`instance-views.tsx`：单页布局、登录、实例信息与操作确认。
- `src/components/ui/`：由 shadcn CLI 安装的基础组件。
- `src/hooks/use-console.ts`：会话、API 状态、操作锁与订阅同步。
- `src/operations.ts`：停启和换 IP 编排，包含轮询、重试、超时与异常恢复。
- `src/styles.css`：语义主题变量、响应式布局和视觉设计。

`tests/frontend.test.tsx` 使用真实 shadcn 组件验证登录、操作确认、操作锁、订阅失败、状态限制、空状态、单页信息展示、刷新恢复、请求取消和会话过期；后端与操作编排测试使用模拟请求，不连接 AWS。
