# Ray's Note — Build Instructions

## Requirements (install once)
1. Node.js LTS → https://nodejs.org
2. Open Command Prompt in this folder

## Run for testing
```
npm install
npm start
```

## Build .exe installer
```
npm install
npm run build
```
The installer will be at: `dist/Ray's Note Setup 1.0.0.exe`

## Icon
Place your icon file named **note-icon.ico** in this folder before building.
The tray also uses this icon at runtime.

## Notes are saved at
`C:\Users\<you>\AppData\Roaming\rays-note\notes.json`
They are NEVER lost when closing from tray — only "Delete" in Dashboard permanently removes a note.

## Autostart with Windows
After installing, press Win+R → shell:startup
Create a shortcut to the installed exe there.
