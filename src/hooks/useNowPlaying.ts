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
  offset: number;   // position (ms) at last sync
  syncedAt: number; // performance.now() when offset was recorded
  running: boolean;
  maxMs: number;    // duration cap — prevents runaway past end of track
}

function clockNow(c: Clock): number {
  const raw = c.running
    ? c.offset + (performance.now() - c.syncedAt)
    : c.offset;
  return c.maxMs > 0 ? Math.min(raw, c.maxMs) : raw;
}

function makeClock(positionMs: number, running: boolean, maxMs: number): Clock {
  return { offset: positionMs, syncedAt: performance.now(), running, maxMs };
}

export function useNowPlaying() {
  const [info, setInfo] = useState<NowPlayingInfo | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const clock = useRef<Clock | null>(null);
  const lastSmtcPos = useRef<number>(-1);
  const lastIsPlaying = useRef<boolean | null>(null);

  useEffect(() => {
    invoke<NowPlayingInfo | null>("get_now_playing")
      .then((data) => {
        if (data) {
          setInfo(data);
          clock.current = makeClock(data.position_ms, data.is_playing, data.duration_ms);
          lastSmtcPos.current = data.position_ms;
          lastIsPlaying.current = data.is_playing;
        }
      })
      .catch(() => {});

    const unlistenTrack = listen<NowPlayingInfo | null>("track-changed", (e) => {
      if (e.payload) {
        setInfo(e.payload);
        clock.current = makeClock(
          e.payload.position_ms,
          e.payload.is_playing,
          e.payload.duration_ms
        );
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
      setInfo((prev) => (prev ? { ...prev, is_playing: smtc.is_playing } : prev));

      const playStateChanged = lastIsPlaying.current !== smtc.is_playing;

      if (smtc.position_ms <= 0) {
        // Position unreadable — still honour a play-state change so pause works.
        if (playStateChanged) {
          const c = clock.current;
          if (c) {
            clock.current = { ...c, running: smtc.is_playing, syncedAt: performance.now() };
          }
          lastIsPlaying.current = smtc.is_playing;
        }
        return;
      }

      const smtcPositionChanged = smtc.position_ms !== lastSmtcPos.current;

      // Recalibrate only when something actually changed.
      // When SMTC position is unchanged the clock free-runs, giving smooth
      // interpolation between slow player updates (Spotify updates ~1 s).
      if (playStateChanged || smtcPositionChanged) {
        clock.current = makeClock(smtc.position_ms, smtc.is_playing, smtc.duration_ms);
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
