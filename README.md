# Smart Guides for the Web

Adobe-style rulers and smart guides for any website.

This browser extension adds horizontal and vertical rulers to the page, allowing you to drag out guides, set a custom zero point, and visually align layouts directly in the browser.

It exists because I wanted this functionality for my own work. I’m sharing it publicly in case others find it useful.

- Give me a shout out / thanks - find me on LinkedIn here: https://www.linkedin.com/in/altimatum/
- I don't need contributions towards a coffee; instead, if you want to, donate that support to Planet Wild: https://planetwild.com/gift

---

## What this is (and isn’t)

**This is:**
- A very lightweight utility for designers, developers, and QA
- A personal tool I use regularly
- Open source and free to use
- Actively tweaked as I encounter bugs or friction, but only when I have time, and want to. There will likely be bugs.

**This is not:**
- A commercial product
- A polished SaaS
- Something with guaranteed support or timelines
- Bloat/spy or any other kind of ware. The source code is open and clean - feel free to review.

Issues and pull requests are welcome, but support is provided on a best-effort basis only.

---

## Features
- Scroll to the top left of your website frame to (de)activate.
- Horizontal and vertical rulers
- Drag from rulers to create guides
- Shift + drag the top ruler to move the zero point
- Negative values supported
- Pixel-based and responsive (ratio) vertical guides
- Colour-coded and grouped guides
- Per-site persistence (guides are stored per domain)
- No tracking, no analytics, no data collection

All data is stored locally in your browser.

---

## Installation (Chrome / Edge)

This extension is not published on the Chrome Web Store.

### Install via “Load unpacked”

1. Download this repository as a ZIP  
   - Click **Code → Download ZIP**
2. Unzip the folder somewhere permanent on your machine
3. Open:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
4. Enable **Developer mode**
5. Click **Load unpacked**
6. Select the unzipped extension folder

The extension will now be active.

---

## Usage

- Drag from the **top ruler** to create horizontal guides
- Drag from the **left ruler** to create vertical guides
- **Shift + drag** the top ruler to reposition the zero point
- Right-click a guide to:
  - Lock / unlock
  - Change colour
  - Assign a group
  This also unlocks switching between pixel and responsive modes
- Use the **padlock** in the top-left corner to pin rulers on or off

Guides are saved automatically per site.

---

## Updating the extension

When I release updates:

1. Download the updated ZIP from GitHub
2. Replace the existing extension folder on your machine
3. Go to:
   - `chrome://extensions` or `edge://extensions`
4. Click **Reload** on the extension card  
   (or toggle it off and back on)

Your existing guides and preferences will be preserved.

---

## Privacy

- No network requests
- No telemetry
- No external services
- No data leaves your browser

Everything is stored locally using browser storage.

---

## Licence

MIT Licence.  
Use it, fork it, modify it.

---

## Notes

This project is shared as-is. I’ll continue improving it when I find issues or need new behaviour myself, but there is no roadmap or guarantee of support.
