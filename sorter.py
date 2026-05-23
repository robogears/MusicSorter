"""Music sorter: reads Downloads, looks up genre on Last.fm, moves into Music subfolders."""
import base64
import io
import json
import os
import queue
import shutil
import sys
import threading
import time
import difflib
import re
import tkinter as tk
from pathlib import Path
from tkinter import simpledialog, messagebox
from urllib.parse import urlencode
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

import customtkinter as ctk
import numpy as np
from PIL import Image
from mutagen import File as MutagenFile
from mutagen.flac import Picture as FlacPicture

try:
    from just_playback import Playback
    _PLAYBACK_IMPORT_ERROR = None
except Exception as _e:  # capture the real reason for the UI
    Playback = None
    _PLAYBACK_IMPORT_ERROR = f"{type(_e).__name__}: {_e}"

try:
    import miniaudio
except Exception:
    miniaudio = None


# ── Theme (monochrome) ──────────────────────────────────────────
BG = "#000000"
SURFACE_2 = "#0e0e0e"
SURFACE_3 = "#1a1a1a"
SURFACE_4 = "#262626"
DUP_BADGE_BG = "#3a2a18"
DUP_BADGE_FG = "#f0b96e"
BORDER = "#262626"
TEXT = "#ffffff"
TEXT_MUTED = "#8a8a8a"
TEXT_DIM = "#555555"
ACCENT_BG = "#ffffff"
ACCENT_FG = "#000000"
ACCENT_HOVER = "#dddddd"
SUCCESS = "#3fb950"
SUCCESS_FLASH = "#173a23"
WARNING = "#d4a017"
DANGER = "#a8423a"
WAVE_UNPLAYED = "#3a3a3a"
WAVE_HOVER = "#5a5a5a"
WAVE_PREVIEW = "#777777"
WAVE_CURSOR = "#ffffff"
WAVE_PLAYED = "#ffffff"

LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/"
USER_AGENT = "MusicSorter/1.0 (personal use)"
ART_SIZE = 88
PAGE_SIZE = 30
PLAYBACK_OK_EXTS = {".mp3", ".flac", ".wav", ".ogg", ".opus"}
WAVE_BARS = 64
APP_VERSION = "0.1.4"  # bump per CLAUDE.md before each tag push

# Default Last.fm API key shipped with the build. Users who want their own
# (e.g. to avoid the shared rate limit) can put a different one in config.json.
DEFAULT_LASTFM_API_KEY = "25da7294f1c679210c7e12bfda4b2f2e"

DEFAULT_AUDIO_EXTS = [
    ".mp3", ".flac", ".m4a", ".wav", ".ogg", ".opus", ".aac", ".wma", ".mp4",
]
# Perceptual volume curve: applied = slider ** N. Higher N = quieter at low slider.
VOLUME_CURVE_POW = 3.0

# Little dude who dances on top of the window while music is playing.
DUDE_IDLE = "  o  \n /|\\ \n / \\ "
DUDE_DANCE_FRAMES = [
    " \\o/ \n  |  \n / \\ ",
    "  o  \n_/|\\ \n / \\ ",
    " \\o/ \n  |  \n / \\ ",
    "  o  \n /|\\_\n / \\ ",
]
DUDE_BPM = 120  # fake tempo for the dance loop


def app_dir() -> Path:
    """Folder to read/write config.json from.

    Frozen build: per-user config dir for the OS.
      Windows: %APPDATA%\\MusicSorter
      macOS:   ~/Library/Application Support/MusicSorter
      Linux:   $XDG_CONFIG_HOME/MusicSorter (or ~/.config/MusicSorter)
    Dev (running sorter.py directly): the script's own folder.
    """
    if getattr(sys, "frozen", False):
        if sys.platform == "win32":
            base = Path(os.environ.get("APPDATA")
                        or Path.home() / "AppData" / "Roaming")
        elif sys.platform == "darwin":
            base = Path.home() / "Library" / "Application Support"
        else:
            base = Path(os.environ.get("XDG_CONFIG_HOME")
                        or Path.home() / ".config")
        path = base / "MusicSorter"
        try:
            path.mkdir(parents=True, exist_ok=True)
        except OSError:
            # Couldn't create the per-user dir — fall back to next to the binary.
            path = Path(sys.executable).parent
        return path
    return Path(__file__).parent


def resource_path(filename: str) -> Path:
    """Resolve a bundled resource (icon, etc.) — works in dev and frozen builds."""
    if getattr(sys, "frozen", False):
        # PyInstaller --onefile extracts data files under sys._MEIPASS
        base = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        return base / filename
    return Path(__file__).parent / filename


def _default_config() -> dict:
    home = Path.home()
    return {
        "downloads_path": str(home / "Downloads"),
        "music_root": str(home / "Music"),
        # Empty = use built-in DEFAULT_LASTFM_API_KEY at runtime. Leaving it
        # blank in config.json means the baked key is never exposed on disk.
        "lastfm_api_key": "",
        "audio_extensions": list(DEFAULT_AUDIO_EXTS),
        "scan_subfolders": False,
    }


def load_config():
    cfg_path = app_dir() / "config.json"
    # First launch: write a sensible default config next to the executable
    # so the user can just double-click the .exe and have it work.
    if not cfg_path.exists():
        config = _default_config()
        try:
            with open(cfg_path, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2)
        except OSError:
            pass
        return config
    with open(cfg_path, encoding="utf-8") as f:
        config = json.load(f)
    # Normalize anything that means "use built-in" to an empty string: the
    # legacy "YOUR_..." placeholder, or a value that happens to equal the
    # baked-in default. After this, "" => default, anything else => custom.
    key = (config.get("lastfm_api_key") or "").strip()
    if key.startswith("YOUR_") or key == DEFAULT_LASTFM_API_KEY:
        key = ""
    config["lastfm_api_key"] = key
    return config


def effective_api_key(config) -> str:
    """The key to actually send to Last.fm — user's override or the baked default."""
    return (config.get("lastfm_api_key") or "").strip() or DEFAULT_LASTFM_API_KEY


def extract_metadata(filepath: Path):
    try:
        audio = MutagenFile(str(filepath), easy=True)
        if audio is not None:
            artist = (audio.get("artist") or [None])[0]
            title = (audio.get("title") or [None])[0]
            if artist and title:
                return artist.strip(), title.strip()
    except Exception:
        pass
    stem = re.sub(r"^\s*\d+[\s.\-_]+", "", filepath.stem)
    if " - " in stem:
        left, right = stem.split(" - ", 1)
        return left.strip(), right.strip()
    return None, stem.strip()


def extract_album_art(filepath: Path):
    try:
        audio = MutagenFile(str(filepath))
        if audio is None:
            return None
        if hasattr(audio, "pictures") and audio.pictures:
            return Image.open(io.BytesIO(audio.pictures[0].data))
        tags = getattr(audio, "tags", None)
        if tags is None:
            return None
        for key in list(tags.keys() if hasattr(tags, "keys") else []):
            if key.startswith("APIC"):
                return Image.open(io.BytesIO(tags[key].data))
        if "covr" in tags:
            covers = tags["covr"]
            if covers:
                return Image.open(io.BytesIO(bytes(covers[0])))
        mbp = tags.get("metadata_block_picture") if hasattr(tags, "get") else None
        if mbp:
            data = base64.b64decode(mbp[0])
            pic = FlacPicture(data)
            return Image.open(io.BytesIO(pic.data))
    except Exception:
        return None
    return None


def compute_waveform(filepath: Path, n_bars: int = WAVE_BARS):
    if miniaudio is None or filepath.suffix.lower() not in PLAYBACK_OK_EXTS:
        return None
    try:
        decoded = miniaudio.decode_file(str(filepath))
        arr = np.frombuffer(decoded.samples, dtype=np.int16)
        if decoded.nchannels > 1:
            arr = arr[::decoded.nchannels]
        if arr.size == 0:
            return None
        abs_arr = np.abs(arr.astype(np.int32))
        chunk = max(1, abs_arr.size // n_bars)
        truncated = abs_arr[: chunk * n_bars]
        if truncated.size == 0:
            return None
        peaks = truncated.reshape(n_bars, chunk).max(axis=1).astype(np.float32)
        m = peaks.max()
        if m > 0:
            peaks = peaks / m
        peaks = np.maximum(peaks, 0.06)
        return peaks.tolist()
    except Exception:
        return None


# Last error text from the most recent lastfm_get call. Surfaced in the UI
# when get_tags ends up returning no tags so it isn't a silent failure.
_LASTFM_LAST_ERROR: str | None = None


def lastfm_get(method, api_key, **params):
    """Wrapper around the Last.fm 2.0 JSON API.
    Returns the parsed dict on success, or None on any failure. The reason is
    stashed in `_LASTFM_LAST_ERROR` so callers can surface it instead of
    silently falling through.
    """
    global _LASTFM_LAST_ERROR
    if not api_key:
        _LASTFM_LAST_ERROR = "no API key configured"
        return None
    params["method"] = method
    params["api_key"] = api_key
    params["format"] = "json"
    url = LASTFM_BASE + "?" + urlencode(params)
    req = Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        # Last.fm sometimes returns 200 with {"error": N, "message": "..."}
        if isinstance(data, dict) and data.get("error"):
            _LASTFM_LAST_ERROR = str(data.get("message") or f"error {data['error']}")
            return None
        _LASTFM_LAST_ERROR = None
        return data
    except HTTPError as e:
        _LASTFM_LAST_ERROR = f"HTTP {e.code}"
        return None
    except URLError as e:
        _LASTFM_LAST_ERROR = f"network: {e.reason}"
        return None
    except (json.JSONDecodeError, TimeoutError) as e:
        _LASTFM_LAST_ERROR = f"{type(e).__name__}: {e}"
        return None


def _parse_tags(payload):
    if not payload or "toptags" not in payload:
        return []
    raw = payload["toptags"].get("tag", [])
    if isinstance(raw, dict):
        raw = [raw]
    out = []
    for t in raw:
        name = (t.get("name") or "").strip()
        if not name:
            continue
        try:
            weight = int(t.get("count", 0))
        except (TypeError, ValueError):
            weight = 0
        out.append((name, weight))
    return out


_TITLE_NORMALIZE_RE = re.compile(r"\s*[\(\[][^)\]]*[\)\]]")
_FEAT_RE = re.compile(r"\s*(feat\.?|ft\.?|featuring)\s+.+$", re.IGNORECASE)


def _clean_title(title: str) -> str:
    """Strip "(feat. X)", "[Remix]", "(Sped Up)" etc. — common noise in
    downloads that prevents Last.fm from matching the canonical track."""
    s = _TITLE_NORMALIZE_RE.sub("", title)
    s = _FEAT_RE.sub("", s)
    return s.strip()


def get_tags(artist, title, api_key):
    tags = []
    tried_clean = False
    if artist and title:
        tags = _parse_tags(lastfm_get(
            "track.getTopTags", api_key,
            artist=artist, track=title, autocorrect=1,
        ))
        if not tags:
            clean = _clean_title(title)
            if clean and clean.lower() != title.lower():
                tried_clean = True
                tags = _parse_tags(lastfm_get(
                    "track.getTopTags", api_key,
                    artist=artist, track=clean, autocorrect=1,
                ))
    if not tags and artist:
        tags = _parse_tags(lastfm_get(
            "artist.getTopTags", api_key,
            artist=artist, autocorrect=1,
        ))
    _ = tried_clean  # reserved for future diagnostics
    tags.sort(key=lambda x: x[1], reverse=True)
    return tags


def list_genre_folders(music_root: Path):
    return sorted([p.name for p in music_root.iterdir() if p.is_dir()],
                  key=lambda s: s.lower())


def suggest_folder(tags, existing_folders):
    if not tags:
        return None, None
    folders_lower = {f.lower(): f for f in existing_folders}
    for tag_name, _ in tags:
        tl = tag_name.lower().strip()
        if tl in folders_lower:
            return folders_lower[tl], tag_name
    for tag_name, _ in tags:
        tl = tag_name.lower().strip()
        for fl, fname in folders_lower.items():
            if fl in tl or tl in fl:
                return fname, tag_name
    top = tags[0][0]
    fuzzy = difflib.get_close_matches(top.lower(), list(folders_lower.keys()),
                                      n=1, cutoff=0.7)
    if fuzzy:
        return folders_lower[fuzzy[0]], top
    return None, top


def chip_color(weight: int):
    if weight >= 70:
        return "#e8e8e8", "#0a0a0a"
    if weight >= 40:
        return SURFACE_4, "#dadada"
    if weight >= 15:
        return SURFACE_3, TEXT_MUTED
    return "#181818", TEXT_DIM


def fmt_time(seconds: float) -> str:
    if seconds is None or seconds <= 0:
        return "0:00"
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m}:{s:02d}"


def bind_press_pop(btn, normal_color: str, pressed_color: str):
    """Briefly tint a button's text on mouse-down for tactile feedback.
    Operating on text_color (not fg_color) so it doesn't fight CTkButton's
    built-in hover behavior."""
    def on_press(_e):
        try:
            btn.configure(text_color=pressed_color)
        except Exception:
            pass

    def on_release(_e):
        try:
            btn.after(80, lambda: btn.configure(text_color=normal_color))
        except Exception:
            pass

    btn.bind("<ButtonPress-1>", on_press, add="+")
    btn.bind("<ButtonRelease-1>", on_release, add="+")


# ── File row ────────────────────────────────────────────────────
class FileRow(ctk.CTkFrame):
    def __init__(self, parent, filepath: Path, app):
        super().__init__(parent, fg_color=SURFACE_2, corner_radius=12)
        self.app = app
        self.filepath = filepath
        self.tags = []
        self.top_tag = None
        self.ready = False
        self.skipped = False
        self.is_duplicate = False
        self._art_image = None
        self.wave_data = None
        self.duration = 0.0
        self.position = 0.0
        self.canvas_w = 600
        self.canvas_h = 36
        self.hover_x = None
        self.dragging = False
        self._displayed_amp = 0.0  # EMA-smoothed amplitude for live reactivity
        self._build()

    def _build(self):
        self.grid_columnconfigure(1, weight=1)

        # ── Top section: art | info+skip ───────────────────────
        self.art_label = ctk.CTkLabel(self, text="", image=self.app.placeholder_art)
        self.art_label.grid(row=0, column=0, padx=(16, 14), pady=(16, 6), sticky="nw")

        top = ctk.CTkFrame(self, fg_color="transparent")
        top.grid(row=0, column=1, sticky="ew", padx=(0, 16), pady=(16, 6))
        top.grid_columnconfigure(0, weight=1)

        info = ctk.CTkFrame(top, fg_color="transparent")
        info.grid(row=0, column=0, sticky="ew")
        info.grid_columnconfigure(0, weight=1)

        self.artist_var = ctk.StringVar(value="Loading…")
        self.artist_label = ctk.CTkLabel(
            info, textvariable=self.artist_var, anchor="w",
            font=ctk.CTkFont(size=12), text_color=TEXT_MUTED,
        )
        self.artist_label.grid(row=0, column=0, sticky="ew")

        self.title_var = ctk.StringVar(value=self.filepath.stem)
        self.title_label = ctk.CTkLabel(
            info, textvariable=self.title_var, anchor="w",
            font=ctk.CTkFont(size=16, weight="bold"), text_color=TEXT,
            wraplength=540, justify="left",
        )
        self.title_label.grid(row=1, column=0, sticky="ew", pady=(1, 0))

        self.filename_var = ctk.StringVar(value=self.filepath.name)
        self.filename_label = ctk.CTkLabel(
            info, textvariable=self.filename_var, anchor="w",
            font=ctk.CTkFont(size=10), text_color=TEXT_DIM,
            wraplength=540, justify="left",
        )
        self.filename_label.grid(row=2, column=0, sticky="ew", pady=(2, 6))

        # Badge slot — used for "ALREADY IN LIBRARY" and similar status pills.
        # Stays empty (zero height) when there's nothing to show.
        self.badge_frame = ctk.CTkFrame(info, fg_color="transparent")
        self.badge_frame.grid(row=3, column=0, sticky="ew")

        self.chips_frame = ctk.CTkFrame(info, fg_color="transparent")
        self.chips_frame.grid(row=4, column=0, sticky="ew", pady=(4, 0))

        self.skip_btn = ctk.CTkButton(
            top, text="Skip", width=78, height=32,
            fg_color="transparent", hover_color=SURFACE_3,
            border_width=1, border_color=BORDER,
            text_color=TEXT_MUTED,
            font=ctk.CTkFont(size=12, weight="bold"),
            corner_radius=8,
            command=self.toggle_skip,
        )
        self.skip_btn.grid(row=0, column=1, sticky="ne", padx=(8, 0))
        bind_press_pop(self.skip_btn, TEXT_MUTED, TEXT)

        # ── Bottom section: play | waveform | time ─────────────
        bottom = ctk.CTkFrame(self, fg_color="transparent")
        bottom.grid(row=1, column=0, columnspan=2, sticky="ew", padx=16, pady=(4, 6))
        bottom.grid_columnconfigure(1, weight=1)

        self.play_btn = ctk.CTkButton(
            bottom, text="▶", width=36, height=36,
            fg_color=SURFACE_3, hover_color=SURFACE_4,
            text_color=TEXT, font=ctk.CTkFont(size=14),
            command=self.toggle_play,
        )
        self.play_btn.grid(row=0, column=0, padx=(0, 12))

        self.wave_canvas = tk.Canvas(
            bottom, height=self.canvas_h, bg=SURFACE_2,
            highlightthickness=0, bd=0,
        )
        self.wave_canvas.grid(row=0, column=1, sticky="ew")
        self.wave_canvas.bind("<Configure>", self._on_canvas_resize)
        self.wave_canvas.bind("<Motion>", self._on_canvas_motion)
        self.wave_canvas.bind("<Leave>", self._on_canvas_leave)
        self.wave_canvas.bind("<Button-1>", self._on_canvas_press)
        self.wave_canvas.bind("<B1-Motion>", self._on_canvas_drag)
        self.wave_canvas.bind("<ButtonRelease-1>", self._on_canvas_release)

        self.time_var = ctk.StringVar(value="—:—")
        ctk.CTkLabel(
            bottom, textvariable=self.time_var,
            font=ctk.CTkFont(size=10, family="Consolas"),
            text_color=TEXT_MUTED, width=80,
        ).grid(row=0, column=2, padx=(12, 0))

        # ── Controls row: suggestion + folder + new ────────────
        ctrl = ctk.CTkFrame(self, fg_color="transparent")
        ctrl.grid(row=2, column=0, columnspan=2, sticky="ew", padx=16, pady=(2, 14))
        ctrl.grid_columnconfigure(0, weight=1)

        self.suggest_var = ctk.StringVar(value="Querying Last.fm…")
        self.suggest_label = ctk.CTkLabel(
            ctrl, textvariable=self.suggest_var, anchor="w",
            font=ctk.CTkFont(size=11), text_color=TEXT_MUTED, justify="left",
        )
        self.suggest_label.grid(row=0, column=0, sticky="w")

        self.folder_var = ctk.StringVar(value="")
        self.folder_menu = ctk.CTkOptionMenu(
            ctrl, variable=self.folder_var,
            values=self.app.existing_folders or ["(none)"],
            width=180, height=32,
            fg_color=SURFACE_3, button_color=SURFACE_4,
            button_hover_color="#373737",
            text_color=TEXT, dropdown_fg_color=SURFACE_3,
            dropdown_text_color=TEXT, dropdown_hover_color=SURFACE_4,
            font=ctk.CTkFont(size=12),
        )
        self.folder_menu.grid(row=0, column=1, padx=(8, 6))

        new_btn = ctk.CTkButton(
            ctrl, text="+ New", width=78, height=36,
            fg_color=SURFACE_3, hover_color=SURFACE_4,
            text_color=TEXT,
            font=ctk.CTkFont(size=12, weight="bold"),
            corner_radius=8,
            command=self.create_new_folder,
        )
        new_btn.grid(row=0, column=2)
        bind_press_pop(new_btn, TEXT, DUP_BADGE_FG)

        delete_btn = ctk.CTkButton(
            ctrl, text="Delete", width=82, height=36,
            fg_color="transparent", hover_color="#2a1010",
            border_width=1, border_color=DANGER,
            text_color=DANGER,
            font=ctk.CTkFont(size=12, weight="bold"),
            corner_radius=8,
            command=self.delete_file,
        )
        delete_btn.grid(row=0, column=3, padx=(8, 0))
        bind_press_pop(delete_btn, DANGER, "#ff7066")

        self.move_one_btn = ctk.CTkButton(
            ctrl, text="Move →", width=96, height=36,
            fg_color=SURFACE_3, hover_color=SURFACE_4,
            border_width=1, border_color="#3a3a3a",
            text_color=TEXT,
            font=ctk.CTkFont(size=12, weight="bold"),
            corner_radius=8,
            command=self.move_one,
        )
        self.move_one_btn.grid(row=0, column=4, padx=(8, 0))
        bind_press_pop(self.move_one_btn, TEXT, SUCCESS)

    # ── Lifecycle / state ───────────────────────────────────────
    def is_queued(self) -> bool:
        return self.ready and not self.skipped

    def set_metadata(self, artist, title):
        if artist and title:
            self.artist_var.set(artist)
            self.title_var.set(title)
        else:
            self.artist_var.set("(no tags)")
            self.title_var.set(self.filepath.stem)

    def set_art(self, pil_image):
        img = pil_image.convert("RGB")
        img.thumbnail((ART_SIZE, ART_SIZE), Image.LANCZOS)
        canvas = Image.new("RGB", (ART_SIZE, ART_SIZE), SURFACE_2)
        ox = (ART_SIZE - img.width) // 2
        oy = (ART_SIZE - img.height) // 2
        canvas.paste(img, (ox, oy))
        self._art_image = ctk.CTkImage(
            light_image=canvas, dark_image=canvas, size=(ART_SIZE, ART_SIZE),
        )
        self.art_label.configure(image=self._art_image)

    def set_tags(self, tags, error_msg: str | None = None):
        self.tags = tags
        self.lookup_error = error_msg
        for w in self.chips_frame.winfo_children():
            w.destroy()
        if not tags:
            ctk.CTkLabel(
                self.chips_frame, text="(no tags found)",
                font=ctk.CTkFont(size=10), text_color=TEXT_DIM,
            ).pack(side="left")
        else:
            for name, weight in tags[:5]:
                bg, fg = chip_color(weight)
                ctk.CTkLabel(
                    self.chips_frame, text=f"  {name}  ",
                    fg_color=bg, text_color=fg, corner_radius=10,
                    font=ctk.CTkFont(size=10, weight="bold"), height=20,
                ).pack(side="left", padx=(0, 4))
        self.re_suggest()
        self.ready = True
        self.app.refresh_move_buttons()

    def re_suggest(self):
        """Re-evaluate suggested folder against the app's current folder list."""
        folder, top = suggest_folder(self.tags, self.app.existing_folders)
        self.top_tag = top
        if folder:
            top_w = next((w for n, w in self.tags if n.lower() == (top or "").lower()), 0)
            color = SUCCESS if top_w >= 40 else "#7aa97a"
            self.suggest_var.set(f"Suggested: {folder}   ·   tag: {top}")
            self.suggest_label.configure(text_color=color)
            self.folder_var.set(folder)
        elif top:
            self.suggest_var.set(f"No folder match. Top tag: {top}  — click + New")
            self.suggest_label.configure(text_color=WARNING)
            self.folder_var.set("")
        else:
            err = getattr(self, "lookup_error", None)
            if err:
                msg = f"Last.fm lookup failed: {err}"
            else:
                msg = "No genre info found. Pick or create a folder."
            self.suggest_var.set(msg)
            self.suggest_label.configure(text_color=DANGER)
            self.folder_var.set("")

    def set_waveform(self, data, duration):
        self.wave_data = data
        self.duration = duration or 0
        self.time_var.set(f"{fmt_time(self.position)} / {fmt_time(self.duration)}")
        self._redraw_wave()

    def update_playback(self, position, duration):
        self.position = position
        if duration:
            self.duration = duration
        self.time_var.set(f"{fmt_time(self.position)} / {fmt_time(self.duration)}")
        self._redraw_wave()

    def update_play_button(self, playing: bool):
        self.play_btn.configure(text="⏸" if playing else "▶")

    # ── Waveform rendering ──────────────────────────────────────
    def _on_canvas_resize(self, event):
        self.canvas_w = max(60, event.width)
        self._redraw_wave()

    def _redraw_wave(self):
        c = self.wave_canvas
        c.delete("all")
        data = self.wave_data
        if data is None:
            data = [0.18] * WAVE_BARS
        n = len(data)
        slot = self.canvas_w / n
        bar_w = max(2, slot * 0.7)
        cy = self.canvas_h / 2
        max_h = self.canvas_h - 2

        # Pixel boundaries — color flips exactly at the cursor.
        if self.dragging and self.hover_x is not None:
            played_x = max(0.0, min(float(self.canvas_w), float(self.hover_x)))
            preview_x = played_x
            played_frac = played_x / max(1, self.canvas_w)
        else:
            played_frac = (self.position / self.duration) if self.duration > 0 else 0
            played_frac = max(0.0, min(1.0, played_frac))
            played_x = played_frac * self.canvas_w
            if self.hover_x is not None and not self.skipped:
                preview_x = max(played_x,
                                min(float(self.canvas_w), float(self.hover_x)))
            else:
                preview_x = played_x

        # Live reactivity: get the amplitude near the playhead and EMA-smooth it.
        is_active = (self.app.playing_row is self
                     and self.app.playback is not None
                     and self.app.playback.active)
        is_playing = is_active and self.app.playback.playing and not self.dragging
        target_amp = 0.0
        if is_playing and self.wave_data and self.duration > 0:
            fpos = played_frac * n
            i0 = max(0, min(n - 1, int(fpos)))
            i1 = min(n - 1, i0 + 1)
            f = fpos - i0
            target_amp = self.wave_data[i0] * (1 - f) + self.wave_data[i1] * f
        self._displayed_amp += (target_amp - self._displayed_amp) * 0.35
        amp = max(0.0, self._displayed_amp)

        # Falloff radius for the "ripple" around the playhead, in pixels.
        ripple_r = slot * 6

        for i, v in enumerate(data):
            x = i * slot + (slot - bar_w) / 2
            bar_center = x + bar_w / 2
            h = max(2, v * (self.canvas_h - 4))
            # Reactive height: bars near the playhead grow with current amplitude.
            if is_playing and amp > 0.02:
                d = abs(bar_center - played_x)
                if d < ripple_r:
                    proximity = 1.0 - (d / ripple_r)
                    h = min(max_h, h * (1.0 + proximity * amp * 0.8))
            if bar_center < played_x:
                color = WAVE_PLAYED
            elif bar_center < preview_x:
                color = WAVE_PREVIEW
            else:
                color = WAVE_UNPLAYED
            c.create_rectangle(x, cy - h / 2, x + bar_w, cy + h / 2,
                               fill=color, outline="")

        # Playhead cursor: visible while hovering, playing, or paused.
        cursor_x = None
        if self.hover_x is not None and not self.skipped:
            cursor_x = self.hover_x
        elif is_active:
            cursor_x = played_x
        if cursor_x is not None:
            cx = max(0, min(self.canvas_w - 1, cursor_x))
            if is_playing and amp > 0.05:
                glow_w = max(2, int(2 + amp * 5))
                c.create_line(cx, 1, cx, self.canvas_h - 1,
                              fill="#7a7a7a", width=glow_w)
            c.create_line(cx, 1, cx, self.canvas_h - 1,
                          fill=WAVE_CURSOR, width=1)

    def _on_canvas_motion(self, event):
        if self.skipped:
            return
        self.hover_x = event.x
        self._redraw_wave()

    def _on_canvas_leave(self, event):
        if self.dragging:
            return
        self.hover_x = None
        self._redraw_wave()

    def _on_canvas_press(self, event):
        if self.skipped:
            return
        if self.filepath.suffix.lower() not in PLAYBACK_OK_EXTS:
            self.app.status_var.set(f"Preview not supported for {self.filepath.suffix}")
            return
        self.dragging = True
        self.hover_x = event.x
        frac = max(0.0, min(1.0, event.x / max(1, self.canvas_w)))
        if self.duration > 0:
            self.position = frac * self.duration
            self.time_var.set(f"{fmt_time(self.position)} / {fmt_time(self.duration)}")
        self.app.scrub_start(self, frac)
        self._redraw_wave()

    def _on_canvas_drag(self, event):
        if not self.dragging:
            return
        self.hover_x = event.x
        frac = max(0.0, min(1.0, event.x / max(1, self.canvas_w)))
        if self.duration > 0:
            self.position = frac * self.duration
            self.time_var.set(f"{fmt_time(self.position)} / {fmt_time(self.duration)}")
        self.app.scrub_to(self, frac)
        self._redraw_wave()

    def _on_canvas_release(self, event):
        self.dragging = False
        self._redraw_wave()

    # ── Actions ─────────────────────────────────────────────────
    def toggle_play(self):
        if self.skipped:
            return
        self.app.play_or_pause(self)

    def toggle_skip(self):
        self.skipped = not self.skipped
        self._apply_skipped_visual()
        self.app.refresh_move_buttons()

    def _apply_skipped_visual(self):
        """Push the skipped/active styling onto the row's widgets."""
        if self.skipped:
            if self.app.playing_row is self:
                self.app.stop_playback()
            self.configure(fg_color=BG)
            self.title_label.configure(text_color=TEXT_DIM)
            self.artist_label.configure(text_color=TEXT_DIM)
            self.filename_label.configure(text_color="#2a2a2a")
            self.suggest_label.configure(text_color=TEXT_DIM)
            # Button label tracks intent: dup rows say "Add" (to opt in),
            # plain rows say "Undo" (to take the skip back).
            label = "Add" if self.is_duplicate else "Undo"
            self.skip_btn.configure(text=label, text_color=TEXT)
        else:
            self.configure(fg_color=SURFACE_2)
            self.title_label.configure(text_color=TEXT)
            self.artist_label.configure(text_color=TEXT_MUTED)
            self.filename_label.configure(text_color=TEXT_DIM)
            self.skip_btn.configure(text="Skip", text_color=TEXT_MUTED)
            if self.ready:
                folder = self.folder_var.get()
                if folder:
                    self.suggest_label.configure(text_color=SUCCESS)

    def set_duplicate(self, is_dup: bool):
        """Mark/unmark this row as already present in the music library.
        Duplicates default to skipped so they don't sneak into batch moves —
        the user has to click 'Add' to opt them in.
        """
        if is_dup == self.is_duplicate:
            return
        self.is_duplicate = is_dup
        # Clear any existing pill
        for w in self.badge_frame.winfo_children():
            w.destroy()
        if is_dup:
            ctk.CTkLabel(
                self.badge_frame, text="  ALREADY IN LIBRARY  ",
                fg_color=DUP_BADGE_BG, text_color=DUP_BADGE_FG,
                corner_radius=10,
                font=ctk.CTkFont(size=10, weight="bold"), height=22,
            ).pack(side="left", pady=(4, 0))
            # Default to skipped so the batch Move ignores it.
            self.skipped = True
        else:
            self.skipped = False
        self._apply_skipped_visual()
        self.app.refresh_move_buttons()

    def create_new_folder(self):
        default = (self.top_tag or "").title()
        name = simpledialog.askstring(
            "New genre folder", "Folder name:",
            initialvalue=default, parent=self.app,
        )
        if not name:
            return
        name = name.strip().strip("/\\")
        if not name:
            return
        try:
            (self.app.music_root / name).mkdir(exist_ok=True)
        except OSError as e:
            messagebox.showerror("Could not create folder", str(e), parent=self.app)
            return
        if name not in self.app.existing_folders:
            self.app.add_folder(name)
        self.folder_var.set(name)

    def flash_and_remove(self, on_done, flash_color: str = SUCCESS_FLASH,
                         text_color: str = "#a3e6b0"):
        self.configure(fg_color=flash_color)
        self.title_label.configure(text_color=text_color)
        def finish():
            try:
                self.destroy()
            except Exception:
                pass
            on_done()
        self.after(160, finish)

    def delete_file(self):
        """Permanently delete the file from disk after confirming."""
        if not messagebox.askyesno(
            "Delete file",
            f"Permanently delete this file?\n\n{self.filepath.name}\n\n"
            f"This can't be undone.",
            parent=self.app, icon="warning",
        ):
            return
        if self.app.playing_row is self:
            self.app.stop_playback()
        try:
            self.filepath.unlink()
        except OSError as e:
            messagebox.showerror("Delete failed", str(e), parent=self.app)
            return
        self.app.skip_count += 1
        self.app.status_var.set(f"Deleted {self.filepath.name}")

        def after_destroy():
            try:
                self.app.rows.remove(self)
            except ValueError:
                pass
            self.app._update_progress()
            self.app.refresh_move_buttons()

        # Red flash so the visual matches the destructive intent.
        self.flash_and_remove(after_destroy,
                              flash_color="#3a1010", text_color="#ff8a80")

    def move_one(self):
        """Move just this row's file. Silent no-op if no folder is set."""
        if self.skipped or not self.ready:
            return
        target = self.folder_var.get().strip()
        if not target or target == "(none)":
            return
        dest_dir = self.app.music_root / target
        dest = dest_dir / self.filepath.name
        try:
            dest_dir.mkdir(exist_ok=True)
            if dest.exists():
                if not messagebox.askyesno(
                    "File exists",
                    f"{dest.name} already exists in {target}.\nOverwrite?",
                    parent=self.app,
                ):
                    return
            if self.app.playing_row is self:
                self.app.stop_playback()
            shutil.move(str(self.filepath), str(dest))
            self.app.move_count += 1
            self.app.status_var.set(f"Moved → {target}\\{self.filepath.name}")

            def after_destroy():
                try:
                    self.app.rows.remove(self)
                except ValueError:
                    pass
                self.app._update_progress()
                self.app.refresh_move_buttons()

            self.flash_and_remove(after_destroy)
        except Exception as e:
            messagebox.showerror("Move failed", str(e), parent=self.app)


# ── Main app ────────────────────────────────────────────────────
class SorterApp(ctk.CTk):
    def __init__(self, files, config):
        super().__init__()
        self.config_data = config
        self.music_root = Path(config["music_root"])
        self.api_key = effective_api_key(config)
        self.all_files = files
        self.total = len(files)
        self.existing_folders = list_genre_folders(self.music_root)
        self.placeholder_art = self._make_placeholder(ART_SIZE)

        self.rows = []
        self.rows_added = 0
        self.work_queue = queue.Queue()
        self.worker_stop = threading.Event()
        # Lowercased filenames already present anywhere under music_root.
        # Used to flag rows as duplicates so they don't auto-queue for moving.
        self.library_files: set[str] = set()
        self.playback = None
        self.playing_row = None
        self.playback_timer_id = None
        self.move_count = 0
        self.skip_count = 0
        self.volume = 0.7
        self._dude_pose_idx = 0
        self._dude_last_beat = -1

        self.title(f"robogears MusicSorter v{APP_VERSION}")
        self.geometry("960x920")
        self.minsize(820, 640)
        self.configure(fg_color=BG)
        # Window icon — PNG via iconphoto works on Windows, macOS, and Linux.
        # Keep a reference on self so Python doesn't garbage-collect the image.
        try:
            icon_png = resource_path("icon.png")
            if icon_png.exists():
                self._icon_photo = tk.PhotoImage(file=str(icon_png))
                self.iconphoto(True, self._icon_photo)
        except Exception:
            pass

        self._build_ui()
        self._add_rows(min(PAGE_SIZE, self.total))
        if self.rows_added < self.total:
            self.after(60, self._load_chunk)
        threading.Thread(target=self._worker, daemon=True).start()
        threading.Thread(target=self._scan_library, daemon=True).start()

        self.protocol("WM_DELETE_WINDOW", self._on_close)

    def _make_placeholder(self, size):
        img = Image.new("RGB", (size, size), SURFACE_3)
        return ctk.CTkImage(light_image=img, dark_image=img, size=(size, size))

    def _build_ui(self):
        # Little dude perched on top
        self.dude_label = tk.Label(
            self, text=DUDE_IDLE,
            font=("Consolas", 13, "bold"),
            fg=TEXT, bg=BG, justify="left",
        )
        self.dude_label.pack(pady=(10, 0))

        # Header (sticky)
        header = ctk.CTkFrame(self, fg_color=BG)
        header.pack(fill="x", padx=24, pady=(6, 0))

        title_row = ctk.CTkFrame(header, fg_color="transparent")
        title_row.pack(fill="x")
        title_row.grid_columnconfigure(2, weight=1)

        # Small logo (the same little dude that's on the window/.exe icon)
        try:
            logo_img = Image.open(str(resource_path("icon.png"))).convert("RGBA")
            self._title_logo = ctk.CTkImage(
                light_image=logo_img, dark_image=logo_img, size=(26, 26),
            )
            ctk.CTkLabel(title_row, image=self._title_logo, text="").grid(
                row=0, column=0, sticky="w", padx=(0, 10)
            )
        except Exception:
            pass

        ctk.CTkLabel(
            title_row, text="robogears MusicSorter",
            font=ctk.CTkFont(size=18, weight="bold"),
            text_color=TEXT,
        ).grid(row=0, column=1, sticky="w")

        ctk.CTkLabel(
            title_row, text=f"v{APP_VERSION}",
            font=ctk.CTkFont(size=11),
            text_color="#c1a87a",  # subtle warm accent for the version stamp
        ).grid(row=0, column=2, sticky="w", padx=(8, 0))

        # Volume cluster — pushed right but smaller than before so the title bar
        # reads as branding first.
        vol_frame = ctk.CTkFrame(title_row, fg_color="transparent")
        vol_frame.grid(row=0, column=3, sticky="e", padx=(20, 10))
        ctk.CTkLabel(
            vol_frame, text="VOL",
            font=ctk.CTkFont(size=9, weight="bold"), text_color=TEXT_MUTED,
        ).pack(side="left", padx=(0, 8))
        self.volume_slider = ctk.CTkSlider(
            vol_frame, from_=0, to=1, width=110, height=12,
            progress_color=TEXT, button_color=TEXT,
            button_hover_color="#dddddd", fg_color=SURFACE_3,
            command=self._on_volume_change,
        )
        self.volume_slider.set(self.volume)
        self.volume_slider.pack(side="left")
        self.volume_pct_var = ctk.StringVar(value=f"{int(self.volume * 100)}%")
        ctk.CTkLabel(
            vol_frame, textvariable=self.volume_pct_var,
            font=ctk.CTkFont(size=9, family="Consolas"),
            text_color=TEXT_MUTED, width=32, anchor="e",
        ).pack(side="left", padx=(6, 0))

        # Settings cog — slimmer, no border, sits flush on the right
        ctk.CTkButton(
            title_row, text="⚙", width=30, height=30,
            fg_color="transparent", hover_color=SURFACE_3,
            text_color=TEXT_MUTED, font=ctk.CTkFont(size=16),
            command=self.open_settings,
        ).grid(row=0, column=4, sticky="e")

        self.progress_var = ctk.StringVar(value=f"0 done / {self.total}")

        self.progress_bar = ctk.CTkProgressBar(
            header, height=2, progress_color=TEXT,
            fg_color=SURFACE_3, corner_radius=1,
        )
        self.progress_bar.pack(fill="x", pady=(10, 16))
        self.progress_bar.set(0)

        # Section header: "QUEUE  ... 0 DONE / 282"
        queue_hdr = ctk.CTkFrame(header, fg_color="transparent")
        queue_hdr.pack(fill="x", pady=(0, 6))
        ctk.CTkLabel(
            queue_hdr, text="QUEUE",
            font=ctk.CTkFont(size=10, weight="bold"), text_color=TEXT_MUTED,
        ).pack(side="left")
        refresh_btn = ctk.CTkButton(
            queue_hdr, text="Refresh", width=68, height=22,
            fg_color="transparent", hover_color=SURFACE_3,
            text_color=TEXT_MUTED,
            font=ctk.CTkFont(size=10, weight="bold"),
            corner_radius=6,
            command=self._rescan_downloads,
        )
        refresh_btn.pack(side="left", padx=(14, 0))
        bind_press_pop(refresh_btn, TEXT_MUTED, TEXT)
        ctk.CTkLabel(
            queue_hdr, textvariable=self.progress_var,
            font=ctk.CTkFont(size=10), text_color=TEXT_MUTED,
        ).pack(side="right")

        move_row_top = ctk.CTkFrame(header, fg_color="transparent")
        move_row_top.pack(fill="x", pady=(0, 14))
        self.move_btn_top = ctk.CTkButton(
            move_row_top, text="  Move 0 tracks  →  ",
            height=42, fg_color=ACCENT_BG, hover_color=ACCENT_HOVER,
            text_color=ACCENT_FG,
            font=ctk.CTkFont(size=13, weight="bold"),
            command=self.move_batch,
        )
        self.move_btn_top.pack(side="left")

        self.queued_var = ctk.StringVar(value="0 queued")
        ctk.CTkLabel(
            move_row_top, textvariable=self.queued_var,
            font=ctk.CTkFont(size=11), text_color=TEXT_MUTED,
        ).pack(side="right")

        # Scrollable list
        self.scroll = ctk.CTkScrollableFrame(
            self, fg_color=BG, corner_radius=0,
            scrollbar_button_color=SURFACE_3,
            scrollbar_button_hover_color=SURFACE_4,
        )
        self.scroll.pack(fill="both", expand=True, padx=20, pady=0)

        # Footer (sticky)
        footer = ctk.CTkFrame(self, fg_color=BG)
        footer.pack(fill="x", padx=24, pady=(8, 18))

        move_row_bot = ctk.CTkFrame(footer, fg_color="transparent")
        move_row_bot.pack(fill="x", pady=(0, 6))
        self.move_btn_bot = ctk.CTkButton(
            move_row_bot, text="  Move 0 tracks  →  ",
            height=42, fg_color=ACCENT_BG, hover_color=ACCENT_HOVER,
            text_color=ACCENT_FG,
            font=ctk.CTkFont(size=13, weight="bold"),
            command=self.move_batch,
        )
        self.move_btn_bot.pack(side="left")

        ctk.CTkLabel(
            footer, text="ACTIVITY",
            font=ctk.CTkFont(size=10, weight="bold"), text_color=TEXT_MUTED,
            anchor="w",
        ).pack(fill="x", pady=(10, 4))
        self.status_var = ctk.StringVar(value="Ready")
        ctk.CTkLabel(
            footer, textvariable=self.status_var,
            font=ctk.CTkFont(size=10, family="Consolas"),
            text_color=TEXT, anchor="w",
        ).pack(fill="x")

    def _add_rows(self, n):
        added = 0
        while self.rows_added < self.total and added < n:
            f = self.all_files[self.rows_added]
            row = FileRow(self.scroll, f, self)
            row.pack(fill="x", padx=4, pady=5)
            self.rows.append(row)
            self.work_queue.put(row)
            self.rows_added += 1
            added += 1
        self.refresh_move_buttons()

    def _load_chunk(self):
        """Incrementally add the remaining rows so the initial paint stays responsive."""
        if self.rows_added >= self.total:
            return
        self._add_rows(min(PAGE_SIZE, self.total - self.rows_added))
        if self.rows_added < self.total:
            self.after(30, self._load_chunk)

    def _worker(self):
        while not self.worker_stop.is_set():
            try:
                row = self.work_queue.get(timeout=0.5)
            except queue.Empty:
                continue
            if row is None or self.worker_stop.is_set():
                break
            try:
                if not row.winfo_exists():
                    continue
                artist, title = extract_metadata(row.filepath)
                self.after(0, lambda r=row, a=artist, t=title: r.set_metadata(a, t))
                # Flag duplicates immediately so the user sees the badge as
                # rows light up (library scan may finish later — the rescan
                # pass in _scan_library will catch anything we missed here).
                if row.filepath.name.lower() in self.library_files:
                    self.after(0, lambda r=row: r.set_duplicate(True))
                art = extract_album_art(row.filepath)
                if art is not None:
                    self.after(0, lambda r=row, a=art: r.set_art(a))
                tags = get_tags(artist, title, self.api_key)
                last_err = _LASTFM_LAST_ERROR if not tags else None
                self.after(0, lambda r=row, t=tags, e=last_err: r.set_tags(t, e))
                # Waveform (slower, last)
                wf = compute_waveform(row.filepath)
                if wf is not None:
                    dur = len(wf) and self._estimate_duration(row.filepath)
                    self.after(0, lambda r=row, w=wf, d=dur: r.set_waveform(w, d))
            except Exception:
                pass
            time.sleep(0.20)

    def _scan_library(self):
        """Walk music_root and index every audio file's name (lowercased) so
        we can flag duplicates in Downloads. Runs in its own daemon thread."""
        exts = {e.lower() for e in self.config_data.get("audio_extensions", [])}
        names: set[str] = set()
        try:
            for p in self.music_root.rglob("*"):
                if self.worker_stop.is_set():
                    return
                try:
                    if p.is_file() and p.suffix.lower() in exts:
                        names.add(p.name.lower())
                except OSError:
                    continue
        except Exception:
            return
        self.library_files = names
        # Re-evaluate any rows that loaded before the index existed.
        self.after(0, self._recheck_duplicates)
        self.after(0, lambda: self.status_var.set(
            f"Library indexed: {len(names)} tracks"
        ))

    def _recheck_duplicates(self):
        for r in list(self.rows):
            try:
                if (not r.is_duplicate
                        and r.filepath.name.lower() in self.library_files):
                    r.set_duplicate(True)
            except Exception:
                pass

    def _estimate_duration(self, filepath: Path) -> float:
        try:
            audio = MutagenFile(str(filepath))
            if audio is not None and getattr(audio, "info", None):
                return float(audio.info.length or 0)
        except Exception:
            pass
        return 0.0

    def add_folder(self, name):
        self.existing_folders = sorted(
            self.existing_folders + [name], key=lambda s: s.lower()
        )
        for r in self.rows:
            try:
                r.folder_menu.configure(values=self.existing_folders)
                # Auto-fill rows that hadn't picked anything yet — if their
                # top tag now matches the new folder, re_suggest will set it.
                # Manual selections (folder_var non-empty) are left alone.
                if r.ready and not r.folder_var.get().strip():
                    r.re_suggest()
            except Exception:
                pass

    def refresh_move_buttons(self):
        n = sum(1 for r in self.rows if r.is_queued())
        label = f"  Move {n} track{'s' if n != 1 else ''}  →  "
        state = "normal" if n > 0 else "disabled"
        for b in (self.move_btn_top, self.move_btn_bot):
            try:
                b.configure(text=label, state=state)
            except Exception:
                pass
        self.queued_var.set(f"{n} queued")

    def _update_progress(self):
        done = self.move_count + self.skip_count
        self.progress_var.set(f"{done} done / {self.total}")
        self.progress_bar.set(done / self.total if self.total else 0)

    # ── Batch move ──────────────────────────────────────────────
    def move_batch(self):
        queued = [r for r in self.rows if r.is_queued()]
        if not queued:
            self.status_var.set("Nothing to move")
            return
        self.move_btn_top.configure(state="disabled")
        self.move_btn_bot.configure(state="disabled")
        self._process_move_queue(queued, 0, len(queued), moved=0, skipped=0)

    def _process_move_queue(self, rows, idx, total, moved, skipped):
        if idx >= len(rows):
            self.status_var.set(
                f"Batch complete  ·  moved {moved}  ·  skipped {skipped}"
            )
            self.refresh_move_buttons()
            return
        row = rows[idx]
        next_call = lambda m=moved, s=skipped: self._process_move_queue(
            rows, idx + 1, total, m, s,
        )
        if not row.is_queued():
            self.after(20, next_call)
            return
        target = row.folder_var.get().strip()
        if not target or target == "(none)":
            self.after(20, next_call)
            return
        dest_dir = self.music_root / target
        dest = dest_dir / row.filepath.name
        try:
            dest_dir.mkdir(exist_ok=True)
            if dest.exists():
                self.status_var.set(f"Skipped (exists): {row.filepath.name}")
                self.after(40, lambda: self._process_move_queue(
                    rows, idx + 1, total, moved, skipped + 1,
                ))
                return
            if self.playing_row is row:
                self.stop_playback()
            shutil.move(str(row.filepath), str(dest))
            self.move_count += 1
            moved += 1
            self.status_var.set(f"Moved → {target}\\{row.filepath.name}")

            def after_destroy(_moved=moved, _skipped=skipped):
                try:
                    self.rows.remove(row)
                except ValueError:
                    pass
                self._update_progress()
                self.after(30, lambda: self._process_move_queue(
                    rows, idx + 1, total, _moved, _skipped,
                ))

            row.flash_and_remove(after_destroy)
        except Exception as e:
            self.status_var.set(f"Failed: {row.filepath.name} — {e}")
            self.after(40, lambda: self._process_move_queue(
                rows, idx + 1, total, moved, skipped + 1,
            ))

    # ── Settings ────────────────────────────────────────────────
    def open_settings(self):
        win = ctk.CTkToplevel(self)
        win.title("Settings")
        win.geometry("640x620")
        win.configure(fg_color=BG)
        win.transient(self)
        win.after(50, win.grab_set)

        wrap = ctk.CTkFrame(win, fg_color=BG)
        wrap.pack(fill="both", expand=True, padx=28, pady=22)

        # ── Local helpers ──────────────────────────────────────
        def section_label(text):
            ctk.CTkLabel(
                wrap, text=text,
                font=ctk.CTkFont(size=10, weight="bold"),
                text_color=TEXT_MUTED, anchor="w",
            ).pack(anchor="w", fill="x", pady=(0, 6))

        def helper_text(text):
            ctk.CTkLabel(
                wrap, text=text,
                font=ctk.CTkFont(size=11), text_color=TEXT_DIM, anchor="w",
                wraplength=560, justify="left",
            ).pack(anchor="w", fill="x", pady=(8, 22))

        def path_row(var, browse_title, with_clear=False):
            row = ctk.CTkFrame(wrap, fg_color="transparent")
            row.pack(fill="x")
            ctk.CTkEntry(
                row, textvariable=var, height=40,
                fg_color=SURFACE_2, text_color=TEXT,
                border_color=BORDER, border_width=1, corner_radius=8,
                font=ctk.CTkFont(family="Consolas", size=11),
            ).pack(side="left", fill="x", expand=True)
            ctk.CTkButton(
                row, text="Browse…", width=92, height=40,
                fg_color=SURFACE_2, hover_color=SURFACE_3,
                border_width=1, border_color=BORDER,
                text_color=TEXT, font=ctk.CTkFont(size=11),
                corner_radius=8,
                command=lambda: self._browse_into(var, browse_title, win),
            ).pack(side="left", padx=(8, 0))
            if with_clear:
                ctk.CTkButton(
                    row, text="Clear", width=64, height=40,
                    fg_color="transparent", hover_color=SURFACE_3,
                    text_color=TEXT_MUTED, font=ctk.CTkFont(size=11),
                    command=lambda: var.set(""),
                ).pack(side="left", padx=(4, 0))

        # ── Header: title + close ──────────────────────────────
        header = ctk.CTkFrame(wrap, fg_color="transparent")
        header.pack(fill="x", pady=(0, 24))
        ctk.CTkLabel(
            header, text="Settings",
            font=ctk.CTkFont(size=20, weight="bold"),
            text_color=TEXT,
        ).pack(side="left")
        ctk.CTkButton(
            header, text="×", width=28, height=28,
            fg_color="transparent", hover_color=SURFACE_3,
            text_color=TEXT_MUTED, font=ctk.CTkFont(size=20),
            command=win.destroy,
        ).pack(side="right")

        # ── State ──────────────────────────────────────────────
        music_var = ctk.StringVar(value=str(self.music_root))
        dl_var = ctk.StringVar(value=self.config_data.get("downloads_path", ""))
        scan_var = ctk.BooleanVar(
            value=bool(self.config_data.get("scan_subfolders", False))
        )
        indexed_var = ctk.StringVar(
            value=f"{len(self.existing_folders)} genre folders indexed"
        )

        # ── DOWNLOAD FOLDER ────────────────────────────────────
        section_label("DOWNLOAD FOLDER")
        path_row(dl_var, "Pick Downloads folder")
        helper_text("Where MusicSorter scans for new music to sort.")

        # ── MUSIC LIBRARY FOLDER ───────────────────────────────
        section_label("MUSIC LIBRARY FOLDER")
        path_row(music_var, "Pick music root folder", with_clear=True)

        stats_row = ctk.CTkFrame(wrap, fg_color="transparent")
        stats_row.pack(fill="x", pady=(10, 0))
        ctk.CTkLabel(
            stats_row, textvariable=indexed_var,
            font=ctk.CTkFont(size=11, weight="bold"), text_color=TEXT_MUTED,
        ).pack(side="left")

        def do_refresh():
            p = music_var.get().strip()
            if p and Path(p).is_dir():
                try:
                    folders = list_genre_folders(Path(p))
                    indexed_var.set(f"{len(folders)} genre folders indexed")
                except Exception:
                    indexed_var.set("Could not scan")
            else:
                indexed_var.set("Set the path first")

        ctk.CTkButton(
            stats_row, text="Refresh", width=70, height=22,
            fg_color="transparent", hover_color=SURFACE_3,
            text_color=TEXT_MUTED, font=ctk.CTkFont(size=11),
            command=do_refresh,
        ).pack(side="left", padx=(14, 0))

        helper_text("Destination for moved files. Each subfolder is a genre.")

        # ── Scan-subfolders toggle ─────────────────────────────
        ctk.CTkCheckBox(
            wrap, text="Scan subfolders of Downloads",
            variable=scan_var, font=ctk.CTkFont(size=12),
            text_color=TEXT, fg_color=TEXT, hover_color=ACCENT_HOVER,
            border_color=BORDER, checkmark_color=ACCENT_FG,
        ).pack(anchor="w", pady=(0, 4))
        ctk.CTkLabel(
            wrap, text="Includes audio files nested inside Downloads subfolders.",
            font=ctk.CTkFont(size=11), text_color=TEXT_DIM, anchor="w",
        ).pack(anchor="w", fill="x", pady=(0, 12))

        # Last.fm key — not user-configurable, always use baked default
        def key_for_save() -> str:
            return ""

        # ── Bottom: Done button (primary) ──────────────────────
        btn_row = ctk.CTkFrame(wrap, fg_color="transparent")
        btn_row.pack(fill="x", side="bottom")
        ctk.CTkButton(
            btn_row, text="Done", width=120, height=40,
            fg_color=ACCENT_BG, hover_color=ACCENT_HOVER,
            text_color=ACCENT_FG, font=ctk.CTkFont(size=13, weight="bold"),
            corner_radius=8,
            command=lambda: self._save_settings(
                win, music_var.get(), dl_var.get(),
                bool(scan_var.get()), key_for_save(),
            ),
        ).pack(side="right")

    def _browse_into(self, var, title, parent):
        from tkinter import filedialog
        initial = var.get() or ""
        path = filedialog.askdirectory(initialdir=initial, title=title, parent=parent)
        if path:
            var.set(str(Path(path)))

    def _save_settings(self, win, music_root, downloads_path, scan_subfolders, api_key):
        music_root = (music_root or "").strip()
        downloads_path = (downloads_path or "").strip()
        # api_key may be empty — that means "use the built-in default" and is fine.
        api_key = (api_key or "").strip()

        if not music_root:
            messagebox.showerror("Missing path",
                                 "Music folder can't be empty.\n\n"
                                 "Pick one with Browse, then click Save.",
                                 parent=win)
            return
        if not downloads_path:
            messagebox.showerror("Missing path",
                                 "Downloads folder can't be empty.\n\n"
                                 "Pick one with Browse, then click Save.",
                                 parent=win)
            return

        # Filesystem checks can block for seconds on OneDrive / network paths,
        # so we do them off the UI thread and apply the result back on main.
        self.status_var.set("Applying settings…")

        def worker():
            try:
                mr = Path(music_root)
                dl = Path(downloads_path)
                if not mr.is_dir():
                    self.after(0, lambda: self._settings_error(
                        win, f"Music root is not a directory:\n{music_root}"))
                    return
                if not dl.is_dir():
                    self.after(0, lambda: self._settings_error(
                        win, f"Downloads is not a directory:\n{downloads_path}"))
                    return
                music_changed = self.music_root != mr
                old_dl = Path(self.config_data.get("downloads_path", ""))
                old_scan = bool(self.config_data.get("scan_subfolders", False))
                downloads_changed = (old_dl != dl or old_scan != scan_subfolders)
                new_folders = (list_genre_folders(mr) if music_changed
                               else self.existing_folders)
            except Exception as e:
                err = str(e)
                self.after(0, lambda: self._settings_error(win, err))
                return

            self.after(0, lambda: self._apply_settings(
                win, mr, dl, scan_subfolders, api_key, music_changed,
                downloads_changed, new_folders,
            ))

        threading.Thread(target=worker, daemon=True).start()

    def _settings_error(self, win, msg):
        self.status_var.set("Ready")
        try:
            messagebox.showerror("Invalid path", msg, parent=win)
        except Exception:
            messagebox.showerror("Invalid path", msg)

    def _apply_settings(self, win, mr, dl, scan_subfolders, api_key,
                        music_changed, downloads_changed, new_folders):
        self.config_data["music_root"] = str(mr)
        self.config_data["downloads_path"] = str(dl)
        self.config_data["scan_subfolders"] = scan_subfolders
        self.config_data["lastfm_api_key"] = api_key

        cfg_path = app_dir() / "config.json"
        try:
            with open(cfg_path, "w", encoding="utf-8") as f:
                json.dump(self.config_data, f, indent=2)
        except Exception as e:
            self.status_var.set("Save failed")
            messagebox.showerror("Save failed", str(e), parent=win)
            return

        self.music_root = mr
        self.api_key = api_key or DEFAULT_LASTFM_API_KEY

        if music_changed:
            self.existing_folders = new_folders
            values = new_folders or ["(none)"]
            for r in self.rows:
                try:
                    r.folder_menu.configure(values=values)
                    if r.ready:
                        r.re_suggest()
                except Exception:
                    pass
            # Old duplicate index is stale — re-scan the new library in bg
            self.library_files = set()
            for r in self.rows:
                try:
                    if r.is_duplicate:
                        r.set_duplicate(False)
                except Exception:
                    pass
            threading.Thread(target=self._scan_library, daemon=True).start()

        if downloads_changed:
            self._rescan_downloads()

        if downloads_changed and music_changed:
            self.status_var.set(f"Reloaded — music root → {mr}")
        elif downloads_changed:
            self.status_var.set(f"Rescanned {dl}")
        elif music_changed:
            self.status_var.set(f"Music root → {mr}")
        else:
            self.status_var.set("Settings saved")

        self.refresh_move_buttons()
        win.destroy()

    def _rescan_downloads(self):
        """Drop all current rows and re-collect files from the (possibly new)
        downloads path. Stops playback so we never have a row referencing a
        file we just forgot about."""
        self.stop_playback()
        # Drain anything the worker hasn't picked up yet — those rows are about
        # to be destroyed and the worker would just waste cycles on them.
        while True:
            try:
                self.work_queue.get_nowait()
            except queue.Empty:
                break
        for r in list(self.rows):
            try:
                r.destroy()
            except Exception:
                pass
        self.rows.clear()
        self.rows_added = 0
        self.move_count = 0
        self.skip_count = 0
        self.all_files = collect_files(self.config_data)
        self.total = len(self.all_files)
        self._update_progress()
        self._add_rows(min(PAGE_SIZE, self.total))
        if self.rows_added < self.total:
            self.after(60, self._load_chunk)

    # ── Volume ──────────────────────────────────────────────────
    def _curved_volume(self) -> float:
        """Map the linear slider position through a perceptual (power) curve."""
        return float(self.volume) ** VOLUME_CURVE_POW

    def _on_volume_change(self, value):
        self.volume = float(value)
        self.volume_pct_var.set(f"{int(self.volume * 100)}%")
        if self.playback is not None:
            try:
                self.playback.set_volume(self._curved_volume())
            except Exception:
                pass

    # ── Playback ────────────────────────────────────────────────
    def play_or_pause(self, row):
        if Playback is None:
            detail = f" — {_PLAYBACK_IMPORT_ERROR}" if _PLAYBACK_IMPORT_ERROR else ""
            self.status_var.set(f"Playback library not available{detail}")
            return
        if row.filepath.suffix.lower() not in PLAYBACK_OK_EXTS:
            self.status_var.set(f"Preview not supported for {row.filepath.suffix}")
            return
        if self.playing_row is row and self.playback is not None:
            try:
                if self.playback.playing:
                    self.playback.pause()
                    row.update_play_button(False)
                    self.status_var.set(f"Paused {row.filepath.name}")
                else:
                    self.playback.resume()
                    row.update_play_button(True)
                    self.status_var.set(f"Playing {row.filepath.name}")
            except Exception as e:
                self.status_var.set(f"Playback error: {e}")
            return
        self._start_playback(row, seek_frac=0)

    def scrub_start(self, row, fraction):
        """Mouse-down on waveform: start playing here, or seek if already playing."""
        if Playback is None:
            return
        if row.filepath.suffix.lower() not in PLAYBACK_OK_EXTS:
            return
        if self.playing_row is row and self.playback is not None:
            try:
                self.playback.seek(fraction * self.playback.duration)
                if not self.playback.playing:
                    self.playback.resume()
                row.update_play_button(True)
            except Exception:
                pass
            return
        self._start_playback(row, seek_frac=fraction)

    def scrub_to(self, row, fraction):
        """Drag on waveform: seek only, no restart."""
        if self.playing_row is row and self.playback is not None:
            try:
                self.playback.seek(fraction * self.playback.duration)
            except Exception:
                pass

    def _start_playback(self, row, seek_frac: float = 0):
        self.stop_playback()
        try:
            pb = Playback(str(row.filepath))
            try:
                pb.set_volume(self._curved_volume())
            except Exception:
                pass
            pb.play()
            if seek_frac > 0.005:
                try:
                    pb.seek(seek_frac * pb.duration)
                except Exception:
                    pass
            self.playback = pb
            self.playing_row = row
            row.update_play_button(True)
            self.status_var.set(f"Playing {row.filepath.name}")
            if not row.duration and pb.duration:
                row.duration = pb.duration
            self._schedule_playback_tick()
        except Exception as e:
            self.status_var.set(f"Could not play {row.filepath.name}: {e}")

    def _schedule_playback_tick(self):
        if self.playback_timer_id is not None:
            try:
                self.after_cancel(self.playback_timer_id)
            except Exception:
                pass
        self.playback_timer_id = self.after(50, self._playback_tick)

    def _playback_tick(self):
        self.playback_timer_id = None
        if self.playback is None or self.playing_row is None:
            return
        try:
            pos = self.playback.curr_pos
            dur = self.playback.duration
            self.playing_row.update_playback(pos, dur)
            self._update_dude()
            if not self.playback.playing and not self.playback.paused:
                self.stop_playback()
                return
        except Exception:
            pass
        self._schedule_playback_tick()

    def _update_dude(self):
        """Animate the dance dude based on whether music is playing + current amp."""
        is_playing = (self.playback is not None and self.playback.playing
                      and self.playing_row is not None)
        if not is_playing:
            self.dude_label.configure(text=DUDE_IDLE)
            self._dude_last_beat = -1
            return
        amp = float(getattr(self.playing_row, "_displayed_amp", 0))
        # During very quiet sections the dude pauses on idle.
        if amp < 0.05:
            self.dude_label.configure(text=DUDE_IDLE)
            return
        beat_period = 60.0 / DUDE_BPM  # seconds per beat
        beat_count = int(time.monotonic() / beat_period)
        if beat_count != self._dude_last_beat:
            self._dude_pose_idx = (self._dude_pose_idx + 1) % len(DUDE_DANCE_FRAMES)
            self.dude_label.configure(text=DUDE_DANCE_FRAMES[self._dude_pose_idx])
            self._dude_last_beat = beat_count

    def stop_playback(self):
        if self.playback_timer_id is not None:
            try:
                self.after_cancel(self.playback_timer_id)
            except Exception:
                pass
            self.playback_timer_id = None
        if self.playback is not None:
            try:
                self.playback.stop()
            except Exception:
                pass
            self.playback = None
        if self.playing_row is not None:
            try:
                self.playing_row.update_play_button(False)
                self.playing_row.position = 0
                self.playing_row.time_var.set(
                    f"0:00 / {fmt_time(self.playing_row.duration)}"
                )
                self.playing_row._displayed_amp = 0.0
                self.playing_row._redraw_wave()
            except Exception:
                pass
            self.playing_row = None
        try:
            self._update_dude()
        except Exception:
            pass

    def _on_close(self):
        self.worker_stop.set()
        self.work_queue.put(None)
        self.stop_playback()
        self.destroy()


def collect_files(config):
    downloads = Path(config["downloads_path"])
    if not downloads.is_dir():
        return []
    exts = {e.lower() for e in config["audio_extensions"]}
    if config.get("scan_subfolders"):
        candidates = downloads.rglob("*")
    else:
        candidates = downloads.iterdir()
    return sorted([p for p in candidates if p.is_file() and p.suffix.lower() in exts])


def _startup_error(msg: str):
    """Show a GUI dialog for fatal startup problems (so --windowed builds aren't silent)."""
    try:
        import tkinter as _tk
        from tkinter import messagebox as _mb
        root = _tk.Tk()
        root.withdraw()
        _mb.showerror("MusicSorter", msg)
        root.destroy()
    except Exception:
        try:
            with open(app_dir() / "startup_error.txt", "w", encoding="utf-8") as f:
                f.write(msg)
        except Exception:
            pass


def main():
    try:
        config = load_config()
    except Exception as e:
        _startup_error(f"Could not load config.json:\n{e}")
        sys.exit(1)

    # Make sure the music root exists — create it if not (harmless if already there).
    music_root = Path(config["music_root"])
    try:
        music_root.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        _startup_error(
            f"Music folder path is invalid:\n{music_root}\n\n{e}\n\n"
            f"Edit config.json next to the .exe, or change the path from Settings "
            f"after launching."
        )
        sys.exit(1)

    # Downloads is informational only — if it's missing we still launch with an
    # empty list so the user can fix it via Settings.
    files = collect_files(config)

    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("dark-blue")

    try:
        app = SorterApp(files, config)
        app.mainloop()
    except Exception as e:
        import traceback
        _startup_error(
            "MusicSorter crashed while starting:\n\n"
            f"{e}\n\n--- Traceback ---\n{traceback.format_exc()}"
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
