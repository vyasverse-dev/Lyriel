import json
import os
from datetime import date
from datetime import timedelta

from flask import Flask, jsonify, redirect, render_template, request, session, url_for

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "lyriel_secret_key")
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=7)

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_DB_PATH = os.path.join(_BASE_DIR, "database.json")


def load_db():
    # Use an absolute path so login always reads the same database file.
    with open(_DB_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_db(data):
    with open(_DB_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)


def _get_current_user_id():
    return session.get("user_id")


def _clean_playlist_name(value):
    cleaned = " ".join(str(value or "").split()).strip()
    return cleaned[:80]


@app.route("/")
def home():
    if _get_current_user_id() is not None:
        return redirect(url_for("dashboard"))
    return render_template("login.html")


@app.route("/login")
def login():
    if _get_current_user_id() is not None:
        return redirect(url_for("dashboard"))
    return render_template("login.html")


@app.route("/api/login", methods=["POST"])
def api_login():
    payload = request.get_json(silent=True) or {}
    username = (payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    remember_me = bool(payload.get("remember_me"))

    if not username or not password:
        return jsonify({"status": "fail", "message": "Invalid Credentials"}), 401

    db = load_db()
    users = db.get("users", [])
    user = next((u for u in users if str(u.get("username") or "").lower() == username.lower()), None)

    auto_registered = False
    if user is None:
        max_user_id = max([int(u.get("user_id", 0)) for u in users] or [0])
        user = {
            "user_id": max_user_id + 1,
            "username": username,
            "password": password,
            "email": "",
            "created_date": date.today().isoformat(),
        }
        users.append(user)
        db["users"] = users
        save_db(db)
        auto_registered = True
    elif str(user.get("password") or "") != password:
        return jsonify({"status": "fail", "message": "Invalid Credentials"}), 401

    session["user_id"] = user.get("user_id")
    session["username"] = user.get("username")
    session.permanent = remember_me
    return jsonify({"status": "success", "success": True, "auto_registered": auto_registered})


@app.route("/api/me", methods=["GET"])
def get_me():
    user_id = _get_current_user_id()
    if user_id is None:
        return jsonify({"status": "fail", "message": "Unauthorized"}), 401

    db = load_db()
    users = db.get("users", [])
    user = next((u for u in users if u.get("user_id") == user_id), None)
    if user is None:
        return jsonify({"status": "fail", "message": "User not found"}), 404

    playlists = [p for p in db.get("playlists", []) if p.get("user_id") == user_id]
    total_songs = sum(len(p.get("song_ids") or []) for p in playlists)
    return jsonify(
        {
            "username": user.get("username", ""),
            "created_date": user.get("created_date", ""),
            "total_playlists": len(playlists),
            "total_songs": total_songs,
        }
    )


@app.route("/dashboard")
def dashboard():
    if _get_current_user_id() is None:
        return redirect(url_for("login"))
    return render_template("index.html")


@app.route("/api/playlists", methods=["GET"])
def get_playlists():
    user_id = _get_current_user_id()
    if user_id is None:
        return jsonify([]), 401
    db = load_db()
    results = [
        p
        for p in db.get("playlists", [])
        if p.get("user_id") == user_id
    ]
    return jsonify(results)


@app.route("/api/songs", methods=["GET"])
def get_songs():
    db = load_db()
    return jsonify(db.get("songs", []))


@app.route("/api/playlists/create", methods=["POST"])
def create_playlist():
    user_id = _get_current_user_id()
    if user_id is None:
        return jsonify({"status": "fail", "message": "Unauthorized"}), 401

    payload = request.get_json(silent=True) or {}
    new_name = _clean_playlist_name(payload.get("name"))
    if not new_name:
        return jsonify({"status": "fail", "message": "Playlist name cannot be empty"}), 400

    db = load_db()
    playlists = db.get("playlists", [])

    max_id = max(
        [int(p.get("playlist_id", 0)) for p in playlists if p.get("playlist_id") is not None] or [0]
    )
    new_playlist_id = max_id + 1

    new_playlist = {
        "playlist_id": new_playlist_id,
        "playlist_name": new_name,
        "user_id": user_id,
        "created_date": date.today().isoformat(),
        "song_ids": [],
    }

    playlists.append(new_playlist)
    db["playlists"] = playlists
    save_db(db)

    return jsonify({"status": "success", "playlist": new_playlist})


@app.route("/api/playlists/<int:playlist_id>/edit-name", methods=["POST"])
def edit_playlist_name(playlist_id: int):
    user_id = _get_current_user_id()
    if user_id is None:
        return jsonify({"status": "fail", "message": "Unauthorized"}), 401

    payload = request.get_json(silent=True) or {}
    new_name = _clean_playlist_name(payload.get("name"))
    if not new_name:
        return jsonify({"status": "fail", "message": "Name cannot be empty"}), 400

    db = load_db()
    playlists = db.get("playlists", [])
    playlist = next(
        (
            p
            for p in playlists
            if p.get("playlist_id") == playlist_id and p.get("user_id") == user_id
        ),
        None,
    )
    if playlist is None:
        return jsonify({"status": "fail", "message": "Playlist not found"}), 404

    playlist["playlist_name"] = new_name
    save_db(db)
    return jsonify({"status": "success", "playlist": playlist})


@app.route("/api/playlists/<int:playlist_id>", methods=["GET"])
def get_playlist_detail(playlist_id: int):
    """
    Returns playlist metadata plus the songs in the playlist, in playlist song_ids order.
    """
    user_id = _get_current_user_id()
    if user_id is None:
        return jsonify({"status": "fail", "message": "Unauthorized"}), 401

    db = load_db()
    playlist = next(
        (
            p
            for p in db.get("playlists", [])
            if p.get("playlist_id") == playlist_id and p.get("user_id") == user_id
        ),
        None,
    )
    if playlist is None:
        return jsonify({"status": "fail", "message": "Playlist not found"}), 404

    songs = db.get("songs", [])
    song_map = {s.get("song_id"): s for s in songs}
    ordered_songs = [song_map[sid] for sid in (playlist.get("song_ids") or []) if sid in song_map]

    return jsonify({"status": "success", "playlist": playlist, "songs": ordered_songs})


@app.route("/api/playlists/<int:playlist_id>/remove-song", methods=["POST"])
def remove_song_from_playlist(playlist_id: int):
    user_id = _get_current_user_id()
    if user_id is None:
        return jsonify({"status": "fail", "message": "Unauthorized"}), 401

    payload = request.get_json(silent=True) or {}
    song_id = payload.get("song_id")
    try:
        song_id = int(song_id)
    except (TypeError, ValueError):
        return jsonify({"status": "fail", "message": "Invalid song_id"}), 400

    db = load_db()
    playlists = db.get("playlists", [])
    playlist = next(
        (
            p
            for p in playlists
            if p.get("playlist_id") == playlist_id and p.get("user_id") == user_id
        ),
        None,
    )
    if playlist is None:
        return jsonify({"status": "fail", "message": "Playlist not found"}), 404

    song_ids = playlist.get("song_ids") or []
    if song_id in song_ids:
        playlist["song_ids"] = [sid for sid in song_ids if sid != song_id]
        save_db(db)
        return jsonify({"status": "success"})

    # If the song isn't present, treat as a no-op success.
    return jsonify({"status": "success", "already_removed": True})


@app.route("/api/playlists/<int:playlist_id>", methods=["DELETE"])
def delete_playlist(playlist_id: int):
    user_id = _get_current_user_id()
    if user_id is None:
        return jsonify({"status": "fail", "message": "Unauthorized"}), 401

    db = load_db()
    playlists = db.get("playlists", [])
    new_playlists = [
        p for p in playlists if not (p.get("playlist_id") == playlist_id and p.get("user_id") == user_id)
    ]
    if len(new_playlists) == len(playlists):
        return jsonify({"status": "fail", "message": "Playlist not found"}), 404

    db["playlists"] = new_playlists
    save_db(db)
    return jsonify({"status": "success"})


@app.route("/api/playlists/<int:playlist_id>/add-song", methods=["POST"])
def add_song_to_playlist(playlist_id: int):
    user_id = _get_current_user_id()
    if user_id is None:
        return jsonify({"status": "fail", "message": "Unauthorized"}), 401

    payload = request.get_json(silent=True) or {}
    song_id = payload.get("song_id")
    try:
        song_id = int(song_id)
    except (TypeError, ValueError):
        return jsonify({"status": "fail", "message": "Invalid song_id"}), 400

    db = load_db()
    playlists = db.get("playlists", [])
    playlist = next(
        (
            p
            for p in playlists
            if p.get("playlist_id") == playlist_id and p.get("user_id") == user_id
        ),
        None,
    )
    if playlist is None:
        return jsonify({"status": "fail", "message": "Playlist not found"}), 404

    songs = db.get("songs", [])
    song_exists = any(s.get("song_id") == song_id for s in songs)
    if not song_exists:
        return jsonify({"status": "fail", "message": "Song not found"}), 404

    song_ids = playlist.get("song_ids") or []
    if song_id not in song_ids:
        song_ids.append(song_id)
        playlist["song_ids"] = song_ids
        save_db(db)
        return jsonify({"status": "success", "already_exists": False})

    return jsonify({"status": "success", "already_exists": True})


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("home"))


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
