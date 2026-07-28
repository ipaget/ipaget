import { useEffect } from "react";
import DebugWindow from "../components/DebugWindow";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../lib/runtime";

export default function DebugPage() {
  useEffect(() => {
    (async () => {
      if (!isTauriRuntime()) {
        return;
      }
      try {
        await emit("debug-window-opened");
      } catch {}
    })();
    return () => {
      (async () => {
        if (!isTauriRuntime()) {
          return;
        }
        try {
          await emit("debug-window-closed");
        } catch {}
      })();
    };
  }, []);

  return (
    <DebugWindow standalone onClose={() => {
      if (isTauriRuntime()) {
        getCurrentWebviewWindow().close();
      } else {
        window.close();
      }
    }} />
  );
}


