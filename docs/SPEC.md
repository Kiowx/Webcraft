# WebCraft：浏览器版 Minecraft 克隆架构规范（v4）

目标：实现一个零依赖的单页面 Minecraft 克隆游戏。双击 `index.html` 即可打开，
并兼容 `file://` 协议。项目使用原生 WebGL1 和传统 `<script>` 标签，不使用 ES 模块。
所有资源都在运行时通过程序生成，包括 Canvas 像素画和 WebAudio 合成音频。
用户界面语言为中文。

## 文件结构与加载顺序

以下文件必须按照 `index.html` 中 `<script>` 标签的顺序加载：

```
js/util.js      — 数学、随机数（mulberry32）、AABB 与辅助函数       -> window.U
js/noise.js     — 带种子的值噪声/单纯形噪声与 FBM                  -> window.Noise
js/textures.js  — 程序生成的 16px 纹理图集 [代理维护]              -> window.Textures
js/audio.js     — WebAudio 合成音效与音乐 [代理维护]               -> window.Sound
js/blocks.js    — 方块/物品注册表、配方、掉落物与食物              -> window.Blocks, window.Items
js/gl.js        — WebGL 辅助函数、着色器与 mat4                    -> window.GL
js/world.js     — 区块、世界生成、批量光照与定时任务堆             -> window.World 等
js/mesher.js    — 16 格高分区网格生成（AO、平滑光照）              -> window.Mesher
js/physics.js   — AABB 扫掠碰撞                                   -> window.Physics
js/entities.js  — 实体、空间哈希与复用几何缓冲                     -> window.Entities
js/player.js    — 玩家控制器、生存属性与操作                       -> window.Player
js/renderer.js  — 天空、区块、实体和手持物品的逐帧渲染             -> window.Renderer
js/craft.js     — 配方匹配与熔炉烧炼更新                           -> window.Craft
js/ui.js        — HUD、背包窗口与菜单                              -> window.UI
js/save.js      — IndexedDB 增量存档及旧版兼容回退                 -> window.SaveSys
js/main.js      — 启动、输入、固定步长循环、分区流送与自检
```

每个文件都使用 `'use strict'` IIFE，只挂载一个全局命名空间，不创建其他全局变量。
项目不发起网络请求，不使用 ES 模块语法，也不使用顶层 `await`。

## 坐标与世界常量

- Y 轴向上。世界高度 H=256，海平面高度为 63。区块尺寸为 16×256×16，并拆分为
  16 个高度为 16 格的渲染分区。空的高空分区不生成网格。数组索引公式为
  `x | z<<4 | y<<8`。
- 稀疏状态表保存可朝向方块的水平方向 `0..3`、开关位 `4`、红石强度 `0..15`、流动液体的衰减等级 `1..7`、
  作物生长阶段 `0..7`，以及耕地湿度 `0..7`。
  工作台、熔炉、箱子和床在放置时朝向玩家；普通熔炉与燃烧熔炉互相切换时必须保留状态。
- 高频区块查询使用按 X/Z 分层的数值 Map，字符串键 Map 仅用于遍历和持久化。流送、
  网格与渲染使用一致的圆形半径；离开绘制半径时先释放 GPU 网格，离开 CPU 缓存半径
  后才卸载方块与光照数据。光照传播使用可复用的类型数组队列。
- 方块 ID 使用 Uint8：0 air、1 stone、2 grass、3 dirt、4 cobblestone、5 planks、
  6 sapling、7 bedrock、8 water、9 lava、10 sand、11 gravel、12 gold_ore、
  13 iron_ore、14 coal_ore、15 log、16 leaves、17 glass、18 tallgrass、
  19 flower_red、20 flower_yellow、21 torch、22 crafting_table、23 furnace、
  24 furnace_lit、25 chest、26 tnt、27 bookshelf、28 mossy_cobblestone、
  29 bricks、30 stone_bricks、31 snow（方块）、32 grass_snow、33 sandstone、
  34 spruce_log、35 leaves_spruce、36 cactus、37 glowstone、38 wool、39 bed、
  40 diamond_ore、41 plank_slab、42 stone_slab、43 farmland、44 wheat_crop、
  45 carrot_crop、46 potato_crop、47 fire、48 lapis_ore、49 enchanting_table、
  50 anvil、51 sugar_cane、52 clay、53 obsidian、54 iron_block、55 ladder、
  56 cobweb、57 soul_sand、58 oak_stairs、59 oak_fence、60 lever、
  61 redstone_lamp、62 redstone_lamp_lit、63 oak_door、64 oak_door_top、
  65 oak_trapdoor、66 oak_fence_gate、67 stone_button、68 stone_pressure_plate、
  69 oak_sign、70 snow_layer、71 plank_double_slab、72 stone_double_slab、
  73 redstone_wire、74 redstone_torch、75 redstone_torch_off、76 repeater、
  77 repeater_lit、78 piston、79 piston_head、80 netherrack、81 nether_bricks、
  82 nether_portal、83 end_stone、84 end_portal_frame、85 end_portal、86 brewing_stand、
  87 iron_door、88 iron_door_top、89 iron_trapdoor、90 dragon_egg、91 bell、
  92 composter、93 lectern、94 grindstone、95 smithing_table、96 smoker。
- 河流以连续低地穿过既有生物群系；地下洞穴包含窄长裂谷。煤、铁、金、青金石和钻石必须按
  确定性的椭球矿脉生成，不能退化为互不相邻的逐块散点。
- 河床可生成黏土，水岸可生成甘蔗。甘蔗仅能在邻水的草方块、泥土或沙子上生长，
  失去邻水或底部支撑后必须连锁脱落。
- 水和岩浆在相邻空间被打开后使用定时任务向下及水平传播；流动等级必须随距离衰减，
  源头移除后孤立液体应回退。水接触岩浆源时生成黑曜石，其他水岩浆接触生成圆石，
  并触发声音与粒子反馈。
- 梯子使用水平朝向状态并依附完整方块侧面，支撑移除后脱落；玩家可攀爬且会重置坠落距离。
  蜘蛛网显著限制水平移动和下落速度，灵魂沙使用 14/16 格高碰撞并降低地面移动速度。
- 楼梯使用由上下两个长方体组成的定向碰撞；栅栏按四侧相邻实体方块或栅栏动态增加连接臂。
  木门、铁门、木活板门、铁活板门和栅栏门使用方向位与开关位生成动态碰撞；门的上下两格必须联动放置和拆除。
  木制开合方块可由玩家直接使用，铁制开合方块只能响应红石信号。
  雪层状态 `0..7` 对应 1/8 至 8/8 格高度，同类半砖叠放后转换成双层半砖。
- 红石粉放置为红石线，信号从 15 开始逐格衰减到 0。拉杆、按钮、压力板和红石火把是信号源；
  中继器提供定向满强度输出，红石灯、门、活板门、栅栏门和活塞响应供电状态。按钮和压力板由
  世界定时任务复位，红石设备的递归更新必须合并，不能产生无限回调。
- 物品 ID 从 256 开始：256 stick、257 coal、258 charcoal、259 iron_ingot、
  260 gold_ingot、261 diamond、262 apple、263 porkchop_raw、264 porkchop_cooked、
  265 beef_raw、266 beef_cooked、267 mutton_raw、268 mutton_cooked、
  269 rotten_flesh、270 gunpowder、271 shears、272 flint、273 leather、274 string、
  275 feather、276 bone、277 bone_meal、278 egg、279 wheat_seeds。
  工具 ID 为 280–299：280..284 是 pickaxe_[wood,stone,iron,gold,diamond]，
  285..289 是 axe_*，290..294 是 shovel_*，295..299 是 sword_*，材质顺序相同。
  300..322 依次为 wheat、bread、carrot、potato、baked_potato、chicken_raw、
  chicken_cooked、fish_raw、fish_cooked、golden_apple、paper、book、clay_ball、brick、
  glowstone_dust、lapis、bucket、water_bucket、lava_bucket、flint_steel、bow、arrow、fishing_rod；
  323 为 redstone；324..334 为 ender_pearl、blaze_rod、blaze_powder、eye_of_ender、
  emerald、slime_ball、nether_wart、glass_bottle、water_bottle、awkward_potion、healing_potion。
  340..355 是皮革、金、铁和钻石四套头盔/胸甲/护腿/靴子；360..364 是五种材质的锄。

## 生存物品与成长系统

- 完整昼夜循环为 1200 秒。主世界保留昼夜和天气；下界和末地使用独立天空、雾色、地形与生成表。
  为兼容既有区块存档，下界使用 `x=200000` 附近的坐标分区，末地使用 `x=-200000` 附近的坐标分区。
  下界传送门按黑曜石框架激活并按 8:1 坐标换算；末影之眼可填充要塞传送门框架并开启末地传送门。
- 世界结构包括沙漠水井、完整村庄、地牢、废弃矿井、沙漠神殿、要塞传送门房和下界要塞；
  所有结构及战利品都由世界种子与区域/区块坐标确定性生成。村庄按 128 格区域选址，只允许平原、沙漠和
  雪地候选，并在坡度过大或水面过低时拒绝生成；道路、地基、桥梁和建筑不得依赖区块加载顺序。
- 村庄包含集合钟、道路、农田、小型/大型住宅、图书馆、铁匠铺、屠夫屋和教堂的模板池，按生物群系替换
  墙体、屋顶、原木、地基和道路材料。床是住宅点，堆肥桶、讲台、锻造台、烟熏炉和酿造台是职业点，
  砂轮保留为武器匠职业点。
  村民绑定村庄、床和职业点，白天工作、傍晚集合、夜间回家，交易耗尽后在工作站补货；空床允许生成幼年
  村民。村庄首次加载生成铁傀儡和猫，夜间有低概率发生僵尸围攻。初始化标记与居民元数据必须写入存档。

- 四个独立装备槽保存物品耐久和附魔。盔甲值按装备实时计算，承受生物、爆炸、仙人掌或
  箭矢伤害时提供减伤并消耗耐久；死亡掉落、存档和拾取不得丢失耐久、附魔或自定义名称。
- 锄可将无遮挡的草方块或泥土变为耕地。耕地在四格内有水或下雨时湿度升至 7；小麦、
  胡萝卜和马铃薯在光照充足时从阶段 0 生长到 7。骨粉推进生长，成熟作物按类型掉落农产品。
  草有概率掉落小麦种子，僵尸有低概率掉落胡萝卜或马铃薯。
- 空桶只能收集液体源，水桶和岩浆桶放置新的源并变回空桶。打火石可点燃 TNT 或在实心
  方块上方生火，使用时消耗耐久；火焰通过定时任务熄灭。
- 弓按住使用键蓄力，松开后消耗箭和弓耐久并生成带重力、方块碰撞和生物命中的箭实体。
  鸡蛋按使用键立即消耗一个并生成带重力的投射物；命中方块或实体时破碎，有 1/8 概率孵出幼鸡，
  成功孵化时另有 1/32 概率一次孵出四只。
  箭命中方块后保留为可拾取实体。持剑按住使用键立即进入格挡，近战、箭矢和爆炸伤害减半，
  击退缩小到 35%，移动输入降至 20% 且不能疾跑或挖掘；格挡不消耗剑耐久。
  生物死亡生成会主动飞向附近玩家的经验球。钓鱼竿对水面持续使用可获得生鱼。
  牛、鸡、骷髅和蜘蛛分别提供皮革、羽毛、骨/箭和线。
- 猪、牛、羊和鸡分别被胡萝卜、小麦、小麦和种子吸引。两只成年同类进入繁殖状态后生成
  具有五分钟成长时间的幼体，亲代进入五分钟繁殖冷却；多人模式由服务端验证食物、距离和背包。
- 生物表另外包含史莱姆、末影人、狼、村民、猫、铁傀儡、鱿鱼、蝙蝠和烈焰人。史莱姆死亡后分裂，末影人受击后
  被激怒并可能瞬移，狼可用骨头驯服，村民按职业提供绿宝石交易，铁傀儡保护村民，鱿鱼与蝙蝠分别使用水下和飞行运动，
  烈焰人在下界要塞区域生成并掉落烈焰棒。
- 首次进入末地时生成末影龙，末影龙具有独立飞行动作、200 点生命和 HUD 首领血条。击败后在末地主岛
  生成返回传送门、龙蛋和经验球；击败状态必须写入单人存档与服务器世界存档，不能在重连后重复生成首领。
- 玻璃瓶可从水中装满；水瓶加入下界疣得到粗制药水，再加入萤石粉得到治疗药水。饮用后返还玻璃瓶。
- 食物分别定义饥饿值与饱和度；生鸡肉和腐肉可能给予饥饿效果，金苹果在满饥饿时仍可食用
  并给予短时生命恢复。鸡肉、鱼、马铃薯和黏土球支持熔炉加工。
- 附魔台对手持工具、武器、弓、盔甲或单本书消耗经验等级与青金石，当前支持保护、锋利、
  效率、力量和耐久。铁砧消耗一级经验及对应材料修复手持装备。创造模式背包提供完整物品目录。

## js/textures.js `[代理维护]` 接口约定

传统脚本，通过 `window.Textures` 暴露接口。构建一个 512×512 的 Canvas 图集，
其中包含 16×16 像素的纹理块，整体为 32×32 网格。纹理采用 Minecraft 风格像素画，
必须可确定性生成：使用内部带种子的随机数，不得使用 `Math.random` 或 `Date`。
除 `document.createElement('canvas')` 外不得访问 DOM。

接口：

- `Textures.build()`：幂等构建纹理图集，返回并缓存下述对象。
- `Textures.atlas`：构建后为 `{ canvas, size:512, tile:16 }`。
- `Textures.uv(name)`：返回归一化的 `[u0,v0,u1,v1]`。V 轴沿 Canvas 向下，
  方向转换由渲染器处理。遇到未知名称时只警告一次，并返回品红色回退纹理的 UV。
- `Textures.rect(name)`：返回图集中的像素区域 `[px,py,16,16]`，供 UI 的
  `drawImage` 使用。
- `Textures.names()`：返回所有纹理块名称组成的数组。

以下纹理名称必须精确匹配。

地形与方块：

`grass_top grass_side grass_side_snow dirt stone cobblestone mossy_cobblestone
bedrock sand sandstone_top sandstone_side gravel water lava log_side log_top
spruce_log_side leaves leaves_spruce planks glass coal_ore iron_ore gold_ore
diamond_ore glowstone snow cactus_side cactus_top tallgrass flower_red
flower_yellow sapling torch crafting_table_top crafting_table_side
crafting_table_front furnace_top furnace_side furnace_front furnace_front_lit
bricks stone_bricks bookshelf tnt_side tnt_top tnt_bottom wool_white bed_top
bed_side chest_top chest_side chest_front sun moon crack_0 crack_1 crack_2
crack_3 crack_4 crack_5 crack_6 crack_7 __white`

新增方块与阶段纹理：

`farmland_top wheat_0 wheat_1 wheat_2 wheat_3 carrot_0 carrot_1 carrot_2 carrot_3
potato_0 potato_1 potato_2 potato_3 fire lapis_ore enchanting_table_top
enchanting_table_side anvil_top anvil_side sugar_cane clay obsidian iron_block
bell composter lectern grindstone smithing_table_top smithing_table_side smoker_top smoker_side smoker_front`

`__white` 是 16×16 的纯白不透明纹理，用于带颜色的粒子。

镂空纹理 `tallgrass`、`flower_*`、`sapling`、`torch`、`leaves` 和
`leaves_spruce` 使用 Alpha 为 0 的透明背景。`water` 是约 55% 不透明度的蓝色；
`lava` 不透明并具有发光感；`crack_N` 是透明背景上的黑色裂纹，覆盖率随 N 增长；
`sun` 是透明背景上的黄白色发光方块；`moon` 是透明背景上的浅灰蓝色方块。

物品：

`stick coal charcoal iron_ingot gold_ingot diamond apple porkchop_raw
porkchop_cooked beef_raw beef_cooked mutton_raw mutton_cooked rotten_flesh
gunpowder shears flint leather string feather bone bone_meal egg wheat_seeds wheat bread
carrot potato baked_potato chicken_raw chicken_cooked fish_raw fish_cooked golden_apple paper
book clay_ball brick glowstone_dust lapis_lazuli bucket water_bucket lava_bucket flint_steel bow
arrow fishing_rod`

物品使用透明背景，图案位于纹理中央。

工具使用透明背景和经典 Minecraft 对角线轮廓。工具头颜色按材质区分：
wood 为棕色、stone 为灰色、iron 为银色、gold 为黄色、diamond 为青色；
握柄为木棍棕色。

`pickaxe_wood pickaxe_stone pickaxe_iron pickaxe_gold pickaxe_diamond
axe_wood axe_stone axe_iron axe_gold axe_diamond
shovel_wood shovel_stone shovel_iron shovel_gold shovel_diamond
sword_wood sword_stone sword_iron sword_gold sword_diamond`

锄使用 `hoe_wood hoe_stone hoe_iron hoe_gold hoe_diamond`。盔甲图标使用
`armor_<helmet|chestplate|leggings|boots>_<leather|gold|iron|diamond>`。

玩家皮肤使用原版 64×64 展开规则，分别映射头、帽子、躯干、外套、左右手臂/袖子和
左右腿/裤腿的六个面。内置 `steve`、`alex`、`miner` 和 `wanderer` 四套皮肤；玩家可在
皮肤设置中选择经典 4 像素手臂或纤细 3 像素手臂。第三人称和远端玩家必须绘制 6 个基础肢体盒与
6 个略微膨胀的第二层皮肤盒，第一人称右臂必须复用同一套手臂和袖子 UV，不能继续使用独立的固定手臂贴图。

手持的非方块物品根据其 16×16 Alpha 轮廓生成有厚度的挤出模型。方块物品可通过
`handModel` 和 `handPose` 覆盖默认立方体模型；火把必须使用轮廓挤出模型、靠近底部的握点和
向左上方倾斜的专用姿态，不能渲染成六面完整方块。手臂和物品的 GPU 网格只在切换选中物品时重新上传。

生物皮肤使用完整不透明的 16×16 纹理。`_face` 表示带眼睛的头部正面，
`_side` 表示头部侧面或顶部，`_body` 表示躯干，`_leg` 表示腿部：

`pig_face pig_side pig_body pig_leg
cow_face cow_side cow_body cow_leg
sheep_face sheep_side sheep_body sheep_leg
zombie_face zombie_side zombie_body zombie_leg
creeper_face creeper_side creeper_body creeper_leg
chicken_body chicken_head chicken_beak chicken_leg skeleton spider_body spider_head spider_leg
villager_robe villager_farmer villager_librarian villager_toolsmith villager_butcher villager_cleric
iron_golem iron_golem_face cat cat_face`

猪使用粉色；牛使用棕白斑纹；羊使用奶油色羊毛和棕褐色脸部；僵尸使用绿色皮肤和
深青色衣服；苦力怕使用斑驳绿色和经典的悲伤脸。

详细生物方盒使用 `<kind>_<part>_<front|back|left|right|top|bottom>` 格式的
逐面纹理名称。猪、牛和羊包含口鼻、耳朵、尾巴、角、乳房、羊毛外壳等小型轮廓部件；
这些部件可以在六个面上复用同一个不透明附件纹理。剪羊毛使用物品 271，剪毛状态持续
保存，直到羊吃草后重新长出羊毛。

玩家姿态至少包含站立、行走、疾跑、潜行、跳跃、攻击、格挡、拉弓、进食和使用物品；头部偏航相对
躯干限制在合理范围内。盔甲按头盔、胸甲、护腿和靴子分层套在皮肤外，附魔装备增加独立微膨胀闪光层。
手持模型按方块、剑、工具、弓、食物、火把和普通平面物品使用不同握点与角度。

蜘蛛必须具有头、躯干和八条腿，鱿鱼具有八条触手，烈焰人具有十二根分层旋转棒，史莱姆具有透明外壳、
内核和脸部。村民按职业显示帽子、鼻子和合拢手臂；骷髅持弓，驯服狼显示项圈，苦力怕引信阶段显示膨胀
和充能外层。幼年生物整体约为成年体的 55%，头部保持约 72% 的独立比例，不能把整个成年模型等比缩小。

质量标准：纹理应具有类似 Minecraft 的逐像素噪点和斑纹变化。例如 stone 使用灰色
底色和深色斑点簇；grass_top 使用双色绿色噪点；矿石以 stone 为底并加入彩色矿物簇；
planks 使用带接缝的水平木板；log_top 显示年轮。避免使用纯色平铺纹理。

## js/audio.js `[代理维护]` 接口约定

传统脚本，通过 `window.Sound` 暴露接口。音频采用采样优先的事件系统：默认音色在首次解锁时
生成一次 `AudioBuffer` 并缓存，播放阶段只读取缓存，不在每次点击时实时合成；资源包可用
OGG、WAV 或 MP3 覆盖任一事件。AudioContext 必须延迟到首次调用 `unlock()` 时创建。
如果上下文处于暂停状态，应在解锁时恢复。音频不可用时，所有方法都必须安全返回，不能抛出异常。

接口：

- `Sound.unlock()`：在首次用户操作时调用，创建或恢复音频上下文。
- `Sound.emit(name, options)`：按语义事件播放音效；`options` 可包含 `x/y/z`、`volume`、
  `pitch` 和确定变体用的 `seed`。
- `Sound.play(name, vol=1, pitch=1)`：立即播放 UI 或玩家自身音效。
- `Sound.playAt(name, x, y, z, vol=1, pitch=1)`：播放世界坐标音效，使用 HRTF、反距离
  衰减、遮挡低通和洞穴混响。
- `Sound.setListener(x,y,z, yaw)`：每帧更新监听者位置和朝向。
- `Sound.setMaster(v)`：设置 0..1 的主音量，默认值为 0.7。
- `Sound.setMusicVolume(v)`：设置 0..1 的独立音乐音量，并与主音量相乘。
- `Sound.setMusic(on)`：控制标题菜单、生存、创造、下界和末地分类的间隔稀疏背景音乐。
- `Sound.tick(dt, environment)`：更新雨量、洞穴强度、水下状态、室内外、维度和时间。
- `Sound.preload(names)`：预生成并缓存指定事件；不传参数时预热菜单和容器事件。
- `Sound.prepare(names)`：只下载并解码资源包中的懒加载短音效，不播放声音；首次解锁后应在浏览器空闲时
  逐个预热常见挖掘、被动生物和敌对生物事件，不能在玩家进入听觉范围时集中解码。
- `Sound.loadResourcePack(manifestOrUrl, files)`：加载资源包覆盖，`files` 可为文件名到
  `File` 或 `ArrayBuffer` 的映射。短音效立即解码；`music.*` 长音频只登记来源，并在选中播放时
  惰性下载、解码和缓存，禁止在首次解锁时一次性加载全部 BGM。
- `Sound.describe(name)`：返回事件分类、变体、音高范围和路由，用于调试与测试。

菜单事件必须精确匹配：

`ui.button.click ui.slider.tick ui.slot container.chest.open container.chest.close`

`ui.button.click`、`ui.slider.tick` 和 `ui.slot` 必须使用单变体及固定 1.0 音高，保持居中、
非空间化，并绕过墙体遮挡、水下低通和洞穴混响。按钮只在鼠标或触控松开时仍位于原控件内
才播放；悬停、禁用控件、取消按压和键盘焦点移动均不播放。滑块在按下时播放一次，连续拖动
只更新数值、不重复播放；键盘左右键每次有效离散变化播放一次。菜单“完成”按钮播放一次
`ui.button.click`，Esc 返回静音。箱子开关使用空间化的 `container.chest.open/close`，其他 GUI 静音。

资源包清单示例：

```json
{
  "name": "自定义界面声音",
  "events": {
    "ui.button.click": ["ui/button.wav"],
    "ui.slider.tick": ["ui/slider.wav"],
    "ui.slot": ["ui/slot.wav"],
    "container.chest.open": ["block/chest/open.wav"],
    "container.chest.close": ["block/chest/close.wav"]
  }
}
```

默认加载 `/assets/audio/manifest.json`。菜单按钮、箱子、方块、脚步、实体、玩家、机关和环境音，以及 BGM，优先使用经官方资源索引 SHA-1 校验的 Minecraft Java 1.12.2 OGG。BGM 按 `music.menu`、`music.overworld`、`music.creative`、`music.nether`、`music.end` 分类；世界音效按首次触发惰性解码。没有直接原版对应或加载失败的语义事件回退到程序生成缓冲。服务器允许从 `/assets/` 提供清单和音频文件。

## js/ui.js 界面约定

- UI 使用独立的程序生成 GUI 像素图集，不占用世界纹理图集。图集中至少包含槽位、
  完整的 182×22 快捷栏、快捷栏选中框、完整/半格生命、完整/半格饥饿、护甲、经验条、氧气泡、准星、按钮、
  熔炉火焰和箭头。ASCII 使用内置 5×7 位图字体，中文使用清晰字体回退。
- 以原版 18×18 槽位和 176×166 容器为基础尺寸，支持自动、1x、2x、3x 整数 GUI
  比例并将选择写入 localStorage；
  Canvas 禁用图像平滑，所有目标坐标必须取整。
- HUD 快捷栏使用 182×22 基础尺寸，生命和饥饿图标以 8 像素间距排列。切换手持物品后，
  名称显示约 2 秒并淡出。HUD 还显示经验、护甲、氧气和限时状态效果；低生命与低饥饿
  使用原版式状态动画。背包、工作台、熔炉、箱子和创造物品栏五种容器分别使用独立背景，
  生存背包提供四个装备槽并绘制包含已穿盔甲的可转向立体玩家预览。
- 主菜单使用程序生成的方块世界移动全景和灰色浮雕按钮。暂停与死亡界面的按钮必须与实际点击区域
  共用同一布局函数，不能出现只有外观、无法点击的按钮。
- 标题、世界选择、暂停、选项、视频、控制、声音、语言、资源包和删除确认页面使用屏幕栈管理。
  `Esc` 返回上一级，标题和暂停页作为各自的根页面。所有菜单以居中的 320×240 逻辑坐标布局，
  再按整数 GUI 比例放大；标准按钮为 200×20，双列按钮为 148×20。
- 视野、渲染距离、鼠标灵敏度、主音量和音乐音量使用可拖动滑块；难度、界面尺寸、平滑光照、
  粒子、反转鼠标、原始输入和自动跳跃使用循环按钮。滑块必须支持左右方向键，页面控件支持
  `Tab`、上下方向键、`Enter` 和 `Space`。悬停或聚焦文字变黄，禁用项显示为灰色。
- 中文文字使用不小于 12 像素的字号，以两倍分辨率预渲染后高质量缩小，并为字体度量外侧保留安全边距；
  绘制位置与阴影仍对齐整数像素，不能裁掉偏旁或细笔画。选项子页面使用 32×32 泥土平铺背景；
  不使用圆角卡片或现代过渡动画。
- 背包支持左/右键拿取、`Shift+点击` 快移、数字键与悬停槽交换、双击收集同类物品，
  以及左键拖动平均分配、右键拖动逐格分配。槽位操作提供短促回弹，拾取物品与经验显示提示。
  在面板外松开时左键丢弃整组、右键丢弃一个；多人模式提交来源槽位、物品 ID、数量和
  `inventoryRevision`，由服务端扣除并生成掉落实体。移动结果物品前必须先检查完整容量，避免复制漏洞。
- 触摸设备进入世界后显示独立操作层：左摇杆移动，右侧区域滑动视角，并提供跳跃、潜行、疾跑、
  攻击/长按破坏、放置/使用、背包、聊天和暂停按钮。不同 Pointer ID 必须能同时移动、转向和执行动作，
  松开一根手指不能取消其他手指的持续操作。触摸快捷栏可切换槽位，容器槽位支持触摸拿取与拖放；
  打开容器、聊天、菜单或死亡界面时隐藏世界操作层，并提供不依赖键盘的关闭入口。混合输入设备按最近的
  Pointer 类型切换触摸操作层和鼠标锁定，不能因为设备声明支持触摸就永久禁用桌面控制。

## 跨模块一致性要求

- 网格生成器和渲染器通过 `Textures.uv(name)` 读取纹理；UI 图标通过
  `Textures.rect(name)` 和 `Textures.atlas.canvas` 的 `drawImage` 绘制。
- 每个 `Blocks` 定义都必须包含 `tex`，其中的逐面纹理名称必须与上述列表一致。

## 单服务器多人联机

- `server/server.js` 使用同一个 HTTP 服务提供静态文件和 `/ws` WebSocket 端点。服务器只维护一个世界，
  默认最多 15 名玩家；`PORT`、`HOST`、`MAX_PLAYERS`、`DATA_DIR`、`ADMIN_PASSWORD` 和
  `WHITELIST` 可通过环境变量覆盖。未提供管理员密码时启动进程必须随机生成并只打印到服务端控制台。
- 服务端与客户端复用同一套确定性世界生成器。服务端持有世界种子、玩家档案、实体、容器和稀疏方块改动，
  权威推进液体、作物、火焰、甘蔗、重力方块、天气和时间。方块改动保存在
  `server/data/world.json`，不传输或保存完整未修改区块。
- 新世界在服务器开始监听时立即建立初始存档，后续修改默认按一秒窗口合并写盘；
  `SAVE_DEBOUNCE_MS` 可在 250 至 10000 毫秒范围内覆盖。沼泽群系、沙漠水井、地下地牢和
  生物群系村庄必须保持种子与加载顺序确定性；结构箱子的生成战利品在首次打开时转入服务端容器。
  已初始化村庄集合、村民职业/住宅/工作站/交易次数以及猫和铁傀儡必须随世界实体一起持久化。
- 客户端以 20Hz 上报位置、视角、动作、手持物、皮肤类型和移动状态；服务器以 20Hz 广播可丢弃快照，连接积压时
  不排队旧快照，远端玩家和实体以 30Hz 线性插值并进行最多 100ms 的速度外推。延迟使用应用层
  ping/pong 往返时间计算，不能依赖客户端与服务器的系统时钟差。远端模型复用实体盒模型、世界光照、阴影、完整姿态、皮肤第二层和盔甲。加入服务器前可设置
  1 至 16 个字符的本地持久化昵称；远端玩家头顶绘制随距离淡出的姓名牌，重名由服务器追加编号。
- 本地方块 ID 或方块状态变化按坐标合并后批量发送。服务器校验坐标、方块 ID、批量大小及玩家交互距离，
  并根据原方块、手持工具和模式生成服务端掉落物；接受后向所有客户端广播并延迟写盘。
  未加载区块的改动必须等该区块生成时再应用。
- 新版客户端开始挖掘时发送目标、快捷栏、手持物和本次按本地环境计算的总时长。服务器始终按权威方块与
  背包计算最低时长，客户端时长只能保持或延长该结果，不能缩短；空中和水下倍率不得从开始消息之前的
  旧 20Hz 移动状态推断。服务器通过 `mine_state` 返回确认、完成或明确拒绝原因，并按应用层 RTT 的一半
  提供有限宽限。合法的持续挖掘必须一次完成，拒绝时必须立即回传权威方块，不能要求玩家反复重挖。
- 联机默认且普通玩家固定为生存模式。生命、饥饿、经验、背包、装备、出生点、死亡掉落和重生写入
  服务器玩家档案；客户端提交的模式字段不能改变服务端模式。服务端同步怪物、村庄居民、掉落物、经验球、箭矢、鸡蛋、TNT、
  玩家 PvP、伤害、击退和 0.5 秒受伤无敌帧，客户端只插值显示远端实体。近战使用玩家视点到实体
  包围盒的距离，并允许受限的 RTT 位置回溯，不能用方块中心偏移判定实体攻击距离。
- 背包档案带递增 `inventoryRevision`。丢弃、拾取、合成、交易、投掷鸡蛋、耐久消耗和进食均由服务端校验当前修订号、
  快捷栏与物品类型后原子更新；旧档案包只能降低饥饿值，不能伪造进食恢复，也不能覆盖已经确认的背包。
  切换快捷栏使用即时动作包广播。快照中的装备摘要至少包含物品 ID 与是否附魔；远端玩家的方块手持模型
  使用立方体，剑、工具、弓、食物和火把使用分类姿态，其他物品使用双面带厚度模型。
- 格挡使用独立于攻击动作的持续状态。开始和结束格挡通过即时动作包提交，并继续包含在 20Hz 状态快照中纠错；
  服务端校验当前快捷栏确实持剑后再进行减伤。远端玩家必须平滑显示抬剑、放剑、持剑模型及 block-hit 动作。
- 箱子和熔炉槽位由服务端保存并带递增版本号。多人并发提交旧版本时，服务端拒绝操作、回传权威容器和
  玩家背包，客户端清除悬空鼠标物品，不能通过同时拿取复制物品。熔炉燃烧和烧炼由服务端更新。
- 工作台和背包内的合成格属于客户端临时槽位，但发送档案时必须将其中物品合并到背包守恒快照；
  每次取出合成结果时客户端发送完整合成格，服务端必须使用共享配方表重新匹配、扣除原料并发放结果，
  不能信任客户端声明的成品；
  合成界面打开期间，旧档案回包不得覆盖本地背包、装备或鼠标物品。关闭界面后客户端发送带递增事务号的
  最终档案，服务端必须原样回传事务号，客户端只在匹配确认后解除覆盖保护。
- 浏览器生成并持久化随机身份令牌，服务端仅保存令牌哈希；重连后恢复同一档案。连接包含心跳、延迟、
  指数退避自动重连和异常移动限制。世界保存前保留 `world.backup.json`，封禁和权限随世界持久化。
- `T` 打开聊天，`/` 打开命令输入，`Tab` 显示在线玩家、延迟与权限组。`/auth <密码>` 或服务端控制台
  `grant <玩家> <密码>` 授予管理员；管理员具有自身/目标游戏模式、封禁、权限组、给予目标物品、
  获取任意物品、时间、天气和难度管理权限。`user`、`moderator`、`admin` 三组权限由服务端判定。
- 多人睡眠由服务端校验床、交互距离、夜晚和附近敌对生物；所有存活的生存玩家均入睡后才跳到清晨并清除降雨。
  所有音效触发都只能使用上述音效名称；映射允许在脚步声中复用 `dig_*`。
  遇到未知名称时必须发出警告，不能使游戏崩溃。
- v3 存档使用名为 `webcraft_v2` 的 IndexedDB 数据库。元数据和 RLE 压缩区块保存在
  不同的对象仓库中；每次只重写脏区块，并为每个区块保存校验和。v1 localStorage
  存档槽继续作为兼容回退方案。加载旧 96 格高区块时按 RLE 解码长度识别旧格式，
  再扩展到 256 格，不能因新元数据覆盖而误判旧区块高度。IndexedDB 区块记录应保持
  RLE 压缩状态，直到区块第一次进入流送范围时才校验并解压。
- 世界与实体模拟以固定 20 TPS 推进，玩家控制器和碰撞以固定 60 TPS 推进，渲染使用
  玩家前后状态插值。准星、方块和实体射线必须从最后一帧显示的插值相机位置发出。
  世界和实体的伪随机数状态、天气、方块状态会写入存档，确保读档后可以延续确定性的
  游戏随机序列。
- 运行时分区重建必须通过 `Mesher.meshSectionRuntime` 复用 TypedArray 暂存缓冲，上传完成前不得再次调用；
  独立测试或需要长期保存结果时继续使用 `meshSection`。方块碎屑只增加粒子渲染版本，不能使实体几何失效。
  粒子使用专用 GPU 缓冲并按 20 TPS 状态及量化相机朝向更新；实体缓存键不得依赖世界网格脏版本。
  所有生物、玩家第二层和盔甲盒模型应在进入游戏前预热，避免首次接近实体时创建 UV 与大型几何缓冲。
- 暂停菜单提供鼠标灵敏度、反转 Y 轴和原始鼠标输入设置。原始输入不可用时应回退到
  普通指针锁定；yaw 保持在 `[-π, π]`，pitch 限制在接近 `[-π/2, π/2]` 的范围内。
- 设置保存在 `localStorage`，至少包含 FOV、渲染距离、难度、主音量、音乐音量、平滑光照、皮肤预设、手臂模型、
  粒子等级、自动跳跃、鼠标灵敏度、反转 Y 轴和原始输入。设置修改后立即应用；平滑光照变化
  会使已加载区块重新生成网格，和平难度会停止敌对生物生成并移除现有敌怪。
- 战斗包含 0.5 秒受伤无敌帧、下落暴击和冲刺击退。敌对生物追踪必须通过视线检测；
  失去视线后使用有节点上限的局部路径搜索，游荡生物应避开悬崖和液体。
- 生存模式方块交互距离为 4.5 格，创造模式为 5 格，近战实体距离为 3 格。实体射线不得
  穿过更近的方块；冲刺命中后重置本次冲刺击退，非剑工具攻击消耗 2 点耐久。
- 第一人称攻击与挖掘使用平方和平方根正弦组合的挥动曲线，进食包含抬手与咀嚼阶段，
  切换物品包含装备下沉。走路视角摇晃保持关闭，但受击可使用短促镜头倾斜。
- 挖掘过程中按命中面生成少量方块碎屑，普通命中、暴击、入水、雨滴落地和液体凝固
  均提供独立反馈；雨雪粒子在无天空光的位置不得穿过屋顶显示。
- 自检地址为 `index.html?selftest=1`。它运行适合无界面环境的世界生成、光照、网格、
  物理、合成和存档往返测试，将 PASS/FAIL 结果写入 `#selftest-log`，并将
  `document.title` 设置为 `SELFTEST PASS` 或 `SELFTEST FAIL`。
- `npm run test:gameplay` 运行不依赖浏览器的核心玩法测试；`npm test` 同时运行核心玩法和
  单服务器联机集成测试。`npm run test:browser` 使用 Playwright 自行启动临时服务器与无头浏览器，
  验证自检页面、Canvas 菜单和多人连接；`npm run test:all` 依次运行 Node 与浏览器测试。
