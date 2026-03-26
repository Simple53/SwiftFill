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
          <span class="delete-custom" data-key="${key}" style="cursor:pointer;color:var(--red);" title="移除此字段">✖</span>
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
    el.oninput = async () => {
      setVal(currentData, el.dataset.path, el.value);
      await saveData(currentData);
      setStatus('保存成功', true, true);
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
  const overlay = document.getElementById('lock-overlay');
  const unlockBtn = document.getElementById('unlock-btn');

  const checkLock = async () => {
    const session = await chrome.storage.session.get('unlocked');
    if (session.unlocked) {
      overlay.style.display = 'none';
      return true;
    }
    return false;
  };

  const requestUnlock = async () => {
    try {
      // 检查设备是否支持身份验证（如 Windows Hello）
      const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!available) {
        // 如果硬件不支持，回退到普通确认（或者您可以根据需要改为密码）
        if (confirm('您的设备不支持生物识别，是否确认解锁并查看隐私数据？')) {
          await chrome.storage.session.set({ unlocked: true });
          overlay.style.display = 'none';
        }
        return;
      }

      // 触发系统级验证弹窗 (支持 Windows Hello / Mac Touch ID / PIN)
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      
      const options = {
        publicKey: {
          challenge,
          rp: { name: "SwiftFill (填表神器)" },
          user: {
            id: new Uint8Array(16),
            name: "user@swiftfill",
            displayName: "SwiftFill User"
          },
          pubKeyCredParams: [{ alg: -7, type: "public-key" }],
          authenticatorSelection: { 
            authenticatorAttachment: "platform", // 强制使用设备原生验证 (TouchID/WindowsHello)
            userVerification: "required" 
          },
          timeout: 60000
        }
      };

      await navigator.credentials.create(options);
      
      // 验证成功
      await chrome.storage.session.set({ unlocked: true });
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if(tabs[0]) chrome.tabs.sendMessage(tabs[0].id, {action: "unlocked_refresh"}).catch(()=>{});
      });
      overlay.style.display = 'none';
      setStatus('验证成功，欢迎回来', true);
    } catch (err) {
      console.error('Unlock failed:', err);
      // 如果用户取消或不支持，提供一个通用的状态反馈
      if (err.name === 'NotAllowedError') {
        setStatus('验证被取消，请重试', false);
      } else {
        setStatus('系统验证不可用，请检查设备设置', false);
      }
    }
  };

  unlockBtn.onclick = requestUnlock;

  // 初始检查
  const isUnlocked = await checkLock();
  if (!isUnlocked) {
    // 自动尝试触发一次（可选，或者等待点击）
    // requestUnlock(); 
  }

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

  document.getElementById('do-show-widget').onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'show_widget' }, res => {
        setStatus('已召唤悬浮球');
        setTimeout(() => window.close(), 1000);
      });
    });
  };

  document.getElementById('do-save').onclick = async () => {
    await saveData(currentData);
    setStatus('已手动保存最新数据', true);
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
