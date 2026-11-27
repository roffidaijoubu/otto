import { ref } from "vue";

export type SoundName =
  | "window_open"
  | "window_close"
  | "chat_send"
  | "chat_receive"
  | "job_complete"
  | "toggle"
  | "delete"
  | "error";

const STORAGE_KEY = "otto-studio-os-sounds-enabled";
const DEFAULT_VOLUME = 0.38;

function readInitialEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "false" || saved === "0") return false;
    if (saved === "true" || saved === "1") return true;
  } catch {
    // ignore storage errors
  }
  return true;
}

export const soundsEnabled = ref<boolean>(readInitialEnabled());

let preferredExt: "webm" | "mp3" | null = null;
const audioPool = new Map<SoundName, HTMLAudioElement>();

function resolveExtension(): "webm" | "mp3" {
  if (preferredExt) return preferredExt;
  if (typeof Audio === "undefined") {
    preferredExt = "mp3";
    return preferredExt;
  }
  try {
    const probe = new Audio();
    preferredExt = probe.canPlayType("audio/webm; codecs=opus") ? "webm" : "mp3";
  } catch {
    preferredExt = "mp3";
  }
  return preferredExt;
}

function getBaseAudio(name: SoundName): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  let audio = audioPool.get(name);
  if (!audio) {
    const ext = resolveExtension();
    audio = new Audio(`/sounds/${name}.${ext}`);
    audio.preload = "auto";
    audioPool.set(name, audio);
  }
  return audio;
}

export function setSoundsEnabled(enabled: boolean): void {
  soundsEnabled.value = enabled;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
    } catch {
      // ignore storage errors
    }
  }
  if (enabled) {
    playSound("toggle");
  }
}

export function toggleSounds(): void {
  setSoundsEnabled(!soundsEnabled.value);
}

export function playSound(name: SoundName, opts?: { volume?: number; force?: boolean }): void {
  if (!opts?.force && !soundsEnabled.value) return;
  if (typeof window === "undefined" || typeof Audio === "undefined") return;

  const base = getBaseAudio(name);
  if (!base) return;

  const volume = Math.max(0, Math.min(1, opts?.volume ?? DEFAULT_VOLUME));

  try {
    // Clone if already playing so overlapping clicks never cut each other off
    const player = base.paused ? base : (base.cloneNode(true) as HTMLAudioElement);
    player.volume = volume;
    if (player === base) {
      try {
        player.currentTime = 0;
      } catch {
        // ignore seek errors before metadata loads
      }
    }
    const maybePromise = player.play();
    if (maybePromise && typeof maybePromise.catch === "function") {
      maybePromise.catch(() => {
        // Swallow autoplay-policy or interrupted-playback errors cleanly
      });
    }
  } catch {
    // Never throw from UI sound playback
  }
}
