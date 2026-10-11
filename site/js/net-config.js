// Where the multiplayer server lives: Cloud Run service "wyrm-server" in
// project dendros-wyrm (see notes/MULTIPLAYER.md). Set to '' to hide the
// server list and offer solo play only.
export const SERVER_URL = 'https://wyrm-server-420365023329.us-west1.run.app';

// Local testing: pages served from localhost may point at a local server
// or a Cloud Run URL with ?server=… (never allowed on the public site).
export function serverUrl() {
    try {
        const q = new URLSearchParams(location.search).get('server');
        const localPage = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
        if (q && localPage && /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.run\.app)$/.test(q)) return q;
    } catch { /* ignore */ }
    return SERVER_URL;
}
