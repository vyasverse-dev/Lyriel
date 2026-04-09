function toSeconds(durationLabel) {
    if (!durationLabel || typeof durationLabel !== "string") return 0;
    const [mins, secs] = durationLabel.split(":").map((n) => Number(n) || 0);
    return mins * 60 + secs;
}

export function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const mins = Math.floor(seconds / 60);
    const secs = String(seconds % 60).padStart(2, "0");
    return `${mins}:${secs}`;
}

const VOLUME_STORAGE_KEY = "lyriel_player_volume_v1";

export class LyrielPlayer {
    constructor({ onTrackChange, onPlayStateChange, onProgress, onRepeatChange, onShuffleChange }) {
        this.audio = new Audio();
        this.audio.preload = "metadata";
        this.queue = [];
        this.currentIndex = -1;
        this.currentSong = null;
        this.repeatMode = "all";
        this.shuffle = false;
        this.onTrackChange = onTrackChange;
        this.onPlayStateChange = onPlayStateChange;
        this.onProgress = onProgress;
        this.onRepeatChange = onRepeatChange;
        this.onShuffleChange = onShuffleChange;

        try {
            const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
            if (raw != null) {
                const n = Math.max(0, Math.min(100, Number(raw)));
                if (!Number.isNaN(n)) {
                    this.audio.volume = n / 100;
                }
            }
        } catch {
            /* ignore */
        }

        this.audio.addEventListener("timeupdate", () => {
            const current = this.audio.currentTime || 0;
            const duration = this.audio.duration || toSeconds(this.currentSong?.duration);
            if (this.onProgress) this.onProgress(current, duration);
        });

        this.audio.addEventListener("play", () => {
            if (this.onPlayStateChange) this.onPlayStateChange(true);
        });

        this.audio.addEventListener("pause", () => {
            if (this.onPlayStateChange) this.onPlayStateChange(false);
        });

        this.audio.addEventListener("ended", () => {
            if (this.repeatMode === "one") {
                this.audio.currentTime = 0;
                this.audio.play().catch(() => {});
                return;
            }
            this.next();
        });
    }

    setQueue(queueSongs, startSongId = null) {
        console.log("setQueue called", { queueSongs, startSongId, count: Array.isArray(queueSongs) ? queueSongs.length : 0 });
        this.queue = Array.isArray(queueSongs) ? [...queueSongs] : [];
        if (!this.queue.length) {
            this.currentIndex = -1;
            this.currentSong = null;
            return;
        }
        if (startSongId === null || startSongId === undefined) {
            this.playSongAt(0);
            return;
        }
        const index = this.queue.findIndex((song) => song.song_id === startSongId);
        console.log("setQueue found index", { startSongId, index });
        this.playSongAt(index >= 0 ? index : 0);
    }

    playSongAt(index) {
        if (!this.queue.length) {
            console.log("playSongAt: queue is empty");
            return;
        }
        const boundedIndex = Math.max(0, Math.min(index, this.queue.length - 1));
        this.currentIndex = boundedIndex;
        this.currentSong = this.queue[this.currentIndex];
        const audioSrc = `/static/songs/${encodeURIComponent(this.currentSong.song_id)}.mp3`;
        console.log("PLAYING INDEX", { index: this.currentIndex, song: this.currentSong.song_title, src: audioSrc });
        this.audio.src = audioSrc;
        this.audio.play().catch(() => {});
        if (this.onTrackChange) this.onTrackChange(this.currentSong);
    }

    togglePlay() {
        if (!this.currentSong && this.queue.length > 0) {
            this.playSongAt(0);
            return;
        }
        if (this.audio.paused) {
            this.audio.play().catch(() => {});
            return;
        }
        this.audio.pause();
    }

    next() {
        if (!this.queue.length) return;
        if (this.shuffle && this.queue.length > 1) {
            let randomIndex = this.currentIndex;
            while (randomIndex === this.currentIndex) {
                randomIndex = Math.floor(Math.random() * this.queue.length);
            }
            this.playSongAt(randomIndex);
            return;
        }
        const nextIndex = this.currentIndex + 1;
        if (nextIndex >= this.queue.length) {
            if (this.repeatMode === "all") {
                this.playSongAt(0);
            } else {
                this.audio.pause();
            }
            return;
        }
        this.playSongAt(nextIndex);
    }

    previous() {
        if (!this.queue.length) return;
        if ((this.audio.currentTime || 0) > 5) {
            this.audio.currentTime = 0;
            return;
        }
        const prevIndex = this.currentIndex - 1;
        if (prevIndex < 0) {
            this.playSongAt(this.queue.length - 1);
            return;
        }
        this.playSongAt(prevIndex);
    }

    seek(percent) {
        const duration = this.audio.duration || toSeconds(this.currentSong?.duration);
        if (!duration) return;
        const normalized = Math.max(0, Math.min(100, Number(percent) || 0));
        this.audio.currentTime = (normalized / 100) * duration;
    }

    setVolume(value) {
        const normalized = Math.max(0, Math.min(100, Number(value) || 0)) / 100;
        this.audio.volume = normalized;
        try {
            localStorage.setItem(VOLUME_STORAGE_KEY, String(Math.round(normalized * 100)));
        } catch {
            /* ignore */
        }
    }

    getVolumePercent() {
        return Math.round((this.audio.volume || 0) * 100);
    }

    cycleRepeatMode() {
        const modes = ["all", "one", "off"];
        const nextIndex = (modes.indexOf(this.repeatMode) + 1) % modes.length;
        this.repeatMode = modes[nextIndex];
        
        // Disable shuffle when enabling repeat (unless turning repeat off)
        if (this.repeatMode !== "off" && this.shuffle) {
            this.shuffle = false;
            if (this.onShuffleChange) this.onShuffleChange(this.shuffle);
        }
        
        if (this.onRepeatChange) this.onRepeatChange(this.repeatMode);
    }

    setShuffle(value) {
        this.shuffle = Boolean(value);
        
        // Disable repeat when enabling shuffle
        if (this.shuffle && this.repeatMode !== "off") {
            this.repeatMode = "off";
            if (this.onRepeatChange) this.onRepeatChange(this.repeatMode);
        }
        
        if (this.onShuffleChange) this.onShuffleChange(this.shuffle);
    }
}
