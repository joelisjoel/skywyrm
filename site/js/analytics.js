// Google Analytics (GA4), cookieless (approved by Joel, 2026-10-15; see
// privacy.html). Only on skywyrm.io, never on a dev or local page.
// - Consent mode keeps every storage denied, so GA sets no cookies and
//   can't tell two visits apart: it gets cookieless pings only.
// - Google signals and ad personalisation are off; the page address goes
//   without its query string (no room codes or link tags).
// - Events are fixed words from this file (the visit's funnel steps), never
//   a name or anything a player typed.
const ID = 'G-DNN6E9ZXCT';
const EVENTS = { play: 'game_start', life: 'life_end', again: 'play_again', online: 'join_online' };
let on = false;

export function startAnalytics(allowed = true) {
    if (on || !allowed || !/^(www\.)?skywyrm\.io$/.test(location.hostname)) return;
    on = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };   // gtag.js wants the arguments object itself
    window.gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
    window.gtag('set', 'ads_data_redaction', true);
    window.gtag('js', new Date());
    window.gtag('config', ID, { page_location: location.origin + location.pathname, allow_google_signals: false, allow_ad_personalization_signals: false });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${ID}`;
    document.head.append(s);
}

// A step of the visit's funnel (visit.js VISIT_STAGES), reached for the first time this visit.
export function trackStage(stage) {
    if (on && EVENTS[stage]) window.gtag('event', EVENTS[stage]);
}
