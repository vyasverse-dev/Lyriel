async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    let data = {};
    try {
        data = await response.json();
    } catch (error) {
        data = {};
    }
    if (!response.ok) {
        const message = data.message || "Request failed";
        throw new Error(message);
    }
    return data;
}

function postJson(url, payload) {
    return requestJson(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
}

export const api = {
    getPlaylists() {
        return requestJson("/api/playlists");
    },
    getSongs() {
        return requestJson("/api/songs");
    },
    getMe() {
        return requestJson("/api/me");
    },
    getPlaylist(playlistId) {
        return requestJson(`/api/playlists/${playlistId}`);
    },
    createPlaylist(name) {
        return postJson("/api/playlists/create", { name });
    },
    editPlaylistName(playlistId, name) {
        return postJson(`/api/playlists/${playlistId}/edit-name`, { name });
    },
    deletePlaylist(playlistId) {
        return requestJson(`/api/playlists/${playlistId}`, { method: "DELETE" });
    },
    addSongToPlaylist(playlistId, songId) {
        return postJson(`/api/playlists/${playlistId}/add-song`, { song_id: songId });
    },
    removeSongFromPlaylist(playlistId, songId) {
        return postJson(`/api/playlists/${playlistId}/remove-song`, { song_id: songId });
    }
};
