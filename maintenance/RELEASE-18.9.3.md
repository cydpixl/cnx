# Connections 18.9.3 — call color and mobile movie startup

Join, Rejoin and Call again use the blue accent color. Leave call remains red. Real two-account calls verified leave, rejoin and connection recovery, including phone-sized and desktop layouts.

The user confirmed the 18.9.2 portrait PWA layout repair, but Ted S2E04 still failed immediately on an iPhone 17 Pro Max installed PWA. This release removes embedded cover artwork and descriptive tags from the in-memory streaming initialization buffer. The original uploaded file, audio/video decoding setup and remote byte offsets remain unchanged. The actual Ted initialization sent to the decoder decreases from 10,261,227 bytes to 1,196 bytes. Touch seek previews no longer open a competing native file decoder; streamed desktop previews keep the timeline tooltip without scanning the entire file. Managed streaming responds to refill and eviction notifications.

Playback failures show Copy playback details, including browser capability, decoder phase, codec and error. The copied report excludes media URLs and access tokens. Retry reopens the source and recovers the current playback position. Diagnostic reports identify the built application version.

Validation: source checks, bounded metadata and initialization preservation tests, actual Ted playback with captured decoder append sizes, clipboard diagnostic copy, and recovery after a controlled decoder error. The prior call/fullscreen/shared playback regression is also exercised with the new streaming initialization. Controlled error injection tests the recovery interface; it does not reproduce the phone's decoder failure.

Physical iPhone playback is not yet verified. Windows Playwright WebKit has neither MediaSource nor ManagedMediaSource and cannot substitute for that check. The next physical failure, if any, can supply exact diagnostic details rather than only Retry playback. GitHub Pages is the release target; other hosts are outside this release.
