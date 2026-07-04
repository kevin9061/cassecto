const audio = document.getElementById("audio");
const fileInput = document.getElementById("fileInput");
const browseBtn = document.getElementById("browseBtn");
const clearBtn = document.getElementById("clearBtn");
const dropZone = document.getElementById("dropZone");

const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

const seekBar = document.getElementById("seekBar");
const currentTimeEl = document.getElementById("currentTime");
const durationEl = document.getElementById("duration");
const volumeBar = document.getElementById("volumeBar");

const songTitle = document.getElementById("songTitle");
const trackMeta = document.getElementById("trackMeta");

const reels = document.querySelectorAll(".reel");
const windLeft = document.getElementById("windLeft");
const windRight = document.getElementById("windRight");

const playlistItemsEl = document.getElementById("playlistItems");
const playlistEmpty = document.getElementById("playlistEmpty");

let playlist = [];      // { id, name, url, order }
let currentIndex = -1;

const MIN_WIND = 20;   // px, smallest a reel's wound tape gets
const MAX_WIND = 78;   // px, matches full reel size in CSS

// ================================================================
// IndexedDB persistence — stores the actual audio file blobs so
// tracks survive page reloads / browser restarts.
// ================================================================
const DB_NAME = "cassecto-db";
const DB_VERSION = 1;
const STORE_NAME = "tracks";

let db = null;
let nextOrder = 0; // running counter so new uploads always sort after existing ones

function openDB() {
    return new Promise((resolve, reject) => {
        if (!("indexedDB" in window)) {
            reject(new Error("IndexedDB not supported"));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

function dbAddTrack(file, order) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const record = { name: file.name, type: file.type, blob: file, order };
        const req = store.add(record);
        req.onsuccess = () => resolve(req.result); // the generated id
        req.onerror = (e) => reject(e.target.error);
    });
}

function dbGetAllTracks() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result.sort((a, b) => a.order - b.order));
        req.onerror = (e) => reject(e.target.error);
    });
}

function dbDeleteTrack(id) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

function dbClearAll() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
    });
}

// ---------- Playlist rendering ----------
function renderPlaylist() {
    playlistItemsEl.innerHTML = "";
    playlistEmpty.style.display = playlist.length ? "none" : "block";

    playlist.forEach((track, i) => {
        const li = document.createElement("li");
        if (i === currentIndex) li.classList.add("active");

        const num = document.createElement("span");
        num.className = "track-num";
        num.textContent = String(i + 1).padStart(2, "0");

        const name = document.createElement("span");
        name.className = "track-name";
        name.textContent = track.name;

        const share = document.createElement("span");
        share.className = "track-share";
        share.title = "Share this track";
        share.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="5" r="3"></circle>
            <circle cx="6" cy="12" r="3"></circle>
            <circle cx="18" cy="19" r="3"></circle>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
        </svg>`;
        share.addEventListener("click", (e) => {
            e.stopPropagation();
            shareTrack(i);
        });

        const remove = document.createElement("span");
        remove.className = "track-remove";
        remove.textContent = "✕";
        remove.addEventListener("click", (e) => {
            e.stopPropagation();
            removeTrack(i);
        });

        li.appendChild(num);
        li.appendChild(name);
        li.appendChild(share);
        li.appendChild(remove);
        li.addEventListener("click", () => loadTrack(i, true));

        playlistItemsEl.appendChild(li);
    });
}

async function removeTrack(i) {
    const wasCurrent = i === currentIndex;
    const [removed] = playlist.splice(i, 1);

    if (removed) {
        URL.revokeObjectURL(removed.url);
        if (db && removed.id != null) {
            try {
                await dbDeleteTrack(removed.id);
            } catch (err) {
                console.warn("Could not remove track from storage:", err);
            }
        }
    }

    if (playlist.length === 0) {
        currentIndex = -1;
        audio.pause();
        audio.removeAttribute("src");
        songTitle.textContent = "Insert Cassette";
        trackMeta.textContent = "Drop an audio file or browse";
        stopSpin();
        resetProgress();
    } else if (wasCurrent) {
        loadTrack(Math.min(i, playlist.length - 1), true);
    } else if (i < currentIndex) {
        currentIndex--;
    }
    renderPlaylist();
}

// ---------- Simple on-screen toast (so real-device errors are actually visible) ----------
function showToast(message, isError) {
    let toast = document.getElementById("cassectoToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "cassectoToast";
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.background = isError ? "#c94f3f" : "#8ba888";
    toast.classList.add("show");
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}

// ---------- Sharing tracks (native share sheet: Nearby Share, Bluetooth, etc.) ----------
async function shareTrack(i) {
    const track = playlist[i];
    if (!track) return;

    try {
        const blob = await fetch(track.url).then(r => r.blob());

        // Native Android/iOS app (via Capacitor) — write a temp file, then open the OS share sheet
        if (window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
            if (!Capacitor.Plugins || !Capacitor.Plugins.Filesystem || !Capacitor.Plugins.Share) {
                showToast("Share plugin not installed in this build", true);
                return;
            }
            const { Filesystem, Share } = Capacitor.Plugins;

            const base64Data = await blobToBase64(blob);
            const safeName = track.name.replace(/[/\\?%*:|"<>]/g, "_");

            const written = await Filesystem.writeFile({
                path: safeName,
                data: base64Data,
                directory: "CACHE"
            });

            await Share.share({
                title: track.name,
                text: `Sharing "${track.name}" from Cassecto`,
                url: written.uri,
                dialogTitle: "Share track via"
            });
            return;
        }

        // Browser fallback — Web Share API (supports files on many mobile browsers)
        const file = new File([blob], track.name, { type: blob.type || "audio/mpeg" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                title: track.name,
                text: `Sharing "${track.name}" from Cassecto`,
                files: [file]
            });
            return;
        }

        // Last-resort fallback — trigger a plain download
        const a = document.createElement("a");
        a.href = track.url;
        a.download = track.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast("Sharing isn't supported here — downloaded instead");
    } catch (err) {
        if (err && err.name === "AbortError") return; // user cancelled the share sheet
        console.warn("Share failed:", err);
        showToast("Share failed: " + (err && err.message ? err.message : "unknown error"), true);
    }
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            // reader.result is "data:<mime>;base64,<data>" — Filesystem wants just the base64 part
            const base64 = reader.result.split(",")[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ---------- Loading files ----------

async function addFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith("audio/"));
    if (!files.length) return;

    const wasEmpty = playlist.length === 0;

    for (const file of files) {
        const order = nextOrder++;
        let id = null;

        if (db) {
            try {
                id = await dbAddTrack(file, order);
            } catch (err) {
                console.warn("Could not save track to storage:", err);
            }
        }

        playlist.push({
            id,
            name: file.name,
            url: URL.createObjectURL(file),
            order
        });
    }

    renderPlaylist();
    if (wasEmpty) loadTrack(0, true);
}

function loadTrack(index, autoplay) {
    if (index < 0 || index >= playlist.length) return;
    currentIndex = index;
    const track = playlist[index];

    audio.src = track.url;
    songTitle.textContent = track.name.replace(/\.[^/.]+$/, "");
    trackMeta.textContent = `Track ${index + 1} of ${playlist.length}`;
    renderPlaylist();

    if (autoplay) {
        audio.play().catch(() => {});
        startSpin();
    }
}

// ---------- Restore saved library on load ----------
async function restoreLibrary() {
    try {
        db = await openDB();
        const records = await dbGetAllTracks();

        if (records.length) {
            playlist = records.map(rec => ({
                id: rec.id,
                name: rec.name,
                url: URL.createObjectURL(rec.blob),
                order: rec.order
            }));
            nextOrder = Math.max(...records.map(r => r.order)) + 1;
            renderPlaylist();
            loadTrack(0, false);
        }
    } catch (err) {
        console.warn("Persistent storage unavailable — tracks will only last this session.", err);
    }
}

// ---------- Transport controls ----------
playBtn.addEventListener("click", () => {
    if (currentIndex === -1 && playlist.length) loadTrack(0, false);
    audio.play().catch(() => {});
    startSpin();
});

pauseBtn.addEventListener("click", () => {
    audio.pause();
    stopSpin();
});

stopBtn.addEventListener("click", () => {
    audio.pause();
    audio.currentTime = 0;
    stopSpin();
});

prevBtn.addEventListener("click", () => {
    if (!playlist.length) return;
    const wasPlaying = !audio.paused;
    const nextIdx = currentIndex <= 0 ? playlist.length - 1 : currentIndex - 1;
    loadTrack(nextIdx, wasPlaying);
});

nextBtn.addEventListener("click", () => {
    if (!playlist.length) return;
    const wasPlaying = !audio.paused;
    const nextIdx = currentIndex >= playlist.length - 1 ? 0 : currentIndex + 1;
    loadTrack(nextIdx, wasPlaying);
});

audio.addEventListener("ended", () => {
    if (playlist.length > 1) {
        nextBtn.click();
    } else {
        stopSpin();
    }
});

// ---------- Spin helpers ----------
function startSpin() {
    reels.forEach(r => r.classList.add("spin"));
}
function stopSpin() {
    reels.forEach(r => r.classList.remove("spin"));
}

// ---------- Progress / tape wind ----------
audio.addEventListener("loadedmetadata", () => {
    seekBar.max = Math.floor(audio.duration) || 0;
    durationEl.textContent = formatTime(audio.duration);
});

audio.addEventListener("timeupdate", () => {
    seekBar.value = Math.floor(audio.currentTime);
    currentTimeEl.textContent = formatTime(audio.currentTime);
    updateTapeWind();
});

seekBar.addEventListener("input", () => {
    audio.currentTime = seekBar.value;
    updateTapeWind();
});

function updateTapeWind() {
    if (!audio.duration) return;
    const progress = audio.currentTime / audio.duration; // 0 -> 1
    const leftSize = MAX_WIND - progress * (MAX_WIND - MIN_WIND);
    const rightSize = MIN_WIND + progress * (MAX_WIND - MIN_WIND);
    windLeft.style.width = leftSize + "px";
    windLeft.style.height = leftSize + "px";
    windRight.style.width = rightSize + "px";
    windRight.style.height = rightSize + "px";
}

function resetProgress() {
    seekBar.value = 0;
    currentTimeEl.textContent = "0:00";
    durationEl.textContent = "0:00";
    windLeft.style.width = MAX_WIND + "px";
    windLeft.style.height = MAX_WIND + "px";
    windRight.style.width = MIN_WIND + "px";
    windRight.style.height = MIN_WIND + "px";
}

function formatTime(time) {
    if (!isFinite(time)) return "0:00";
    let minutes = Math.floor(time / 60);
    let seconds = Math.floor(time % 60);
    if (seconds < 10) seconds = "0" + seconds;
    return minutes + ":" + seconds;
}

// ---------- Volume ----------
volumeBar.addEventListener("input", () => {
    audio.volume = volumeBar.value / 100;
});
audio.volume = volumeBar.value / 100;

// ---------- File input / browse ----------
browseBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", function () {
    addFiles(this.files);
    this.value = "";
});

clearBtn.addEventListener("click", async () => {
    if (!playlist.length) return;
    const ok = confirm("Clear your entire saved library? This can't be undone.");
    if (!ok) return;

    audio.pause();
    audio.removeAttribute("src");
    playlist.forEach(t => URL.revokeObjectURL(t.url));
    playlist = [];
    currentIndex = -1;
    nextOrder = 0;

    songTitle.textContent = "Insert Cassette";
    trackMeta.textContent = "Drop an audio file or browse";
    stopSpin();
    resetProgress();
    renderPlaylist();

    if (db) {
        try {
            await dbClearAll();
        } catch (err) {
            console.warn("Could not clear storage:", err);
        }
    }
});

// ---------- Drag & drop ----------
["dragenter", "dragover"].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.add("drag-over");
    });
});
["dragleave", "drop"].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
    });
});
dropZone.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

// ---------- Keyboard shortcuts ----------
document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") {
        e.preventDefault();
        audio.paused ? playBtn.click() : pauseBtn.click();
    } else if (e.code === "ArrowRight") {
        nextBtn.click();
    } else if (e.code === "ArrowLeft") {
        prevBtn.click();
    }
});

// ---------- Initial state ----------
resetProgress();
restoreLibrary();
