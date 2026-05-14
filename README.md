# AI 桌宠 — 凯尔希

一个基于 Electron + Vite + PixiJS 的桌面宠物应用，使用 Spine 骨骼动画和 DeepSeek API 实现 AI 对话。

## 环境要求

- **Node.js** >= 18（https://nodejs.org）
- **DeepSeek API Key**（https://platform.deepseek.com 注册免费获取）

## 安装与运行

```bash
# 1. 进入项目目录
cd desktop-pet

# 2. 安装依赖（首次运行只需一次）
npm install

# 3. 配置 API Key
#    将 .env.example 复制为 .env，填入你的 DeepSeek API Key

# 4. 启动
#    双击 start.vbs，或在终端运行：
npm run dev
```

## 注意事项

- **启动请用 `start.vbs`**，不要用 `start.bat`（.bat 中路径已写死）
- 如果自己构建，`node_modules` 需重新 `npm install`，不要直接复制他人的

---

## 详细说明

### 一、角色性格设定

**设定文件位置：** `desktop-pet/data/character.txt`

该文件包含完整的凯尔希角色设定，包括：

- **人物背景：** 凯尔希是《明日方舟》中罗德岛的实际负责人，前文明的人造生命（代号 Ama-10），制造者为博士和普瑞赛斯
- **性格特征：** 外冷内热、一丝不苟、认真负责、无私无畏、学识渊博。对博士的感情超越爱情，是跨越万年与生死的羁绊
- **外貌描述：** 银发齐肩、猫耳（菲林族）、绿色收腰连衣裙 + 白外套、眼神犀利
- **额外皮肤：** 凯尔希·思衡托（复活后形态）— 长发遮眼、温柔妩媚的气质转变
- **登场角色：** Mon3tr（M3，凯尔希的召唤物，继承记忆后变成黑发菲林少女）、阿米娅、博士、普瑞赛斯等

该文件内容会被程序自动读取，作为 AI 聊天的**系统提示词（System Prompt）**，确保角色的言行符合原作设定。

如需修改性格，直接编辑 `desktop-pet/data/character.txt`，重启应用即可生效。

---

### 二、闲置语音机制

**闲置语音触发间隔：**

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 最短闲置时间 | 300 秒（5 分钟） | 无操作后至少等这么久才开始播放闲置语音 |
| 最长闲置时间 | 600 秒（10 分钟） | 超过这个时间必定会触发一次闲置语音 |
| 实际触发 | 300~600 秒随机值 | 每次触发后重新随机计算下一次间隔 |

闲置语音的触发时间由各模型的 `manifest.json` 控制，可以在对应文件中修改 `idle_timeout_min_seconds` 和 `idle_timeout_max_seconds` 字段。

**闲置动画触发间隔：**
- 角色处于 Relax 待机状态 90~150 秒（1.5~2.5 分钟）后，会自动播放一个随机动画
- 播放完后回到 Relax 状态，循环等待

**触发闲置语音的场景：**
- 鼠标悬停在角色上无操作达到闲置时间
- **双击角色**也会触发一条闲置语音

**禁用闲置语音：**
- 右键菜单 → 点击「闲置语音: 开」可切换开关

**交互反馈（点击角色）：**
- **单击：** 播放 Interact 动画 + 随机点击语音（click_voices）
- **双击：** 播放 Interact 动画 + 随机闲置语音（idle_voices）
- **拖拽：** 移动窗口位置

---

### 三、语音与美术素材路径

#### 素材文件结构

```
ama_01/
├── voice/                     ← 语音源文件（.wav）
│   ├── 1/                    ← 凯尔希 模型1 语音
│   │   ├── 交谈1.wav
│   │   ├── 交谈2.wav
│   │   ├── 交谈3.wav
│   │   ├── 任命助理.wav
│   │   ├── 信赖提升后交谈1~3.wav
│   │   ├── 晋升后交谈1~2.wav
│   │   ├── 周年庆典.wav
│   │   ├── 闲置.wav
│   │   ├── 1_2/              ← 戳一下 / 信赖触摸
│   │   ├── 1_3/              ← 新年祝福（1月1日~1月5日）
│   │   └── 1_4/              ← 生日祝福（1月23日）
│   ├── 2/                    ← 凯尔希 模型2 语音（同上结构 + 2_2, 2_3）
│   ├── 3/                    ← 凯尔希 模型3 语音（同上结构 + 1_2, 1_3）
│   └── 4/                    ← 凯尔希 模型4 语音（同上结构 + 4_2, 4_3）
│
├── art/                      ← Spine 骨骼动画源文件
│   ├── 003_kalts/            ← 凯尔希 模型1
│   ├── 003_kalts_boc#6/      ← 凯尔希·boc#6 模型2
│   ├── 003_kalts_sale#14/    ← 凯尔希·sale#14 模型3
│   └── 003_kalts_2/          ← 凯尔希·思衡托 模型4
│
└── desktop-pet/
    └── public/
        ├── models/           ← 运行时需要的动画资源（与 art/ 内容对应）
        │   ├── 003_kalts/
        │   ├── 003_kalts_2/
        │   ├── 003_kalts_boc6/
        │   └── 003_kalts_sale14/
        └── voices/           ← 语音清单（manifest.json 索引文件）
            ├── 003_kalts/
            ├── 003_kalts_2/
            ├── 003_kalts_boc6/
            └── 003_kalts_sale14/
```

#### 各模型对应关系

| 皮肤 | 模型文件夹 | 动画文件 | 语音编号 | 缩放 |
|------|-----------|---------|---------|------|
| 凯尔希 | `003_kalts` | `build_char_003_kalts.skel` | `voice/1/` | 0.9 |
| 凯尔希·boc#6 | `003_kalts_boc6` | `build_char_003_kalts_boc6.skel` | `voice/2/` | 1.0 |
| 凯尔希·sale#14 | `003_kalts_sale14` | `build_char_003_kalts_sale14.skel` | `voice/3/` | 0.85 |
| 凯尔希·思衡托 | `003_kalts_2` | `build_char_1052_kalts2.skel` | `voice/4/` | 0.85 |

运行时切换皮肤：右键菜单 →「切换」按钮，或点击 `window.__switchModel()`。

#### 动画资源构成

每个模型包含 3 个文件（例如凯尔希）：
- `build_char_003_kalts.skel` — 骨骼数据（Spine 二进制格式）
- `build_char_003_kalts.atlas` — 贴图集索引
- `build_char_003_kalts.png` — 贴图集

#### 语音清单配置

每个模型都有一个 `manifest.json`，位于 `public/voices/{模型名}/manifest.json`。例：

```json
{
  "click_voices": [
    "/voice/1/1_2/戳一下.wav",
    "/voice/1/1_2/信赖触摸.wav"
  ],
  "idle_voices": [
    "/voice/1/交谈1.wav",
    "/voice/1/交谈2.wav",
    ...
  ],
  "idle_timeout_min_seconds": 300,
  "idle_timeout_max_seconds": 600,
  "time_windows": [
    { "name": "新年", "start": "01-01", "end": "01-05",
      "idle_voices": ["/voice/1/1_3/新年祝福.wav"] },
    { "name": "生日", "start": "01-23", "end": "01-23",
      "idle_voices": ["/voice/1/1_4/生日.wav"] }
  ]
}
```

- **click_voices：** 单击角色时随机播放
- **idle_voices：** 闲置超时后随机播放
- **time_windows：** 特定日期范围内额外增加的闲置语音（节日限定）
- **idle_timeout_min/max_seconds：** 闲置语音触发间隔

**修改节日语音日期：** 编辑 `desktop-pet/public/voices/{模型名}/manifest.json`
中的 `time_windows` 数组。格式为 `"MM-DD"`：

```json
"time_windows": [
  { "name": "新年", "start": "01-01", "end": "01-05",
    "idle_voices": ["...新年祝福.wav"] },
  { "name": "生日", "start": "01-23", "end": "01-23",
    "idle_voices": ["...生日.wav"] }
]
```
- 需要改日期：修改对应条目的 `start` 和 `end`
- 想加新节日：复制一组 `{}` 填入新日期和语音文件路径
- 每个模型（4个皮肤）各自有自己的 `manifest.json`，需要逐个修改
- 如果语音文件在子目录（如 `1_3/`），确保路径指向正确的文件

**修改闲置语音等待时间：** 同样在 `manifest.json` 中调整这两个字段：

```json
"idle_timeout_min_seconds": 300,   // 最短闲置时间（秒），默认 5 分钟
"idle_timeout_max_seconds": 600    // 最长闲置时间（秒），默认 10 分钟
```
- 数值单位是秒
- 实际触发时间在 min~max 之间随机
- 如果想 2~5 分钟，就设 `"idle_timeout_min_seconds": 120, "idle_timeout_max_seconds": 300`
- 同样 4 个模型的 `manifest.json` 都要改才会全部生效
- 代码中的后备默认值在 `desktop-pet/src/main.js` 第 80~81 行，如果 manifest 加载失败会使用那里的值

#### 运行时路径映射

- 动画：Vite 开发服务器从 `public/models/` 提供，URL 为 `/models/{dir}/{file}.skel`
- 语音：Vite 自定义中间件从项目根目录 `voice/` 目录提供，URL 为 `/voice/{path}`。路径做了安全防护，防止目录穿越攻击
- API 聊天：调用 DeepSeek API `https://api.deepseek.com/chat/completions`

---

### 四、行走模式

右键菜单可以开启「行走」，角色会在屏幕底部自动活动：

| 行为 | 概率 | 说明 |
|------|------|------|
| 行走 | 35% | 以 40px/s 速度横向移动到随机位置 |
| 发呆 | 25% | 原地 Relax 5~15 秒 |
| 坐下 | 20% | 切换到 Sit 动画，停留 15~30 秒 |
| 睡觉 | 20% | 切换到 Sleep 动画，停留 15~30 秒 |

行走模式下，角色会吸附到屏幕底部（任务栏上方），在屏幕最底端自动来回活动。

#### 行走模式参数调整

行走模式的逻辑在 `desktop-pet/electron/main.js` 中，可调整的参数：

| 参数 | 代码位置（行号） | 默认值 | 说明 |
|------|-----------------|--------|------|
| 行走概率 | ~130 | 35% | `r < 0.35` |
| 发呆概率 | ~132 | 25% | `r < 0.60` |
| 坐下概率 | ~133 | 20% | `r < 0.80` |
| 睡觉概率 | ~134 | 20% | 剩余 |
| 行走速度 | ~173 | 40 px/s | `dist / 40`，数值越大越快 |
| 停留时间 | ~229 | 15~30 秒 | `15000 + Math.random() * 15000`（毫秒） |
| 最小行走距离 | ~171 | 50 px | 低于此值则改为坐下 |
| 移动帧间隔 | ~205 | 50 ms | 每帧更新位置的间隔 |

**修改方法：**
1. 用文本编辑器打开 `desktop-pet/electron/main.js`
2. 找到对应行号调整数值
3. 重启应用生效

例 — 想让角色走得更快（80 px/s）：
```js
// 将第 173 行改为：
const duration = (dist / 80) * 1000;
```

---

### 五、技术说明

- **窗口：** 无边框透明窗口，375×510，默认置顶
- **点击穿透：** 鼠标在角色身上时才响应点击，透明区域自动穿透到桌面
- **托盘图标（悬浮提示 prts）：** 关闭窗口会最小化到系统托盘；左键单击显示窗口，右键菜单可选择「显示」或「退出」
- **聊天：** 右键 →「聊天」打开对话气泡，调用 DeepSeek API 进行流式对话（历史记录保留最近 20 条）
- **快捷键：** F12 打开开发者工具
