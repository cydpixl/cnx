# Connections 19.2.1 — calls and API playback

- Incoming calls show one green Join call button; media controls appear after joining.
- Calls keep Mic, Camera, Share screen, Apps and Leave visible. More contains the secondary controls.
- During a connected one-to-one call, catalog Watch now offers Watch together or Watch alone. The friend accepts Join playback.
- CineSrc and MoviesAPI share play, pause, seek, speed and episode changes using the existing authenticated WebRTC connection. Loading waits for both players and controls can be used by either viewer.
- Source choice stays fixed within a shared session so both viewers use the same version. Watch alone leaves sync while preserving the call.
- Existing uploaded-film playback, rooms, accounts and backend namespace remain intact.
- Verified with separate authenticated browser clients, actual Endgame playback through both sources, and the existing 25-check call/messaging/uploaded-playback regression.

# Connections 19 — overhaul and repair list

Source: `Connections-V13-movies-repair`. Release target: https://cydpixl.github.io/cnx/

## Calls

- [x] Rejoin an occupied call using its existing session ID. Repeated joins clean up previous peer connections, subscriptions, media tracks and heartbeat timers.
- [x] Reserve outgoing calls atomically so simultaneous dialing connects both people to one session.
- [x] Define activity by participant presence and individual heartbeat leases. Empty sessions offer Call again, and expired presence stops counting as active.
- [x] Transfer a call between signed-in devices. Prepare and verify the new connection before releasing the original device.
- [x] Move an occupied call when the friend has already left, then let the friend rejoin that same session.
- [x] Separate microphone, camera and output settings, with input level, gain, noise suppression, echo cancellation, camera preview and mirror controls.
- [x] Replace inputs without enabling a muted microphone or a disabled camera. Restore the live camera state for the peer.
- [x] Camera switching preserves its enabled state and publishes the change to the peer.
- [x] Keep both cameras visible beside the shared screen. Enlarge either camera, double-click to focus it, or open it in individual fullscreen while sharing continues.
- [x] Right-click and touch video menus offer enlargement, fullscreen, minimize/restore, picture in picture where supported, and call settings.
- [x] Rebuild the control dock with clear Leave/Rejoin states; collapse the empty-call lounge and retain camera snapshots and replay clips.

## Cinema

- [x] Open browsing and playback in an animated viewport-sized overlay, with a full-screen mobile surface and reduced-motion support.
- [x] Give playback the main canvas, with optional call companions and controls alongside it.
- [x] Closing cinema preserves the call. Ending a shared call closes its cinema surface and releases camera previews.
- [x] Manual watched/unwatched status for films and individual episodes.
- [x] Automatically mark completed films/episodes after sufficient playback, without treating a jump to the end as viewing.
- [x] Private watched history syncs between signed-in devices, with an immediate local copy.
- [x] Redesigned subtitle selection, preview, appearance, position and timing; retain track choice for each film, including streamed blob sources.

## Chat and personal space

- [x] Refined sidebar navigation, conversation spacing, profile dock, header actions and composer layout.
- [x] Activity, Sketchbook and Connections entries; searchable help with real actions.
- [x] Unified creation menu with one file-upload action and existing camera, drawing, coloring and sketchbook workflows.
- [x] Editable profile bio, brush size and drawing undo. Catalog favorites survive subsequent profile editing.
- [x] Real TMDB discovery and profile favorites through the existing catalog service; Discord/Lanyard connection preview and disconnect.
- [x] 12-hour Eastern timestamps and an AM/PM scheduling control. `America/New_York` handles EST/EDT automatically even when the browser uses a different timezone or locale.

## Verification and release

- `npm run check`: existing unit/regression suites plus call leases, episode identity, actual-viewing completion and Eastern/DST scheduling.
- Rules emulator: call reservations, transfer ownership, watched-history privacy, existing messaging/call rules, and subtitle permissions.
- Three independent browser clients using isolated emulator accounts: repeated rejoin, device transfer, simultaneous dialing, input replacement, camera enlargement during screen sharing, shared playback, subtitles, watched sync, and 390px mobile layout. Results and screenshots are in `output/playwright/v19`.
- Camera/microphone and screen-sharing QA uses controlled streams with actual WebRTC negotiation between clients. Physical iPhone PWA permissions, rear-camera hardware switching, and OS screen-picker behavior require physical-device verification.
- Release keeps the GitHub account namespace, original Firebase project, media host, and `/cnx/` asset base. Static shell updates preserve account storage.

Implementation references: [Firestore atomic writes](https://firebase.google.com/docs/firestore/manage-data/transactions), [Firestore REST commit](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit), [WebRTC input replacement](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/replaceTrack).
