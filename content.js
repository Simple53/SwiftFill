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
    document.querySelectorAll('iframe').forEach(ifr => {
      try { ifr.contentWindow.postMessage({ action: "rf_fill_all", data: msg.data }, "*"); } catch(e) {}
    });
    reply({ filled: count });
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
  if (window.top !== window || shadowRoot) return;
  const widgetContainer = document.createElement('div');
  widgetContainer.id = 'rf-exam-widget-container';
  widgetContainer.style.cssText = 'position:fixed; top:100px; right:20px; z-index:9999999;';
  document.body.appendChild(widgetContainer);

  shadowRoot = widgetContainer.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = `
    <style>
      #bubble {
        width: 100px; height: 36px; background: #2563eb; color: #fff;
        border-radius: 18px; cursor: move; display: flex; align-items: center; justify-content: center;
        font-size: 13px; font-weight: bold; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        user-select: none; transition: transform 0.2s; border: 2px solid #fff;
      }
      #bubble:hover { transform: scale(1.05); }
      #panel {
        position: absolute; top: 40px; right: 0; width: 220px; background: #fff;
        border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.2);
        display: none; flex-direction: column; overflow: hidden; border: 1px solid #e5e7eb;
      }
      #panel.open { display: flex; }
      .header { padding: 12px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; font-weight: bold; font-size: 12px; }
      .list { max-height: 300px; overflow-y: auto; padding: 8px 0; }
      .item {
        padding: 8px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 2px;
        border-bottom: 1px solid #f3f4f6; position: relative;
      }
      .item:hover { background: #f9fafb; }
      .item label { font-size: 10px; color: #6b7280; }
      .item span { font-size: 12px; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .copy-tip {
        position: absolute; right: 8px; top: 12px; font-size: 10px; color: #059669;
        background: #d1fae5; padding: 2px 6px; border-radius: 4px; opacity: 0; transition: opacity 0.2s;
      }
      .footer { padding: 8px; border-top: 1px solid #e5e7eb; }
      button {
        width: 100%; padding: 8px; background: #2563eb; color: #fff; border: none;
        border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;
      }
      button:hover { background: #1d4ed8; }
    </style>
    <div id="bubble" title="单击展开">✎ 填表神器 <span id="close-bubble" style="margin-left:4px;cursor:pointer;font-weight:normal;" title="隐藏悬浮球">×</span></div>
    <div id="panel">
      <div class="header" style="display:flex; justify-content:space-between">
        <span>📋 个人资料 (点击复制)</span>
        <span id="close-panel" style="cursor:pointer; padding:0 4px" title="收起面板">✖</span>
      </div>
      <div class="list" id="widget-list"></div>
      <div class="footer">
        <button id="widget-do-fill">一键填充当前页</button>
      </div>
    </div>
  `;

  const bubble = shadowRoot.getElementById('bubble');
  const panel = shadowRoot.getElementById('panel');
  let isDragging = false, startX, startY, initialX, initialY;

  bubble.onmousedown = (e) => {
    isDragging = false;
    startX = e.clientX; startY = e.clientY;
    const rect = widgetContainer.getBoundingClientRect();
    initialX = rect.left; initialY = rect.top;

    const move = (me) => {
      if (Math.abs(me.clientX - startX) > 5 || Math.abs(me.clientY - startY) > 5) {
        isDragging = true;
        widgetContainer.style.left = (initialX + (me.clientX - startX)) + 'px';
        widgetContainer.style.top = (initialY + (me.clientY - startY)) + 'px';
        widgetContainer.style.right = 'auto';
      }
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  bubble.onclick = (e) => { 
    if (!isDragging && e.target.id !== 'close-bubble') panel.classList.toggle('open'); 
  };
  
  shadowRoot.getElementById('close-bubble').onclick = (e) => {
    e.stopPropagation();
    widgetContainer.style.display = 'none';
  };

  shadowRoot.getElementById('close-panel').onclick = () => {
    panel.classList.remove('open');
  };

  panel.querySelector('#widget-do-fill').onclick = () => {
    window.postMessage({ action: "rf_fill_all", data: cachedData }, "*");
    const btn = panel.querySelector('#widget-do-fill');
    btn.textContent = `已发送填充指令`;
    setTimeout(() => { btn.textContent = '一键填充当前页'; }, 2000);
  };

  updateWidgetContent();
}

function updateWidgetContent() {
  if (!shadowRoot) return;
  const list = shadowRoot.querySelector('#widget-list');
  const items = [];
  
  // 基础字段预览 (所有字段)
  FIELD_RULES.forEach(rule => {
    const val = cachedData ? getNestedValue(cachedData, rule.path) : '';
    if (val) items.push({ label: rule.label, val: String(val) });
  });

  // 自定义字段预览
  if (cachedData && cachedData.custom) {
    Object.keys(cachedData.custom).forEach(key => {
      items.push({ label: key, val: String(cachedData.custom[key]) });
    });
  }

  list.innerHTML = items.map(item => `
    <div class="item" data-val="${item.val.replace(/"/g, '&quot;')}">
      <label>${item.label}</label>
      <span>${item.val}</span>
      <div class="copy-tip">已复制</div>
    </div>
  `).join('');

  list.querySelectorAll('.item').forEach(el => {
    el.onclick = () => {
      navigator.clipboard.writeText(el.dataset.val).then(() => {
        const tip = el.querySelector('.copy-tip');
        tip.style.opacity = '1';
        setTimeout(() => { tip.style.opacity = '0'; }, 1000);
      });
    };
  });
}

loadConfig().then(createWidget);
