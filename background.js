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
      // semiee 可能在同一个页面用 AJAX 加载详情, 合并搜索+详情一键完成
      managedTabs.delete(tabId);
      chrome.scripting.executeScript({ target: { tabId }, func: autoClickSemieeFull }).catch(() => {});
    } else {
      // LCSC 走页面跳转, 搜索页 → 产品页 → PDF 两阶段
      managedTabs.set(tabId, { source: state.source, stage: "detail" });
      chrome.scripting.executeScript({ target: { tabId }, func: autoClickLcscSearch }).catch(() => {});
    }
  } else if (state.stage === "detail") {
    managedTabs.delete(tabId);
    chrome.scripting.executeScript({ target: { tabId }, func: autoClickLcscDetail }).catch(() => {});
  }
});

/* ==========================================================================
   以下函数被注入到目标页面中执行 — 不能引用外部变量
   ========================================================================== */

/**
 * @brief semiee 一站式脚本 — 搜索 → 点击结果 → 打开 PDF
 *
 *         在同一页面内完成全链条 (因为 semiee 可能用 AJAX 加载详情, 不触发 URL 变化)。
 *         分两个阶段:
 *           phase 1: 等待搜索结果, 点击第一个 .result-one
 *           phase 2: 等待详情渲染, 打开 PDF
 */
function autoClickSemieeFull() {
  const MAX_WAIT = 12000;
  const INTERVAL = 300;
  const start = Date.now();
  let phase = 1;

  console.log("[DS] 脚本已注入, 开始等待搜索结果...");

  function tick() {
    const elapsed = Date.now() - start;
    if (elapsed > MAX_WAIT) {
      console.log("[DS] 超时退出, phase=" + phase);
      return;
    }

    if (phase === 1) {
      const item = document.querySelector("#searchResult .result-one");
      if (item) {
        console.log("[DS] 阶段1: 找到 .result-one, 点击");
        item.click();
        phase = 2;
        setTimeout(tick, 800);
        return;
      }
      if (elapsed % 1500 < INTERVAL) {
        console.log("[DS] 阶段1: 等待 #searchResult .result-one...");
      }
    }

    if (phase === 2) {
      // 检查 URL 是否已改变 (可能发生了页面跳转)
      console.log("[DS] 阶段2: 当前 URL=" + window.location.href);

      // 方案1: 点击 PDF 图标
      const pdfIcon = document.querySelector(".openPDFFile");
      if (pdfIcon) {
        console.log("[DS] 阶段2: 找到 .openPDFFile, 点击");
        pdfIcon.click();
        return;
      }

      // 方案2: "打开" 按钮的 data-href
      const openBtn = document.querySelector(".openFile[data-href]");
      if (openBtn) {
        const url = openBtn.getAttribute("data-href");
        console.log("[DS] 阶段2: 找到 .openFile, data-href=" + url);
        if (url) { window.open(url, "_blank"); return; }
      }

      // 方案3: 隐藏的下载链接
      const dl = document.querySelector(".downloadFile a[href]");
      if (dl) {
        const url = dl.getAttribute("href");
        console.log("[DS] 阶段2: 找到 .downloadFile a, href=" + url);
        if (url && !url.includes("javascript")) {
          window.open(url, "_blank"); return;
        }
      }

      // 方案4: AI 对话按钮
      const ai = document.querySelector(".j-ai-chat[data-href]");
      if (ai) {
        const url = ai.getAttribute("data-href");
        console.log("[DS] 阶段2: 找到 .j-ai-chat, data-href=" + url);
        if (url) { window.open(url, "_blank"); return; }
      }

      // 诊断: 输出当前页面关键元素存在情况
      if (elapsed % 2000 < INTERVAL) {
        console.log("[DS] 阶段2: 诊断 - " +
          "hasSearchResult=" + !!document.querySelector("#searchResult") +
          " hasOpenPDFFile=" + !!document.querySelector(".openPDFFile") +
          " hasOpenFile=" + !!document.querySelector(".openFile") +
          " hasDetailsGuige=" + !!document.querySelector(".details-guige"));
      }
    }

    setTimeout(tick, INTERVAL);
  }

  setTimeout(tick, 800);
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
