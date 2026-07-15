# WebCraft

<img width="2559" height="1198" alt="WebCraft 游戏截图" src="https://github.com/user-attachments/assets/87da819f-27e4-4519-8906-7620d30bfe79" />

在线版演示：https://po.cxs.lat （可多人联机）
友情链接：[linuxdo](https://linux.do/)

## 单机运行

可直接打开 `index.html`。单机世界保存在浏览器本地存储中。

## 单服务器联机

需要 Node.js 18.14 或更高版本：

```powershell
npm install
npm start
```

然后在浏览器打开：

```text
http://localhost:8080
```

点击“多人游戏”，输入 1 至 16 个字符的昵称后即可加入同一世界。昵称保存在当前浏览器中，其他玩家的昵称会显示在角色头顶；重名时服务器会自动追加编号。服务器同时提供网页和 WebSocket，不需要另外配置静态服务器。

“选项 -> 皮肤自定义”可切换 Steve、Alex、矿工或旅行者皮肤，并选择经典或纤细手臂。皮肤第二层、玩家姿态、手持物和已穿盔甲会同步给同服其他玩家。

## 手机版操作

手机或平板建议横屏游玩。进入世界后会自动显示触摸操作层：

- 左侧摇杆移动，右侧空白区域滑动转向。
- “跳”“蹲”“跑”控制跳跃、潜行和疾跑，其中潜行与疾跑为开关。
- “攻击”支持长按破坏方块，“使用”用于放置方块、打开容器、进食、拉弓和格挡。
- 顶部按钮可打开背包、多人聊天和暂停菜单；容器界面右上角的“关闭”返回游戏。
- 直接触摸底部快捷栏可切换手持物品，背包槽位支持触摸拿取和拖放。

在同时支持鼠标和触摸的设备上，游戏会按最近使用的输入方式自动切换操作层与鼠标锁定。

## 自动化测试

```powershell
npm test
npm run test:browser
npm run test:all
```

`test:browser` 使用 Playwright 自动启动临时服务器和无头浏览器，检查浏览器自检、Canvas 绘制、菜单点击、
昵称输入和多人 WebSocket 连接，结束后会关闭服务器并删除临时世界。Windows 会优先使用已安装的 Chrome，
其次使用 Edge；也可通过 `PLAYWRIGHT_CHANNEL=chrome` 或 `PLAYWRIGHT_CHANNEL=msedge` 指定。

Debian 首次运行需要安装 Playwright Chromium 及其系统依赖：

```bash
npm install
npx playwright install --with-deps chromium
npm run test:browser
```

失败截图和 trace 保存在 `test-results/browser/`。

默认配置：

- 端口：`8080`
- 最大玩家数：`15`
- 世界存档：`server/data/world.json`
- 模式：单世界生存模式
- 管理员密码：未配置时启动时随机生成并打印在服务端控制台

可通过环境变量修改：

```powershell
$env:PORT=9000
$env:MAX_PLAYERS=15
$env:ADMIN_PASSWORD="请换成高强度密码"
$env:WHITELIST="玩家甲,玩家乙"
$env:SAVE_DEBOUNCE_MS=1000
npm start
```

联机中按 `T` 打开聊天，按 `/` 直接输入命令，按 `Tab` 查看在线玩家，输入 `/help` 查看命令。
普通玩家可使用：

```text
/list
/status
/seed
/spawn
/setspawn [x y z]
/kill
```

普通玩家不能更改游戏模式。管理员可在游戏中输入：

```text
/auth <权限密码>
```

也可以在服务端控制台输入 `grant <玩家> <权限密码>`。认证后可按权限使用：

```text
/gamemode <survival|creative> [玩家]
/give <玩家> <物品ID|注册名|中文名> [数量]
/item <物品ID|注册名|中文名> [数量]
/tp [玩家] <目标玩家|x y z>
/setspawn [玩家] [x y z]
/heal [玩家]
/feed [玩家]
/kill [玩家]
/clear [玩家] [物品ID|注册名|中文名] [数量]
/kick <玩家> [原因]
/perm <玩家> <user|moderator|admin>
/ban <玩家> [原因]
/pardon <玩家>
/say <消息>
/summon <生物ID> [x y z]
/save
/time <day|night|0..1>
/weather <clear|rain>
/difficulty <peaceful|easy|normal|hard>
```

服务端控制台可直接使用：

```text
help
list
status
seed
save
stop
say <消息>
grant <玩家> <权限密码>
op <玩家> <权限密码>
deop <玩家>
perm <玩家> <user|moderator|admin>
gamemode <玩家> <survival|creative>
give <玩家> <物品ID|注册名|中文名> [数量]
clear <玩家> [物品ID|注册名|中文名] [数量]
kick <玩家> [原因]
ban <玩家> [原因]
pardon <玩家>
tp <玩家> <目标玩家|x y z>
setspawn <玩家> [x y z]
heal <玩家>
feed <玩家>
kill <玩家>
summon <生物ID> <x> <y> <z>
time <day|night|0..1>
weather <clear|rain>
difficulty <peaceful|easy|normal|hard>
whitelist <on|off|list|add|remove> [玩家]
```

服务端保存稳定玩家身份、生存背包、装备、生命、经验、权限、封禁、共享箱子和熔炉，并权威校验多人合成配方。
背包包带有递增修订号，服务端丢弃、拾取、进食、攻击耐久和交易结果不会再被延迟到达的旧背包包覆盖；
按 `Q` 丢出一个物品，按 `Ctrl+Q` 丢出整组，按 `F` 交换主手与副手；生存背包的人物预览右下方提供副手槽，
可直接放入盾牌。背包中左键拖到面板外丢整组，右键拖出丢一个。切换快捷栏或副手会立即同步，
其他玩家可从各个方向看到两只手中的带厚度物品模型；主手持剑或工具时，长按右键可使用副手盾牌格挡。
断线会自动重连并恢复档案；保存前会把上一份世界写入 `server/data/world.backup.json`。

1.12.2 风格村庄按区域与生物群系确定性生成，包含道路、桥梁、农田、住宅、职业建筑、床和工作站。
村民会工作、集合、回家、补货和繁殖，铁傀儡保护村庄，猫在村庄内活动；这些居民及村庄初始化状态会随
单人或服务器世界保存。手持鸡蛋按右键可投掷，联机时由服务端扣除鸡蛋并判定碰撞与幼鸡孵化。

反向代理部署时需要同时转发普通 HTTP 请求和 `/ws` WebSocket 升级请求。使用 HTTPS 时客户端会自动连接同源 `wss://`。

协议 v3 由服务端同步怪物、村庄居民、幼体成长、繁殖、掉落物、经验球、箭矢、鸡蛋、TNT、玩家战斗、多人睡眠、
死亡重生、天气、世界时间、作物、液体、火焰、红石、维度传送和容器。客户端仍负责本地移动手感，
服务端会限制异常移动和交互距离，并对新版客户端校验挖掘开始时间。挖掘时长使用服务端工具与方块结果
作为不可缩短的下限，空中、水下状态由本次开始消息补充，避免状态包延迟造成方块反复回滚。

游戏昼夜为原版式 20 分钟循环。黑曜石框架可激活下界传送门；下界要塞、烈焰人、末影之眼、
主世界要塞、末地传送门、末影龙、返回传送门和龙蛋构成基础生存进度。新增木门、铁门、木/铁活板门、
栅栏门、按钮、压力板、告示牌、雪层、双层半砖以及 0..15 强度红石线路。

战斗采用 1.12.2 风格盾牌格挡，剑不再用于格挡。世界提供白桦原木与树叶方块、兔子和马，以及可铺设的
铁轨与矿车。附魔台、铁砧和酿造台提供对应操作窗口，并新增进度与统计页。

玩家移动、生存和战斗共用 `js/vanilla.js` 中的 1.12.2 参数：20 TPS 重力与阻力、疾跑/潜行倍率、
攻击冷却、锋利加成、护甲韧性、保护附魔、饥饿消耗和生命恢复在单机与联机中使用同一套公式。
服务端地面生物使用带每 tick 搜索和节点预算的局部 A*，并缓存路径；追逐、逃跑、食物引诱、回家和
游荡按目标优先级切换，避免大量生物同时寻路阻塞快照广播。

主世界地形按世界种子确定性生成，包含海洋、河流、山地、气候区、隧道洞穴和裂谷。
切换到 1.12.2 原版材质后，
僵尸、骷髅、苦力怕、蜘蛛、史莱姆、末影人、烈焰人和末影龙会同时切换对应的原版比例模型、分面 UV
和附加层，切回默认材质会恢复默认模型配置。

## 开源许可与原版资源

WebCraft 源代码使用 [MIT License](LICENSE)。公开仓库不包含 Minecraft 客户端 JAR、从客户端提取或生成的材质，
也不包含 Mojang 原版音乐和音效；这些本地文件已写入 `.gitignore`，且不受本项目许可证授权。
未安装这些可选资源时，游戏仍可使用内置材质与程序化音效运行。

如需在本地启用 1.12.2 原版材质，请自行从合法取得的 Minecraft Java 1.12.2 客户端提取
`assets/minecraft/textures`、`assets/minecraft/models` 和 `assets/minecraft/blockstates` 到
`assets/minecraft-1.12.2/extracted/`，然后执行：

```powershell
python -m pip install Pillow
python tools/build_vanilla_texture_pack.py
```

本项目并非 Minecraft 官方产品，也未获得 Mojang Studios 或 Microsoft 的认可或关联。
