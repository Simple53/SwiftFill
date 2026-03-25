# 🚀 SwiftFill - The Ultimate Form Auto-Filler

**SwiftFill** is a Chrome extension designed specifically for government job applications, recruitment systems, and complex web forms. With a smart recognition engine and a minimalist interface, it solves the pain points of tedious form entry and failed auto-filling in multi-layered iframes.

[中文版 (Chinese)](README.md) | **English**

---

## ✨ Core Highlights

### 1. 🤖 Smart Form Filling System
- **High-Precision Matching**: Semantic-based matching identifies hundreds of standard and non-standard fields like "Name," "DOB," and "University."
- **Iframe Penetration**: Deeply optimized for government systems using nested iframes. Whether it's the main page or a deep-layer popup, it fills with one click.
- **Custom Field Support**: Users can add unique fields (e.g., Job Codes, Special Remarks) with full CRUD support.

### 2. 🎈 All-in-One Floating Assistant
- **Minimalist Capsule Design**: A discreet floating ball on the right side that stays visible and supports dragging to avoid blocking content.
- **Single-Column List**: Expand the floating assistant to see a clean list of your data for quick reference or preview.
- **Toggle on Demand**: Close the widget anytime and summon it back from the popup menu instantly.

### 3. 🖱️ Click-to-Copy
- **Instant Clipboard**: Single-click any field in the popup or floating panel to copy its value (ID numbers, long resumes, etc.) for quick manual pasting.

### 4. 🔒 Privacy & Security
- **Zero Uploads, 100% Local**: All sensitive information is stored in your browser's private storage (`chrome.storage.local`). **No data ever leaves your computer.**
- **Physical Isolation**: Data is isolated from website cookies. No external site or third-party app can access your SwiftFill data.
- **Privacy Access Lock**: Powered by the `Web Authentication API`. Accessing the popup requires **Windows Hello (Face/Fingerprint)**, **Touch ID (Mac)**, or your **System PIN**, preventing unauthorized access if you leave your computer unattended.
- **Encrypted Backups**: Export your data as a backup. The payload is salted and encrypted, ensuring your privacy even if the file is lost.

---

## 🛠️ Installation
1.  Download the source code.
2.  Open Chrome and navigate to `chrome://extensions/`.
3.  Enable **"Developer mode"** in the top right.
4.  Click **"Load unpacked"** and select the `Swiftfill-chrome-extension` folder.

---

## 📅 Version Management
This project uses Git for version tracking. To push updates (for developers):
```bash
git add .
git commit -m "docs: add English README and language toggle"
git push origin main
```

---

## 📄 License
This project is for personal use and administrative efficiency. Please use it in compliance with the regulations of the relevant recruitment systems.

Good luck with your exams and career! 🚩
