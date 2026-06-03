import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export interface NowPlayingInfo {
  title: string;
  artist: string;
  position_ms: number;
  duration_ms: number;
  is_playing: boolean;
}

interface Clock {
  offset: number;    // position (ms) at last sync
  syncedAt: number;  // performance.now() when offset was recorded
  running: boolean;
}

function clockNow(c: Clock): number {
  return c.running ? c.offset + (performance.now() - c.syncedAt) : c.offset;
}

function makeClock(positionMs: number, running: boolean): Clock {
  return { offset: positionMs, syncedAt: performance.now(), running };
}

export function useNowPlaying() {
  const [info, setInfo] = useState<NowPlayingInfo | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const clock = useRef<Clock | null>(null);
  const lastSmtcPos = useRef<number>(-1);  // last SMTC-reported position we acted on
  const lastIsPlaying = useRef<boolean | null>(null);

  useEffect(() => {
    invoke<NowPlayingInfo | null>("get_now_playing")
      .then((data) => {
        if (data) {
          setInfo(data);
          clock.current = makeClock(data.position_ms, data.is_playing);
          lastSmtcPos.current = data.position_ms;
          lastIsPlaying.current = data.is_playing;
        }
      })
      .catch(() => {});

    const unlistenTrack = listen<NowPlayingInfo | null>("track-changed", (e) => {
      if (e.payload) {
        setInfo(e.payload);
        clock.current = makeClock(e.payload.position_ms, e.payload.is_playing);
        lastSmtcPos.current = e.payload.position_ms;
        lastIsPlaying.current = e.payload.is_playing;
        setPositionMs(e.payload.position_ms);
      } else {
        setInfo(null);
        clock.current = null;
        lastSmtcPos.current = -1;
        lastIsPlaying.current = null;
        setPositionMs(0);
      }
    });

    const unlistenTick = listen<NowPlayingInfo>("position-tick", (e) => {
      const smtc = e.payload;
      setInfo((prev) => prev ? { ...prev, is_playing: smtc.is_playing } : prev);

      if (smtc.position_ms <= 0) return; // ignore SMTC read glitches

      const c = clock.current;
      const playStateChanged = lastIsPlaying.current !== smtc.is_playing;
      const smtcPositionChanged = smtc.position_ms !== lastSmtcPos.current;

      if (playStateChanged || smtcPositionChanged) {
        // Recalibrate clock whenever SMTC reports a new position or play state changes.
        // If SMTC position is the same as last tick, the clock continues free-running.
        const pos = smtc.position_ms > 0 ? smtc.position_ms : (c ? clockNow(c) : 0);
        clock.current = makeClock(pos, smtc.is_playing);
        lastSmtcPos.current = smtc.position_ms;
        lastIsPlaying.current = smtc.is_playing;
      }
    });

    const timer = setInterval(() => {
      if (clock.current) setPositionMs(clockNow(clock.current));
    }, 16);

    return () => {
      clearInterval(timer);
      unlistenTrack.then((fn) => fn());
      unlistenTick.then((fn) => fn());
    };
  }, []);

  if (!info) return null;
  return { ...info, position_ms: positionMs };
}
