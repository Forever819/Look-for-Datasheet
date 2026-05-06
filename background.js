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
    // 注入搜索页自动点击, 同时标记下一阶段
    managedTabs.set(tabId, { source: state.source, stage: "detail" });
    const func = state.source === LCSC_MENU_ID ? autoClickLcscSearch : autoClickSemieeSearch;
    chrome.scripting.executeScript({ target: { tabId }, func }).catch(() => {});
  } else if (state.stage === "detail") {
    // 注入产品页自动点击 datasheet
    managedTabs.delete(tabId);
    const func = state.source === LCSC_MENU_ID ? autoClickLcscDetail : autoClickSemieeDetail;
    chrome.scripting.executeScript({ target: { tabId }, func }).catch(() => {});
  }
});

/* ==========================================================================
   以下函数被注入到目标页面中执行 — 不能引用外部变量
   ========================================================================== */

/**
 * @brief semiee 搜索页 — 等待结果加载后自动点击第一条
 */
function autoClickSemieeSearch() {
  const MAX_WAIT = 5000;
  const INTERVAL = 300;
  const start = Date.now();

  function tryClick() {
    const selectors = [
      ".search-list a",
      ".result-item a",
      ".search-result a",
      ".product-item a",
      "table a",
      ".list a"
    ];
    for (const sel of selectors) {
      const link = document.querySelector(sel);
      if (link && link.href && !link.href.includes("javascript")) {
        window.location.href = link.href;
        return;
      }
    }
    if (Date.now() - start < MAX_WAIT) setTimeout(tryClick, INTERVAL);
  }
  setTimeout(tryClick, 800);
}

/**
 * @brief semiee 产品详情页 — 自动点击 datasheet/PDF 链接
 */
function autoClickSemieeDetail() {
  const MAX_WAIT = 5000;
  const INTERVAL = 300;
  const start = Date.now();

  function tryClick() {
    const selectors = [
      "a[href*='.pdf']",
      "a[href*='datasheet']",
      "a[href*='file/']",
      "[class*='datasheet'] a",
      "[class*='pdf'] a",
      ".btn-download a",
      "a[class*='download']"
    ];
    for (const sel of selectors) {
      const link = document.querySelector(sel);
      if (link && link.href && !link.href.includes("javascript")) {
        window.open(link.href, "_blank");
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
        window.open(text, "_blank");
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
          window.open(a.href, "_blank");
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
