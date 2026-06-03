import "./App.css";
import { useNowPlaying } from "./hooks/useNowPlaying";
import { useLyrics } from "./hooks/useLyrics";
import { NowPlaying } from "./components/NowPlaying";
import { LyricsView } from "./components/LyricsView";
import { X, Minus, Maximize2, Minimize2 } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import { useEffect, useState, type MouseEvent } from "react";

const appWindow = getCurrentWindow();

function handleDragStart(e: MouseEvent) {
  if ((e.target as HTMLElement).closest("button")) return;
  appWindow.startDragging();
}

/** Returns true if the window is maximized or snapped to a screen edge (width > 480 logical px) */
async function checkDocked(): Promise<boolean> {
  const maximized = await appWindow.isMaximized();
  if (maximized) return true;
  const size = await appWindow.innerSize();
  const dpr = window.devicePixelRatio || 1;
  return size.width / dpr > 480;
}

function App() {
  const nowPlaying = useNowPlaying();
  const { lines, activeIndex, source, loading } = useLyrics(
    nowPlaying?.title,
    nowPlaying?.artist,
    nowPlaying?.duration_ms ?? 0,
    nowPlaying?.position_ms ?? 0
  );

  const [isDocked, setIsDocked] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Initial check
    checkDocked().then(setIsDocked);
    appWindow.isMaximized().then(setIsMaximized);

    // Re-check on every resize (covers maximize, snap, manual resize)
    const unlistenResize = appWindow.listen("tauri://resize", async () => {
      const [docked, maximized] = await Promise.all([
        checkDocked(),
        appWindow.isMaximized(),
      ]);
      setIsDocked(docked);
      setIsMaximized(maximized);
    });

    return () => {
      unlistenResize.then((fn) => fn());
    };
  }, []);

  async function toggleMaximize() {
    if (isMaximized) {
      await appWindow.unmaximize();
    } else {
      await appWindow.maximize();
    }
  }

  return (
    <div
      className={cn(
        "dark group h-screen w-screen overflow-hidden flex flex-col transition-all duration-300",
        isDocked
          ? "bg-black/90 backdrop-blur-2xl border border-white/[0.06] shadow-2xl rounded-none"
          : "rounded-xl border border-transparent hover:bg-black/75 hover:backdrop-blur-2xl hover:border-white/[0.08] hover:shadow-2xl"
      )}
    >
      {/* Centered content wrapper — constrains width when docked/maximized */}
      <div className={cn(
        "flex flex-col flex-1 overflow-hidden w-full",
        isDocked && "max-w-2xl mx-auto"
      )}>
        {/* Title bar / drag handle */}
        <div
          onMouseDown={handleDragStart}
          className={cn(
            "flex-shrink-0 flex items-center justify-between px-3 pt-2 pb-1 cursor-grab active:cursor-grabbing select-none transition-opacity duration-300",
            isDocked ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <img src="/Humn-text-light.svg" alt="Humn" className="h-3.5 w-auto flex-shrink-0 opacity-50" />
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => appWindow.minimize()}
              className="w-5 h-5 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors cursor-default"
            >
              <Minus className="w-2.5 h-2.5 text-white/60" />
            </button>
            <button
              onClick={toggleMaximize}
              className="w-5 h-5 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors cursor-default"
            >
              {isMaximized ? (
                <Minimize2 className="w-2.5 h-2.5 text-white/60" />
              ) : (
                <Maximize2 className="w-2.5 h-2.5 text-white/60" />
              )}
            </button>
            <button
              onClick={() => appWindow.hide()}
              className="w-5 h-5 rounded-full bg-white/10 hover:bg-red-500/60 flex items-center justify-center transition-colors cursor-default"
            >
              <X className="w-2.5 h-2.5 text-white/60" />
            </button>
          </div>
        </div>

        {/* Now playing info */}
        <div
          className={cn(
            "transition-opacity duration-300",
            isDocked ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <NowPlaying title={nowPlaying?.title} artist={nowPlaying?.artist} />
        </div>

        {/* Lyrics */}
        <div className="flex-1 overflow-hidden">
          <LyricsView
            lines={lines}
            activeIndex={activeIndex}
            positionMs={nowPlaying?.position_ms ?? 0}
            loading={loading}
            hasTrack={!!nowPlaying?.title}
          />
        </div>

        {/* Source footer */}
        <div
          className={cn(
            "flex-shrink-0 transition-opacity duration-300 flex items-center justify-center px-3 pb-2 pt-1",
            isDocked ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <span className="text-white/35 text-[10px] font-medium tracking-wider uppercase select-none">
            {source ?? (loading ? "loading…" : lines.length > 0 ? "unknown source" : "")}
          </span>
        </div>
      </div>
    </div>
  );
}

export default App;

