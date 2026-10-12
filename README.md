# 幽州迂道览胜舆

> 北京进京证摄像头避让导航 —— 把全北京的进京证抓拍摄像头标在地图上，规划一条**尽量不经过摄像头**的行车路线。

进京证摄像头会在你无证进京时拍照取证。本项目汇集进京证摄像头点位，叠加高德地图，
用「避让多边形」让路线绕开这些点位，并把不同取舍的方案（多绕多少公里 / 少过几个红点）并列给你选。

---

## 功能

- **6288 个摄像头点位**（GCJ-02 坐标系）在地图上分色展示，点一下即可查看点位详情：精确到秒的更新时间、违章抓拍截图、车主实况评论。
- **避让规划**：输入起终点，服务端跑避让算法，一次返回多个方案（不避让 / 避让若干点位），标注里程、耗时、走廊内剩余红点数。
- **自动定位起点**：打开页面自动取当前位置作为起点（也可手动点「定位」或在地图上选点）。
- **地图选点 / 地址输入提示**：起终点支持地图点击选取与关键字提示。
- **数据热重载**：更新点位数据不需要重新构建镜像，也不需要重启容器。

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 后端 | Go 1.25（**仅标准库**） | 无第三方依赖，可离线构建 |
| 前端 | React 18 + Vite 5 | 产物约 56 KB（gzip） |
| 部署 | Docker 三阶段构建 + Docker Compose | 运行镜像基于 alpine 3.20，非 root（uid 10001） |

---

## 快速开始

### 方式一：Docker Compose（推荐）

```bash
cp .env.example .env      # 填入高德 Key，见下节
docker compose up -d --build
```

浏览器打开 <http://localhost:8080>。

### 方式二：本地开发

需要 Go 1.25+、Node 22+。

```bash
# 后端（监听 :8080）。注意：Go 模块在 server/ 下，而数据与前端产物在仓库根目录，
# 所以从 server/ 启动时要显式指回上一层。
cd server
AMAP_WEB_KEY=<你的高德 Web 服务 Key> \
  DATA_DIR=../data WEB_DIR=../web/dist go run .

# 前端（Vite dev server，:5173，/api 已代理到 :8080）
cd web
npm install
npm run dev
```

开发时访问 <http://localhost:5173>（Vite 热更新）；`npm run build` 后也可由 Go 服务在 :8080 直接托管。

## 配置

所有配置走环境变量，均有默认值。Docker 部署从 `.env` 读取（参考 `.env.example`）。

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `AMAP_WEB_KEY` | **是** | — | 高德**Web 服务** Key。仅服务端调用路径规划与输入提示，**不会下发到浏览器**。 |
| `AMAP_JS_KEY` | 建议单独申请 | 复用 `AMAP_WEB_KEY` | 高德 **Web 端(JS API)** Key。**必然下发到浏览器**，务必在高德控制台配置 Referer 域名白名单。 |
| `AMAP_SECURITY_CODE` | 可选 | — | JS API 2.0 安全密钥。填了自动启用 `/_AMapService` 代理转发，密钥不出服务端。 |
| `PORT` | 否 | `8080` | 对外端口。 |
| `AMAP_CITY` | 否 | `北京` | 输入提示限定的城市。 |
| `AMAP_TIMEOUT_SEC` | 否 | `20` | 单次调用高德接口的超时（秒）。 |
| `LOG_REQUESTS` | 否 | `false` | 是否打印每个请求。 |
| `ADMIN_TOKEN` | 否 | — | 管理接口令牌。留空则 `/api/admin/reload` 只允许容器内调用。 |
| `DATA_DIR` / `WEB_DIR` / `ADDR` | 否 | `/app/data`、`/app/web`、`:8080` | 镜像内已设好，本地开发一般无需改动。 |

Key 申请入口：<https://console.amap.com/dev/key/app>

---

## 架构

```
server/                     Go 后端（仅标准库）
  main.go                   入口：装配依赖、优雅关闭
  internal/config/          环境变量配置
  internal/geo/             等距圆柱近似的点线距离、米↔度换算
  internal/store/           三个 JSON 载入内存 + CELL=0.01 空间网格索引；Holder 支持原子热替换
  internal/amap/            高德 REST 客户端（driving / inputtips）
  internal/planner/         避让算法
  internal/httpapi/         路由、gzip、CORS、静态资源 + SPA 兜底、高德代理

web/                        React + Vite 前端
  src/amap.js               JS API 2.0 加载器（优先 serviceHost 代理模式）
  src/locate.js             浏览器定位封装（AMap.Geolocation）
  src/App.jsx               全局状态
  src/components/           MapView / PointPopup / Sidebar / Lightbox

data/                       运行时数据（镜像内打包，compose 里挂卷以便更新）
  cameras.json              点位列表（约 1.4 MB）
  details.json              各点位详情页解析结果（约 1.0 MB）
  comments.json             各点位车主评论（约 9 MB）

Dockerfile                  三阶段：node 构建前端 → golang 构建后端 → alpine 运行
docker-compose.yml          build + 端口 + 环境变量 + 健康检查 + 资源限制
```

### 关键设计取舍

- **避让算法放在服务端**：可脱离浏览器单测，便于做超时控制；同时高德 Web 服务 Key 不外泄。
- **前端弹窗不用 `AMap.InfoWindow`**：改用地图容器内的绝对定位覆盖层，地图 `moving`/`zoomchange`/`moveend` 时重算锚点，完全由 React 掌控，避免 InfoWindow「一次性定位、事后改高度断锚点」的问题。
- **评论懒加载**：单点位最多 600 条评论，默认只返回最近 20 条 + 总数，响应从 54 KB 降到 2.3 KB。
- **不引入数据库**：11 MB 数据、单进程、只读为主。解析全部 JSON 约 68 ms、全量重写约 207 ms，存储层不是瓶颈；真正的瓶颈在数据采集层，已单独解决（见「数据更新」）。

---

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | 健康检查 + 数据规模（`points` / `details` / `commentPoints` / `comments` / `amapKeySet`） |
| `GET` | `/api/config` | 前端启动配置：`jsKey`、`serviceHost`、默认半径、类型码、初始中心与缩放。**不含任何 Web 服务 Key** |
| `GET` | `/api/points` | 全部 6288 个点位（gzip 后约 173 KB） |
| `GET` | `/api/points/{id}` | 单点位详情 + 最近 N 条评论（默认 20，`?limit=` 可调） |
| `POST` | `/api/plan` | 服务端跑完整避让算法，一次返回全部方案 |
| `GET` | `/api/tips?kw=` | 起终点输入提示（代理高德，Key 不外泄） |
| `POST` | `/api/admin/reload` | 数据热重载。需 `X-Admin-Token`（未设 `ADMIN_TOKEN` 时仅允许本机） |
| `*` | `/_AMapService/*` | 高德官方推荐的安全密钥代理，转发时补 `&jscode=` |

**`POST /api/plan` 请求**

```json
{ "start": [116.360827, 40.079540], "end": [116.399771, 40.158950],
  "radius": 100, "targetAll": false, "strategy": 32 }
```

`start` / `end` 为 `[经度, 纬度]`；`radius` 为避让走廊半径（米）。

**响应**（节选；下例为上文请求的实测返回）

```json
{ "radius": 100, "targetAll": false, "calls": 7,
  "baseline": { "label": "不避让（基准）", "dist": 15515, "dur": 1970, "red": 15 },
  "plans": [ { "label": "不避让（基准）", "dist": 15515, "dur": 1970, "red": 15, "areas": [],  "rounds": 0 },
             { "label": "避让 15 个点",   "dist": 17836, "dur": 1919, "red": 5,  "areas": 7,   "rounds": 1 },
             { "label": "避让 25 个点",   "dist": 22160, "dur": 2203, "red": 4,  "areas": 12,  "rounds": 3 },
             { "label": "避让 35 个点",   "dist": 23106, "dur": 2314, "red": 0,  "areas": 17,  "rounds": 6 } ] }
```

每个 `plan` 另含 `poly`（路线折线，上例 361 个点）、`near`（走廊内点位下标，上例 3 个）、
`areas[].poly`（避让多边形）与 `areas[].members`（该避让区覆盖的点位下标）。
`red` 为走廊内的红点个数 —— 上例的取舍是：多绕 7.6 km 换来红点清零。

---

## 数据更新

点位数据采用「整体替换」而非增量更新：上游首页把全部点位内联在一个 `LabelsData` 数组里，重新获取一次就是全量快照，不存在增量对不上的问题。
详情与评论按 `href` 里的详情页 id 挂载，新增点位只补采对应 id，旧条目不动。

```bash
./update.sh              # 获取首页 → 对比 → 补采详情/评论 → 热重载，一条命令
./update.sh --dry-run    # 只对比并报告变更，不写任何文件
```

环境变量：`PYTHON`（默认 `python`）、`BASE_URL`（默认 `http://127.0.0.1:8080`）、`ADMIN_TOKEN`（未设时尝试从 `.env` 读取）。

| 脚本 | 职责 |
|---|---|
| `extract_coords.py` | 从上游首页快照提取坐标 → `cameras.json` / `cameras.csv`（快照缺失时自动获取） |
| `pointlib.py` | 共用逻辑：获取首页、解析 `LabelsData`、读写 `cameras.json`、版本对比 |
| `update_points.py` | 更新入口。以详情页 id 为主键逐字段对比，报告新增/删除/修改；`os.replace` 原子写入；变更历史进 `data/changes.json`；支持 `--dry-run` 与 `--html` |
| `fetch_details.py` | 采集详情页 → `details.json`（6 并发 + 完整页校验 + 重试） |
| `fetch_comments.py` | 采集车主评论 → `comments.json` |

**两个必须注意的点**

1. **必须挂目录，不能挂单个文件。** 写数据用 `os.replace` 原子替换，会换掉 inode；文件级 bind mount 会一直指向旧 inode，宿主机改了容器也看不到。`docker-compose.yml` 里挂的是 `./data:/app/data`。
2. **改动前端必须重建镜像。** 前端产物是烘焙进镜像的（`COPY --from=web /web/dist /app/web`），光跑 `npm run build` 更新本地 `web/dist` 容器看不到，需要 `docker compose build` 再 `up`。数据不同——数据是卷挂载的，改完热重载即可（耗时约 83~173 ms）。

## 测试

端到端测试用 Playwright（`playwright-core` + 本机 Chromium）。先确保服务已在 `http://127.0.0.1:8080` 运行。

```bash
NODE_PATH=<playwright-core 所在目录> node test_go_app.js   # 主链路：选点 → 规划 → 弹窗 → 评论
NODE_PATH=<playwright-core 所在目录> node test_locate.js   # 定位功能（自动定位 / 手动定位 / 失败路径）
```

- `test_go_app.js`：验证启动、点位加载、地图选点、避让方案、点位弹窗与评论渲染，并断言无 JS 错误。
- `test_locate.js`：验证启动自动定位只触发一次、地图居中到位、手动定位仍可用，以及非安全上下文下的失败降级。

> 写测试时注意：`setZoomAndCenter` 默认是**动画**的，时长随距离变化，跨城区可能 5~6 秒；且方案渲染时会调 `setFitView`（动画），**动画期间发出的 `setZoomAndCenter` 会被丢弃**。测试里要么传 `immediately=true`，要么用「设一次 → 校验 → 没到位再来」的循环。

---

## 安全说明：高德 Key 能藏住多少

分两个 Key 看，结论完全不同：

- **Web 服务 Key（`restapi.amap.com`）—— 已彻底隐藏。** 前端源码与产物里不含任何 `restapi.amap.com` / `v5/direction` / `avoidpolygons`，前端只调用相对路径 `/api/*`；`/api/config` 只下发 `jsKey`。
- **JS API Key（`webapi.amap.com`）—— 藏不住。** 它必须出现在 `<script src="...&key=...">` 里；实测页面加载后共 78 个请求，其中 18 个 URL 带明文 Key，分布在 6 个域名（`jsapi.amap.com`、`o4.amap.com`、`webapi.amap.com`、`restapi.amap.com`、`jsapi-service.amap.com`、`mapplugin.amap.com`）。这是 JS API 的固有设计，只能靠高德控制台的 **Referer 白名单**防护。
- **安全密钥（`securityJsCode`）—— 能藏住。** 按高德官方推荐，填 `AMAP_SECURITY_CODE` 后本服务启用 `/_AMapService` 反向代理，前端只拿到代理地址，真实密钥留在服务端。DevTools 里看不到安全密钥。

部署时请务必：为 JS API Key 配置 Referer 白名单；`.env` 与 `amap_key.txt` 不要进版本库（已在 `.gitignore` 中）。

## 已知限制

- **移动端定位需要 HTTPS**（iOS 10+ / 部分 Android 在非安全上下文禁止定位）。本机 `localhost` 不受影响；线上部署必须启用 HTTPS，否则「定位」不可用（会自动降级为提示，不报错）。
- **PC 没有 GPS**，定位走高德 IP 定位，官方给出的失败率约 5%。
- **规划接口最长要跑一两分钟**（串行调用高德十余次）。服务端 `WriteTimeout` 已放宽到 150s+30s，反向代理/网关的超时也要相应放宽。
- 高德 `avoidpolygons` 本身有限制：最多 32 个区域、每区域最多 16 个顶点、每区域面积不超过 81 km²，算法已按此切分避让区。
