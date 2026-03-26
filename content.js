// --- 配置与配置加载 ---
const STORAGE_KEY = 'rf_exam_v3_enc';
const SALT = 'rf-ext-salt-exam';
let cachedData = null;
let FIELD_RULES = [];

// 加密/解密
function decryptData(encObj) {
  if (!encObj || !encObj.payload) return null;
  try {
    const dec = atob(encObj.payload);
    let text = "";
    for(let i = 0; i < dec.length; i++) {
        text += String.fromCharCode(dec.charCodeAt(i) ^ SALT.charCodeAt(i % SALT.length));
    }
    return JSON.parse(decodeURIComponent(text));
  } catch(e) { return null; }
}

async function loadConfig() {
  const r = await chrome.storage.local.get(STORAGE_KEY);
  if (r[STORAGE_KEY]) {
    cachedData = decryptData(JSON.parse(r[STORAGE_KEY]));
  }
  const res = await fetch(chrome.runtime.getURL('fields.json'));
  FIELD_RULES = await res.json();
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEY]) {
    loadConfig().then(() => {
      chrome.runtime.sendMessage({ action: 'check_lock' }, (unlocked) => {
        if (unlocked) updateWidgetContent();
      });
    });
  }
});

// --- 核心填充逻辑 ---
function getNestedValue(obj, path) {
  return path.split('.').reduce((a, k) => a && a[k] !== undefined ? a[k] : null, obj);
}

function matchField(el) {
  const container = el.closest('div, td, li, tr') || document.body;
  const labels = [];
  
  // 1. 找兄弟节点文字
  if (el.previousElementSibling) labels.push(el.previousElementSibling.innerText);
  
  // 2. 向上找容器内的标签文字 (阻断机制：如果发现容器内有多个输入项，则停止向上搜素)
  let curr = el.parentElement;
  let depth = 0;
  while (curr && curr !== document.body && depth < 3) {
    const inputs = curr.querySelectorAll('input, select, textarea');
    if (inputs.length > 1) break; // 发现复合容器，停止寻找标签防止内容重复
    labels.push(curr.innerText);
    curr = curr.parentElement;
    depth++;
  }
  
  const text = labels.join(' ').replace(/\s+/g, ' ');

  // 匹配逻辑
  for (const rule of FIELD_RULES) {
    if (rule.keys.some(k => new RegExp(k, 'i').test(text))) return rule.path;
  }
  // 匹配自定义字段
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
    const shouldBeChecked = String(val).includes('是') || String(val).includes('1') || String(val).includes('男') || String(val).includes('女');
    if (el.checked !== shouldBeChecked) {
      el.click(); // 触发框架事件
      el.checked = shouldBeChecked;
    }
  } else {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
}

function triggerGlobalFill(data) {
  if (!data) return 0;
  let filled = 0;
  document.querySelectorAll('input, select, textarea').forEach(el => {
    const path = matchField(el);
    if (path && fillElement(el, path, data)) filled++;
  });
  return filled;
}

// --- 通信与 Iframe 穿透 ---
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.action === 'fill') {
    const count = triggerGlobalFill(msg.data);
    // 同时也尝试显示悬浮球（如果由于某种原因不可见）
    const container = document.getElementById('rf-exam-widget-container');
    if (container) container.style.display = 'block';
    
    document.querySelectorAll('iframe').forEach(ifr => {
      try { ifr.contentWindow.postMessage({ action: "rf_fill_all", data: msg.data }, "*"); } catch(e) {}
    });
    reply({ filled: count });
  } else if (msg.action === 'show_widget') {
    const container = document.getElementById('rf-exam-widget-container');
    if (!container) {
      // 容器丢失了，重置状态重新创建
      shadowRoot = null; 
      createWidget();
    } else {
      container.style.display = 'block';
      updateWidgetContent();
    }
    reply({ status: 'ok' });
  } else if (msg.action === 'unlocked_refresh') {
    loadConfig().then(createWidget);
    reply({ status: 'ok' });
  }
});

window.addEventListener("message", (event) => {
  if (event.data && event.data.action === "rf_fill_all") {
    triggerGlobalFill(event.data.data || cachedData);
    document.querySelectorAll('iframe').forEach(ifr => {
      try { ifr.contentWindow.postMessage({ action: "rf_fill_all", data: event.data.data || cachedData }, "*"); } catch(e) {}
    });
  }
});

// --- 悬浮球 UI (Shadow DOM) ---
let shadowRoot = null;

function createWidget() {
  // 确保处于顶级窗口且还没有创建（或原容器已丢失）
  if (window.top !== window) return;

  chrome.runtime.sendMessage({ action: 'check_lock' }, (unlocked) => {
    if (!unlocked) return; // 未解锁时不注入或显示数据
    
    let widgetContainer = document.getElementById('rf-exam-widget-container');
    if (widgetContainer && shadowRoot) {
      widgetContainer.style.display = 'block';
      updateWidgetContent();
      return;
    }
  
    if (!widgetContainer) {
      widgetContainer = document.createElement('div');
      widgetContainer.id = 'rf-exam-widget-container';
      widgetContainer.style.cssText = 'position:fixed; top:100px; right:20px; z-index:2147483647;';
      document.body.appendChild(widgetContainer);
    }

    if (!shadowRoot) {
      shadowRoot = widgetContainer.attachShadow({ mode: 'open' });
    }

    shadowRoot.innerHTML = `
      <style>
      :host {
        --primary: #2563eb;
        --bg: #ffffff;
        --border: #e5e7eb;
        --text: #111827;
        --muted: #6b7280;
      }
      
        .trigger-icon {
          width: 48px; height: 48px; background: var(--primary); color: #fff;
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 12px rgba(37,99,235,0.3); cursor: move; user-select: none;
          transition: transform 0.2s; position: relative;
        }
        .trigger-icon:hover { transform: scale(1.05); }
        .trigger-icon svg { width: 24px; height: 24px; pointer-events: none; }
        
        .hover-close {
          display: none; position: absolute; top: -4px; right: -4px;
          background: #dc2626; color: white; border-radius: 50%;
          width: 20px; height: 20px; font-size: 11px; line-height: 20px; text-align: center;
          cursor: pointer; box-shadow: 0 2px 4px rgba(220,38,38,0.3); pointer-events: auto;
        }
        .trigger-icon:hover .hover-close { display: block; }

      .panel {
        width: 280px; max-height: 500px;
        background: var(--bg); border: 1px solid var(--border); border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.15); display: none; flex-direction: column;
        overflow: hidden; font-family: -apple-system, sans-serif;
        margin-top: 8px; position: absolute; right: 0;
      }
      .panel.open { display: flex; }

      .panel-header {
        padding: 12px 16px; background: #f9fafb; border-bottom: 1px solid var(--border);
        display: flex; justify-content: space-between; align-items: center;
      }
      .panel-header h3 { margin: 0; font-size: 14px; font-weight: 600; color: var(--text); }
      .close-panel { cursor: pointer; color: var(--muted); font-size: 14px; transition: color 0.2s;}
      .close-panel:hover { color: #dc2626; }
      
      .panel-content {
        padding: 12px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 8px;
        background: #fafafa;
      }
      .panel-content::-webkit-scrollbar { width: 4px; }
      .panel-content::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }

      .item {
        padding: 8px 10px; background: #ffffff; border: 1px solid var(--border);
        border-radius: 6px; cursor: move; transition: all 0.2s; position: relative;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      }
      .item:hover { border-color: var(--primary); background: #eff6ff; }
      .item label { display: block; font-size: 10px; color: var(--muted); pointer-events: none; margin-bottom: 2px; }
      .item span { display: block; font-size: 12px; color: var(--text); pointer-events: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      
      .item.dragging { opacity: 0.5; border: 1px dashed var(--primary); }

      .copy-tip {
        position: absolute; right: 8px; top: 12px; font-size: 10px; color: #059669;
        opacity: 0; transition: opacity 0.2s; background: #d1fae5; padding: 2px 6px; border-radius: 4px;
        pointer-events: none;
      }

      .panel-footer { padding: 10px; border-top: 1px solid var(--border); background: var(--bg); }
      .btn-fill {
        width: 100%; padding: 8px; background: var(--primary); color: #fff; border: none;
        border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.2s;
      }
      .btn-fill:hover { background: #1d4ed8; }
    </style>

      <div class="trigger-icon" id="trigger-icon" title="点击展开，拖动调整">
        <span class="hover-close" id="hover-close" title="彻底关闭">✖</span>
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
      </div>

    <div class="panel" id="panel">
      <div class="panel-header">
        <h3>📋 填表数据</h3>
        <span class="close-panel" id="close-panel" title="彻底关闭">✖</span>
      </div>
      <div class="panel-content" id="widget-list"></div>
      <div class="panel-footer">
        <button class="btn-fill" id="widget-do-fill">一键智能填充</button>
      </div>
    </div>
  `;

  const icon = shadowRoot.getElementById('trigger-icon');
  const panel = shadowRoot.getElementById('panel');
  let isDraggingIcon = false, startX, startY, initialX, initialY;

  icon.onmousedown = (e) => {
    isDraggingIcon = false;
    startX = e.clientX; startY = e.clientY;
    const rect = widgetContainer.getBoundingClientRect();
    initialX = rect.left; initialY = rect.top;

    const move = (me) => {
      if (Math.abs(me.clientX - startX) > 5 || Math.abs(me.clientY - startY) > 5) {
        isDraggingIcon = true;
        widgetContainer.style.left = (initialX + (me.clientX - startX)) + 'px';
        widgetContainer.style.top = (initialY + (me.clientY - startY)) + 'px';
        widgetContainer.style.right = 'auto';
      }
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      
      // Edge snapping logic
      const rect = widgetContainer.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const snapToLeft = centerX < window.innerWidth / 2;
      
      widgetContainer.style.transition = 'left 0.3s cubic-bezier(0.25, 1, 0.5, 1), right 0.3s cubic-bezier(0.25, 1, 0.5, 1)';
      if (snapToLeft) {
        widgetContainer.style.left = '0px';
      } else {
        widgetContainer.style.left = (window.innerWidth - widgetContainer.offsetWidth) + 'px';
      }
      setTimeout(() => { widgetContainer.style.transition = ''; }, 300);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  icon.onclick = (e) => {
    if (e.target.id === 'hover-close') return;
    if (!isDraggingIcon) panel.classList.toggle('open');
  };

  shadowRoot.getElementById('hover-close').onclick = (e) => {
    e.stopPropagation();
    widgetContainer.style.display = 'none';
  };

  shadowRoot.getElementById('close-panel').onclick = (e) => {
    e.stopPropagation();
    widgetContainer.style.display = 'none';
  };

  shadowRoot.getElementById('widget-do-fill').onclick = () => {
    const count = triggerGlobalFill(cachedData);
    alert(`填充了 ${count} 个字段`);
  };

  // 简单的拖拽排序逻辑
  const list = shadowRoot.getElementById('widget-list');
  list.addEventListener('dragover', e => {
    e.preventDefault();
    const draggingItem = shadowRoot.querySelector('.dragging');
    const siblings = [...list.querySelectorAll('.item:not(.dragging)')];
    const nextSibling = siblings.find(sibling => e.clientY <= sibling.getBoundingClientRect().top + sibling.getBoundingClientRect().height / 2);
    list.insertBefore(draggingItem, nextSibling);
  });

    updateWidgetContent();
  }); // End check_lock
}

function updateWidgetContent() {
  if (!shadowRoot) return;
  const list = shadowRoot.querySelector('#widget-list');
  const items = [];
  
  // 基础字段预览 - 只显示有值的
  FIELD_RULES.forEach(rule => {
    const val = cachedData ? getNestedValue(cachedData, rule.path) : '';
    if (val && String(val).trim()) {
      items.push({ label: rule.label || rule.keys[0], val: String(val) });
    }
  });

  // 自定义字段预览 - 只显示有值的
  if (cachedData && cachedData.custom) {
    Object.keys(cachedData.custom).forEach(key => {
      const val = cachedData.custom[key];
      if (val && String(val).trim()) {
        items.push({ label: key, val: String(val) });
      }
    });
  }

  list.innerHTML = items.map(item => `
    <div class="item" draggable="true" data-val="${item.val.replace(/"/g, '&quot;')}">
      <label>${item.label}</label>
      <span>${item.val}</span>
      <div class="copy-tip">已复制</div>
    </div>
  `).join('') || '<div style="text-align:center; color:#999; padding:20px; font-size:12px;">暂无数据，请在插件菜单中填写</div>';

  list.querySelectorAll('.item').forEach(el => {
    el.onclick = (e) => {
      navigator.clipboard.writeText(el.dataset.val).then(() => {
        const tip = el.querySelector('.copy-tip');
        tip.style.opacity = '1';
        setTimeout(() => { tip.style.opacity = '0'; }, 1000);
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
