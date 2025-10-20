import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./i18n";

// Disable default context menu unless Shift is pressed
document.addEventListener('contextmenu', (e) => {
  if (!e.shiftKey) {
    e.preventDefault();
  }
});

// Disable default browser shortcuts unless Shift is pressed
document.addEventListener('keydown', (e) => {
  // Skip if Shift is pressed
  if (e.shiftKey) {
    return;
  }

  // Check if we're in an editable element
  const target = e.target as HTMLElement;
  const isEditable = 
    target.tagName === 'INPUT' || 
    target.tagName === 'TEXTAREA' || 
    target.isContentEditable;

  // List of shortcuts to disable
  const disabledShortcuts = [
    // Search shortcuts
    { ctrl: true, key: 'f' },
    { ctrl: true, key: 'F' },
    { meta: true, key: 'f' }, // Mac Command+F
    { meta: true, key: 'F' },
    
    // Refresh shortcuts
    { ctrl: true, key: 'r' },
    { ctrl: true, key: 'R' },
    { meta: true, key: 'r' }, // Mac Command+R
    { meta: true, key: 'R' },
    { key: 'F5' },
    { ctrl: true, key: 'F5' },
    
    // Navigation shortcuts
    { alt: true, key: 'ArrowLeft' },
    { alt: true, key: 'ArrowRight' },
    { meta: true, key: 'ArrowLeft' }, // Mac
    { meta: true, key: 'ArrowRight' }, // Mac
    { key: 'Backspace', allowInEditable: true }, // Some browsers go back on backspace, but allow in input fields
    
    // Zoom shortcuts
    { ctrl: true, key: '0' },
    { ctrl: true, key: '+' },
    { ctrl: true, key: '-' },
    { ctrl: true, key: '=' },
    { meta: true, key: '0' }, // Mac
    { meta: true, key: '+' },
    { meta: true, key: '-' },
    { meta: true, key: '=' },
    
    // Other browser shortcuts
    { ctrl: true, key: 'p' }, // Print
    { ctrl: true, key: 'P' },
    { meta: true, key: 'p' },
    { meta: true, key: 'P' },
    { ctrl: true, key: 's' }, // Save
    { ctrl: true, key: 'S' },
    { meta: true, key: 's' },
    { meta: true, key: 'S' },
    { ctrl: true, key: 'u' }, // View source
    { ctrl: true, key: 'U' },
    { meta: true, key: 'u' },
    { meta: true, key: 'U' },
  ];

  // Check if current key combination matches any disabled shortcut
  for (const shortcut of disabledShortcuts) {
    const keyMatch = shortcut.key === e.key;

    if (keyMatch) {
      // Skip if we're in an editable element and this key is allowed in editable contexts
      if (isEditable && (shortcut as any).allowInEditable) {
        continue;
      }

      // For shortcuts with modifiers
      if (shortcut.ctrl || shortcut.meta || shortcut.alt) {
        if ((shortcut.ctrl && (e.ctrlKey || e.metaKey)) ||
            (shortcut.meta && e.metaKey) ||
            (shortcut.alt && e.altKey)) {
          e.preventDefault();
          return;
        }
      } else {
        // For shortcuts without modifiers (like F5, Backspace)
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          return;
        }
      }
    }
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

