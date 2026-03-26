// background.js

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.action === 'check_lock') {
    chrome.storage.session.get('unlocked', (res) => {
      reply(!!res.unlocked);
    });
    return true; // Keep message channel open for async reply
  }
});
