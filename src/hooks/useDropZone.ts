import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

interface DropZoneOptions {
  onDrop: (paths: string[]) => void;
  enabled?: boolean;
}

export const useDropZone = ({ onDrop, enabled = true }: DropZoneOptions) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const unlistenHover = listen<string[]>("tauri://file-drop-hover", () => {
      setIsDragging(true);
    });

    const unlistenDrop = listen<string[]>("tauri://file-drop", (event) => {
      setIsDragging(false);
      
      if (ref.current) {
        const mouseX = window.innerWidth / 2;
        const mouseY = window.innerHeight / 2;
        
        const element = document.elementFromPoint(mouseX, mouseY);
        if (ref.current.contains(element)) {
          onDrop(event.payload);
        }
      }
    });

    const unlistenCancel = listen("tauri://file-drop-cancelled", () => {
      setIsDragging(false);
    });

    return () => {
      unlistenHover.then((fn) => fn());
      unlistenDrop.then((fn) => fn());
      unlistenCancel.then((fn) => fn());
    };
  }, [onDrop, enabled]);

  return { ref, isDragging };
};

