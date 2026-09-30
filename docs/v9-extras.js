(async () => {
  'use strict';
  const VERSION = '9.0';
  const REACTIONS = { like: '👍', heart: '❤️', laugh: '😂', wow: '😮', sad: '😢', fire: '🔥', celebrate: '🎉' };
  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function waitForRuntime() {
    for (let i = 0; i < 240; i++) {
      if (window.__connectionsRuntime?.state) return window.__connectionsRuntime;
      await sleep(50);
    }
    console.warn('[Connections v9] Runtime was not exposed.');
    return null;
  }

  const rt = await waitForRuntime();
  if (!rt) return;
  const { state, db, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, onSnapshot, serverTimestamp } = rt;

  const valueMillis = value => {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'number') return value;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toast = message => rt.toast?.(message);
  const currentConnection = () => state.connections?.find(connection => connection.id === state.activeId) || null;
  const peerUidFor = connection => connection?.members?.find(uid => uid !== state.user?.uid) || '';
  const currentPeerUid = () => peerUidFor(currentConnection());
  const messageRef = id => state.activeId && id ? doc(db, 'connections', state.activeId, 'messages', id) : null;
  const findMessage = id => {
    if (!id) return null;
    return state.messageRows?.find(item => item.id === id) || state.pendingMessages?.get(id) || null;
  };

  /* ---------- Presence + live peer profiles ---------- */
  const peerWatchers = new Map();
  let presenceWriteAt = 0;
  let presenceTimer = null;
  let activePeerProfile = null;
  let lastPresenceText = '';

  function formatLastActive(ms) {
    if (!ms) return 'Offline';
    const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (seconds < 90) return 'Active recently';
    if (seconds < 3600) return `Last active ${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `Last active ${Math.floor(seconds / 3600)}h ago`;
    const days = Math.floor(seconds / 86400);
    return `Last active ${days}d ago`;
  }

  function presenceInfo(profile) {
    const last = valueMillis(profile?.lastActiveAt);
    const fresh = last && Date.now() - last < 105000;
    if(profile?.presenceState==='invisible')return {text:'Offline',kind:'offline'};
    if(profile?.presenceState==='dnd'&&fresh)return {text:'Do Not Disturb',kind:'dnd'};
    if(profile?.presenceState==='idle'&&fresh)return {text:'Idle',kind:'away'};
    if (profile?.presenceState === 'online' && fresh) return { text: 'Active now', kind: 'online' };
    if (profile?.presenceState === 'away' && fresh) return { text: 'Away', kind: 'away' };
    return { text: formatLastActive(last), kind: 'offline' };
  }

  async function writePresence(force = false, override = '') {
    if (!state.user?.uid) return;
    const now = Date.now();
    if (!force && now - presenceWriteAt < 28000) return;
    presenceWriteAt = now;
    if(rt.experience){rt.experience.presence(force);return;}
    const presenceState = override || (document.hidden ? 'away' : 'online');
    try {
      await updateDoc(doc(db, 'users', state.user.uid), { presenceState, lastActiveAt: serverTimestamp() });
      if (state.profile) Object.assign(state.profile, { presenceState });
    } catch (error) {
      console.warn('[Connections v9] Presence update failed', error);
    }
  }

  function ensurePresenceUi() {
    const peerInfo = document.querySelector('.peer-info');
    const handle = $('peer-handle');
    if (peerInfo && handle && !$('peer-presence')) {
      const line = document.createElement('div');
      line.id = 'peer-presence';
      line.className = 'peer-presence';
      line.innerHTML = '<i></i><span>Offline</span>';
      handle.insertAdjacentElement('afterend', line);
    }
    if (peerInfo && !$('peer-discord-card')) {
      const card = document.createElement('section');
      card.id = 'peer-discord-card';
      card.className = 'peer-discord-card hidden';
      card.innerHTML = '<div class="discord-art" aria-hidden="true"><span>◉</span></div><div class="discord-copy"><small>DISCORD ACTIVITY</small><strong id="discord-activity-title"></strong><span id="discord-activity-details"></span><em id="discord-activity-state"></em></div>';
      const games = $('peer-games');
      const gamesHeading = games?.previousElementSibling;
      if (gamesHeading) gamesHeading.insertAdjacentElement('beforebegin', card);
      else peerInfo.append(card);
    }
    const selfCard = document.querySelector('.self-card');
    if (selfCard && !selfCard.querySelector('.self-presence-dot')) {
      const dot = document.createElement('i');
      dot.className = 'self-presence-dot';
      selfCard.append(dot);
    }
  }

  let renderedPeerUid = '';

  function renderPresence() {
    ensurePresenceUi();
    const uid = currentPeerUid();
    if (uid !== renderedPeerUid) {
      renderedPeerUid = uid;
      activePeerProfile = uid ? (state.peers?.get(uid) || null) : null;
    } else {
      activePeerProfile = uid ? (state.peers?.get(uid) || activePeerProfile) : null;
    }
    const info = presenceInfo(activePeerProfile);
    const line = $('peer-presence');
    if (line) {
      line.className = `peer-presence ${info.kind}`;
      line.querySelector('span').textContent = info.text;
    }
    if (state.view === 'chat' && $('header-subtitle')) {
      $('header-subtitle').textContent = activePeerProfile?.customStatus || activePeerProfile?.activityText || info.text;
      $('header-subtitle').classList.toggle('active-now', info.kind === 'online');
    }
    lastPresenceText = info.text;

    for (const button of document.querySelectorAll('#conversation-list [data-connection]')) {
      const connection = state.connections?.find(item => item.id === button.dataset.connection);
      const otherUid = peerUidFor(connection);
      const profile = state.peers?.get(otherUid);
      const status = presenceInfo(profile);
      let dot = button.querySelector('.conversation-presence-dot');
      if (!dot) {
        dot = document.createElement('i');
        dot.className = 'conversation-presence-dot';
        button.append(dot);
      }
      dot.className = `conversation-presence-dot ${status.kind}`;
      dot.title = status.text;
    }
  }

  function syncPeerWatchers() {
    if (!state.user?.uid) return;
    const desired = new Set((state.connections || []).filter(c => c.status === 'accepted').map(peerUidFor).filter(Boolean));
    for (const [uid, unsubscribe] of peerWatchers) {
      if (!desired.has(uid)) { unsubscribe?.(); peerWatchers.delete(uid); }
    }
    for (const uid of desired) {
      if (peerWatchers.has(uid)) continue;
      const unsubscribe = onSnapshot(doc(db, 'users', uid), snapshot => {
        if (!snapshot.exists()) return;
        const profile = snapshot.data();
        state.peers?.set(uid, profile);
        if (uid === currentPeerUid()) {
          activePeerProfile = profile;
          connectLanyard(profile.discordUserId || '');
        }
        renderPresence();
      }, error => console.warn('[Connections v9] Peer presence unavailable', error));
      peerWatchers.set(uid, unsubscribe);
    }
    const uid = currentPeerUid();
    if (uid) {
      const profile = state.peers?.get(uid);
      if (profile) {
        activePeerProfile = profile;
        connectLanyard(profile.discordUserId || '');
      }
    }
    renderPresence();
  }

  /* ---------- Lanyard Discord presence/activity ---------- */
  let lanyardSocket = null;
  let lanyardHeartbeat = null;
  let lanyardReconnect = null;
  let lanyardId = '';
  let lanyardData = null;

  function closeLanyard() {
    clearInterval(lanyardHeartbeat); lanyardHeartbeat = null;
    clearTimeout(lanyardReconnect); lanyardReconnect = null;
    if (lanyardSocket) {
      lanyardSocket.onclose = null;
      try { lanyardSocket.close(); } catch {}
    }
    lanyardSocket = null;
    lanyardData = null;
  }

  function activityImage(activity, data) {
    if (data?.listening_to_spotify && data.spotify?.album_art_url) return data.spotify.album_art_url;
    const key = activity?.assets?.large_image || '';
    if (!key) return '';
    if (/^https:\/\//i.test(key)) return key;
    if (key.startsWith('mp:')) return `https://media.discordapp.net/${key.slice(3)}`;
    if (key.startsWith('spotify:') && data?.spotify?.album_art_url) return data.spotify.album_art_url;
    if (activity?.application_id && /^[A-Za-z0-9_-]+$/.test(key)) return `https://cdn.discordapp.com/app-assets/${activity.application_id}/${key}.png?size=128`;
    return '';
  }

  function renderLanyard() {
    const card = $('peer-discord-card');
    if (!card) return;
    if (!lanyardId || !lanyardData) {
      card.classList.add('hidden');
      return;
    }
    const data = lanyardData;
    let activity = null;
    let title = '';
    let details = '';
    let status = '';
    if (data.listening_to_spotify && data.spotify) {
      title = data.spotify.song || 'Listening on Spotify';
      details = data.spotify.artist ? `by ${data.spotify.artist}` : 'Spotify';
      status = data.spotify.album || '';
      activity = (data.activities || []).find(item => item.name === 'Spotify') || null;
    } else {
      activity = (data.activities || []).find(item => item.type !== 4 && item.name && item.name !== 'Spotify') || (data.activities || []).find(item => item.type === 4);
      if (activity) {
        const prefix = activity.type === 0 ? 'Playing' : activity.type === 1 ? 'Streaming' : activity.type === 2 ? 'Listening to' : activity.type === 3 ? 'Watching' : '';
        title = activity.type === 4 ? (activity.state || 'Custom status') : `${prefix ? `${prefix} ` : ''}${activity.name}`;
        details = activity.details || '';
        status = activity.type === 4 ? '' : (activity.state || '');
      }
    }
    if (!title) {
      const labels = { online: 'Online on Discord', idle: 'Idle on Discord', dnd: 'Do Not Disturb', offline: 'Offline on Discord' };
      title = labels[data.discord_status] || 'Discord';
      details = data.discord_user?.global_name || data.discord_user?.username || '';
    }
    if(activePeerProfile)activePeerProfile.activityText=title;
    rt.experience?.renderSidebar();
    $('discord-activity-title').textContent = title;
    $('discord-activity-details').textContent = details;
    $('discord-activity-state').textContent = status;
    const art = card.querySelector('.discord-art');
    const image = activityImage(activity, data);
    art.style.backgroundImage = image ? `url("${image.replace(/"/g, '%22')}")` : '';
    art.classList.toggle('has-art', !!image);
    card.classList.remove('hidden');
  }

  function connectLanyard(nextId) {
    nextId = /^\d{17,20}$/.test(String(nextId || '').trim()) ? String(nextId).trim() : '';
    if (nextId === lanyardId && (lanyardSocket || !nextId)) return;
    closeLanyard();
    lanyardId = nextId;
    renderLanyard();
    if (!lanyardId) return;

    fetch(`https://api.lanyard.rest/v1/users/${lanyardId}`)
      .then(response => response.ok ? response.json() : null)
      .then(payload => { if (payload?.success && lanyardId === nextId) { lanyardData = payload.data; renderLanyard(); } })
      .catch(() => {});

    const connect = () => {
      if (!lanyardId || lanyardId !== nextId) return;
      try {
        const ws = new WebSocket('wss://api.lanyard.rest/socket');
        lanyardSocket = ws;
        ws.onmessage = event => {
          let packet; try { packet = JSON.parse(event.data); } catch { return; }
          if (packet.op === 1) {
            clearInterval(lanyardHeartbeat);
            const interval = Math.max(10000, Number(packet.d?.heartbeat_interval) || 30000);
            lanyardHeartbeat = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 3 })); }, interval);
            ws.send(JSON.stringify({ op: 2, d: { subscribe_to_id: lanyardId } }));
            return;
          }
          if (packet.op === 0 && (packet.t === 'INIT_STATE' || packet.t === 'PRESENCE_UPDATE')) {
            lanyardData = packet.d;
            renderLanyard();
          }
        };
        ws.onclose = () => {
          clearInterval(lanyardHeartbeat); lanyardHeartbeat = null;
          if (lanyardId === nextId) lanyardReconnect = setTimeout(connect, 4500);
        };
        ws.onerror = () => { try { ws.close(); } catch {} };
      } catch {
        lanyardReconnect = setTimeout(connect, 6000);
      }
    };
    connect();
  }

  /* ---------- Settings: Discord ID ---------- */
  function decorateSettings() {
    const content = $('settings-content');
    const bio = content?.querySelector('#settings-bio');
    if (!content || !bio || $('settings-discord-id')) return;
    const label = document.createElement('label');
    label.className = 'settings-discord-label';
    label.innerHTML = `Discord activity <span class="settings-field-note">Lanyard</span><input id="settings-discord-id" inputmode="numeric" maxlength="20" placeholder="Discord user ID" value="${escapeHtml(state.profile?.discordUserId || '')}" /><small>Shows your live Discord status/activity to people you connect with. Your Discord account must be monitored by Lanyard.</small>`;
    bio.closest('label')?.insertAdjacentElement('afterend', label);
  }

  document.addEventListener('click', event => {
    const save = event.target.closest('#settings-profile-save');
    if (!save) return;
    const input = $('settings-discord-id');
    if (!input || !state.user?.uid) return;
    const value = input.value.trim();
    if (value && !/^\d{17,20}$/.test(value)) {
      event.preventDefault(); event.stopImmediatePropagation();
      toast('Discord User ID should be 17–20 digits.');
      input.focus();
      return;
    }
    updateDoc(doc(db, 'users', state.user.uid), { discordUserId: value })
      .then(() => { if (state.profile) state.profile.discordUserId = value; })
      .catch(error => toast(error.message || 'Could not save Discord activity.'));
  }, true);

  /* ---------- Messaging: polished actions, replies, reactions, scheduled cancellation, GIPHY ---------- */
  let composerMode = null;
  let augmentQueued = false;
  let activeReactionRow = null;
  let giphyTimer = null;
  let giphyOffset = 0;
  let giphyQuery = '';
  let giphyLoading = false;
  const GIPHY_STORAGE_KEY = 'connections.giphy.apiKey';
  const MEDIA_API = 'https://cnx-gh-media.pixlcyd.workers.dev';
  const isGiphyUrl = value => typeof value === 'string' && /^https:\/\/(?:media\d*|i)\.giphy\.com\//i.test(value);
  const getGiphyKey = () => String(window.CONNECTIONS_GIPHY_KEY || localStorage.getItem(GIPHY_STORAGE_KEY) || '').trim();
  const actionIcon = name => window.__connectionsIcon?.(name) || ({
    reply:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17l-5-5 5-5"/><path d="M4 12h9a7 7 0 0 1 7 7"/></svg>',
    react:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8.5 10h.01M15.5 10h.01M8.5 14.5c1 1 2.1 1.5 3.5 1.5s2.5-.5 3.5-1.5"/></svg>',
    copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    edit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
    delete:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M8 10v7M12 10v7M16 10v7M6 7l1 13h10l1-13"/></svg>',
    cancel:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>'
  }[name] || '');

  function ensureDecisionUi() {
    if ($('v9-decision')) return;
    const layer = document.createElement('div');
    layer.id = 'v9-decision';
    layer.className = 'v9-decision hidden';
    layer.innerHTML = `<div class="v9-decision-shade" data-v9-decision-cancel></div><section class="v9-decision-card" role="dialog" aria-modal="true" aria-labelledby="v9-decision-title"><div class="v9-decision-icon" id="v9-decision-icon">!</div><div><strong id="v9-decision-title"></strong><p id="v9-decision-copy"></p></div><div class="v9-decision-actions"><button type="button" class="secondary" data-v9-decision-cancel>Keep it</button><button type="button" class="danger" id="v9-decision-confirm">Delete</button></div></section>`;
    document.body.append(layer);
  }

  function askDecision({ title, copy, confirmText = 'Delete', cancelText = 'Keep it', danger = true }) {
    ensureDecisionUi();
    const layer = $('v9-decision');
    $('v9-decision-title').textContent = title;
    $('v9-decision-copy').textContent = copy;
    const confirm = $('v9-decision-confirm');
    confirm.textContent = confirmText;
    confirm.classList.toggle('danger', danger);
    const cancel = layer.querySelector('.v9-decision-actions .secondary');
    cancel.textContent = cancelText;
    layer.classList.remove('hidden');
    requestAnimationFrame(() => layer.classList.add('visible'));
    return new Promise(resolve => {
      let settled = false;
      const done = value => {
        if (settled) return;
        settled = true;
        layer.classList.remove('visible');
        setTimeout(() => layer.classList.add('hidden'), 150);
        confirm.removeEventListener('click', yes);
        layer.querySelectorAll('[data-v9-decision-cancel]').forEach(el => el.removeEventListener('click', no));
        document.removeEventListener('keydown', key);
        resolve(value);
      };
      const yes = () => done(true);
      const no = () => done(false);
      const key = event => { if (event.key === 'Escape') done(false); if (event.key === 'Enter' && document.activeElement !== $('message-input')) done(true); };
      confirm.addEventListener('click', yes);
      layer.querySelectorAll('[data-v9-decision-cancel]').forEach(el => el.addEventListener('click', no));
      document.addEventListener('keydown', key);
      setTimeout(() => confirm.focus(), 20);
    });
  }

  function ensureMessagingUi() {
    const form = $('message-form');
    if (form && !$('v8-composer-mode')) {
      const bar = document.createElement('div');
      bar.id = 'v8-composer-mode';
      bar.className = 'v8-composer-mode hidden';
      bar.innerHTML = '<div><strong id="v8-composer-mode-title"></strong><span id="v8-composer-mode-text"></span></div><button type="button" id="v8-composer-mode-close" aria-label="Cancel">×</button>';
      form.insertBefore(bar, form.querySelector('.message-input-wrap'));
      $('v8-composer-mode-close').addEventListener('click', clearComposerMode);
    }
    const wrap = form?.querySelector('.message-input-wrap');
    const attach = $('attach-media');
    if (wrap && attach && !$('v9-gif-button')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'v9-gif-button';
      button.className = 'v9-gif-button';
      button.title = 'Send a GIF';
      button.setAttribute('aria-label', 'Send a GIF');
      button.textContent = 'GIF';
      attach.insertAdjacentElement('afterend', button);
      button.addEventListener('click', () => toggleGifPicker());
    }
    if (form && !$('v9-gif-picker')) {
      const picker = document.createElement('section');
      picker.id = 'v9-gif-picker';
      picker.className = 'v9-gif-picker hidden';
      picker.innerHTML = `<header><strong>GIFs</strong><span>Powered by GIPHY</span><button type="button" id="v9-gif-close" aria-label="Close GIF picker">×</button></header><div id="v9-gif-key-setup" class="v9-gif-key-setup hidden"><strong>Connect GIPHY</strong><p>Paste your GIPHY web API key once on this device.</p><div><input id="v9-gif-key" type="password" autocomplete="off" placeholder="GIPHY API key"><button type="button" id="v9-gif-key-save">Save</button></div></div><div id="v9-gif-browser"><div class="v9-gif-search"><input id="v9-gif-search" type="search" maxlength="50" placeholder="Search GIFs"><button type="button" id="v9-gif-trending">Trending</button></div><div id="v9-gif-grid" class="v9-gif-grid"></div><button type="button" id="v9-gif-more" class="v9-gif-more hidden">Load more</button></div>`;
      form.insertBefore(picker, form.querySelector('.message-input-wrap'));
      $('v9-gif-close').addEventListener('click', () => toggleGifPicker(false));
      $('v9-gif-trending').addEventListener('click', () => { $('v9-gif-search').value = ''; loadGiphy('', true); });
      $('v9-gif-search').addEventListener('input', event => {
        clearTimeout(giphyTimer);
        giphyTimer = setTimeout(() => loadGiphy(event.target.value.trim(), true), 280);
      });
      $('v9-gif-more').addEventListener('click', () => loadGiphy(giphyQuery, false));
      $('v9-gif-key-save').addEventListener('click', () => {
        const key = $('v9-gif-key').value.trim();
        if (key.length < 8) { toast('Enter a valid GIPHY API key.'); return; }
        localStorage.setItem(GIPHY_STORAGE_KEY, key);
        $('v9-gif-key').value = '';
        renderGifKeyState();
        loadGiphy('', true);
      });
      $('v9-gif-grid').addEventListener('click', async event => {
        const tile = event.target.closest('[data-gif-url]');
        if (!tile) return;
        try {
          await sendGif({ url: tile.dataset.gifUrl, title: tile.dataset.gifTitle || 'GIF' });
          toggleGifPicker(false);
        } catch (error) { toast(error.message || 'Could not send GIF.'); }
      });
    }
    const chatView = $('chat-view');
    const formNode = $('message-form');
    if (chatView && formNode && !$('v8-typing-indicator')) {
      const typing = document.createElement('div');
      typing.id = 'v8-typing-indicator';
      typing.className = 'v8-typing-indicator hidden';
      typing.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span><span id="v8-typing-text"></span>';
      chatView.insertBefore(typing, formNode);
    }
    ensureDecisionUi();
  }

  function renderGifKeyState() {
    const setup = $('v9-gif-key-setup');
    const browser = $('v9-gif-browser');
    if (!setup || !browser) return;
    const hasKey = !!getGiphyKey();
    setup.classList.toggle('hidden', hasKey);
    browser.classList.toggle('hidden', !hasKey);
  }

  function toggleGifPicker(force) {
    ensureMessagingUi();
    const picker = $('v9-gif-picker');
    if (!picker || state.view !== 'chat' || !state.activeId) return;
    const opening = force ?? picker.classList.contains('hidden');
    picker.classList.toggle('hidden', !opening);
    $('v9-gif-button')?.classList.toggle('active', opening);
    if (!opening) return;
    renderGifKeyState();
    if (getGiphyKey()) loadGiphy('', true);
    else setTimeout(() => $('v9-gif-key')?.focus(), 30);
  }

  async function loadGiphy(query = '', reset = false) {
    const key = getGiphyKey();
    if (!key || giphyLoading) return;
    if (reset) { giphyOffset = 0; giphyQuery = query; }
    const grid = $('v9-gif-grid');
    if (!grid) return;
    giphyLoading = true;
    if (reset) grid.innerHTML = '<div class="v9-gif-loading">Loading GIFs…</div>';
    try {
      const endpoint = query ? 'search' : 'trending';
      const params = new URLSearchParams({ api_key: key, limit: '24', offset: String(giphyOffset), rating: 'pg-13', lang: 'en' });
      if (query) params.set('q', query.slice(0, 50));
      const response = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params}`);
      const payload = await response.json();
      if (!response.ok || payload?.meta?.status >= 400) throw Error(payload?.meta?.msg || 'GIPHY search failed.');
      const tiles = (payload.data || []).map(item => {
        const preview = item.images?.fixed_width_small?.webp || item.images?.fixed_width?.webp || item.images?.fixed_height_small?.webp || item.images?.original?.url || '';
        const send = item.images?.original?.url || item.images?.downsized?.url || preview;
        if (!isGiphyUrl(preview) || !isGiphyUrl(send)) return '';
        return `<button type="button" class="v9-gif-tile" data-gif-url="${escapeHtml(send)}" data-gif-title="${escapeHtml(item.title || 'GIF')}"><img src="${escapeHtml(preview)}" alt="${escapeHtml(item.title || 'GIF')}" loading="lazy"></button>`;
      }).join('');
      if (reset) grid.innerHTML = tiles || '<div class="v9-gif-loading">No GIFs found.</div>';
      else grid.insertAdjacentHTML('beforeend', tiles);
      giphyOffset += (payload.data || []).length;
      $('v9-gif-more').classList.toggle('hidden', !(payload.pagination?.total_count > giphyOffset));
    } catch (error) {
      if (reset) grid.innerHTML = `<div class="v9-gif-error">${escapeHtml(error.message || 'GIPHY unavailable.')}</div>`;
      toast(error.message || 'GIPHY unavailable.');
    } finally { giphyLoading = false; }
  }

  async function sendGif(gif) {
    if (!state.activeId || !state.user?.uid || !isGiphyUrl(gif.url)) return;
    await rt.experience.send('',{url:gif.url,name:String(gif.title||'GIPHY GIF').slice(0,100),type:'image/gif',size:1});
  }

  function previewForMessage(message) {
    if (!message) return 'Message';
    const text = String(message.text || '').trim();
    if (text) return text.slice(0, 140);
    if (message.media?.name) return isGiphyUrl(message.media.url) ? 'GIF' : `Attachment: ${message.media.name}`;
    return 'Message';
  }

  function senderNameFor(message) {
    if (!message) return 'Message';
    if (message.senderUid === state.user?.uid) return state.profile?.displayName || 'You';
    return state.peers?.get(message.senderUid)?.displayName || $('peer-name')?.textContent || 'Connection';
  }

  function setComposerMode(mode) {
    ensureMessagingUi();
    toggleGifPicker(false);
    composerMode = mode;
    const bar = $('v8-composer-mode');
    if (!bar) return;
    if (!mode) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    $('v8-composer-mode-title').textContent = mode.type === 'edit' ? 'Editing message' : `Replying to ${mode.senderName}`;
    $('v8-composer-mode-text').textContent = mode.preview;
    const input = $('message-input');
    if (mode.type === 'edit') input.value = mode.text || '';
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function clearComposerMode() {
    composerMode = null;
    $('v8-composer-mode')?.classList.add('hidden');
  }

  function renderableMessages() {
    const ids = new Set((state.messageRows || []).map(item => item.id));
    const pending = [...(state.pendingMessages?.values?.() || [])].filter(item => !ids.has(item.id));
    const now = Date.now();
    const term = ($('chat-search')?.value || '').trim().toLowerCase();
    return [...(state.messageRows || []), ...pending]
      .filter(message => message.senderUid === state.user?.uid || valueMillis(message.scheduledFor) <= now + 150)
      .sort((a, b) => (valueMillis(a.scheduledFor) || valueMillis(a.createdAt)) - (valueMillis(b.scheduledFor) || valueMillis(b.createdAt)))
      .filter(message => !term || String(message.text || '').toLowerCase().includes(term) || String(message.media?.name || '').toLowerCase().includes(term));
  }

  function reactionMarkup(message) {
    const map = message?.reactions || {};
    return Object.entries(REACTIONS).map(([key, emoji]) => {
      const list = Array.isArray(map[key]) ? map[key] : [];
      if (!list.length) return '';
      const active = list.includes(state.user?.uid) ? ' active' : '';
      return `<button type="button" class="message-reaction${active}" data-reaction="${key}" title="${emoji}">${emoji}<span>${list.length}</span></button>`;
    }).join('');
  }

  function closeReactionPickers(except = null) {
    document.querySelectorAll('.v9-reaction-picker.open').forEach(picker => {
      if (picker !== except) picker.classList.remove('open');
    });
    if (!except) activeReactionRow = null;
  }

  function toggleReactionPicker(row) {
    const picker = row?.querySelector('.v9-reaction-picker');
    if (!picker) return;
    const opening = !picker.classList.contains('open');
    closeReactionPickers(opening ? picker : null);
    picker.classList.toggle('open', opening);
    activeReactionRow = opening ? row : null;
  }

  function ensureGiphyMedia(body, message) {
    const existing = body.querySelector('.v9-giphy-message');
    if (body.querySelector('.message-gallery') || !isGiphyUrl(message?.media?.url)) { existing?.remove(); return; }
    if (existing?.dataset.url === message.media.url) return;
    existing?.remove();
    const link = document.createElement('a');
    link.className = 'message-media v9-giphy-message';
    link.dataset.url = message.media.url;
    link.href = message.media.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.innerHTML = `<img src="${escapeHtml(message.media.url)}" alt="${escapeHtml(message.media.name || 'GIF')}" loading="lazy"><small>GIPHY</small>`;
    const status = body.querySelector('.message-status');
    status ? body.insertBefore(link, status) : body.append(link);
  }

  function augmentMessages() {
    augmentQueued = false;
    const list = $('message-list');
    if (!list || state.view !== 'chat') return;
    const messages = renderableMessages();
    const byId = new Map(messages.map(message=>[message.id,message]));
    const rows = [...list.querySelectorAll('.message-row')];
    rows.forEach(row => {
      if(row.classList.contains('message-leave'))return;
      const message = byId.get(row.dataset.messageId);
      if (!message?.id) return;
      const signature=JSON.stringify(message);
      if(row.dataset.augmented===signature&&row.querySelector('.message-actions'))return;
      row.dataset.augmented=signature;
      row.dataset.messageId = message.id;
      const own = message.senderUid === state.user?.uid;
      const scheduled = own && valueMillis(message.scheduledFor) > Date.now() + 150;
      row.classList.toggle('own-message', own);
      const body = row.querySelector('.message-body');
      if (!body) return;

      ensureGiphyMedia(body, message);

      let reply = body.querySelector('.message-reply-preview');
      if (message.replyTo) {
        if (!reply) { reply = document.createElement('div'); reply.className = 'message-reply-preview'; body.insertBefore(reply, body.querySelector('.message-text,.message-media,.message-status')); }
        reply.innerHTML = `<strong>${escapeHtml(message.replyTo.senderName || 'Message')}</strong><span>${escapeHtml(message.replyTo.text || 'Message')}</span>`;
      } else reply?.remove();

      const meta = body.querySelector('.message-meta');
      let edited = meta?.querySelector('.message-edited');
      if (message.editedAt) {
        if (!edited && meta) { edited = document.createElement('span'); edited.className = 'message-edited'; meta.append(edited); }
        if (edited) edited.textContent = 'edited';
      } else edited?.remove();

      let reactions = body.querySelector('.message-reactions');
      const reactionHtml = reactionMarkup(message);
      if (reactionHtml) {
        if (!reactions) { reactions = document.createElement('div'); reactions.className = 'message-reactions'; body.append(reactions); }
        if (reactions.dataset.signature !== reactionHtml) { reactions.innerHTML = reactionHtml; reactions.dataset.signature = reactionHtml; }
      } else reactions?.remove();

      let actions = body.querySelector('.message-actions');
      if (!actions) { actions = document.createElement('div'); actions.className = 'message-actions'; body.append(actions); }
      if (scheduled) {
        actions.className = 'message-actions scheduled-actions';
        actions.innerHTML = `<span>Scheduled</span><button type="button" class="danger" data-msg-action="cancel-scheduled" title="Cancel scheduled message" aria-label="Cancel scheduled message">${actionIcon('cancel')}</button>`;
      } else {
        actions.className = 'message-actions';
        actions.innerHTML = `<button type="button" data-msg-action="reply" title="Reply" aria-label="Reply">${actionIcon('reply')}</button><button type="button" data-msg-action="react" title="Add reaction" aria-label="Add reaction">${actionIcon('react')}</button><button type="button" data-msg-action="copy" title="Copy" aria-label="Copy">${actionIcon('copy')}</button>${own && message.text ? `<button type="button" data-msg-action="edit" title="Edit" aria-label="Edit">${actionIcon('edit')}</button>` : ''}${own ? `<button type="button" class="danger" data-msg-action="delete" title="Delete" aria-label="Delete">${actionIcon('delete')}</button>` : ''}`;
      }

      if(!scheduled){actions.querySelectorAll('[data-msg-action]').forEach(b=>{if(!['reply','react'].includes(b.dataset.msgAction))b.classList.add('action-overflow')});const more=document.createElement('button');more.type='button';more.dataset.messageMore='1';more.setAttribute('aria-label','More message actions');more.innerHTML=window.__connectionsIcon('Ellipsis');actions.append(more);}

      let picker = body.querySelector('.v9-reaction-picker');
      if (!picker) { picker = document.createElement('div'); picker.className = 'v9-reaction-picker'; body.append(picker); }
      picker.innerHTML = Object.entries(REACTIONS).map(([key, emoji]) => `<button type="button" data-reaction="${key}" title="React ${emoji}">${emoji}</button>`).join('');
    });
  }

  function queueAugmentMessages() {
    if (augmentQueued) return;
    augmentQueued = true;
    requestAnimationFrame(augmentMessages);
  }

  async function sendReply(text, mode) {
    if (!state.activeId || !state.user?.uid) return;
    await rt.experience.send(text,null,{replyTo:{id:mode.id,senderUid:mode.senderUid,senderName:mode.senderName.slice(0,48),text:mode.preview.slice(0,180)}});
  }

  async function editMessage(id, text) {
    const ref = messageRef(id); if (!ref) return;
    const current=await getDoc(ref);if(!current.exists())throw Error('Message no longer exists.');const data=current.data();await updateDoc(ref,{text,editedAt:serverTimestamp(),editHistory:[...(data.editHistory||[]),{text:data.text,at:Date.now()}].slice(-30)});
  }

  async function toggleReaction(id, key) {
    if (!REACTIONS[key] || !state.user?.uid) return;
    const ref = messageRef(id); if (!ref) return;
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) return;
    const current = snapshot.data();
    const reactions = { ...(current.reactions || {}) };
    const list = Array.isArray(reactions[key]) ? [...reactions[key]] : [];
    const index = list.indexOf(state.user.uid);
    if (index >= 0) list.splice(index, 1); else list.push(state.user.uid);
    if (list.length) reactions[key] = [...new Set(list)].slice(0, 2); else delete reactions[key];
    await updateDoc(ref, { reactions });
  }

  async function deleteStoredMedia(message) {
    const url = message?.media?.url || '';
    if (!/^https:\/\/cnx-gh-media\.pixlcyd\.workers\.dev\/media\//.test(url) || !state.user) return;
    try {
      const token = await state.user.getIdToken();
      await fetch(`${MEDIA_API}/media/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ url }) });
    } catch (error) { console.warn('[Connections v9] Attachment cleanup failed', error); }
  }

  $('message-list')?.addEventListener('click', async event => {
    const action = event.target.closest('[data-msg-action]');
    const reaction = event.target.closest('[data-reaction]');
    const row = event.target.closest('.message-row[data-message-id]');
    if (!row) return;
    const message = findMessage(row.dataset.messageId);
    if (!message) return;
    try {
      if (reaction) {
        await toggleReaction(message.id, reaction.dataset.reaction);
        closeReactionPickers();
        return;
      }
      if (!action) return;
      const type = action.dataset.msgAction;
      if (type === 'reply') {
        setComposerMode({ type: 'reply', id: message.id, senderUid: message.senderUid, senderName: senderNameFor(message), preview: previewForMessage(message) });
      } else if (type === 'edit') {
        setComposerMode({ type: 'edit', id: message.id, senderUid: message.senderUid, senderName: senderNameFor(message), preview: previewForMessage(message), text: message.text || '' });
      } else if (type === 'react') {
        toggleReactionPicker(row);
      } else if (type === 'delete') {
        const ok = await askDecision({ title: 'Delete message?', copy: 'This removes it from both sides of the conversation.', confirmText: 'Delete message', cancelText: 'Keep message' });
        if (ok) { await deleteDoc(messageRef(message.id)); toast('Message deleted'); }
      } else if (type === 'cancel-scheduled') {
        const ok = await askDecision({ title: 'Cancel scheduled message?', copy: 'It will be deleted now and will not be sent later.', confirmText: 'Cancel message', cancelText: 'Keep scheduled' });
        if (ok) { await deleteDoc(messageRef(message.id)); toast('Scheduled message cancelled'); }
      } else if (type === 'copy') {
        const copy = message.text || message.media?.url || '';
        if (copy) { await navigator.clipboard.writeText(copy); toast('Copied'); }
      }
    } catch (error) { toast(error.message || 'Message action failed.'); }
  });

  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.v9-reaction-picker') && !event.target.closest('[data-msg-action="react"]')) closeReactionPickers();
    if (!event.target.closest('#v9-gif-picker') && !event.target.closest('#v9-gif-button')) toggleGifPicker(false);
  });

  $('message-form')?.addEventListener('submit', async event => {
    if (!composerMode) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const input = $('message-input');
    const text = input?.value.trim() || '';
    if (!text) return;
    if (text.length > 2000) { toast('Messages can be up to 2,000 characters.'); return; }
    const mode = composerMode;
    input.value = ''; input.style.height = '';
    clearComposerMode();
    try {
      if (mode.type === 'edit') await editMessage(mode.id, text);
      else await sendReply(text, mode);
    } catch (error) {
      input.value = text;
      setComposerMode(mode);
      toast(error.message || 'Could not send message.');
    }
  }, true);

  document.addEventListener('click', event => {
    if (!composerMode || !event.target.closest('#schedule-message')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    toast(composerMode.type === 'edit' ? 'Finish or cancel the edit first.' : 'Send this reply now, or cancel the reply before scheduling.');
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && composerMode && document.activeElement === $('message-input')) clearComposerMode();
  });

  /* ---------- Typing indicator ---------- */
  let typingConversation = '';
  let unsubTyping = null;
  let remoteTyping = null;
  let typingStopTimer = null;
  let typingWriteAt = 0;

  async function writeTypingFor(connectionId, typing) {
    if (!connectionId || !state.user?.uid) return;
    try {
      await setDoc(doc(db, 'connections', connectionId, 'typing', state.user.uid), { typing: !!typing, updatedAt: serverTimestamp() });
    } catch (error) { console.warn('[Connections v9] Typing state unavailable', error); }
  }

  function writeTyping(typing) {
    return writeTypingFor(state.activeId, typing);
  }

  function markTyping() {
    if (!state.activeId || !$('message-input')?.value.trim()) { clearTimeout(typingStopTimer); writeTyping(false); return; }
    const now = Date.now();
    if (now - typingWriteAt > 1700) { typingWriteAt = now; writeTyping(true); }
    clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(() => writeTyping(false), 3200);
  }

  function renderTyping() {
    ensureMessagingUi();
    const host = $('v8-typing-indicator');
    if (!host) return;
    const fresh = remoteTyping?.typing && Date.now() - valueMillis(remoteTyping.updatedAt) < 6500;
    if (!fresh || state.view !== 'chat') { host.classList.add('hidden'); return; }
    const profile = state.peers?.get(currentPeerUid());
    $('v8-typing-text').textContent = `${profile?.displayName || 'They'} is typing…`;
    host.classList.remove('hidden');
  }

  function syncTypingSubscription() {
    const id = state.activeId || '';
    if (id === typingConversation) return;
    if (typingConversation && state.user?.uid) writeTypingFor(typingConversation, false);
    typingConversation = id;
    unsubTyping?.(); unsubTyping = null; remoteTyping = null; renderTyping();
    if (!id || !state.user?.uid) return;
    unsubTyping = onSnapshot(collection(db, 'connections', id, 'typing'), snapshot => {
      const peerUid = currentPeerUid();
      const peerDoc = snapshot.docs.find(item => item.id === peerUid);
      remoteTyping = peerDoc?.data() || null;
      renderTyping();
    }, error => console.warn('[Connections v9] Typing listener unavailable', error));
  }

  $('message-input')?.addEventListener('input', markTyping);
  $('message-input')?.addEventListener('blur', () => { clearTimeout(typingStopTimer); writeTyping(false); });

  /* ---------- Movie controls idle behavior ---------- */
  function bindMoviePlayer(player) {
    if (!player || player.dataset.v8IdleBound === '1') return;
    player.dataset.v8IdleBound = '1';
    let timer = null;
    let hoverChrome = false;
    const schedule = () => {
      clearTimeout(timer);
      if (hoverChrome) return;
      timer = setTimeout(() => player.classList.add('v8-controls-idle'), 3000);
    };
    const wake = () => { player.classList.remove('v8-controls-idle'); schedule(); };
    player.addEventListener('pointermove', wake, { passive: true });
    player.addEventListener('pointerdown', wake, { passive: true });
    player.addEventListener('mouseenter', wake, { passive: true });
    for (const selector of ['.arnie-player-bar', '.arnie-stage-top', '.arnie-fs-tools']) {
      const chrome = player.querySelector(selector);
      if (!chrome) continue;
      chrome.addEventListener('pointerenter', () => { hoverChrome = true; player.classList.add('v8-controls-hover'); player.classList.remove('v8-controls-idle', 'fs-idle'); clearTimeout(timer); });
      chrome.addEventListener('pointerleave', () => { hoverChrome = false; player.classList.remove('v8-controls-hover'); wake(); });
    }
    player.querySelector('video')?.addEventListener('playing', schedule);
    schedule();
  }

  function bindCallControls() {
    const overlay = $('call-overlay');
    const controls = overlay?.querySelector('.call-controls');
    if (!overlay || !controls || overlay.dataset.v8ControlsBound === '1') return;
    overlay.dataset.v8ControlsBound = '1';
    let timer = null;
    let hovering = false;
    const relevant = () => overlay.classList.contains('movie-playing-grid') || !!document.fullscreenElement?.closest?.('#arnie-player');
    const schedule = () => {
      clearTimeout(timer);
      if (hovering || !relevant()) { overlay.classList.remove('v8-call-controls-idle'); return; }
      timer = setTimeout(() => overlay.classList.add('v8-call-controls-idle'), 3000);
    };
    const wake = () => { overlay.classList.remove('v8-call-controls-idle'); schedule(); };
    overlay.addEventListener('pointermove', wake, { passive: true });
    controls.addEventListener('pointerenter', () => { hovering = true; overlay.classList.add('v8-call-controls-hover'); overlay.classList.remove('v8-call-controls-idle'); clearTimeout(timer); });
    controls.addEventListener('pointerleave', () => { hovering = false; overlay.classList.remove('v8-call-controls-hover'); schedule(); });
  }

  /* ---------- Background movie/TV uploads ---------- */
  function ensureUploadTray() {
    let tray = $('v8-upload-tray');
    if (tray) return tray;
    tray = document.createElement('aside');
    tray.id = 'v8-upload-tray';
    tray.className = 'v8-upload-tray hidden';
    tray.innerHTML = '<div class="v8-upload-spinner"></div><div><strong>Media upload</strong><span id="v8-upload-text">Starting…</span></div><button type="button" aria-label="Hide upload status">×</button>';
    tray.querySelector('button').onclick = () => tray.classList.add('hidden');
    document.body.append(tray);
    return tray;
  }

  function bindMoviePanel(panel) {
    if (!panel || panel.dataset.v8UploadBound === '1') return;
    panel.dataset.v8UploadBound = '1';
    bindMoviePlayer(panel.querySelector('#arnie-player'));
    const input = panel.querySelector('#arnie-file');
    const status = panel.querySelector('#arnie-upload-status');
    if (!input || !status) return;
    let selectedCount = 0;
    return; // Upload ownership and status live in the persistent v10 manager.
    const tray = ensureUploadTray();
    const mirror = () => {
      const text = status.textContent.trim();
      if (!text) return;
      $('v8-upload-text').textContent = text;
      tray.classList.remove('hidden', 'done', 'failed');
      if (/added to watch/i.test(text)) {
        tray.classList.add('done');
        tray.querySelector('strong').textContent = 'Upload complete';
        if (selectedCount <= 1) setTimeout(() => tray.classList.add('hidden'), 4500);
      } else if (/failed|error|invalid|could not|use mp4/i.test(text)) {
        tray.classList.add('failed');
        tray.querySelector('strong').textContent = 'Upload issue';
      } else tray.querySelector('strong').textContent = selectedCount > 1 ? `${selectedCount} uploads running` : 'Uploading in background';
    };
    new MutationObserver(mirror).observe(status, { childList: true, characterData: true, subtree: true });
    input.addEventListener('change', event => {
      selectedCount = event.target.files?.length || 0;
      if (!selectedCount) return;
      tray.querySelector('strong').textContent = selectedCount > 1 ? `${selectedCount} uploads running` : 'Uploading in background';
      $('v8-upload-text').textContent = selectedCount > 1 ? 'Preparing files…' : `Preparing ${event.target.files[0].name}…`;
      tray.classList.remove('hidden', 'done', 'failed');
      toast('Upload started in the background. You can keep using Connections.');
      // The base uploader keeps its File objects and upload promises alive after the picker closes.
      setTimeout(() => panel.querySelector('#arnie-close')?.click(), 220);
    }, true);
  }

  /* ---------- Observers + lifecycle ---------- */
  const bodyObserver = new MutationObserver(records => {
    if(!records.some(record=>[...record.addedNodes].some(node=>node.nodeType===1&&!node.closest?.("#message-list,#arnie-player,#arnie-results"))))return;
    decorateSettings();
    ensurePresenceUi();
    ensureMessagingUi();
    bindMoviePanel($('movies-app'));
    bindMoviePlayer($('arnie-player'));
    bindCallControls();
    queueAugmentMessages();
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });

  const messageList = $('message-list');
  if (messageList) new MutationObserver(queueAugmentMessages).observe(messageList, { childList: true, subtree: true });

  document.addEventListener('visibilitychange', () => writePresence(true));
  for (const event of ['pointerdown', 'keydown', 'focus']) window.addEventListener(event, () => writePresence(false), { passive: true });
  window.addEventListener('pagehide', () => { writePresence(true, 'away'); writeTyping(false); });

  presenceTimer = setInterval(() => { writePresence(true); renderPresence(); renderTyping(); syncPeerWatchers(); syncTypingSubscription(); }, 45000);
  const fastSync = setInterval(() => {
    if (!state.user?.uid) return;
    syncPeerWatchers();
    syncTypingSubscription();
    ensureMessagingUi();
    bindMoviePanel($('movies-app'));
    queueAugmentMessages();
  }, 850);

  // First paint.
  ensurePresenceUi(); ensureMessagingUi(); bindCallControls(); syncPeerWatchers(); syncTypingSubscription(); queueAugmentMessages(); writePresence(true);
  window.__connectionsV9 = { version: VERSION, refreshPresence: renderPresence, refreshMessages: queueAugmentMessages };
})();
