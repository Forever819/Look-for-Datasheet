/**
 * @file   background.js
 * @brief  Chrome Extension Service Worker
 *
 *         选中文字后右键菜单提供两个数据手册搜索选项:
 *         - semiee.com (半导小芯)
 *         - LCSC (szlcsc.com)
 *
 *         打开搜索页后自动注入脚本，逐级自动点击直到 PDF 页。
 */

const PARENT_MENU_ID = "look-for-datasheet";
const SEMIEE_MENU_ID = "datasheet-semiee";
const LCSC_MENU_ID   = "datasheet-lcsc";

const SEARCH_URLS = {
  [SEMIEE_MENU_ID]: "https://www.semiee.com/search?searchModel=",
  [LCSC_MENU_ID]:   "https://so.szlcsc.com/global.html?k="
};

/**
 * 追踪 tab 的自动点击状态
 * stage: 'search' → 注入搜索页自动点击 → stage 变为 'detail'
 * stage: 'detail' → 注入产品页自动点击 → 完成,移除
 */
const managedTabs = new Map();

/* -------------------------------------------------------------------------- */
/*  创建右键菜单                                                               */
/* -------------------------------------------------------------------------- */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: PARENT_MENU_ID,
    title: "查找数据手册",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: SEMIEE_MENU_ID,
    parentId: PARENT_MENU_ID,
    title: "semiee.com: %s",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: LCSC_MENU_ID,
    parentId: PARENT_MENU_ID,
    title: "LCSC: %s",
    contexts: ["selection"]
  });
});

/* -------------------------------------------------------------------------- */
/*  处理菜单点击                                                               */
/* -------------------------------------------------------------------------- */

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const keyword = info.selectionText?.trim();
  if (!keyword) return;

  const base = SEARCH_URLS[info.menuItemId];
  if (!base) return;

  const url = base + encodeURIComponent(keyword);

  chrome.tabs.create({ url }, (newTab) => {
    managedTabs.set(newTab.id, {
      source: info.menuItemId,
      stage: "search"
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  页面加载完成后注入自动点击脚本 (链式: 搜索页 → 产品页 → PDF)                 */
/* -------------------------------------------------------------------------- */

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const state = managedTabs.get(tabId);
  if (!state) return;
  if (changeInfo.status !== "complete") return;

  if (state.stage === "search") {
    if (state.source === SEMIEE_MENU_ID) {
      // semiee: 搜索结果点击后在新标签页打开详情, 先注入搜索页脚本拦截 window.open
      managedTabs.set(tabId, { source: state.source, stage: "semiee-detail" });
      // world: 'MAIN' 确保能拦截页面自己的 window.open 调用
      chrome.scripting.executeScript({ target: { tabId }, func: autoClickSemieeSearch, world: "MAIN" }).catch(() => {});
    } else {
      // LCSC: 页面跳转, 搜索页 → 产品页 → PDF 两阶段
      managedTabs.set(tabId, { source: state.source, stage: "detail" });
      chrome.scripting.executeScript({ target: { tabId }, func: autoClickLcscSearch }).catch(() => {});
    }
  } else if (state.stage === "semiee-detail") {
    // semiee 详情页加载完成, 注入 PDF 查找脚本
    managedTabs.delete(tabId);
    chrome.scripting.executeScript({ target: { tabId }, func: autoClickSemieeDetail }).catch(() => {});
  } else if (state.stage === "detail") {
    managedTabs.delete(tabId);
    chrome.scripting.executeScript({ target: { tabId }, func: autoClickLcscDetail }).catch(() => {});
  }
});

/* ==========================================================================
   以下函数被注入到目标页面中执行 — 不能引用外部变量
   ========================================================================== */

/**
 * @brief semiee 搜索页 — 拦截 window.open 后点击搜索结果, 重定向到详情页
 *
 *         semiee 点击搜索结果会用 window.open 打开新标签页,
 *         拦截此调用并将当前标签页重定向到详情页 URL。
 */
function autoClickSemieeSearch() {
  const MAX_WAIT = 5000;
  const INTERVAL = 300;
  const start = Date.now();

  // 拦截 window.open, 捕获详情页 URL
  const origOpen = window.open;
  window.open = function(url, target, features) {
    console.log("[DS] 拦截 window.open: url=" + url + " target=" + target);
    // 接受任何同站非搜索页的 URL
    if (url && (url.includes("semiee.com") || url.startsWith("/")) && !url.includes("/search")) {
      const fullUrl = url.startsWith("/") ? window.location.origin + url : url;
      console.log("[DS] 重定向到: " + fullUrl);
      window.location.href = fullUrl;
      return null;
    }
    // 未匹配, 放行
    console.log("[DS] 未匹配, 放行原始 window.open");
    return origOpen(url, target, features);
  };

  // 备用: 监听所有 <a target=_blank> 点击, 阻止新标签并重定向
  document.addEventListener("click", function(e) {
    const a = e.target.closest("a");
    if (a && a.target === "_blank" && a.href) {
      console.log("[DS] 拦截 <a target=_blank>: " + a.href);
      if (a.href.includes("semiee.com") && !a.href.includes("/search")) {
        e.preventDefault();
        console.log("[DS] 重定向到: " + a.href);
        window.location.href = a.href;
      }
    }
  }, true);

  console.log("[DS] 已安装拦截器, 等待搜索结果...");

  function tryClick() {
    const item = document.querySelector("#searchResult .result-one");
    if (item) {
      console.log("[DS] 点击第一条搜索结果");
      item.click();
      // 如果 2 秒内没跳转, 还原 window.open 避免影响后续
      setTimeout(() => {
        window.open = origOpen;
        console.log("[DS] 2秒内未跳转, 还原 window.open");
      }, 2000);
      return;
    }
    if (Date.now() - start < MAX_WAIT) setTimeout(tryClick, INTERVAL);
  }
  setTimeout(tryClick, 800);
}

/**
 * @brief semiee 产品详情页 — 自动打开 PDF 数据手册
 *
 *         详情页 DOM 结构:
 *         .openPDFFile           — 点击打开 PDF 的图标
 *         .openFile[data-href]   — "打开"按钮, data-href 是 PDF URL
 *         .downloadFile a[href]  — 隐藏的下载链接
 */
function autoClickSemieeDetail() {
  const MAX_WAIT = 5000;
  const INTERVAL = 300;
  const start = Date.now();

  function tryClick() {
    // 方案1: 点击 PDF 图标
    const pdfIcon = document.querySelector(".openPDFFile");
    if (pdfIcon) {
      console.log("[DS] 详情页: 点击 .openPDFFile");
      pdfIcon.click();
      return;
    }

    // 方案2: 点击 "打开" 按钮 (触发站点 JS 事件)
    const openBtn = document.querySelector(".openFile[data-href]");
    if (openBtn) {
      const url = openBtn.getAttribute("data-href");
      console.log("[DS] 详情页: 点击 .openFile, url=" + url);
      // 尝试直接跳转
      if (url) { window.location.href = url; }
      return;
    }

    // 方案3: 隐藏下载链接
    const dl = document.querySelector(".downloadFile a[href]");
    if (dl) {
      const url = dl.getAttribute("href");
      console.log("[DS] 详情页: .downloadFile a, url=" + url);
      if (url && !url.includes("javascript")) {
        window.location.href = url;
        return;
      }
    }

    if (Date.now() - start < MAX_WAIT) setTimeout(tryClick, INTERVAL);
  }
  setTimeout(tryClick, 800);
}

/**
 * @brief LCSC 搜索页 — 等待结果加载后自动点击第一条产品
 */
function autoClickLcscSearch() {
  const MAX_WAIT = 5000;
  const INTERVAL = 300;
  const start = Date.now();

  function tryClick() {
    const links = document.querySelectorAll("a[href*='item.szlcsc.com']");
    if (links.length > 0) {
      window.location.href = links[0].href;
      return;
    }
    if (Date.now() - start < MAX_WAIT) setTimeout(tryClick, INTERVAL);
  }
  setTimeout(tryClick, 800);
}

/**
 * @brief LCSC 产品详情页 — 自动点击数据手册按钮
 *
 *         拦截剪贴板复制以捕获 PDF URL 并自动打开。
 */
function autoClickLcscDetail() {
  const MAX_WAIT = 5000;
  const INTERVAL = 300;
  const start = Date.now();
  let capturedPdfUrl = null;

  // 拦截 clipboard.writeText, 捕获 PDF URL 后自动打开
  if (navigator.clipboard?.writeText) {
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = function (text) {
      if (text && (text.includes(".pdf") || text.includes("datasheet"))) {
        capturedPdfUrl = text;
        window.location.href = text;
      }
      return orig(text);
    };
  }

  function tryClick() {
    if (capturedPdfUrl) return; // 已捕获, 停止

    // 优先找直接链接
    const links = document.querySelectorAll("a");
    for (const a of links) {
      const text = a.textContent?.toLowerCase() || "";
      if (
        text.includes("数据手册") || text.includes("datasheet") ||
        a.href?.includes(".pdf") || a.href?.includes("datasheet")
      ) {
        if (a.href && !a.href.includes("javascript")) {
          window.location.href = a.href;
          return;
        }
      }
    }

    // 备用: 点击含 datasheet 类名的元素
    const btn = document.querySelector("[class*='datasheet']");
    if (btn) {
      btn.click();
      return;
    }

    // 备用: 查找"数据手册"文本的可点击父元素并点击
    const all = document.querySelectorAll("*");
    for (const el of all) {
      if (el.children.length === 0 && el.textContent?.includes("数据手册")) {
        el.click();
        return;
      }
    }

    if (Date.now() - start < MAX_WAIT) setTimeout(tryClick, INTERVAL);
  }
  setTimeout(tryClick, 800);
}
