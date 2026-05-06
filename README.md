# 查找数据手册 — Chrome 扩展

选中网页上的芯片型号 → 右键 → 自动打开 PDF 数据手册。

支持 **semiee.com（半导小芯）** 和 **LCSC（szlcsc.com）** 两个数据源。

---

## 安装与更新

1. Chrome 打开 `chrome://extensions/`
2. 开启右上角**开发者模式**
3. 点击**加载已解压的扩展程序** → 选择本项目目录
4. 更新代码后点击扩展卡片的刷新图标 🔄

## 使用方法

1. 在任意网页选中芯片型号（如 `STM32F103C8T6`、`EG2124A`）
2. 右键 → **查找数据手册**
3. 选择数据源：
   - **semiee.com**：适合中文资料、国产替代查询
   - **LCSC**：适合直接购买、LCSC 商城数据手册
4. 自动跳转到 PDF 数据手册（全过程约 1–3 秒）

---

## 给 C/嵌入式开发者的原理讲解

如果你和我一样主要写 C 驱动 MCU，下面用嵌入式概念类比前端技术。

### 核心概念映射

| Chrome 扩展概念 | C/嵌入式类比 | 说明 |
|:--|:--|:--|
| **Manifest V3** | STM32CubeMX `.ioc` | 声明扩展权限、入口、资源 |
| **Service Worker** | `while(1)` 主循环 | 扩展后台进程，事件驱动，空闲休眠 |
| **Context Menu** | GPIO EXTI 中断 | 用户右键 → 触发回调 |
| **`chrome.tabs.create()`** | FreeRTOS `xTaskCreate()` | 创建新标签页 |
| **`chrome.scripting.executeScript()`** | SWD 烧录一段代码到 RAM 并跳转执行 | 向目标页面注入 JS 函数 |
| **`world: "MAIN"` vs `ISOLATED`** | 用户态 vs 内核态 / ring0 vs ring3 | MAIN 才能拦截页面 JS；ISOLATED 是沙盒，只能自说自话 |
| **DOM** | 寄存器映射表 | `document.querySelector()` ≈ `GPIOA->IDR` |
| **`window.location.href`** | `PC = 0x08001000` | 直接跳转地址，不被弹窗拦截器阻止 |
| **`window.open()`** | 启动第二个核 | 会被 Chrome 拦截，非用户手势静默丢弃 |
| **CSS Selector** | 文件路径 | `#searchResult .result-one` ≈ `/bus/uart1/tx_buffer[0]` |
| **`.click()`** | GPIO 脉冲 | 拉高→拉低，触发目标元素的事件处理器 |
| **`MutationObserver`** | DMA 完成中断 | 监听 DOM 变化 |
| **`managedTabs` Map** | 有限状态机 FSM | 追踪每个标签页处于哪个阶段 |

### 全链路数据流

```
用户选中 "STM32F103C8T6"
         │
         ▼
   右键菜单 (硬件中断)
         │
         ├── semiee ─┬─ 搜索页 (注入脚本, world=MAIN)
         │           │     ├─ 拦截 window.open
         │           │     ├─ 点击 .result-one
         │           │     ├─ 截获详情页 URL
         │           │     └─ 重定向到详情页
         │           │
         │           └─ 详情页 (注入脚本)
         │                 ├─ 找到 .openFile[data-href]
         │                 ├─ 提取 PDF URL
         │                 └─ location.href 跳转
         │
         └── LCSC ─┬─ 搜索页 (注入脚本)
                   │     ├─ 找到 item.szlcsc.com 链接
                   │     └─ location.href 跳转
                   │
                   └─ 产品页 (注入脚本)
                         ├─ 拦截 clipboard.writeText
                         ├─ 点击"数据手册复制"
                         └─ 截获 PDF URL 跳转
```

### ManagedTabs 状态机

```
                    ┌──────────────────────────────┐
                    │     chrome.tabs.onUpdated     │
                    │     status === "complete"      │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │      stage === "search"?     │
                    └──────┬──────────┬──────────┘
                           │          │
                    semiee │          │ LCSC
                           ▼          ▼
              ┌─────────────────┐   ┌──────────────────┐
              │ stage=           │   │ stage="detail"    │
              │ "semiee-detail"  │   │ 注入搜索点击脚本    │
              │ 注入拦截脚本      │   └────────┬─────────┘
              │ (world=MAIN)     │            │
              └────────┬────────┘   ┌────────▼─────────┐
                       │            │ 页面跳转到产品页    │
                       ▼            │ onUpdated 触发     │
              ┌─────────────────┐   │ stage="detail"     │
              │ 拦截 window.open │   │ 注入PDF点击脚本     │
              │ 重定向到详情页    │   │ → delete           │
              │ onUpdated 触发   │   └──────────────────┘
              │ stage=           │
              │ "semiee-detail"  │
              │ 注入PDF点击脚本    │
              │ → delete         │
              └─────────────────┘
```

### 注入脚本的 Isolated World 陷阱

这是整个开发中最大的坑。Manifest V3 的 `chrome.scripting.executeScript` 默认在 **ISOLATED world** 中运行。两个世界有独立的 JavaScript 全局对象：

```
┌──────────────────────────────┐
│         MAIN world           │  ← 页面自身的 JS
│  window.open = [native]      │
│  页面代码调用 window.open()   │
│  走的是这个 world 的函数       │
└──────────────────────────────┘
┌──────────────────────────────┐
│       ISOLATED world         │  ← 注入脚本默认运行在这
│  window.open = ourOverride() │
│  只有我们自己的代码看得见      │
│  页面代码完全感知不到          │
└──────────────────────────────┘
```

类比：你的代码在 ring3 改了"内核函数指针"，但 ring0 的内核根本不用那个表。
**解决方案**：`{ world: "MAIN" }` 让注入脚本直接跑在页面 JS 同一个环境里。

### 文件结构

```
Chorme_Plugin/
├── manifest.json      # 扩展声明: Manifest V3, 权限, 入口
├── background.js      # Service Worker: 菜单, 事件监听, 脚本注入
├── icons/             # PNG 图标 (16/32/48/128)
├── README.md          # 本文档
├── CHANGELOG.md       # 完整开发调试记录
└── .gitignore
```

### 权限说明

| 权限 | 用途 |
|:--|:--|
| `contextMenus` | 创建右键菜单项 |
| `scripting` | 向页面注入自动点击脚本 |
| `https://www.semiee.com/*` | semiee 搜索/详情页 |
| `https://so.szlcsc.com/*` | LCSC 搜索页 |
| `https://item.szlcsc.com/*` | LCSC 产品详情页 |

不读取任何网页内容，不上传任何数据。
