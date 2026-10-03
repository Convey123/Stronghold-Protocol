# 打包客户端：Windows EXE 与 Android APK

网页版是**服务器自带客户端**：浏览器打开 `http://<服务器>:3000/` 时，所有素材都由服务器发。朋友一多，出口带宽就先撑不住（实测 8 人在线时上行 3 Mbps 跑满）。桌面 / 安卓客户端把**整套客户端与素材打进包里**（约 330 MB），服务器只再负责房间、回合、经济与 WebSocket——这是这个模式本来就该有的结构（战斗在各自客户端模拟，DESIGN §14）。

```
打包后的客户端（Electron / Capacitor）        游戏服务器（node server/index.js）
  ├── index.html, js/, css/, vendor/            ├── /ws      ← 客户端唯一还要向服务器要的东西
  ├── assets/ (立绘/Spine/音效/语音)      ←→    ├── /data/, /shared/, /sim/, /   （浏览器版玩家仍可整站访问）
  ├── data/ (游戏数据)                          └── /healthz
  └── sim/  (战斗模拟，浏览器里跑)
```

## 1. 服务器地址怎么定

客户端默认连构建时注入的地址（`window.__SP_APP__.server`，`SP_SERVER=…` 构建时给，不给就是 `http://localhost:3000`）；玩家可以在**设置 → 服务器地址**里改（写进 `localStorage` 的 `sp.server`，改完自动重连），所以即使发布出去的包里是个占位地址，玩家也能自己填。解析顺序（`public/js/serverConfig.js`）：

1. 壳自带的本机服务器（`window.__SP_LOCAL__.server`，桌面端「离线游玩」才有）
2. `window.__SP_APP__.server`（打包时注入）
3. `?server=http://host:3000`（给某个链接指定服务器）
4. `localStorage['sp.server']`（设置里改的）
5. 页面自己的 origin（浏览器版，什么都不用配）

地址只取 origin（`http(s)://host:port`），路径会被忽略：客户端用 `/ws`、`/data/` 这类绝对路径，服务器必须挂在根路径上（`docs/DEPLOY.md` §2.4）。

## 2. 构建

依赖：Node ≥ 22；打 Windows 包需要 `wine` + `wine32`（electron-builder 生成卸载程序要在 wine 里跑一次安装器）；打安卓包需要 JDK 21 与 Android SDK（`platforms;android-36`、`build-tools;36.0.0`）。

```bash
# 0) 先备好素材（首次，约 250 MB；已有则跳过）
npm ci && node tools/setup.mjs --no-local

# 1) Windows：客户端包 + 内置服务器运行时 + electron-builder
cd app/desktop && npm install
SP_SERVER=http://<你的服务器>:3000 npm run dist:win    # = client（客户端包）+ runtime（内置服务器）+ electron-builder
#   等价的手动步骤（排查时用）：
#   node tools/build-client-app.mjs --out app/build/client --kind desktop --server http://<服务器>:3000
#   node app/desktop/build-runtime.mjs
#   npx electron-builder --win --x64
# 可选：国内网络下 GitHub releases 很慢，加这两行走镜像（装完可以 unset；默认走官方源）
export ELECTRON_MIRROR=https://cdn.npmmirror.com/binaries/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
export CSC_IDENTITY_AUTO_DISCOVERY=false    # 没有代码签名证书时必须
npx electron-builder --win --x64            # 同时出 nsis 安装版与 zip 便携版
# 只想要便携版（不需要 wine）：npx electron-builder --win zip --x64

# 2) Android：生成客户端包 → Capacitor 同步 → Gradle 出 APK
cd app/android && npm install && SP_SERVER=http://<你的服务器>:3000 npm run client && npx cap sync android
cd android && ANDROID_HOME=~/android-sdk ./gradlew assembleDebug     # 或 assembleRelease
```

产物（`app/dist/` 已被 git 忽略）：

| 文件 | 体积 | 说明 |
|---|---|---|
| `app/dist/desktop/StrongholdProtocol-0.1.0-win-x64-Setup.exe` | ~285 MB | NSIS 安装版：可选安装目录、桌面/开始菜单快捷方式、带卸载程序 |
| `app/dist/desktop/StrongholdProtocol-0.1.0-win-x64-portable.zip` | ~385 MB | 便携版：解压后直接运行 `StrongholdProtocol.exe` |
| `app/android/android/app/build/outputs/apk/debug/app-debug.apk` | 见下 | 安卓调试签名 APK，可直接安装 |
| `app/android/android/app/build/outputs/apk/release/app-release.apk` | 见下 | 未签名；用 `apksigner` / keystore 签名后分发 |

`--slim` 可以把语音（58 MB）留在服务器上（省体积，但玩家点开语音会走网络）。

## 3. 给玩家

- **Windows**：装 `Setup.exe`（未做代码签名，SmartScreen 会提示「未知发布者」→ 更多信息 → 仍要运行），或解压便携版 zip 双击 `StrongholdProtocol.exe`。
- **Android**：安装 APK 需在系统里允许「安装未知来源应用」。首次启动若连不上：设置 → 服务器地址填 `http://<服务器IP>:3000`。
- 客户端**内置素材**，所以第一次进游戏不再从服务器下载几十 MB；之后只有 WebSocket 流量（4 人对局每回合约 0.25 MB）。

## 4. 实机验证（本仓库跑过的）

同一份壳代码构建 Linux 版，在 `xvfb` 里真跑一次打包后的应用，并用 DevTools 协议向页面提问：

```
[client] serving …/resources/client at http://127.0.0.1:45123/
页面: 卫戍协议：盟约 · STRONGHOLD PROTOCOL | http://127.0.0.1:45123/
window.__SP_APP__ = {"kind":"desktop","version":"0.1.0","server":"http://127.0.0.1:3399"}
客户端解析出的 ws 地址 = ws://127.0.0.1:3399/ws
设置里显示的服务器地址 = http://127.0.0.1:3399
Net 连接结果 = {"status":"connected"}        页面是否报错 = 0
```

即：应用能加载本地客户端包、解析出服务器地址、并真的连上服务器。静态服务本身的单测在 `test/app/desktop-serve.test.js`（目录穿越、Range、缓存头、404）。

## 5. 结构与注意

- `app/desktop/`：Electron 壳。`main.js` 建窗、菜单、外链交给系统浏览器；`serve.js` 是**纯 Node 的本地静态服务**（无 Electron 依赖，所以能单测），端口固定记忆在 userData 里（`client-port.json`），这样页面 origin 稳定、`localStorage`（昵称、会话、服务器地址、设置）不会每次启动丢。
- `app/android/`：Capacitor 工程（`www/` = 客户端包，`android/` 是原生工程）。已开 `usesCleartextTraffic`（连 `http://` / `ws://` 的服务器必需）、`hardwareAccelerated`（WebGL）、`noCompress` 媒体扩展名（不二次压缩 330 MB 素材）。
- 重新构建时**先重跑 `tools/build-client-app.mjs`**，再 `npx cap sync android` / 重打 Windows 包；客户端代码或素材变了就必须重打，应用不会自己更新。
- 首次构建要下 Gradle 发行包：`gradle-wrapper.properties` 用官方 `services.gradle.org`；国内网络如果太慢，把 `distributionUrl` 换成镜像（例如 `https://mirrors.cloud.tencent.com/gradle/gradle-8.14.3-all.zip`）即可。两个 `package-lock.json` 里的 `resolved` 一律指向官方 `registry.npmjs.org`，不绑定任何镜像。
- 版权：客户端内置的是官方美术 / 音频（版权归鹰角网络 / Yostar，**仅限个人非商业使用**）；本项目代码为 GPL-3.0-or-later，分发这两个安装包同样适用（见 `NOTICE.md`）。

## 6. 分发与更新

安装包怎么发由你定：丢网盘 / 对象存储 / CDN，或者放进任意静态目录。想省事也可以放一份在自己的 HTTP 服务器上（比如 `public/download/`，已加入 `.gitignore`，不会被打进客户端包），页面上顺手给出每个文件的 SHA-256。

> **「无法安全下载 / 已阻止不安全的下载」**：这是浏览器的混合内容拦截——从 **https** 页面点 **http** 链接下载会被直接拦掉。
> 解决办法：把下载页地址**在新标签页里直接打开**（它本身是 http 页面，同源下载不会被拦）。若 `.exe` / `.apk` 仍被拦，就下同名的 **.zip** 兜底包（`…-Setup.zip` / `…-android.zip`），解压后就是安装程序 / APK。
> 彻底免掉这层提示需要 https 分发（正规证书 + 443/指定端口），或者干脆换网盘 / CDN 分发。

文件清单：

| 文件 | 大小 |
|---|---|
| `StrongholdProtocol-0.1.0-win-x64-Setup.exe` | ~285 MB |
| `StrongholdProtocol-0.1.0-win-x64-portable.zip` | ~385 MB |
| `StrongholdProtocol-0.1.0-android.apk` | ~320 MB |
| `StrongholdProtocol-0.1.0-win-x64-Setup.zip` | ~285 MB（浏览器拦 exe 时的兜底） |
| `StrongholdProtocol-0.1.0-android.zip` | ~320 MB（浏览器拦 apk 时的兜底） |

注意两点：

- 安装包很大（每个 280–390 MB），别放在上行很小的家用/小主机服务器上：一个人下载时其他人的对局会明显变卡，网盘 / 对象存储 / CDN 更合适。
- 每次改完客户端代码或素材，都要**重跑 `tools/build-client-app.mjs` 再打包**（`npm run dist:win` 已经这么串起来了）。踩过的坑：先打了一次包、又用 `--slim` 重新生成客户端包做测试、再打第二次包，结果第二次的安装包里是测试配置（服务器指向 127.0.0.1、没有语音）。打包完请务必核对产物里的注入配置：

```bash
unzip -p app/dist/desktop/StrongholdProtocol-*-portable.zip resources/client/index.html | grep -o 'window.__SP_APP__=[^<]*'
unzip -p app/dist/android/StrongholdProtocol-*-android.apk assets/public/index.html | grep -o 'window.__SP_APP__=[^<]*'
unzip -l app/dist/desktop/StrongholdProtocol-*-portable.zip | grep -c assets/audio/voice/cn/     # 应 ≥ 2040
```

安卓签名：`app/android/keystore/stronghold-release.keystore`（口令在同目录 `password.txt`，**已被 git 忽略，请自行备份**）。丢了这把钥匙，以后的新版本就无法覆盖安装（包名相同、签名不同，安卓会拒绝更新）。重新签名：

```bash
cd app/android
$ANDROID_HOME/build-tools/36.0.0/zipalign -f 4 android/app/build/outputs/apk/release/app-release-unsigned.apk /tmp/a.apk
$ANDROID_HOME/build-tools/36.0.0/apksigner sign --ks keystore/stronghold-release.keystore \
  --ks-pass pass:$(cat keystore/password.txt) --ks-key-alias stronghold \
  --out ../dist/android/StrongholdProtocol-0.1.0-android.apk /tmp/a.apk
```

Windows 两个产物都**未做代码签名**（没有证书），SmartScreen 会提示「未知发布者」。想消除提示需要买一张代码签名证书，再用 electron-builder 的 `CSC_LINK` / `CSC_KEY_PASSWORD` 重打。

## 7. 分辨率自适应（2026-10-03）

安卓客户端可以运行，但一开始没有适配不同机型——实测（打包后的 Electron 壳 + CDP 按机型设视口）发现：**没有元素被裁掉，但 375–440 px 高的手机横屏上底盘占屏高 57–59 %，棋盘只剩 42–48 %**。根因是根字号 `clamp(40px, …)` 的 40 px 地板：40 px 时设计稿高 432 px，比它所在的屏幕还高，于是底盘按桌面尺寸画、棋盘被挤到剩下的空间。

改了三处：

1. `public/css/theme.css`：地板降到 20 px，让拟合公式说话（`min(100vw/19.2, 100svh/10.8)`，上限 240 px 不变）→ 设计稿永远装得进屏幕；
2. `public/css/devices.css`：矮屏（≤460 px 高）下面板与商店栏让出多余留白、商店卡缩 12 %，但每个可点区域保住像素下限（卡片 ≥54 px 宽、确认条 ≥34 px）→ 棋盘从 286×172 变 330×198（面积 +33 %），底盘 0.57 → 0.48；
3. 安卓工程：`AndroidManifest.xml` 加 `screenOrientation="sensorLandscape"`（关闭自动旋转的手机也直接进横屏，不会停在错位的竖屏），`res/values/styles.xml` 加 `windowFullscreen` + `layoutInDisplayCutoutMode=shortEdges` → 状态栏那 24–48 px 还给棋盘，`devices.css` 里本来就写好的安全区（刘海/圆角/手势条）规则才真正生效（index.html 已带 `viewport-fit=cover`）。

棋盘画布复核：`render/app.js` 把 canvas 尺寸精确对齐视口（390×844 / 844×390 / 1024×768 均一致），背板按 `min(devicePixelRatio, 2)` 渲染（DPR 3 的手机用 2×，省 GPU）；旋转与窗口缩放由 `ResizeObserver` + 根字号公式覆盖；竖屏由 `index.html` 的 `.rotate-hint` 提示（触摸设备竖屏才显示）。

复测用的小工具（运行时才有，不在仓库里）：`Emulation.setDeviceMetricsOverride` + `Emulation.setTouchEmulationEnabled` 逐个机型量「棋盘占比 / 底盘占比 / 越界元素」。以后改布局都可以这样验收。

## 8. 分发时的坑

- **防火墙 / 安全组决定客户端能不能用。** 打包版连的是固定地址，云主机的安全组（或本机防火墙）一旦不放行游戏端口，客户端就既下载不到包、也连不上服务器；发新包或约局之前先确认端口是开的。
- **分发通道和游戏端口可以分开。** 例如游戏走 3000、安装包走 80 的静态站点：把文件 `sudo cp` 进站点目录即可，不用改服务器代码。
- **浏览器拦下载**（「无法安全下载」）见 §6：新标签页直接打开下载页；`.apk`/`.exe` 被拦就下同名 `.zip`。

## 9. 服务器侧：只服务客户端（`SP_WEB=0`）

不想再对外提供网页版（网页端每位玩家首次进入都要拉几十 MB 素材，小主机上行扛不住）时，可以让服务器**只做运算**：`SP_WEB=0`（`server/index.js`，默认仍是 `1` = 照常提供网页版）：

- `/ws` 正常（房间 / 回合 / 经济 / 校验），`/healthz` 正常（多返回一个 `web: false` 供监控）；
- `/` 返回一句说明页（提示使用客户端、显示当前地址与在线人数），其余所有路径 404——客户端代码、`data/`、`shared/`、`sim/`、素材、字体一律不再服务；
- 服务器日志里的 `[lobby]` 行为不变；部署时给进程加上这个环境变量即可（`docs/DEPLOY.md` §2.5、README 的环境变量表）。

效果：服务器上行从「每个浏览器首次进入下载几十 MB」变成只剩信令（打包版客户端把素材内置了，见 §1）。测试见 `test/lobby.test.js` 的 `client-only server (SP_WEB=0 / opts.web=false)`。

## 10. 登录页的设置入口与「离线游玩」（2026-10-03）

打包客户端里服务器地址原来只能在对局内的设置里改——如果地址错了，玩家根本进不到那个界面。现在**标题页左下角有「设置」**（`public/js/screens/title.js` `.title-set`，带当前模式标签：离线游玩 / 服务器地址），点开就是同一个设置弹窗（`ui/settings.js`），里面多了两项：

| 项 | 说明 |
|---|---|
| 游玩方式 MODE | **联机**（用下面的服务器地址）/ **离线游玩**（PC 端才有：本机对局，不需要网络）← 切换后自动重载 |
| 服务器地址 SERVER | 仅在联机时显示，填写 `http://主机:端口`（打包版才显示这一行） |

**离线游玩怎么实现的**：Electron 主进程在启动时**自己跑一份游戏服务器**（`runtime/` = `server/` + `shared/` + `data/`，加一个 `{"type":"module"}` 的 package.json；`app/desktop/build-runtime.mjs` 装配），用 `startServer({ port: 0, host: '127.0.0.1', web: false })` 起在随机端口上——服务器本来就在 Node 里运算（房间 / 回合 / 经济 / 校验），客户端把浏览器里的战斗模拟照旧跑，于是**单人 + AI 队友完整可玩，全程不出网**。preload（`app/desktop/preload.js`）把端口以 `window.__SP_LOCAL__ = { server }` 同步交给页面，`public/js/serverConfig.js` 在 `localStorage['sp.offline']` 为真时优先用它（优先级高于构建注入地址与 `?server=`）；浏览器与安卓端没有本机服务器，这一项不显示（`offlineAvailable()`）。

**实测**（Linux 版同一份壳 + CDP 驱动真实点击）：标题页设置入口在左下角 ✓ → 面板出现「游玩方式 MODE（联机/离线游玩）」与「服务器地址」✓ → 切离线并重载后 `serverBase()` = `http://127.0.0.1:45829` ✓ → 填代号点开始 → 会话 `online` → `room.create` 返回 `ok`，房号 `YHTG`，界面进入房间页 ✓（全程由 App 自带服务器完成，未连任何远端）。

单元测试：`test/ui/serverConfig.test.js` 的「离线游玩」4 个用例（本机服务器注入、优先级、切换与存储、浏览器里不可用）。

> 踩过的坑：`tools/build-client-app.mjs` 的 `--out` 原来按仓库根解析，npm script 里传 `../build/client` 就写到了仓库外（`/home/ubuntu/harness/build/client`），打包用的还是旧包 —— 现在按调用方 cwd 解析。
