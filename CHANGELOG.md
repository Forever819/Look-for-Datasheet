# Changelog

## v1.2.0 (2026-05-07) — semiee 全链路打通

### semiee 自动跳转 PDF 的七次 Debug

semiee 的自动跳转链路调试贯穿了整个开发过程，每步都踩了一个坑：

#### 尝试 1：通用 CSS 选择器 → 失败
最初的 `autoClickSemieeSearch` 用了一堆猜测的通用选择器：
```javascript
".search-list a", ".result-item a", ".search-result a", ...
```
**失败原因**：semiee 搜索结果不使用 `<a>` 标签，而是 `<div class="result-one">` 配合 JS 点击事件。

**修复**：用户 F12 提供了实际 DOM 结构，替换为 `#searchResult .result-one`。

#### 尝试 2：`.result-one` 点击后等待页面跳转 → 失败
点击后通过 `onUpdated` 检测 URL 变化来触发第二阶段脚本。
**失败原因**：URL 完全不变化——semiee 不会跳转到详情页 URL，而是在同一个搜索页内弹窗显示详情（后来发现实际上是在新标签页打开）。

#### 尝试 3：合并为单次注入全链条脚本 → 失败
不再依赖 `onUpdated`，在同一脚本中分两阶段完成搜索→详情→PDF。
**失败原因**：点击 `.result-one` 后确实打开了详情，但详情在**新标签页**（`window.open`），而注入的脚本还跑在旧标签页里，永远等不到 PDF 元素。

#### 尝试 4：改为检测 DOM 而非 URL 变化 → 失败
**失败原因**：同上，详情在新标签页，当前页面的 DOM 里永远不会出现 `.openPDFFile`。

#### 尝试 5：`window.open(url, "_blank")` → 被 Chrome 静默屏蔽
当脚本好不容易找到 `.openFile[data-href]` 并拿到 PDF URL 后，`window.open` 调用被 Chrome 的弹窗拦截器静默丢弃。
**修复**：全部改为 `window.location.href = url` 直接跳转。

#### 尝试 6：拦截 `window.open` 重定向到详情页 → 注入环境隔离
在搜索页脚本中覆盖 `window.open`，让新标签页的 URL 重定向到当前标签页。
**失败原因**：`chrome.scripting.executeScript` 默认运行在 **ISOLATED world**（沙盒 JS 环境），在此环境中覆盖的 `window.open` 只对注入脚本自身可见，**页面的 JS 代码看不到这个覆盖**。

**修复**：设置 `world: "MAIN"` 让脚本与页面 JS 运行在同一环境，拦截才能真正生效。
这是前端开发中 Manifest V3 特有的陷阱——相当于你的代码想在用户态改内核函数，但跑在 ring3 根本没权限。

#### 尝试 7：URL 匹配条件太严格 → 成功！
拦截到 `window.open` 调用后，日志显示：`拦截 window.open: /6587901a-....html`
**失败原因**：URL 是**相对路径**（以 `/` 开头），不包含域名。旧条件 `url.includes("semiee.com")` 匹配不到，直接放行。
**修复**：增加 `url.startsWith("/")` 判断，拼接完整 URL 后重定向。

### 所有已完成功能

- 右键菜单双数据源选择（semiee.com / LCSC）
- LCSC 搜索 → 产品页 → PDF 全自动跳转
- semiee 搜索 → 新标签页拦截 → 详情页 → PDF 全自动跳转
- semiee 详情页 PDF 元素定位（`.openFile[data-href]` / `.openPDFFile` / `.downloadFile a`）
- LCSC 剪贴板拦截捕获 PDF URL
- Chrome 弹窗拦截器绕过（`window.location.href` 替代 `window.open`）

### Debug 方法论总结

| 方法 | 说明 |
|:--|:--|
| F12 Console 日志 | 注入 `console.log`，在目标页面的 DevTools 中观察脚本执行轨迹 |
| 用户提供 DOM HTML | 直接从 F12 Elements 复制实际 DOM 结构，比任何猜测都准 |
| 逐层定位根因 | 不是"semiee 不工作"，而是精确到"`window.open` 被调用了但参数是相对路径" |
| C/嵌入式类比 | 每个前端概念映射到硬件概念，降低理解成本 |

---

## v1.0.0 (2026-05-06) — 初始版本

- Manifest V3 Chrome 扩展基础框架
- 右键菜单：选中文字后显示"查找数据手册"
- semiee.com 搜索页跳转（手动点击搜索结果）
- LCSC 搜索页跳转 + 自动点击第一条产品
- 自动生成 PNG 图标
- Git 仓库初始化
