const STORAGE_KEY = 'rf_exam_v3_enc';
const SALT = 'rf-ext-salt-exam';
const WIDGET_MARGIN = 12;
const PANEL_GAP = 10;
const PANEL_FALLBACK_HEIGHT = 320;

let cachedData = null;
let FIELD_RULES = [];
let shadowRoot = null;
let widgetDismissed = false;
let widgetDock = { horizontal: 'right', vertical: 'top' };
let pendingFillData = null;
let fillTimeout = null;
let observedFrames = new WeakSet();

function decryptData(encObj) {
  if (!encObj || !encObj.payload) return null;
  try {
    const dec = atob(encObj.payload);
    let text = '';
    for (let i = 0; i < dec.length; i++) {
      text += String.fromCharCode(dec.charCodeAt(i) ^ SALT.charCodeAt(i % SALT.length));
    }
    return JSON.parse(decodeURIComponent(text));
  } catch (e) {
    return null;
  }
}

async function loadConfig() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (result[STORAGE_KEY]) {
    cachedData = decryptData(JSON.parse(result[STORAGE_KEY]));
  }
  const res = await fetch(chrome.runtime.getURL('fields.json'));
  FIELD_RULES = await res.json();
}

chrome.storage.onChanged.addListener((changes) => {
  if (!changes[STORAGE_KEY]) return;
  loadConfig().then(() => {
    chrome.runtime.sendMessage({ action: 'check_lock' }, (unlocked) => {
      if (unlocked) updateWidgetContent();
    });
  });
});

function getNestedValue(obj, path) {
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), obj);
}

function matchField(el) {
  const labels = [];
  if (el.previousElementSibling) labels.push(el.previousElementSibling.innerText || '');

  let curr = el.parentElement;
  let depth = 0;
  while (curr && curr !== document.body && depth < 3) {
    const inputs = curr.querySelectorAll('input, select, textarea');
    if (inputs.length > 1) break;
    labels.push(curr.innerText || '');
    curr = curr.parentElement;
    depth++;
  }

  const text = labels.join(' ').replace(/\s+/g, ' ');

  for (const rule of FIELD_RULES) {
    if (rule.keys.some((key) => new RegExp(key, 'i').test(text))) return rule.path;
  }

  if (cachedData && cachedData.custom) {
    for (const key of Object.keys(cachedData.custom)) {
      if (text.includes(key)) return `custom.${key}`;
    }
  }

  return null;
}

function fillElement(el, path, data) {
  const val = getNestedValue(data, path);
  if (val === null || val === undefined || val === '') return false;

  if (el.type === 'checkbox' || el.type === 'radio') {
    const boolLike = ['是', '1', 'true', '男', '有'];
    const shouldBeChecked = boolLike.some((flag) => String(val).includes(flag));
    if (el.checked !== shouldBeChecked) {
      el.click();
      el.checked = shouldBeChecked;
    }
    return true;
  }

  el.value = val;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function triggerGlobalFill(data) {
  if (!data) return 0;
  let filled = 0;
  document.querySelectorAll('input, select, textarea').forEach((el) => {
    const path = matchField(el);
    if (path && fillElement(el, path, data)) filled++;
  });
  return filled;
}

function attachFrameLoadListener(frame) {
  if (!frame || observedFrames.has(frame)) return;
  observedFrames.add(frame);
  frame.addEventListener('load', () => {
    if (!cachedData) return;
    scheduleFillForNewIframe(cachedData);
  }, true);
}

function broadcastFillToFrame(frame, data, visited) {
  if (!frame) return;
  attachFrameLoadListener(frame);

  let frameWindow;
  try {
    frameWindow = frame.contentWindow;
  } catch (e) {
    return;
  }

  if (!frameWindow || visited.has(frameWindow)) return;
  visited.add(frameWindow);

  try {
    frameWindow.postMessage({ action: 'rf_fill_all', data }, '*');
  } catch (e) {}

  try {
    frameWindow.document.querySelectorAll('iframe').forEach((childFrame) => {
      broadcastFillToFrame(childFrame, data, visited);
    });
  } catch (e) {}
}

function scanAndBroadcastFrames(data) {
  const visited = new WeakSet();
  visited.add(window);
  document.querySelectorAll('iframe').forEach((frame) => {
    broadcastFillToFrame(frame, data, visited);
  });
}

function fillAllIframes(data, delay = 500) {
  if (!data) return;
  const delays = [0, 120, delay, delay * 2, delay * 3].filter((value, index, arr) => value >= 0 && arr.indexOf(value) === index);
  delays.forEach((timeout) => {
    setTimeout(() => {
      scanAndBroadcastFrames(data);
    }, timeout);
  });
}

function scheduleFillForNewIframe(data) {
  pendingFillData = data;
  if (fillTimeout) clearTimeout(fillTimeout);
  fillTimeout = setTimeout(() => {
    if (!pendingFillData) return;
    fillAllIframes(pendingFillData, 300);
    pendingFillData = null;
  }, 220);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.action === 'fill') {
    const count = triggerGlobalFill(msg.data);
    const container = document.getElementById('rf-exam-widget-container');
    if (container && !widgetDismissed) container.style.display = 'block';
    fillAllIframes(msg.data, 700);
    reply({ filled: count });
    return;
  }

  if (msg.action === 'show_widget') {
    if (widgetDismissed) {
      reply({ status: 'dismissed' });
      return;
    }
    const container = document.getElementById('rf-exam-widget-container');
    if (!container) {
      shadowRoot = null;
      createWidget();
    } else {
      container.style.display = 'block';
      updateWidgetContent();
    }
    reply({ status: 'ok' });
    return;
  }

  if (msg.action === 'unlocked_refresh') {
    if (!widgetDismissed) loadConfig().then(createWidget);
    reply({ status: 'ok' });
  }
});

window.addEventListener('message', (event) => {
  if (!event.data || event.data.action !== 'rf_fill_all') return;
  const fillData = event.data.data || cachedData;
  triggerGlobalFill(fillData);
  fillAllIframes(fillData, 300);
});

const iframeObserver = new MutationObserver((mutations) => {
  let hasNewIframe = false;
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.tagName === 'IFRAME') {
        attachFrameLoadListener(node);
        hasNewIframe = true;
        return;
      }
      if (node.querySelectorAll) {
        const frames = node.querySelectorAll('iframe');
        if (frames.length) {
          frames.forEach((frame) => attachFrameLoadListener(frame));
          hasNewIframe = true;
        }
      }
    });
  });
  if (hasNewIframe && cachedData) scheduleFillForNewIframe(cachedData);
});

function startIframeObservation() {
  document.querySelectorAll('iframe').forEach((frame) => attachFrameLoadListener(frame));
  iframeObserver.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  startIframeObservation();
} else {
  document.addEventListener('DOMContentLoaded', startIframeObservation);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function syncWidgetDock(widgetContainer) {
  const rect = widgetContainer.getBoundingClientRect();
  widgetDock = {
    horizontal: rect.left + rect.width / 2 <= window.innerWidth / 2 ? 'left' : 'right',
    vertical: rect.top + rect.height / 2 <= window.innerHeight / 2 ? 'top' : 'bottom'
  };
}

function snapWidgetToViewport(widgetContainer, animate = false) {
  const rect = widgetContainer.getBoundingClientRect();
  const width = rect.width || widgetContainer.offsetWidth || 40;
  const height = rect.height || widgetContainer.offsetHeight || 40;
  const threshold = 100;

  let left = clamp(rect.left, WIDGET_MARGIN, window.innerWidth - width - WIDGET_MARGIN);
  let top = clamp(rect.top, WIDGET_MARGIN, window.innerHeight - height - WIDGET_MARGIN);

  if (left <= threshold) left = WIDGET_MARGIN;
  else if (window.innerWidth - (left + width) <= threshold) left = window.innerWidth - width - WIDGET_MARGIN;

  if (top <= threshold) top = WIDGET_MARGIN;
  else if (window.innerHeight - (top + height) <= threshold) top = window.innerHeight - height - WIDGET_MARGIN;

  widgetContainer.style.transition = animate ? 'left 0.3s cubic-bezier(0.25,1,0.5,1), top 0.3s cubic-bezier(0.25,1,0.5,1)' : '';
  widgetContainer.style.left = `${left}px`;
  widgetContainer.style.top = `${top}px`;
  widgetContainer.style.right = 'auto';
  widgetContainer.style.bottom = 'auto';
  syncWidgetDock(widgetContainer);

  if (animate) {
    setTimeout(() => {
      widgetContainer.style.transition = '';
    }, 300);
  }
}

function applyPanelPlacement(widgetContainer, panel) {
  panel.style.left = '0';
  panel.style.top = '0';
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';

  const iconRect = widgetContainer.getBoundingClientRect();
  const panelWidth = panel.offsetWidth || 280;
  const panelHeight = panel.offsetHeight || PANEL_FALLBACK_HEIGHT;
  const rightSpace = window.innerWidth - iconRect.right;
  const leftSpace = iconRect.left;
  const bottomSpace = window.innerHeight - iconRect.bottom;
  const topSpace = iconRect.top;

  const openToRight = widgetDock.horizontal === 'left' || (rightSpace >= panelWidth + PANEL_GAP && rightSpace >= leftSpace);
  const openDown = widgetDock.vertical === 'top' || (bottomSpace >= panelHeight + PANEL_GAP && bottomSpace >= topSpace);

  let left = openToRight ? iconRect.width + PANEL_GAP : -(panelWidth + PANEL_GAP);
  let top = openDown ? 0 : iconRect.height - panelHeight;

  const nextLeft = iconRect.left + left;
  const nextTop = iconRect.top + top;
  left += clamp(nextLeft, WIDGET_MARGIN, window.innerWidth - panelWidth - WIDGET_MARGIN) - nextLeft;
  top += clamp(nextTop, WIDGET_MARGIN, window.innerHeight - panelHeight - WIDGET_MARGIN) - nextTop;

  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function hideWidgetForTab(widgetContainer, panel) {
  widgetDismissed = true;
  if (panel) panel.classList.remove('open');
  if (widgetContainer) widgetContainer.style.display = 'none';
}

function createWidget() {
  if (window.top !== window || widgetDismissed) return;

  chrome.runtime.sendMessage({ action: 'check_lock' }, (unlocked) => {
    if (!unlocked) return;

    let widgetContainer = document.getElementById('rf-exam-widget-container');
    if (widgetContainer && shadowRoot) {
      widgetContainer.style.display = 'block';
      snapWidgetToViewport(widgetContainer);
      updateWidgetContent();
      return;
    }

    if (!widgetContainer) {
      widgetContainer = document.createElement('div');
      widgetContainer.id = 'rf-exam-widget-container';
      widgetContainer.style.cssText = `position:fixed; top:100px; left:${Math.max(WIDGET_MARGIN, window.innerWidth - 56)}px; z-index:2147483647;`;
      document.body.appendChild(widgetContainer);
    }

    if (!shadowRoot) {
      shadowRoot = widgetContainer.attachShadow({ mode: 'open' });
    }

    shadowRoot.innerHTML = `
      <style>
        :host {
          --primary: #ed6a2f;
          --primary-soft: #fff2eb;
          --bg: #fffdfa;
          --border: #f1d3c4;
          --text: #30211a;
          --muted: #8c6c60;
        }
        .trigger-icon {
          width: 40px;
          height: 40px;
          background: #ed6a2f;
          color: #fff;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 18px rgba(237,106,47,0.18);
          cursor: move;
          user-select: none;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
          position: relative;
          border: 1px solid #e56128;
        }
        .trigger-icon:hover {
          transform: translateY(-1px);
          box-shadow: 0 12px 22px rgba(237,106,47,0.24);
        }
        .trigger-icon svg {
          width: 21px;
          height: 21px;
          pointer-events: none;
        }
        .hover-close {
          display: none;
          position: absolute;
          top: -6px;
          right: -6px;
          background: #fff;
          color: #8c6c60;
          border-radius: 999px;
          width: 18px;
          height: 18px;
          font-size: 11px;
          line-height: 18px;
          text-align: center;
          cursor: pointer;
          pointer-events: auto;
          border: 1px solid #efd8cb;
          box-shadow: 0 2px 8px rgba(72,38,19,0.12);
        }
        .trigger-icon:hover .hover-close { display: block; }
        .panel {
          width: 280px;
          max-height: 500px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 16px;
          box-shadow: 0 18px 38px rgba(89,45,24,0.14);
          display: none;
          flex-direction: column;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          position: absolute;
        }
        .panel.open { display: flex; }
        .panel-header {
          padding: 12px 16px;
          background: #fff5ef;
          border-bottom: 1px solid var(--border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .panel-header h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--text);
        }
        .close-panel {
          cursor: pointer;
          color: var(--muted);
          font-size: 14px;
          transition: color 0.2s;
        }
        .close-panel:hover { color: #dc5a23; }
        .panel-content {
          padding: 12px;
          overflow-y: auto;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: #fffdfa;
        }
        .panel-content::-webkit-scrollbar { width: 4px; }
        .panel-content::-webkit-scrollbar-thumb {
          background: #ead6cb;
          border-radius: 4px;
        }
        .item {
          padding: 8px 10px;
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 8px;
          cursor: move;
          transition: all 0.2s;
          position: relative;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }
        .item:hover {
          border-color: #eeae8d;
          background: #fff3ec;
        }
        .item label {
          display: block;
          font-size: 10px;
          color: var(--muted);
          pointer-events: none;
          margin-bottom: 2px;
        }
        .item span {
          display: block;
          font-size: 12px;
          color: var(--text);
          pointer-events: none;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .item.dragging {
          opacity: 0.5;
          border: 1px dashed var(--primary);
        }
        .copy-tip {
          position: absolute;
          right: 8px;
          top: 12px;
          font-size: 10px;
          color: #0f8a5b;
          opacity: 0;
          transition: opacity 0.2s;
          background: #dff8ee;
          padding: 2px 6px;
          border-radius: 4px;
          pointer-events: none;
        }
        .panel-footer {
          padding: 10px;
          border-top: 1px solid var(--border);
          background: var(--bg);
        }
        .btn-fill {
          width: 100%;
          padding: 9px 10px;
          background: #ed6a2f;
          color: #fff;
          border: none;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
          box-shadow: 0 10px 18px rgba(237,106,47,0.18);
        }
        .btn-fill:hover {
          transform: translateY(-1px);
          background: #df5e24;
          box-shadow: 0 14px 22px rgba(237,106,47,0.22);
        }
      </style>
      <div class="trigger-icon" id="trigger-icon" title="点击展开，拖动调整">
        <span class="hover-close" id="hover-close" title="关闭">✕</span>
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="5" y="4.5" width="10.5" height="14" rx="2.4"></rect>
          <path d="M8 9h4.5M8 12h4.5M8 15h3"></path>
          <path d="M17 6.5v4M15 8.5h4"></path>
        </svg>
      </div>
      <div class="panel" id="panel">
        <div class="panel-header">
          <h3>填表数据</h3>
          <span class="close-panel" id="close-panel" title="关闭">✕</span>
        </div>
        <div class="panel-content" id="widget-list"></div>
        <div class="panel-footer">
          <button class="btn-fill" id="widget-do-fill">一键智能填充</button>
        </div>
      </div>
    `;

    const icon = shadowRoot.getElementById('trigger-icon');
    const panel = shadowRoot.getElementById('panel');
    const list = shadowRoot.getElementById('widget-list');
    let isDraggingIcon = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;

    snapWidgetToViewport(widgetContainer);

    icon.onmousedown = (e) => {
      if (e.button !== 0) return;
      isDraggingIcon = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = widgetContainer.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;

      const move = (me) => {
        if (Math.abs(me.clientX - startX) > 5 || Math.abs(me.clientY - startY) > 5) {
          isDraggingIcon = true;
          panel.classList.remove('open');
          const newLeft = clamp(initialX + (me.clientX - startX), WIDGET_MARGIN, window.innerWidth - widgetContainer.offsetWidth - WIDGET_MARGIN);
          const newTop = clamp(initialY + (me.clientY - startY), WIDGET_MARGIN, window.innerHeight - widgetContainer.offsetHeight - WIDGET_MARGIN);
          widgetContainer.style.left = `${newLeft}px`;
          widgetContainer.style.top = `${newTop}px`;
          widgetContainer.style.right = 'auto';
          widgetContainer.style.bottom = 'auto';
        }
      };

      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        snapWidgetToViewport(widgetContainer, true);
      };

      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };

    icon.onclick = (e) => {
      if (e.target.id === 'hover-close') return;
      if (!isDraggingIcon) {
        panel.classList.toggle('open');
        if (panel.classList.contains('open')) applyPanelPlacement(widgetContainer, panel);
      }
    };

    shadowRoot.getElementById('hover-close').onclick = (e) => {
      e.stopPropagation();
      hideWidgetForTab(widgetContainer, panel);
    };

    shadowRoot.getElementById('close-panel').onclick = (e) => {
      e.stopPropagation();
      hideWidgetForTab(widgetContainer, panel);
    };

    shadowRoot.getElementById('widget-do-fill').onclick = () => {
      const count = triggerGlobalFill(cachedData);
      fillAllIframes(cachedData, 700);
      alert(`已填充 ${count} 个字段`);
    };

    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      const draggingItem = shadowRoot.querySelector('.dragging');
      const siblings = [...list.querySelectorAll('.item:not(.dragging)')];
      const nextSibling = siblings.find((sibling) => e.clientY <= sibling.getBoundingClientRect().top + sibling.getBoundingClientRect().height / 2);
      list.insertBefore(draggingItem, nextSibling);
    });

    window.addEventListener('resize', () => {
      if (widgetDismissed || !document.body.contains(widgetContainer)) return;
      snapWidgetToViewport(widgetContainer);
      if (panel.classList.contains('open')) applyPanelPlacement(widgetContainer, panel);
    });

    updateWidgetContent();
  });
}

function updateWidgetContent() {
  if (!shadowRoot) return;
  const list = shadowRoot.querySelector('#widget-list');
  if (!list) return;

  const items = [];
  FIELD_RULES.forEach((rule) => {
    const val = cachedData ? getNestedValue(cachedData, rule.path) : '';
    if (val && String(val).trim()) items.push({ label: rule.label || rule.keys[0], val: String(val) });
  });

  if (cachedData && cachedData.custom) {
    Object.keys(cachedData.custom).forEach((key) => {
      const val = cachedData.custom[key];
      if (val && String(val).trim()) items.push({ label: key, val: String(val) });
    });
  }

  list.innerHTML = items.map((item) => `
    <div class="item" draggable="true" data-val="${item.val.replace(/"/g, '&quot;')}">
      <label>${item.label}</label>
      <span>${item.val}</span>
      <div class="copy-tip">已复制</div>
    </div>
  `).join('') || '<div style="text-align:center; color:#999; padding:20px; font-size:12px;">暂无数据，请先在插件弹窗中填写</div>';

  list.querySelectorAll('.item').forEach((el) => {
    el.onclick = () => {
      navigator.clipboard.writeText(el.dataset.val).then(() => {
        const tip = el.querySelector('.copy-tip');
        tip.style.opacity = '1';
        setTimeout(() => {
          tip.style.opacity = '0';
        }, 1000);
      });
    };
    el.addEventListener('dragstart', () => el.classList.add('dragging'));
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  });
}

loadConfig().then(() => {
  chrome.runtime.sendMessage({ action: 'check_lock' }, (unlocked) => {
    if (unlocked) createWidget();
  });
});
