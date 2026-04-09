import { api } from "./api.js";
import { LyrielPlayer, formatTime } from "./player.js";

const username = document.body.dataset.username || "Guest";
const themeStorageKey = "lyriel_theme";
const favoritesStorageKey = `lyriel_favorites_${username}`;
const recentStorageKey = `lyriel_recent_${username}`;
const lastPlayedStorageKey = `lyriel_last_played_${username}`;
const placeholderCover = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#5a77ff"/><stop offset="100%" stop-color="#72f1b8"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><text x="50%" y="54%" text-anchor="middle" font-size="72" fill="white" font-family="Arial">♫</text></svg>')}`;

function normalizeFavoriteIds(raw) {
    try {
        const parsed = JSON.parse(raw || "[]");
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.map((id) => Number(id)).filter((n) => !Number.isNaN(n)));
    } catch {
        return new Set();
    }
}

const state = {
    playlists: [],
    songs: [],
    filteredSongs: [],
    playlistSongs: [],
    /** Sorted copy used for playlist view + Play Playlist (matches UI order) */
    playlistSongsSorted: [],
    selectedPlaylistId: null,
    activeView: "home",
    searchSortCriteria: "title",
    searchSortOrder: "asc",
    playlistSortCriteria: "title",
    playlistSortOrder: "asc",
    searchQuery: "",
    searchField: "all",
    renderLimit: 50,
    renderStep: 50,
    favorites: normalizeFavoriteIds(localStorage.getItem(favoritesStorageKey)),
    recentlyPlayed: JSON.parse(localStorage.getItem(recentStorageKey) || "[]"),
    me: null,
    loadingSongs: false,
    lastProgressPersistAt: 0
};

const refs = {
    views: {
        home: document.getElementById("homeView"),
        search: document.getElementById("searchView"),
        playlist: document.getElementById("playlistView")
    },
    navItems: document.querySelectorAll(".nav-item[data-view]"),
    sidePlaylistList: document.getElementById("sidePlaylistList"),
    playlistGrid: document.getElementById("playlistGrid"),
    recentlyPlayedList: document.getElementById("recentlyPlayedList"),
    searchInput: document.getElementById("searchInput"),
    clearSearchBtn: document.getElementById("clearSearchBtn"),
    sortSongsSelect: document.getElementById("sortSongsSelect"),
    sortSongsOrderSelect: document.getElementById("sortSongsOrderSelect"),
    sortPlaylistSelect: document.getElementById("sortPlaylistSelect"),
    sortPlaylistOrderSelect: document.getElementById("sortPlaylistOrderSelect"),
    quickFilterButtons: document.querySelectorAll(".quick-filter-btn"),
    searchSongTable: document.getElementById("searchSongTable"),
    searchEmptyState: document.getElementById("searchEmptyState"),
    loadMoreSongsBtn: document.getElementById("loadMoreSongsBtn"),
    songSkeleton: document.getElementById("songSkeleton"),
    playlistSongTable: document.getElementById("playlistSongTable"),
    playlistTitle: document.getElementById("playlistTitle"),
    createPlaylistBtn: document.getElementById("createPlaylistBtn"),
    backToHomeBtn: document.getElementById("backToHomeBtn"),
    renamePlaylistBtn: document.getElementById("renamePlaylistBtn"),
    deletePlaylistBtn: document.getElementById("deletePlaylistBtn"),
    playPlaylistBtn: document.getElementById("playPlaylistBtn"),
    toastContainer: document.getElementById("toastContainer"),
    currentTrackTitle: document.getElementById("currentTrackTitle"),
    currentTrackArtist: document.getElementById("currentTrackArtist"),
    nowPlayingCover: document.getElementById("nowPlayingCover"),
    favoriteCurrentBtn: document.getElementById("favoriteCurrentBtn"),
    shuffleBtn: document.getElementById("shuffleBtn"),
    repeatBtn: document.getElementById("repeatBtn"),
    prevBtn: document.getElementById("prevBtn"),
    playPauseBtn: document.getElementById("playPauseBtn"),
    nextBtn: document.getElementById("nextBtn"),
    seekBar: document.getElementById("seekBar"),
    currentTimeLabel: document.getElementById("currentTimeLabel"),
    durationLabel: document.getElementById("durationLabel"),
    volumeRange: document.getElementById("volumeRange"),
    themeToggleBtn: document.getElementById("themeToggleBtn"),
    memberSinceText: document.getElementById("memberSinceText"),
    logoutLink: document.getElementById("logoutLink"),
    profileName: document.getElementById("profileName"),
    profileCreatedAt: document.getElementById("profileCreatedAt"),
    profilePlaylistCount: document.getElementById("profilePlaylistCount"),
    profileSongCount: document.getElementById("profileSongCount"),
    profileFavoriteCount: document.getElementById("profileFavoriteCount"),
    profileRecentCount: document.getElementById("profileRecentCount")
};

const player = new LyrielPlayer({
    onTrackChange: (song) => {
        refs.currentTrackTitle.textContent = song.song_title || "Unknown";
        refs.currentTrackArtist.textContent = song.artist || "Unknown Artist";
        refs.nowPlayingCover.src = getCoverSrc(song.song_id);
        refs.nowPlayingCover.onerror = () => {
            refs.nowPlayingCover.onerror = null;
            refs.nowPlayingCover.src = placeholderCover;
        };
        updateFavoriteCurrentButton();
        pushRecentlyPlayed(song.song_id);
        persistLastPlayed(song.song_id, 0);
        renderRecentlyPlayed();
        updatePlayingRowHighlight();
    },
    onPlayStateChange: (isPlaying) => {
        refs.playPauseBtn.textContent = isPlaying ? "⏸" : "▶";
    },
    onProgress: (current, duration) => {
        refs.currentTimeLabel.textContent = formatTime(current);
        refs.durationLabel.textContent = formatTime(duration);
        const percent = duration ? ((current / duration) * 100).toFixed(2) : 0;
        refs.seekBar.value = percent;
        refs.seekBar.style.setProperty("--seek-progress", `${percent}%`);
        refs.seekBar.parentElement?.style.setProperty("--seek-progress", `${percent}%`);
        const now = Date.now();
        if (player.currentSong && now - state.lastProgressPersistAt > 1200) {
            state.lastProgressPersistAt = now;
            persistLastPlayed(player.currentSong.song_id, current);
        }
    },
    onRepeatChange: (mode) => {
        refs.repeatBtn.textContent = mode === "one" ? "🔂" : "🔁";
        refs.repeatBtn.classList.toggle("favorite-active", mode !== "off");
    },
    onShuffleChange: (isEnabled) => {
        refs.shuffleBtn.classList.toggle("favorite-active", isEnabled);
    }
});

function debounce(fn, delay = 280) {
    let timer = null;
    return (...args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    refs.toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 2200);
}

function setLoading(button, loadingText, callback) {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = loadingText;
    return Promise.resolve(callback()).finally(() => {
        button.disabled = false;
        button.textContent = originalText;
    });
}

function getCoverSrc(songId) {
    return `/static/covers/${encodeURIComponent(songId)}.jpg`;
}

function applyCoverFallback() {
    document.querySelectorAll("img[data-cover]").forEach((img) => {
        img.onerror = () => {
            img.onerror = null;
            const fallbackText = img.dataset.fallbackText || img.alt || "Lyriel";
            img.src = buildInitialsCover(fallbackText);
        };
    });
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function parseDuration(duration) {
    if (!duration || typeof duration !== "string") return 0;
    const [mins, secs] = duration.split(":").map((n) => Number(n) || 0);
    return mins * 60 + secs;
}

function buildInitialsCover(text) {
    const raw = String(text || "Lyriel").trim();
    const initials = raw
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || "")
        .join("") || "L";
    const seed = raw
        .split("")
        .reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const hueA = seed % 360;
    const hueB = (seed * 3 + 97) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="hsl(${hueA},70%,35%)"/><stop offset="100%" stop-color="hsl(${hueB},70%,25%)"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><text x="50%" y="55%" text-anchor="middle" font-size="96" fill="rgba(255,255,255,0.92)" font-family="Arial, sans-serif">${initials}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function formatDurationLabel(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const mins = Math.floor(safe / 60);
    const secs = String(Math.floor(safe % 60)).padStart(2, "0");
    return `${mins}:${secs}`;
}

function getPlaylistById(playlistId) {
    return state.playlists.find((item) => item.playlist_id === playlistId) || null;
}

function getSongMap() {
    return new Map(state.songs.map((song) => [song.song_id, song]));
}

function getPlaylistMeta(playlist) {
    const songMap = getSongMap();
    const songIds = Array.isArray(playlist.song_ids) ? playlist.song_ids : [];
    const totalSongs = songIds.length;
    const totalDuration = songIds.reduce((sum, id) => sum + parseDuration(songMap.get(id)?.duration), 0);
    return { totalSongs, totalDuration };
}

function saveFavorites() {
    localStorage.setItem(favoritesStorageKey, JSON.stringify([...state.favorites]));
}

function toggleFavorite(songId) {
    const id = Number(songId);
    if (Number.isNaN(id)) return;
    if (state.favorites.has(id)) {
        state.favorites.delete(id);
    } else {
        state.favorites.add(id);
    }
    saveFavorites();
    updateFavoriteCurrentButton();
    renderProfileCard();
    renderSearchTable();
    renderPlaylistSongs();
}

function isFavoriteSongId(songId) {
    const id = Number(songId);
    return !Number.isNaN(id) && state.favorites.has(id);
}

function updatePlayingRowHighlight() {
    const currentId = player.currentSong?.song_id;
    document.querySelectorAll(".song-row[data-song-id]").forEach((row) => {
        const rowId = Number(row.dataset.songId);
        const match = currentId != null && !Number.isNaN(rowId) && Number(currentId) === rowId;
        row.classList.toggle("song-row--playing", match);
    });
}

function updateFavoriteCurrentButton() {
    const songId = player.currentSong?.song_id;
    if (songId == null || songId === "") {
        refs.favoriteCurrentBtn.textContent = "♡";
        refs.favoriteCurrentBtn.classList.remove("favorite-active");
        return;
    }
    const id = Number(songId);
    const active = !Number.isNaN(id) && state.favorites.has(id);
    refs.favoriteCurrentBtn.textContent = active ? "♥" : "♡";
    refs.favoriteCurrentBtn.classList.toggle("favorite-active", active);
}

function pushRecentlyPlayed(songId) {
    state.recentlyPlayed = [songId, ...state.recentlyPlayed.filter((id) => id !== songId)].slice(0, 12);
    localStorage.setItem(recentStorageKey, JSON.stringify(state.recentlyPlayed));
}

function persistLastPlayed(songId, currentTime) {
    const payload = { song_id: songId, at: Math.floor(currentTime || 0), ts: Date.now() };
    localStorage.setItem(lastPlayedStorageKey, JSON.stringify(payload));
}

function restoreLastPlayed() {
    const saved = JSON.parse(localStorage.getItem(lastPlayedStorageKey) || "null");
    if (!saved || !saved.song_id) return;
    const song = state.songs.find((item) => item.song_id === saved.song_id);
    if (!song) return;
    player.setQueue(state.songs, song.song_id);
    if (saved.at > 0) {
        setTimeout(() => {
            if (!Number.isNaN(saved.at)) {
                player.audio.currentTime = saved.at;
            }
        }, 350);
    }
}

function renderRecentlyPlayed() {
    const songsById = getSongMap();
    const items = state.recentlyPlayed
        .map((songId) => songsById.get(songId))
        .filter(Boolean)
        .slice(0, 8);
    if (!items.length) {
        refs.recentlyPlayedList.innerHTML = `<div class="recent-item"><div class="recent-title">No recent songs</div><div class="recent-meta">Play any track to see history.</div></div>`;
        return;
    }
    refs.recentlyPlayedList.innerHTML = items.map((song) => `
        <div class="recent-item" data-song-id="${song.song_id}">
            <div class="recent-title">${escapeHtml(song.song_title)}</div>
            <div class="recent-meta">${escapeHtml(song.artist)}</div>
        </div>
    `).join("");
    refs.recentlyPlayedList.querySelectorAll(".recent-item[data-song-id]").forEach((item) => {
        item.addEventListener("click", () => {
            const songId = Number(item.dataset.songId);
            player.setQueue(state.songs, songId);
        });
    });
}

function compareByKey(a, b, key) {
    if (key === "duration") {
        return parseDuration(a.duration) - parseDuration(b.duration);
    }
    if (key === "artist") {
        return String(a.artist || "").localeCompare(String(b.artist || ""));
    }
    return String(a.song_title || "").localeCompare(String(b.song_title || ""));
}

function applySort(songArray, criteria, order) {
    const primary = criteria || "title";
    const direction = order === "desc" ? -1 : 1;
    const secondary = primary === "artist" ? "title" : "artist";
    const tertiary = "duration";
    const sorted = [...songArray].sort((a, b) => {
        const first = compareByKey(a, b, primary);
        if (first !== 0) return first * direction;
        const second = compareByKey(a, b, secondary);
        if (second !== 0) return second * direction;
        return compareByKey(a, b, tertiary) * direction;
    });
    return sorted;
}

function smoothTableRender(tableBody, html, onUpdate) {
    tableBody.classList.add("table-updating");
    requestAnimationFrame(() => {
        tableBody.innerHTML = html;
        tableBody.classList.remove("table-updating");
        if (onUpdate) onUpdate();
    });
}

function matchesSong(song, query) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const title = String(song.song_title || "").toLowerCase();
    const artist = String(song.artist || "").toLowerCase();
    const album = String(song.album || "").toLowerCase();
    if (state.searchField === "title") return title.includes(q);
    if (state.searchField === "artist") return artist.includes(q);
    if (state.searchField === "album") return album.includes(q);
    return title.includes(q) || artist.includes(q) || album.includes(q);
}

function highlightMatch(rawText) {
    const text = String(rawText || "");
    const query = state.searchQuery.trim();
    if (!query) return escapeHtml(text);
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matcher = new RegExp(`(${escapedQuery})`, "ig");
    return escapeHtml(text).replace(matcher, "<mark>$1</mark>");
}

function playlistOptionsHtml() {
    if (!state.playlists.length) {
        return `<option value="">No playlists</option>`;
    }
    return state.playlists.map((playlist) => (
        `<option value="${playlist.playlist_id}">${escapeHtml(playlist.playlist_name)}</option>`
    )).join("");
}

function renderSidebarPlaylists() {
    refs.sidePlaylistList.innerHTML = state.playlists.map((playlist) => `
        <div class="side-playlist-item ${playlist.playlist_id === state.selectedPlaylistId ? "active" : ""}" data-playlist-id="${playlist.playlist_id}">
            ${escapeHtml(playlist.playlist_name)}
        </div>
    `).join("");
    refs.sidePlaylistList.querySelectorAll(".side-playlist-item").forEach((item) => {
        item.addEventListener("click", () => {
            openPlaylist(Number(item.dataset.playlistId));
        });
    });
}

function renderProfileCard() {
    const me = state.me || {};
    refs.profileName.textContent = me.username || username;
    refs.profilePlaylistCount.textContent = String(me.total_playlists || state.playlists.length || 0);
    refs.profileSongCount.textContent = String(me.total_songs || 0);
    refs.profileFavoriteCount.textContent = String(state.favorites.size);
    refs.profileRecentCount.textContent = String(state.recentlyPlayed.length);
    refs.profileCreatedAt.textContent = me.created_date ? `Joined ${me.created_date}` : "";
}

function renderPlaylistGrid() {
    refs.playlistGrid.innerHTML = state.playlists.map((playlist) => {
        const { totalSongs, totalDuration } = getPlaylistMeta(playlist);
        return `
            <article class="playlist-card" data-playlist-id="${playlist.playlist_id}">
                <img class="playlist-cover" data-cover data-fallback-text="${escapeHtml(playlist.playlist_name)}" src="${getCoverSrc((playlist.song_ids || [])[0] || 0)}" alt="${escapeHtml(playlist.playlist_name)} cover">
                <strong class="playlist-name">${escapeHtml(playlist.playlist_name)}</strong>
                <p class="playlist-by">${escapeHtml(username)}</p>
                <p class="playlist-stats">${totalSongs} songs • ${formatDurationLabel(totalDuration)}</p>
                <button class="card-play-btn" type="button" data-play-id="${playlist.playlist_id}">▶</button>
            </article>
        `;
    }).join("");
    applyCoverFallback();
    refs.playlistGrid.querySelectorAll(".playlist-card").forEach((card) => {
        card.addEventListener("click", () => {
            openPlaylist(Number(card.dataset.playlistId));
        });
    });
    refs.playlistGrid.querySelectorAll(".card-play-btn").forEach((button) => {
        button.addEventListener("click", async (event) => {
            event.stopPropagation();
            const playlistId = Number(button.dataset.playId);
            const detail = await api.getPlaylist(playlistId);
            const songs = detail.songs || [];
            if (!songs.length) {
                showToast("Playlist is empty");
                return;
            }
            const sorted = applySort(songs, state.playlistSortCriteria, state.playlistSortOrder);
            player.setQueue(sorted, sorted[0].song_id);
            showToast("Playing playlist");
        });
    });
}

function updateSearchMeta(total) {
    refs.searchEmptyState.classList.toggle("hidden", total > 0 || state.loadingSongs);
    const canLoadMore = total > state.renderLimit;
    refs.loadMoreSongsBtn.classList.toggle("hidden", !canLoadMore);
}

function renderSearchTable() {
    const options = playlistOptionsHtml();
    const filtered = state.songs.filter((song) => matchesSong(song, state.searchQuery));
    const list = applySort(filtered, state.searchSortCriteria, state.searchSortOrder);
    state.filteredSongs = list;
    const viewList = list.slice(0, state.renderLimit);
    const rows = viewList.map((song, index) => `
        <tr class="song-row" data-song-id="${song.song_id}">
            <td>${index + 1}</td>
            <td>
                <div class="song-main">
                    <img class="song-cover" data-cover data-fallback-text="${escapeHtml(song.song_title)}" src="${getCoverSrc(song.song_id)}" alt="${escapeHtml(song.song_title)} cover">
                    <span class="song-title">${highlightMatch(song.song_title)}</span>
                </div>
            </td>
            <td>${highlightMatch(song.artist)}</td>
            <td>${highlightMatch(song.album)}</td>
            <td>${escapeHtml(song.duration)}</td>
            <td>
                <button class="favorite-btn ${isFavoriteSongId(song.song_id) ? "favorite-active" : ""}" type="button" data-favorite-song-id="${song.song_id}">
                    ${isFavoriteSongId(song.song_id) ? "♥" : "♡"}
                </button>
            </td>
            <td>
                <div class="action-wrap">
                    <select class="playlist-select" ${state.playlists.length ? "" : "disabled"}>
                        ${options}
                    </select>
                    <button class="add-plus-btn" type="button" data-add-song-id="${song.song_id}" ${state.playlists.length ? "" : "disabled"}>+</button>
                </div>
            </td>
        </tr>
    `).join("");
    
    smoothTableRender(refs.searchSongTable, rows, () => {
        applyCoverFallback();
        updateSearchMeta(list.length);
        updatePlayingRowHighlight();

        refs.searchSongTable.querySelectorAll(".song-row").forEach((row) => {
            row.addEventListener("click", () => {
                const songId = Number(row.dataset.songId);
                console.log("CLICKED SEARCH SONG", { songId, song: state.filteredSongs.find(s => s.song_id === songId) });
                player.setQueue(state.filteredSongs, songId);
                console.log("QUEUE SET", state.filteredSongs, songId);
            });
        });

        refs.searchSongTable.querySelectorAll("[data-favorite-song-id]").forEach((button) => {
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                const songId = Number(button.dataset.favoriteSongId);
                console.log("FAVORITE CLICKED (SEARCH)", songId);
                toggleFavorite(songId);
            });
        });

        refs.searchSongTable.querySelectorAll("[data-add-song-id]").forEach((button) => {
            button.addEventListener("click", async (event) => {
                event.stopPropagation();
                const songId = Number(button.dataset.addSongId);
                const select = button.parentElement.querySelector("select.playlist-select");
                const playlistId = Number(select.value);
                if (!playlistId) return;
                await setLoading(button, "…", async () => {
                    const result = await api.addSongToPlaylist(playlistId, songId);
                    if (result.already_exists) {
                        showToast("Song already exists in playlist");
                    } else {
                        showToast("Song added to playlist");
                    }
                    await refreshLibrary();
                }).catch((error) => {
                    showToast(error.message);
                });
            });
        });
    });
}

function renderPlaylistSongs() {
    const sortedPlaylistSongs = applySort(state.playlistSongs, state.playlistSortCriteria, state.playlistSortOrder);
    state.playlistSongsSorted = sortedPlaylistSongs;
    const rows = sortedPlaylistSongs.map((song, index) => `
        <tr class="song-row" data-song-id="${song.song_id}">
            <td>${index + 1}</td>
            <td>
                <div class="song-main">
                    <img class="song-cover" data-cover data-fallback-text="${escapeHtml(song.song_title)}" src="${getCoverSrc(song.song_id)}" alt="${escapeHtml(song.song_title)} cover">
                    <span class="song-title">${escapeHtml(song.song_title)}</span>
                </div>
            </td>
            <td>${escapeHtml(song.artist)}</td>
            <td>${escapeHtml(song.duration)}</td>
            <td>
                <button class="favorite-btn ${isFavoriteSongId(song.song_id) ? "favorite-active" : ""}" type="button" data-favorite-song-id="${song.song_id}">
                    ${isFavoriteSongId(song.song_id) ? "♥" : "♡"}
                </button>
            </td>
            <td>
                <button class="remove-btn" type="button" data-remove-song-id="${song.song_id}">−</button>
            </td>
        </tr>
    `).join("");
    
    smoothTableRender(refs.playlistSongTable, rows, () => {
        applyCoverFallback();
        updatePlayingRowHighlight();

        refs.playlistSongTable.querySelectorAll(".song-row").forEach((row) => {
            row.addEventListener("click", () => {
                const songId = Number(row.dataset.songId);
                console.log("CLICKED PLAYLIST SONG", { songId, song: sortedPlaylistSongs.find(s => s.song_id === songId) });
                player.setQueue(sortedPlaylistSongs, songId);
                console.log("QUEUE SET", sortedPlaylistSongs, songId);
            });
        });

        refs.playlistSongTable.querySelectorAll("[data-remove-song-id]").forEach((button) => {
            button.addEventListener("click", async (event) => {
                event.stopPropagation();
                const songId = Number(button.dataset.removeSongId);
                if (!state.selectedPlaylistId) return;
                await setLoading(button, "…", async () => {
                    await api.removeSongFromPlaylist(state.selectedPlaylistId, songId);
                    showToast("Song removed");
                    await openPlaylist(state.selectedPlaylistId);
                    await refreshLibrary();
                }).catch((error) => {
                    showToast(error.message);
                });
            });
        });

        refs.playlistSongTable.querySelectorAll("[data-favorite-song-id]").forEach((button) => {
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                const songId = Number(button.dataset.favoriteSongId);
                console.log("FAVORITE CLICKED (PLAYLIST)", songId);
                toggleFavorite(songId);
            });
        });
    });
}

function setActiveView(view) {
    state.activeView = view;
    Object.entries(refs.views).forEach(([key, node]) => {
        const isActive = key === view;
        node.classList.toggle("active", isActive);
        if (isActive) {
            node.classList.remove("view-enter");
            void node.offsetWidth;
            node.classList.add("view-enter");
        } else {
            node.classList.remove("view-enter");
        }
    });
    refs.navItems.forEach((button) => {
        button.classList.toggle("active", button.dataset.view === view);
    });
}

async function openPlaylist(playlistId) {
    state.selectedPlaylistId = playlistId;
    renderSidebarPlaylists();
    setActiveView("playlist");
    const detail = await api.getPlaylist(playlistId).catch((error) => {
        showToast(error.message);
        return null;
    });
    if (!detail) return;
    const playlist = detail.playlist || getPlaylistById(playlistId);
    const meta = getPlaylistMeta(detail.playlist || playlist || { song_ids: [] });
    refs.playlistTitle.textContent = `${playlist?.playlist_name || "Playlist"} • ${meta.totalSongs} songs • ${formatDurationLabel(meta.totalDuration)}`;
    state.playlistSongs = detail.songs || [];
    renderPlaylistSongs();
}

function renderSongSkeleton() {
    refs.songSkeleton.innerHTML = Array.from({ length: 7 }).map(() => (
        `<div class="skeleton-row"><div class="skeleton-block"></div><div class="skeleton-block short"></div><div class="skeleton-block short"></div></div>`
    )).join("");
    refs.songSkeleton.classList.toggle("hidden", !state.loadingSongs);
}

async function refreshLibrary() {
    state.loadingSongs = true;
    renderSongSkeleton();
    const [playlists, songs, me] = await Promise.all([api.getPlaylists(), api.getSongs(), api.getMe()]);
    state.playlists = playlists;
    state.songs = songs;
    state.me = me;
    state.loadingSongs = false;
    renderSongSkeleton();
    renderSidebarPlaylists();
    renderPlaylistGrid();
    renderSearchTable();
    renderRecentlyPlayed();
    renderProfileCard();
}

function normalizeName(name) {
    return String(name || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

async function createPlaylist() {
    const input = prompt("Enter playlist name");
    if (input === null) return;
    const name = normalizeName(input);
    if (!name) {
        showToast("Playlist name cannot be empty");
        return;
    }
    await setLoading(refs.createPlaylistBtn, "…", async () => {
        await api.createPlaylist(name);
        await refreshLibrary();
        showToast("Playlist created");
    }).catch((error) => {
        showToast(error.message);
    });
}

async function renameSelectedPlaylist() {
    if (!state.selectedPlaylistId) return;
    const existing = getPlaylistById(state.selectedPlaylistId);
    const input = prompt("Rename playlist", existing?.playlist_name || "");
    if (input === null) return;
    const name = normalizeName(input);
    if (!name) {
        showToast("Playlist name cannot be empty");
        return;
    }
    await setLoading(refs.renamePlaylistBtn, "…", async () => {
        await api.editPlaylistName(state.selectedPlaylistId, name);
        await refreshLibrary();
        await openPlaylist(state.selectedPlaylistId);
        showToast("Playlist renamed");
    }).catch((error) => {
        showToast(error.message);
    });
}

async function deleteSelectedPlaylist() {
    if (!state.selectedPlaylistId) return;
    if (!confirm("Delete this playlist permanently?")) return;
    await setLoading(refs.deletePlaylistBtn, "…", async () => {
        await api.deletePlaylist(state.selectedPlaylistId);
        state.selectedPlaylistId = null;
        state.playlistSongs = [];
        state.playlistSongsSorted = [];
        await refreshLibrary();
        setActiveView("home");
        showToast("Playlist deleted");
    }).catch((error) => {
        showToast(error.message);
    });
}

function updateTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    refs.themeToggleBtn.textContent = theme === "dark" ? "☀" : "🌙";
    localStorage.setItem(themeStorageKey, theme);
}

function renderMemberSince() {
    const createdAt = state.me?.created_date;
    if (!refs.memberSinceText) return;
    if (!createdAt) {
        refs.memberSinceText.textContent = "";
        return;
    }
    refs.memberSinceText.textContent = `Member since: ${createdAt}`;
}

function attachRipple(event) {
    const origin = event.target;
    if (!(origin instanceof HTMLElement)) return;
    const btn = origin.closest("button");
    if (!btn) return;
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    const rect = btn.getBoundingClientRect();
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 450);
}

function bindKeyboardShortcuts() {
    document.addEventListener("keydown", (event) => {
        const active = document.activeElement;
        const tag = active?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        if (event.code === "Space") {
            event.preventDefault();
            player.togglePlay();
        } else if (event.code === "ArrowRight") {
            event.preventDefault();
            player.next();
        } else if (event.code === "ArrowLeft") {
            event.preventDefault();
            player.previous();
        }
    });
}

function bindEvents() {
    refs.navItems.forEach((button) => {
        button.addEventListener("click", () => {
            setActiveView(button.dataset.view);
            state.selectedPlaylistId = null;
            renderSidebarPlaylists();
        });
    });
    refs.createPlaylistBtn.addEventListener("click", createPlaylist);
    refs.backToHomeBtn.addEventListener("click", () => {
        state.selectedPlaylistId = null;
        setActiveView("home");
        renderSidebarPlaylists();
    });
    refs.renamePlaylistBtn.addEventListener("click", renameSelectedPlaylist);
    refs.deletePlaylistBtn.addEventListener("click", deleteSelectedPlaylist);
    refs.playPlaylistBtn.addEventListener("click", () => {
        const queue = state.playlistSongsSorted.length
            ? state.playlistSongsSorted
            : state.playlistSongs;
        if (!queue.length) {
            showToast("Playlist is empty");
            return;
        }
        player.setQueue(queue, queue[0].song_id);
    });

    const applySearch = debounce(() => {
        state.searchQuery = refs.searchInput.value.trim();
        state.renderLimit = state.renderStep;
        renderSearchTable();
    }, 220);
    refs.searchInput.addEventListener("input", applySearch);
    refs.clearSearchBtn.addEventListener("click", () => {
        refs.searchInput.value = "";
        state.searchQuery = "";
        state.renderLimit = state.renderStep;
        renderSearchTable();
        refs.searchInput.focus();
    });
    refs.sortSongsSelect.addEventListener("change", () => {
        state.searchSortCriteria = refs.sortSongsSelect.value;
        renderSearchTable();
    });
    refs.sortSongsOrderSelect.addEventListener("change", () => {
        state.searchSortOrder = refs.sortSongsOrderSelect.value;
        renderSearchTable();
    });
    refs.sortPlaylistSelect.addEventListener("change", () => {
        state.playlistSortCriteria = refs.sortPlaylistSelect.value;
        renderPlaylistSongs();
    });
    refs.sortPlaylistOrderSelect.addEventListener("change", () => {
        state.playlistSortOrder = refs.sortPlaylistOrderSelect.value;
        renderPlaylistSongs();
    });
    refs.quickFilterButtons.forEach((button) => {
        button.addEventListener("click", () => {
            refs.quickFilterButtons.forEach((item) => item.classList.remove("active"));
            button.classList.add("active");
            state.searchField = button.dataset.filterKey || "all";
            state.renderLimit = state.renderStep;
            renderSearchTable();
        });
    });
    refs.loadMoreSongsBtn.addEventListener("click", () => {
        state.renderLimit += state.renderStep;
        renderSearchTable();
    });

    refs.playPauseBtn.addEventListener("click", () => player.togglePlay());
    refs.prevBtn.addEventListener("click", () => player.previous());
    refs.nextBtn.addEventListener("click", () => player.next());
    refs.seekBar.addEventListener("input", () => {
        const p = refs.seekBar.value;
        player.seek(p);
        refs.seekBar.style.setProperty("--seek-progress", `${p}%`);
        refs.seekBar.parentElement?.style.setProperty("--seek-progress", `${p}%`);
    });
    refs.volumeRange.addEventListener("input", () => player.setVolume(refs.volumeRange.value));
    refs.shuffleBtn.addEventListener("click", () => player.setShuffle(!player.shuffle));
    refs.repeatBtn.addEventListener("click", () => player.cycleRepeatMode());
    refs.favoriteCurrentBtn.addEventListener("click", () => {
        const songId = player.currentSong?.song_id;
        if (!songId) return;
        toggleFavorite(songId);
    });

    refs.themeToggleBtn.addEventListener("click", () => {
        const current = document.documentElement.getAttribute("data-theme") || "dark";
        updateTheme(current === "dark" ? "light" : "dark");
    });
    document.addEventListener("click", attachRipple);
    bindKeyboardShortcuts();
}

async function bootstrap() {
    const savedTheme = localStorage.getItem(themeStorageKey) || "dark";
    updateTheme(savedTheme);
    bindEvents();
    refs.volumeRange.value = String(player.getVolumePercent());
    await refreshLibrary().catch((error) => {
        showToast(error.message);
    });
    const seenWelcomeKey = `lyriel_welcome_seen_${username}`;
    if (!sessionStorage.getItem(seenWelcomeKey)) {
        showToast(`Welcome back, ${username}`);
        sessionStorage.setItem(seenWelcomeKey, "1");
    }
    renderMemberSince();
    restoreLastPlayed();
}

bootstrap();
