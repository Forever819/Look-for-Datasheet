# 查找数据手册 — Chrome 扩展

选中网页上的芯片型号 → 右键 → 自动打开 PDF 数据手册。

支持 **semiee.com（半导小芯）** 和 **LCSC（szlcsc.com）** 两个数据源。

## 给 C/嵌入式开发者的原理讲解

如果你和我一样主要写 C 驱动 MCU，下面用嵌入式概念类比前端技术。

### 整体架构

```
┌──────────────────────────────────────────────────┐
│                  Chrome 扩展                      │
│                                                   │
│  manifest.json     ← 好比 .ioc 配置文件            │
│  background.js     ← 好比 main() 主循环            │
│  (注入的函数)       ← 好比 ISR 中断服务函数          │
└──────────────────────────────────────────────────┘
```

### 核心概念 vs C 类比

| Chrome 扩展概念 | C/嵌入式类比 | 说明 |
|:--|:--|:--|
| **Manifest V3** | STM32CubeMX 生成的配置文件 | 声明扩展需要哪些权限、加载哪些脚本 |
| **Service Worker** | `while(1)` 主循环 | 扩展的后台进程，负责创建菜单、监听事件，空闲时被 Chrome 休眠 |
| **Context Menu** | 硬件中断引脚 | 用户右键 → 触发回调函数（类似 GPIO EXTI 中断） |
| **`chrome.tabs.create()`** | 启动一个新 Task | 创建浏览器新标签页，类似 FreeRTOS `xTaskCreate()` |
| **`chrome.scripting.executeScript()`** | 远程代码注入 | 向目标标签页注入 JS 函数并执行，类似通过 SWD 往 RAM 里写一段代码然后跳转执行 |
| **Content Script** | Bootloader | 注入到网页中运行的代码，可以读取/操作页面的 DOM |
| **DOM** | 寄存器映射表 | 网页的结构化表示，`document.querySelector()` 类似读取 `GPIOA->IDR` |

### 数据流

```
用户在任意网页选中 "STM32F103C8T6"
         │
         ▼
   右键菜单 (硬件中断)
         │
         ├──→ semiee.com 搜索页 ──→ 自动点击第一条结果 ──→ 产品详情页 ──→ 自动点击 PDF 图标
         │
         └──→ LCSC 搜索页 ──→ 自动点击第一条结果 ──→ 产品详情页 ──→ 自动点击"打开"按钮
```

### 自动点击原理

网页本质上是一个 **DOM 树**（类似文件系统目录树）：

```html
<div id="searchResult">           <!-- 搜索结果容器 -->
    <div class="result-one">      <!-- 第一条结果 -->
        <p class="bord">XL4001</p>
    </div>
</div>
```

我们用 **CSS 选择器**（类似文件路径）定位元素：

```javascript
// 等价于 C 中的: GPIOA->ODR |= (1 << 5);  设置某个引脚
document.querySelector("#searchResult .result-one").click();
//                     ↑ 路径/id选择器              ↑ 触发点击事件
```

这条语句做三件事：
1. `querySelector()` — 在 DOM 树中查找匹配的元素（类似查找特定寄存器地址）
2. `.click()` — 触发该元素的点击事件（类似拉高一个 GPIO 然后拉低，产生一个脉冲沿）
3. 网页自身的 JS 事件处理器响应点击，执行页面跳转

### 链式自动跳转的状态机

```
managedTabs: Map<tabId, {source, stage}>

stage = "search"  ──页面加载完成──→ 注入搜索页自动点击脚本
        │                                  │
        │                            .result-one.click()
        │                                  │
        ▼                                  ▼
stage = "detail"  ←──────────────  页面跳转到详情页
        │
        │                  注入详情页自动点击脚本
        │                         │
        │                  .openPDFFile.click()
        │                         │
        ▼                         ▼
   删除追踪记录              PDF 在新标签页打开
```

这就像一个简单的 **有限状态机（FSM）**，用 `managedTabs` Map 跟踪每个标签页处于哪个阶段。

### 文件说明

```
Chorme_Plugin/
├── manifest.json      # 扩展声明: 权限、入口脚本、图标
├── background.js      # Service Worker: 菜单创建、事件监听、脚本注入
├── icons/             # 图标文件 (PNG)
└── .gitignore
```

### 安装与更新

1. Chrome 打开 `chrome://extensions/`
2. 开启 **开发者模式**（右上角开关）
3. **加载已解压的扩展程序** → 选择本项目目录
4. 更新代码后点刷新图标 🔄

### 使用方法

1. 在任意网页选中芯片型号（如 `STM32F103C8T6`）
2. 右键 → **查找数据手册**
3. 选择数据源：**semiee.com** 或 **LCSC**
4. 自动跳转到 PDF 数据手册
