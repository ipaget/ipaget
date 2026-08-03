import { useEffect } from "react";
import DebugWindow from "../components/DebugWindow";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emit } from "@tauri-apps/api/event";

export default function DebugPage() {
  useEffect(() => {
    (async () => {
      try {
        await emit("debug-window-opened");
      } catch {}
    })();
    return () => {
      (async () => {
        try {
          await emit("debug-window-closed");
        } catch {}
      })();
    };
  }, []);

  return (
    <DebugWindow standalone onClose={() => getCurrentWebviewWindow().close()} />
  );
}


