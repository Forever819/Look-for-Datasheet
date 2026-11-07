/**
 * @file background.js
 * @brief 通过右键菜单打开 semiee 或 LCSC 搜索结果页。
 * @details 仅打开搜索页，由用户选择结果，不自动跳转 PDF。
 */

/** @brief 右键菜单及来源标识。 */
const SEMIEE_MENU_ID = "datasheet-semiee";
const LCSC_MENU_ID = "datasheet-lcsc";

/** @brief 搜索地址，末尾追加编码后的关键词。 */
const SEARCH_URLS = {
  [SEMIEE_MENU_ID]: "https://www.semiee.com/search?searchModel=",
  [LCSC_MENU_ID]: "https://so.szlcsc.com/global.html?k="
};

/**
 * @brief 安装或更新时清理旧菜单，再创建两个无父级的来源菜单。
 * @details Chrome 仍可能将同一扩展的多个可见菜单项自动分组。
 * @returns {void}
 */
function createContextMenus() {
  chrome.contextMenus.removeAll(createSourceMenus);
}

/**
 * @brief 旧菜单清理完成后注册两个来源，避免更新后残留父菜单。
 * @returns {void}
 */
function createSourceMenus() {
  chrome.contextMenus.create({
    id: SEMIEE_MENU_ID,
    title: "semiee.com: %s",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: LCSC_MENU_ID,
    title: "LCSC: %s",
    contexts: ["selection"]
  });
}

/**
 * @brief 打开搜索页，后续操作交由用户完成。
 * @param {chrome.contextMenus.OnClickData} info 菜单标识及选中的搜索文本。
 * @returns {void}
 */
function openSearchPage(info) {
  const keyword = info.selectionText?.trim();
  if (!keyword) return;

  if (!Object.hasOwn(SEARCH_URLS, info.menuItemId)) return;
  const base = SEARCH_URLS[info.menuItemId];
  chrome.tabs.create({ url: base + encodeURIComponent(keyword) });
}

chrome.runtime.onInstalled.addListener(createContextMenus);
chrome.contextMenus.onClicked.addListener(openSearchPage);

/**
 * @example
 * // Chrome 安装或更新时创建选中文字的右键菜单。
 * createContextMenus();
 * // createSourceMenus() 由 removeAll 完成回调调用，无需手动重复调用。
 * // 打开 semiee 搜索结果并停留：
 * openSearchPage({ menuItemId: "datasheet-semiee", selectionText: "STM32F103C8T6" });
 * // 打开 LCSC 搜索结果并停留：
 * openSearchPage({ menuItemId: "datasheet-lcsc", selectionText: "EG2124A" });
 */
