# Connections 18.9.2

- Portrait PWA: off-canvas navigation, visible viewport and safe-area layout, full-width chat, compact options/search, usable message composer, and full-width film row.
- One fullscreen control per call or film; Focus/Grid and picture-in-picture remain in Call view options. Film fullscreen includes the movable camera and glassy chat controls, including its DOM fallback.
- Clear Solo Watch ownership, Back to library, uploaded-file versus streaming labels, selected season, and known episode navigation bounds.
- Heartbeats adjust playback rate without seeking. Deliberate timeline controls and explicit Resync remain functional.
- Read large bounded MP4 startup metadata before streaming. Actual Ted S2E04 has approximately 10 MB of metadata from embedded artwork; the old 1 MB probe forced a scan of the 1.89 GB film.
- Voice-call camera activation negotiates sending direction. Streamless camera tracks cannot be mistaken for absent screen sharing. Cinema camera copies are muted to prevent duplicate audio.

Validation: source checks, startup checks, messaging/media/game regressions, and two isolated real Chrome contexts. Actual Ted episode decoded solo and for both call participants. Portrait bounds verified at 320–440 px, plus reduced viewport and landscape. Call/film fullscreen, camera/chat overlay, fallback close, shared pause/play, and explicit Resync passed. Sixty-eight samples across multiple real heartbeat intervals showed zero automatic backward jumps with an intentionally ahead receiver.

Physical installed iPhone PWA behavior still needs device verification. WebRTC QA uses browser camera fixtures and existing recorded audio; no generated audio. External streaming availability is independent of uploaded movie playback. Existing uploaded files were read only. Cloudflare publication remains deferred by user instruction. This release does not certify the entire Discord reference feature register.
