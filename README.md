# AuraWave Presentation

A gesture-controlled presentation remote using computer vision. Control slides, laser pointer, and drawing with hand gestures through your webcam. Runs fully offline.

## Features
- ☝️ Point → Laser pointer
- 🤏 Pinch → Draw annotations
- 🖐️ Open Palm → Erase + swipe navigation
- 📤 Upload images or PDFs as slides
- 🎯 Presentation mode (full screen)
- 🔌 Fully offline after first load

## How to Run

**Important:** Must be run via a local server (cannot open `index.html` directly).

### Option 1: VS Code Live Server
1. Install "Live Server" extension in VS Code
2. Right-click `index.html` → Open with Live Server

### Option 2: Python
```bash
python -m http.server 8000