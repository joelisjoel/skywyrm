// Where the multiplayer server lives. Empty until the Cloud Run service is
// deployed (see 3d-snake/MULTIPLAYER.md, step 7); the lobby then shows
// "play solo" only.
export const SERVER_URL = '';

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
