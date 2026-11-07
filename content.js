/**
 * @file content.js
 * @brief 在网页选中文字旁显示两个数据手册搜索入口。
 * @details 使用 Shadow DOM 隔离样式；仅在用户点击来源时打开搜索页。
 */
(() => {
  /** @brief 浮动按钮容器、隔离根节点及延迟更新计时器。 */
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "closed" });
  let timer;
  host.style.cssText = "all:initial!important;position:fixed!important;z-index:2147483647!important;display:none!important;";
  root.innerHTML = `
    <style>
      :host { color-scheme: light; }
      nav { display:flex; gap:6px; padding:6px; background:#fff;
        border:1px solid #dbe3ed; border-radius:10px;
        box-shadow:0 4px 18px #172b4d30; font:13px/1.4 system-ui,sans-serif; }
      a { display:block; padding:7px 11px; border-radius:6px; color:#175cd3;
        background:#eff6ff; text-decoration:none; white-space:nowrap; }
      a:hover { background:#dbeafe; }
      a:focus-visible { outline:2px solid #175cd3; outline-offset:1px; }
    </style>
    <nav aria-label="搜索数据手册">
      <a target="_blank" rel="noopener noreferrer" data-base="https://www.semiee.com/search?searchModel=">semiee</a>
      <a target="_blank" rel="noopener noreferrer" data-base="https://so.szlcsc.com/global.html?k=">LCSC</a>
    </nav>`;

  /**
   * @brief 隐藏按钮并取消尚未执行的选区更新。
   * @returns {void}
   */
  function hideToolbar() {
    clearTimeout(timer);
    host.style.setProperty("display", "none", "important");
  }

  /**
   * @brief 判断节点是否位于输入框或可编辑区域，避免干扰输入。
   * @param {Node|null} node 选区中的节点。
   * @returns {boolean} 是否处于编辑区域。
   */
  function isEditable(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return Boolean(element?.closest("input, textarea, select") || element?.isContentEditable);
  }

  /**
   * @brief 过滤包含汉字的选区，更新搜索链接，并将按钮限制在视口内。
   * @returns {void}
   */
  function showToolbar() {
    const selection = window.getSelection();
    const keyword = selection?.toString().trim();
    if (!keyword || /\p{Script=Han}/u.test(keyword) ||
        selection.isCollapsed || !selection.rangeCount ||
        isEditable(selection.anchorNode) || isEditable(selection.focusNode) ||
        isEditable(document.activeElement)) {
      hideToolbar();
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if ((!rect.width && !rect.height) || rect.bottom < 0 || rect.top > innerHeight) {
      hideToolbar();
      return;
    }
    for (const link of root.querySelectorAll("a")) {
      link.href = link.dataset.base + encodeURIComponent(keyword);
    }
    if (!host.isConnected) document.documentElement.append(host);
    host.style.setProperty("display", "block", "important");
    const box = host.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, innerWidth - box.width - 8));
    const top = rect.bottom + box.height + 16 <= innerHeight
      ? rect.bottom + 8 : Math.max(8, rect.top - box.height - 8);
    host.style.setProperty("left", `${left}px`, "important");
    host.style.setProperty("top", `${top}px`, "important");
  }

  /**
   * @brief 合并连续选区事件，支持鼠标及键盘选择文本。
   * @returns {void}
   */
  function scheduleToolbar() {
    clearTimeout(timer);
    timer = setTimeout(showToolbar, 150);
  }

  /**
   * @brief 点击工具条时保留原选区，点击页面其他位置时隐藏。
   * @param {PointerEvent} event 指针按下事件。
   * @returns {void}
   */
  function handlePointerDown(event) {
    if (event.composedPath().includes(host)) {
      event.preventDefault();
    } else {
      hideToolbar();
    }
  }

  /**
   * @brief 使用 Escape 关闭浮动按钮。
   * @param {KeyboardEvent} event 键盘事件。
   * @returns {void}
   */
  function handleKeyDown(event) {
    if (event.key === "Escape") hideToolbar();
  }

  document.addEventListener("selectionchange", scheduleToolbar);
  document.addEventListener("pointerup", scheduleToolbar);
  document.addEventListener("pointerdown", handlePointerDown, true);
  document.addEventListener("keydown", handleKeyDown);
  document.addEventListener("scroll", hideToolbar, true);
  window.addEventListener("resize", hideToolbar);
  window.addEventListener("blur", hideToolbar);

  /**
   * @example
   * // 在网页选中 STM32F103C8T6 后，事件自动调用 scheduleToolbar()。
   * // showToolbar() 根据选中文字生成两个搜索链接，点击任一来源打开搜索页。
   * // 选中 STM32F103C8T6 或 TPS5430 正常显示；选中“芯片”或“STM32芯片”时隐藏。
   * // hideToolbar() 在按 Escape、滚动或点击其他位置时关闭按钮。
   * // isEditable(document.activeElement) 用于排除输入框及可编辑区域。
   * // handlePointerDown(event)、handleKeyDown(event) 由浏览器事件调用。
   */
})();
