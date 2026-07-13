# Minecraft Java 1.12.2 材质资源

本目录保存 WebCraft 使用的 Minecraft Java Edition 1.12.2 原版材质来源和离线生成产物。
浏览器运行时只读取 `generated/`，不会在玩家启动游戏时下载或解析 Mojang 客户端。

## 官方来源与校验

版本：`1.12.2`

- 官方版本清单：`https://piston-meta.mojang.com/mc/game/version_manifest_v2.json`
- 客户端：`https://piston-data.mojang.com/v1/objects/0f275bc1547d01fa5f56ba34bdc87d981ee12daf/client.jar`
- `client.jar` 大小：`10180113` 字节
- `client.jar` SHA-1：`0f275bc1547d01fa5f56ba34bdc87d981ee12daf`
- 本目录 `version.json` SHA-1：`3ef54c4dda2496ffa7146bb8d962b8e0515afcfa`
- 1.12 资源索引 SHA-1：`a21e1ded1a24ea1548dd8db0cf30b6acb02655a9`

PowerShell 校验：

```powershell
Get-FileHash assets/minecraft-1.12.2/client.jar -Algorithm SHA1
Get-FileHash assets/minecraft-1.12.2/version.json -Algorithm SHA1
```

客户端 JAR 中使用的目录被提取到：

```text
extracted/assets/minecraft/textures/
extracted/assets/minecraft/models/
extracted/assets/minecraft/blockstates/
```

## 重新生成

生成器需要 Python 3.11+ 和 Pillow：

```powershell
python -m pip install Pillow
python tools/build_vanilla_texture_pack.py
```

生成器固定读取：

- `assets/minecraft-1.12.2/extracted/assets/minecraft/textures/`
- `assets/minecraft-1.12.2/texture-slots.json`

并写入 `assets/minecraft-1.12.2/generated/`。`texture-slots.json` 的顺序就是现有 512×512 atlas
中的稳定槽位顺序；不得为了贴近原版而重排它，否则已生成区块网格的 UV 会失效。

## 生成产物

| 文件 | 用途 |
| --- | --- |
| `vanilla-atlas-overlay.png` | 512×512 透明覆盖层；方块、物品、皮肤、实体裁片、盔甲和生物群系变体 |
| `texture-map.json` | WebCraft 纹理名到原版源文件或裁切区域的可审计映射 |
| `anim_water.png` | 原版水动画帧条 |
| `anim_lava.png` | 原版岩浆动画帧条 |
| `anim_fire.png` | 原版火焰动画帧条 |
| `anim_nether_portal.png` | 原版下界传送门动画帧条 |
| `animations.json` | 从 `.png.mcmeta` 归一化出的帧数、帧时间和显式帧序列 |
| `vanilla-gui-overlay.png` | widgets、HUD icons、快捷栏、准星、经验条和熔炉指示图 |
| `vanilla-container-atlas.png` | 生存背包、工作台、熔炉和箱子背景 |
| `vanilla-creative.png` | 裁为 195×136 的创造物品栏面板 |
| `vanilla-panorama-strip.png` | 标题界面六张 panorama 水平拼接图 |
| `vanilla-menu-dirt.png` | 选项页面泥土平铺背景 |
| `vanilla-logo.png` | 重组后的 310×44 原版标题 Logo |

当前生成器会把可映射原版内容写进透明 overlay；没有写入的像素保持透明。运行时先生成完整程序
atlas，再叠加 overlay，因此加载失败、源资源缺失或 1.12.2 中不存在的内容都会自然回退，不显示空白。
这一机制保持当前方块/物品 ID、注册名、存档和服务器协议兼容。

## 运行时行为

- `js/textures.js` 异步加载 atlas 覆盖层和动画资源。
- 水、岩浆、火、下界传送门始终更新既有 atlas 槽；`js/renderer.js` 仅用
  `texSubImage2D` 上传变化的 16×16 tile。
- 草地、草侧面、橡树叶和高草为 plains、swamp、desert、snow、mountain、river、ocean、
  beach 预生成染色变体，由 `js/mesher.js` 按 `world.biomeAt(x,z)` 选择。
- `js/ui.js` 优先加载原版 HUD、容器和菜单图；未就绪时仍可使用程序 GUI。
- 调试状态：`Textures.atlas.vanilla === true`、`UI.textureStatus().vanilla === true` 表示对应原版
  资源已经成功加载。

## 实体与模型限制

WebCraft 没有完整复刻 Mojang 1.12.2 的 Java 实体模型渲染器。生成器按 Minecraft ModelBox UV
规则从原版 entity sheet 裁出头、身体、肢体等逐面纹理，并贴到项目现有几何、骨骼动画和碰撞体上。
因此主要颜色、脸部和表面图案来自原版，但以下内容属于兼容性近似：

- 生物几何比例、附件位置和动作继续使用 WebCraft 模型，不保证与 Mojang 模型逐顶点一致。
- 箱子仍使用普通方块几何，顶面、侧面和正面取自原版 chest entity sheet 的近似裁片。
- 床和告示牌使用原版 entity sheet 的代表性裁片，不是完整原版模型展开。
- 远端玩家盔甲从原版 armor layer 提取逐面样本，仍套在当前玩家模型上。
- Steve 和 Alex 使用原版 64×64 skin；miner、wanderer 及原版不存在的项目内容使用程序纹理。
- 1.12.2 不包含 bell、composter、lectern、grindstone、smithing table、smoker 等后续版本方块，
  这些方块继续使用程序生成材质。

如需进一步还原实体，必须另行实现对应生物的原版 ModelBox 尺寸、旋转中心、子部件层级和动画，
不能只继续增加 atlas 裁片。
