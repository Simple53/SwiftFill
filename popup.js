// --- 加密逻辑 ---
const STORAGE_KEY = 'rf_exam_v3_enc';
const SALT = 'rf-ext-salt-exam';
const FIELDS_URL = 'fields.json';

function encryptData(data) {
  const text = encodeURIComponent(JSON.stringify(data));
  let enc = "";
  for(let i = 0; i < text.length; i++) {
    enc += String.fromCharCode(text.charCodeAt(i) ^ SALT.charCodeAt(i % SALT.length));
  }
  return { payload: btoa(enc) };
}

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

// --- 业务逻辑 ---
let cachedFields = [];
let currentData = {};

async function loadFields() {
  const res = await fetch(FIELDS_URL);
  cachedFields = await res.json();
  return cachedFields;
}

function getInitialData(fields) {
  const data = { custom: {} };
  fields.forEach(f => {
    const parts = f.path.split('.');
    let o = data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!o[parts[i]]) o[parts[i]] = {};
      o = o[parts[i]];
    }
    o[parts[parts.length - 1]] = f.default || '';
  });
  return data;
}

async function getData() {
  return new Promise(resolve => {
    chrome.storage.local.get(STORAGE_KEY, r => {
      if (r[STORAGE_KEY]) {
        resolve(decryptData(JSON.parse(r[STORAGE_KEY])));
      } else {
        resolve(null);
      }
    });
  });
}

async function saveData(data) {
  const encrypted = encryptData(data);
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY]: JSON.stringify(encrypted) }, resolve);
  });
}

function getVal(obj, path) {
  return path.split('.').reduce((a, k) => a && a[k] !== undefined ? a[k] : '', obj);
}

function setVal(obj, path, val) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!o[parts[i]]) o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = val;
}

function renderFields(fields, data) {
  const containers = {
    basic: document.getElementById('tab-basic-grid'),
    contact: document.getElementById('tab-contact-grid'),
    edu: document.getElementById('tab-edu-content'),
    detail: document.getElementById('tab-detail-content'),
    custom: document.getElementById('custom-fields-grid')
  };

  // Clear or prepare containers (edu has multiple grids, keep it simple for now)
  Object.values(containers).forEach(c => { if(c) c.innerHTML = ''; });

  fields.forEach(f => {
    const section = f.path.split('.')[0];
    const container = containers[section] || containers.custom;
    if (!container) return;

    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'field';
    if (f.multiline || (section === 'detail' && !f.grid)) fieldDiv.style.gridColumn = 'span 2';
    
    const value = getVal(data, f.path) || '';
    const inputHtml = f.multiline 
      ? `<textarea data-path="${f.path}" rows="3">${value}</textarea>`
      : `<input type="${f.type || 'text'}" data-path="${f.path}" value="${value}" placeholder="${f.default || ''}">`;

    fieldDiv.innerHTML = `
      <label>${f.label}</label>
      ${inputHtml}
      <span class="copy-tip">已复制</span>
    `;
    container.appendChild(fieldDiv);
  });

  // Render dynamic custom fields
  if (data.custom) {
    Object.keys(data.custom).forEach(key => {
      const fieldDiv = document.createElement('div');
      fieldDiv.className = 'field';
      fieldDiv.innerHTML = `
        <label style="display:flex;justify-content:space-between" title="自定义字段">
          <span>${key}</span>
          <span class="delete-custom" data-key="${key}" style="cursor:pointer;color:var(--red);">删</span>
        </label>
        <input type="text" data-path="custom.${key}" value="${data.custom[key]}">
        <span class="copy-tip">已复制</span>
      `;
      containers.custom.appendChild(fieldDiv);
    });
  }

  bindEvents();
}

function bindEvents() {
  document.querySelectorAll('[data-path]').forEach(el => {
    // Click to copy
    el.onclick = () => {
      if (el.value.trim()) {
        navigator.clipboard.writeText(el.value.trim()).then(() => {
          const tip = el.parentElement.querySelector('.copy-tip');
          if (tip) {
            tip.style.opacity = '1';
            setTimeout(() => tip.style.opacity = '0', 1000);
          }
        });
      }
    };
    // Auto save on input
    el.oninput = () => {
      setVal(currentData, el.dataset.path, el.value);
      saveData(currentData);
      setStatus('自动保存中...', true, false);
    };
  });

  // Delete custom fields
  document.querySelectorAll('.delete-custom').forEach(btn => {
    btn.onclick = () => {
      const k = btn.dataset.key;
      if (confirm(`确定删除自定义字段 "${k}" 吗？`)) {
        delete currentData.custom[k];
        saveData(currentData);
        renderFields(cachedFields, currentData);
      }
    };
  });
}

function setStatus(msg, ok = true, autoHide = true) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
  if (autoHide) {
    setTimeout(() => { el.textContent = '数据已加密存储'; el.style.color = ''; }, 2000);
  }
}

// Init
(async () => {
  const fields = await loadFields();
  const saved = await getData();
  currentData = saved || getInitialData(fields);
  renderFields(fields, currentData);

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.onclick = () => {
      document.querySelectorAll('.tab, .section').forEach(el => el.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    };
  });

  // Actions
  document.getElementById('do-fill').onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'fill', data: currentData }, res => {
        setStatus(res ? `填充成功: ${res.filled} 项` : '页面未就绪', !!res);
        if (res) setTimeout(() => window.close(), 1000);
      });
    });
  };

  document.getElementById('add-custom').onclick = () => {
    const key = prompt('请输入新字段名称（例如：政治面貌代码）:');
    if (key && key.trim()) {
      if (!currentData.custom) currentData.custom = {};
      currentData.custom[key.trim()] = '';
      renderFields(cachedFields, currentData);
    }
  };

  document.getElementById('do-clear').onclick = async () => {
    if (confirm('确认清除所有数据？此操作不可撤销。')) {
      await chrome.storage.local.clear();
      location.reload();
    }
  };

  document.getElementById('do-export').onclick = () => {
    const encrypted = encryptData(currentData);
    const blob = new Blob([JSON.stringify(encrypted, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'exam-data.enc.json'; a.click();
  };

  document.getElementById('do-import-btn').onclick = () => document.getElementById('do-import-file').click();
  document.getElementById('do-import-file').onchange = e => {
    const reader = new FileReader();
    reader.onload = async event => {
      try {
        const parsed = JSON.parse(event.target.result);
        const data = parsed.payload ? decryptData(parsed) : parsed;
        if (!data) throw new Error("解密失败");
        currentData = data;
        await saveData(currentData);
        renderFields(cachedFields, currentData);
        setStatus('导入成功');
      } catch (e) { setStatus('格式错误或解密失败', false); }
    };
    reader.readAsText(e.target.files[0]);
  };
})();
