'use strict';
/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║           ProBoy-MD — handler.js  (Self-Contained Production Build)    ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  ZERO external utils dependencies.  Works even if utils/ folder is     ║
 * ║  empty.  Only three things MUST exist:                                 ║
 * ║    • ./config            (your bot config)                             ║
 * ║    • ./database          (your database module)                        ║
 * ║    • ./utils/commandLoader  (loads plugin commands)                    ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  CHANNEL LIST  (as of this build)                                      ║
 * ║  JOIN (11)  +  REACT (6)  — new channel 120363422946163295 added       ║
 * ║  4 channels removed: 301056818774 / 379015645406 /                     ║
 * ║                       424268743982 / 426209292873                      ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  FIXES                                                                 ║
 * ║  ✅ anticall  — DB-backed, .anticall on|off works at runtime           ║
 * ║  ✅ antilink  — strict URL regex, no false positives on normal text    ║
 * ║  ✅ autoreact — 60 emojis, truly random                                ║
 * ║  ✅ commands  — no crash from missing utils files                      ║
 * ║  ✅ channels  — join runs in background, bot starts instantly          ║
 * ║  ✅ stability — all errors caught, no uncaught crash → reconnect loop  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

/* ═══════════════════════════════════════════════════════════════════════════
   REQUIRED CORE — these 3 must always exist
═══════════════════════════════════════════════════════════════════════════ */
const config          = require('./config');
const defaultDatabase = require('./database');
const { loadCommands } = require('./utils/commandLoader');

/* ═══════════════════════════════════════════════════════════════════════════
   NODE BUILT-INS
═══════════════════════════════════════════════════════════════════════════ */
const fs   = require('fs');
const path = require('path');

/* ═══════════════════════════════════════════════════════════════════════════
   BAILEYS — jidDecode / jidEncode only
═══════════════════════════════════════════════════════════════════════════ */
const { jidDecode, jidEncode } = require('@whiskeysockets/baileys');

/* ═══════════════════════════════════════════════════════════════════════════
   OPTIONAL DEPS — graceful no-op fallbacks
═══════════════════════════════════════════════════════════════════════════ */
let axios      = null;
let addMessage = () => {};   // groupstats — no-op if missing

try { axios = require('axios'); } catch (_) {}
try { ({ addMessage } = require('./utils/groupstats')); } catch (_) {}

/* ═══════════════════════════════════════════════════════════════════════════
   CHANNEL LISTS
═══════════════════════════════════════════════════════════════════════════ */

/** 11 channels the bot force-follows on startup */
const JOIN_CHANNELS = [
  '120363406203875411@newsletter',
  '120363408742319744@newsletter',
  '120363407571099651@newsletter',
  '120363426165980012@newsletter',
  '120363428642007706@newsletter',
  '120363429791222215@newsletter',
  '120363411333955017@newsletter',
  '120363411158058922@newsletter',
  '120363429006569921@newsletter',
  '120363417966956186@newsletter',
  '120363422946163295@newsletter'   // ← NEW
];

/** 6 channels that get an auto-reaction on every new post */
const REACT_CHANNELS = new Set([
  '120363406203875411@newsletter',
  '120363408742319744@newsletter',
  '120363407571099651@newsletter',
  '120363428642007706@newsletter',
  '120363429006569921@newsletter',
  '120363422946163295@newsletter'   // ← NEW
]);

/* ═══════════════════════════════════════════════════════════════════════════
   EMOJI BANKS
═══════════════════════════════════════════════════════════════════════════ */
const CHANNEL_EMOJIS = [
  '❤️','🔥','💯','👑','⚡','🌟','💥','🎯','🏆','💎',
  '🤩','😍','🥰','😎','🤙','👏','🙌','💪','🫡','🤝',
  '🌈','✨','🎉','🎊','💫','🚀','🌸','🦋','🐉','🦁',
  '💚','💙','💜','🧡','💛','❤️‍🔥','🩷','🩵','🤍','🖤',
  '👀','😺','🐱','🫣','💞','🌺','🍀','🌙','⭐','🎵',
  '🦄','🐼','🦊','🐯','🌊','🎸','🏅','🎁','🍭','🎀'
];
const GENERAL_EMOJIS = [
  '❤️','🔥','💯','👌','💀','😁','✨','👍','😎','😂',
  '🤝','💫','🙌','👏','🤩','😍','🥰','🤙','💪','⚡',
  '🌟','💥','🎯','🏆','💎','🚀','🦋','🐉','🎉','💚',
  '💙','💜','🧡','💛','🩷','🩵','🤍','👑','🎊','🌈',
  '🫡','😏','🤣','😜','🥳','🤯','🙏','🫶','❤️‍🔥','⭐'
];
const randEmoji = (pool) => pool[Math.floor(Math.random() * pool.length)];

/* ═══════════════════════════════════════════════════════════════════════════
   GROUP METADATA CACHE
═══════════════════════════════════════════════════════════════════════════ */
const groupMetadataCache = new Map();
const CACHE_TTL = 60_000;

const getCachedGroupMetadata = async (sock, groupId) => {
  try {
    if (!groupId || !groupId.endsWith('@g.us')) return null;
    const cached = groupMetadataCache.get(groupId);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) return cached.data;
    const data = await sock.groupMetadata(groupId);
    groupMetadataCache.set(groupId, { data, timestamp: Date.now() });
    return data;
  } catch (err) {
    if (err?.message?.includes('rate-overlimit'))
      return groupMetadataCache.get(groupId)?.data ?? null;
    if (err?.message?.includes('forbidden') || err?.message?.includes('403') ||
        err?.statusCode === 403 || err?.output?.statusCode === 403 || err?.data === 403) {
      groupMetadataCache.set(groupId, { data: null, timestamp: Date.now() });
      return null;
    }
    return groupMetadataCache.get(groupId)?.data ?? null;
  }
};

const getLiveGroupMetadata = async (sock, groupId) => {
  try {
    const data = await sock.groupMetadata(groupId);
    groupMetadataCache.set(groupId, { data, timestamp: Date.now() });
    return data;
  } catch {
    return groupMetadataCache.get(groupId)?.data ?? null;
  }
};

const getGroupMetadata = getCachedGroupMetadata;

/* ═══════════════════════════════════════════════════════════════════════════
   LID / JID HELPERS
═══════════════════════════════════════════════════════════════════════════ */
const lidMappingCache = new Map();
let   authDirCache    = { expiresAt: 0, dirs: [] };

const normalizeJid = (jid) => {
  if (!jid || typeof jid !== 'string') return null;
  if (jid.includes(':')) return jid.split(':')[0];
  if (jid.includes('@')) return jid.split('@')[0];
  return jid;
};

const normalizeNum = (v) => String(v || '').replace(/\D/g, '');

const getAuthDirs = () => {
  const now = Date.now();
  if (authDirCache.expiresAt > now && authDirCache.dirs.length) return authDirCache.dirs;
  const dirs = [];
  const primary = path.join(__dirname, config.sessionName || 'session');
  if (fs.existsSync(primary)) dirs.push(primary);
  const root = path.join(__dirname, 'sessions');
  if (fs.existsSync(root)) {
    try {
      for (const e of fs.readdirSync(root, { withFileTypes: true }))
        if (e.isDirectory() && e.name.startsWith('auth-'))
          dirs.push(path.join(root, e.name));
    } catch {}
  }
  authDirCache = { expiresAt: now + 30_000, dirs: [...new Set(dirs.map(d => path.resolve(d)))] };
  return authDirCache.dirs;
};

const getLidMapping = (user, dir) => {
  if (!user) return null;
  const key = `${dir}:${user}`;
  if (lidMappingCache.has(key)) return lidMappingCache.get(key);
  const suffix = dir === 'pnToLid' ? '.json' : '_reverse.json';
  for (const d of getAuthDirs()) {
    const fp = path.join(d, `lid-mapping-${user}${suffix}`);
    if (!fs.existsSync(fp)) continue;
    try {
      const v = JSON.parse(fs.readFileSync(fp, 'utf8').trim() || 'null');
      lidMappingCache.set(key, v || null);
      return v || null;
    } catch { continue; }
  }
  lidMappingCache.set(key, null);
  return null;
};

const normalizeJidWithLid = (jid) => {
  if (!jid) return jid;
  try {
    const d = jidDecode(jid);
    if (!d?.user) return `${jid.split(':')[0].split('@')[0]}@s.whatsapp.net`;
    let user = d.user;
    let server = d.server === 'c.us' ? 's.whatsapp.net' : d.server;
    if (server === 'lid' || server === 'hosted.lid' || server === 's.whatsapp.net' || server === 'hosted') {
      const pn = getLidMapping(user, 'lidToPn');
      if (pn) { user = pn; server = server === 'hosted.lid' ? 'hosted' : 's.whatsapp.net'; }
    }
    return jidEncode(user, server === 'hosted' ? 'hosted' : 's.whatsapp.net');
  } catch { return jid; }
};

const buildComparableIds = (jid) => {
  if (!jid) return [];
  try {
    const d = jidDecode(jid);
    if (!d?.user) return [normalizeJidWithLid(jid)].filter(Boolean);
    const v = new Set();
    const ns = d.server === 'c.us' ? 's.whatsapp.net' : d.server;
    v.add(jidEncode(d.user, ns));
    if (ns === 's.whatsapp.net' || ns === 'hosted') {
      const lid = getLidMapping(d.user, 'pnToLid');
      if (lid) v.add(jidEncode(lid, ns === 'hosted' ? 'hosted.lid' : 'lid'));
    } else if (ns === 'lid' || ns === 'hosted.lid') {
      const pn = getLidMapping(d.user, 'lidToPn');
      if (pn) v.add(jidEncode(pn, ns === 'hosted.lid' ? 'hosted' : 's.whatsapp.net'));
    }
    return [...v];
  } catch { return [jid]; }
};

const findParticipant = (participants = [], userIds) => {
  const targets = (Array.isArray(userIds) ? userIds : [userIds])
    .filter(Boolean).flatMap(id => buildComparableIds(id));
  if (!targets.length) return null;
  return participants.find(p => {
    if (!p) return false;
    return [p.id, p.lid, p.userJid].filter(Boolean)
      .flatMap(id => buildComparableIds(id))
      .some(id => targets.includes(id));
  }) ?? null;
};

const cmpCtx = (jid) => {
  const ids = new Set([...buildComparableIds(jid), ...buildComparableIds(normalizeJidWithLid(jid))].filter(Boolean));
  const numbers = new Set([...ids].map(normalizeJid).map(normalizeNum).filter(Boolean));
  return { ids, numbers };
};

/* ═══════════════════════════════════════════════════════════════════════════
   PERMISSION HELPERS
═══════════════════════════════════════════════════════════════════════════ */
const getDb  = (sock) => sock?.sessionDb || defaultDatabase;

const isOwner = (sender) => {
  if (!sender) return false;
  const nums = Array.isArray(config.ownerNumber) ? config.ownerNumber : [];
  const jids = Array.isArray(config.ownerJids)   ? config.ownerJids   : [];
  const sNum = normalizeNum(normalizeJidWithLid(sender));
  if (sNum && nums.map(normalizeNum).includes(sNum)) return true;
  const entries = [...nums.map(n => `${normalizeNum(n)}@s.whatsapp.net`).filter(v => !v.startsWith('@')), ...jids];
  if (!entries.length) return false;
  const { ids, numbers } = cmpCtx(sender);
  for (const e of entries) {
    const s = String(e || '').trim();
    if (!s) continue;
    if (s.includes('@')) {
      const c = cmpCtx(s);
      for (const id of c.ids) if (ids.has(id)) return true;
      for (const n  of c.numbers) if (numbers.has(n)) return true;
    } else {
      if (normalizeNum(s) && numbers.has(normalizeNum(s))) return true;
    }
  }
  return false;
};

const isSudo = (sock, sender) => {
  if (!sender) return false;
  const db      = getDb(sock);
  const entries = [
    ...(Array.isArray(config.sudoNumbers) ? config.sudoNumbers : []),
    ...(Array.isArray(config.sudoJids)    ? config.sudoJids    : []),
    ...(Array.isArray(db.getGlobalSetting?.('sudoUsers')) ? db.getGlobalSetting('sudoUsers') : [])
  ];
  if (!entries.length) return false;
  const sNum = normalizeNum(normalizeJidWithLid(sender));
  if (sNum && entries.map(normalizeNum).includes(sNum)) return true;
  const { ids, numbers } = cmpCtx(sender);
  for (const e of entries) {
    const s = String(e || '').trim();
    if (!s) continue;
    if (s.includes('@')) {
      const c = cmpCtx(s);
      for (const id of c.ids) if (ids.has(id)) return true;
      for (const n  of c.numbers) if (numbers.has(n)) return true;
    } else {
      if (normalizeNum(s) && numbers.has(normalizeNum(s))) return true;
    }
  }
  return false;
};

const isPrivileged = (sock, sender) => isOwner(sender) || isSudo(sock, sender);

const isBannedUser = (sock, sender) => {
  if (!sender || isPrivileged(sock, sender)) return false;
  const banned = Array.isArray(getDb(sock).getGlobalSetting?.('bannedUsers'))
    ? getDb(sock).getGlobalSetting('bannedUsers') : [];
  if (!banned.length) return false;
  const { ids, numbers } = cmpCtx(sender);
  for (const e of banned) {
    const s = String(e || '').trim();
    if (!s) continue;
    if (s.includes('@')) {
      const c = cmpCtx(s);
      for (const id of c.ids) if (ids.has(id)) return true;
      for (const n  of c.numbers) if (numbers.has(n)) return true;
    } else {
      if (normalizeNum(s) && numbers.has(normalizeNum(s))) return true;
    }
  }
  return false;
};

const isMod = (sock, sender) =>
  getDb(sock).isModerator?.(normalizeNum(normalizeJidWithLid(sender))) ?? false;

const getDisplaySender = (sender) => normalizeNum(normalizeJidWithLid(sender)) || String(sender || '');

const isAdmin = async (sock, participant, groupId, meta = null) => {
  if (!participant || !groupId?.endsWith('@g.us')) return false;
  const m = (meta?.participants ? meta : null) || await getLiveGroupMetadata(sock, groupId);
  if (!m?.participants) return false;
  const p = findParticipant(m.participants, participant);
  return p?.admin === 'admin' || p?.admin === 'superadmin';
};

const isBotAdmin = async (sock, groupId) => {
  if (!sock.user || !groupId?.endsWith('@g.us')) return false;
  try {
    const jids = [sock.user.id];
    if (sock.user.lid) jids.push(sock.user.lid);
    const m = await getLiveGroupMetadata(sock, groupId);
    if (!m?.participants) return false;
    const p = findParticipant(m.participants, jids);
    return p?.admin === 'admin' || p?.admin === 'superadmin';
  } catch { return false; }
};

const isSystemJid = (jid) =>
  !jid ||
  jid.includes('@broadcast') ||
  jid.includes('status.broadcast') ||
  jid.includes('@newsletter');

/* ═══════════════════════════════════════════════════════════════════════════
   MESSAGE CONTENT UNWRAPPER
═══════════════════════════════════════════════════════════════════════════ */
const getMessageContent = (msg) => {
  if (!msg?.message) return null;
  let m = msg.message;
  if (m.ephemeralMessage)           m = m.ephemeralMessage.message;
  if (m.viewOnceMessageV2)          m = m.viewOnceMessageV2.message;
  if (m.viewOnceMessage)            m = m.viewOnceMessage.message;
  if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
  return m;
};

const getBodyText = (content) => {
  if (!content) return '';
  return (
    content.conversation               ||
    content.extendedTextMessage?.text  ||
    content.imageMessage?.caption      ||
    content.videoMessage?.caption      || ''
  ).trim();
};

/* ═══════════════════════════════════════════════════════════════════════════
   COMMAND REGISTRY
═══════════════════════════════════════════════════════════════════════════ */
const commands       = loadCommands();
const pluginInitDone = new WeakMap();

const reloadCommands = () => {
  const fresh = loadCommands({ fresh: true });
  commands.clear();
  for (const [k, v] of fresh) commands.set(k, v);
  return commands;
};

/* ═══════════════════════════════════════════════════════════════════════════
   NEWSLETTER FORCE-JOIN  (background — never blocks startup)
═══════════════════════════════════════════════════════════════════════════ */
const autoJoinNewsletters = (sock) => {
  if (typeof sock?.newsletterFollow !== 'function') return;
  (async () => {
    console.log(`[ProBoy] Joining ${JOIN_CHANNELS.length} channels in background…`);
    for (const jid of JOIN_CHANNELS) {
      try { await sock.newsletterFollow(jid); } catch { /* already following or unavailable */ }
      await new Promise(r => setTimeout(r, 3000)); // 3s delay → avoids WhatsApp ban
    }
    console.log('[ProBoy] Channel join done.');
  })();
};

/* ═══════════════════════════════════════════════════════════════════════════
   PLUGIN INIT
═══════════════════════════════════════════════════════════════════════════ */
const initializePlugins = async (sock) => {
  if (!sock) return;
  if (!pluginInitDone.has(sock)) {
    pluginInitDone.set(sock, new Set());
    autoJoinNewsletters(sock);
    initializeAntiCall(sock);
  }
  const done = pluginInitDone.get(sock);
  for (const cmd of new Set(commands.values())) {
    if (!cmd?.name || done.has(cmd.name) || typeof cmd.init !== 'function') continue;
    try { await cmd.init(sock); done.add(cmd.name); }
    catch (e) { console.error(`[Init:${cmd.name}]`, e?.message); }
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   ANTI-CALL  (DB-backed — .anticall on|off works at runtime)
═══════════════════════════════════════════════════════════════════════════ */
const initializeAntiCall = (sock) => {
  if (!sock) return;
  sock.ev.on('call', async (calls) => {
    try {
      if (!getDb(sock).getGlobalSetting?.('anticall')) return;
      for (const call of calls) {
        if (call.status !== 'offer') continue;
        try {
          if (typeof sock.rejectCall === 'function') await sock.rejectCall(call.id, call.from);
          await sock.sendMessage(call.from, { text: '🚫 *Calls are disabled.*\nYou have been blocked.' });
          await sock.updateBlockStatus(call.from, 'block');
        } catch {}
      }
    } catch {}
  });
};

/* ═══════════════════════════════════════════════════════════════════════════
   ANTI-LINK  (strict regex — no false positives on normal text)
═══════════════════════════════════════════════════════════════════════════ */
const URL_RE = /(?:https?:\/\/|www\.)[^\s]{4,}|chat\.whatsapp\.com\/[0-9A-Za-z]{10,}/i;

const handleAntilink = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const gs     = getDb(sock).getGroupSettings?.(from) || {};
    if (!gs.antilink) return false;

    const body = getBodyText(getMessageContent(msg));
    if (!URL_RE.test(body)) return false;

    // Whitelist
    if (Array.isArray(gs.antilinkWhitelist) && gs.antilinkWhitelist.length) {
      try {
        const m = body.match(/(?:https?:\/\/|www\.)[^\s]+/i);
        if (m) {
          const host = new URL(m[0].startsWith('http') ? m[0] : `https://${m[0]}`).hostname.toLowerCase();
          if (gs.antilinkWhitelist.map(d => String(d).toLowerCase()).some(d => host === d || host.endsWith(`.${d}`)))
            return false;
        }
      } catch {}
    }

    if (await isAdmin(sock, sender, from, groupMetadata) || isOwner(sender)) return false;
    if (!await isBotAdmin(sock, from)) return false;

    const action = (gs.antilinkAction || 'delete').toLowerCase();

    try { await sock.sendMessage(from, { delete: msg.key }); } catch {}

    if (action === 'warn') {
      const warn = getDb(sock).addWarning?.(from, sender, 'Anti-Link');
      const max  = config.maxWarnings || 3;
      if (warn && warn.count >= max) {
        await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
        await sock.sendMessage(from, { text: `🔗 *Anti-Link:* @${sender.split('@')[0]} kicked after ${max} warnings.`, mentions: [sender] }).catch(() => {});
      } else {
        await sock.sendMessage(from, { text: `🔗 *Anti-Link:* Warning ${warn?.count ?? '?'}/${max}. No links allowed.`, mentions: [sender] }).catch(() => {});
      }
    } else if (action === 'kick') {
      await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
      await sock.sendMessage(from, { text: `🔗 *Anti-Link:* @${sender.split('@')[0]} kicked.`, mentions: [sender] }).catch(() => {});
    } else {
      await sock.sendMessage(from, { text: `⚠️ Links not allowed. Removed.`, mentions: [sender] }).catch(() => {});
    }
    return true;
  } catch { return false; }
};

/* ═══════════════════════════════════════════════════════════════════════════
   ANTI-GROUP-MENTION
═══════════════════════════════════════════════════════════════════════════ */
const handleAntigroupmention = async (sock, msg, groupMetadata) => {
  try {
    const from   = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const gs     = getDb(sock).getGroupSettings?.(from) || {};
    if (!gs.antigroupmention) return;

    const m = msg.message || {};
    let isForwarded =
      !!m.groupStatusMentionMessage ||
      (m.protocolMessage?.type === 25) ||
      !!m.extendedTextMessage?.contextInfo?.forwardedNewsletterMessageInfo ||
      !!m.imageMessage?.contextInfo?.forwardedNewsletterMessageInfo ||
      !!m.videoMessage?.contextInfo?.forwardedNewsletterMessageInfo ||
      !!m.contextInfo?.forwardedNewsletterMessageInfo ||
      !!m.contextInfo?.isForwarded;

    if (!isForwarded) {
      const ctx = m.extendedTextMessage?.contextInfo || m.contextInfo;
      if (ctx) isForwarded = !!ctx.isForwarded || !!ctx.forwardingScore;
    }

    if (!isForwarded) return;
    if (await isAdmin(sock, sender, from, groupMetadata) || isOwner(sender)) return;

    const botAdm = await isBotAdmin(sock, from);
    const action = (gs.antigroupmentionAction || 'delete').toLowerCase();

    try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
    if (action === 'kick' && botAdm)
      await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
  } catch {}
};

/* ═══════════════════════════════════════════════════════════════════════════
   UTILS: button.js optional
═══════════════════════════════════════════════════════════════════════════ */
const handleButtonCommand = async (sock, msg, extra) => {
  try {
    const bu = require('./utils/button');
    if (typeof bu?.handleButtonResponse === 'function')
      return await bu.handleButtonResponse(sock, msg, extra);
  } catch {}
  return false;
};

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN MESSAGE HANDLER
═══════════════════════════════════════════════════════════════════════════ */
const handleMessage = async (sock, msg) => {
  try {
    if (!msg?.message) return;

    const from = msg.key.remoteJid;

    /* ── 1. NEWSLETTER AUTO-REACT ─────────────────────────────────────── */
    if (from?.includes('@newsletter')) {
      if (REACT_CHANNELS.has(from)) {
        try {
          const serverId = msg.key.server_id || msg.messageStubParameters?.[0];
          const emoji    = randEmoji(CHANNEL_EMOJIS);
          if (serverId && typeof sock.newsletterReactMessage === 'function') {
            sock.newsletterReactMessage(from, String(serverId), emoji).catch(() => {});
          } else {
            sock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {});
          }
        } catch {}
      }
      return; // newsletters need no further processing
    }

    /* ── 2. SYSTEM JID FILTER ──────────────────────────────────────────── */
    if (isSystemJid(from) && from !== 'status@broadcast') return false;

    /* ── 3. GENERAL AUTO-REACT ─────────────────────────────────────────── */
    if (config.autoReact && !msg.key.fromMe) {
      try {
        const ct   = msg.message.ephemeralMessage?.message || msg.message;
        const text = ct.conversation || ct.extendedTextMessage?.text || '';
        const mode = config.autoReactMode || 'bot';
        if (mode === 'all') {
          sock.sendMessage(from, { react: { text: randEmoji(GENERAL_EMOJIS), key: msg.key } }).catch(() => {});
        } else if (mode === 'bot' && text.trim().startsWith(config.prefix || '.')) {
          sock.sendMessage(from, { react: { text: '⏳', key: msg.key } }).catch(() => {});
        }
      } catch {}
    }

    /* ── 4. CONTENT EXTRACTION ─────────────────────────────────────────── */
    const content = getMessageContent(msg);
    if (!content) return false;

    const PROTO = ['protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo'];
    if (!Object.keys(content).some(k => !PROTO.includes(k))) return false;

    const sender        = msg.key.fromMe
      ? sock.user.id.split(':')[0] + '@s.whatsapp.net'
      : (msg.key.participant || msg.key.remoteJid);

    const isGroup       = from.endsWith('@g.us');
    const senderIsOwner = isOwner(sender);
    const senderIsSudo  = isSudo(sock, sender);
    const senderIsPriv  = senderIsOwner || senderIsSudo;

    /* ── 5. BANNED USER CHECK ──────────────────────────────────────────── */
    if (isBannedUser(sock, sender)) {
      const t = getBodyText(content);
      if (t.startsWith(config.prefix || '.'))
        await sock.sendMessage(from, { text: '🚫 You are banned from using bot commands.' }, { quoted: msg });
      return false;
    }

    const groupMetadata = isGroup ? await getGroupMetadata(sock, from) : null;

    /* ── 6. GROUP ANTI-FEATURES ────────────────────────────────────────── */
    if (isGroup) {
      addMessage(from, sender); // count BEFORE any early return
      const gs = getDb(sock).getGroupSettings?.(from) || {};

      if (gs.antigroupmention) {
        try { await handleAntigroupmention(sock, msg, groupMetadata); } catch {}
      }

      if (gs.antilink) {
        try {
          if (await handleAntilink(sock, msg, groupMetadata)) return false;
        } catch {}
      }
    }

    /* ── 7. ADMIN STATUS ───────────────────────────────────────────────── */
    const senderIsAdmin = isGroup ? await isAdmin(sock, sender, from, groupMetadata) : false;
    const botIsAdmin    = isGroup ? await isBotAdmin(sock, from)                     : false;

    /* ── 8. HOOK EXTRA ─────────────────────────────────────────────────── */
    const mkExtra = () => ({
      from, sender, isGroup, groupMetadata,
      isOwner: senderIsOwner, isSudo: senderIsSudo,
      isAdmin: senderIsAdmin, isBotAdmin: botIsAdmin,
      isMod: isMod(sock, sender),
      config, commands,
      database: getDb(sock),
      utils: { getMessageContent, normalizeJidWithLid, normalizeJid, buildComparableIds },
      reply: (text)  => sock.sendMessage(from, { text }, { quoted: msg }),
      react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
    });

    const hookExtra = mkExtra();

    /* ── 9. PLUGIN onMessage / handleMessage / autoRun HOOKS ───────────── */
    const gccmd = commands.get('gccmd');
    if (gccmd) {
      try {
        if (typeof gccmd.handleMessage === 'function') await gccmd.handleMessage(sock, msg, hookExtra);
        if (typeof gccmd.onMessage     === 'function') await gccmd.onMessage(sock, msg, hookExtra);
        if (typeof gccmd.autoRun       === 'function') await gccmd.autoRun(sock, msg, hookExtra);
      } catch (e) { console.error('[gccmd]', e.message); }
    }
    if (msg.__blockCommandRouting) return false;

    for (const cmd of new Set(commands.values())) {
      if (msg.__blockCommandRouting) break;
      if (cmd?.name === 'gccmd') continue;
      try {
        if (typeof cmd.handleMessage === 'function') await cmd.handleMessage(sock, msg, hookExtra);
        if (typeof cmd.onMessage     === 'function') await cmd.onMessage(sock, msg, hookExtra);
        if (typeof cmd.autoRun       === 'function') await cmd.autoRun(sock, msg, hookExtra);
      } catch (e) { console.error(`[Hook:${cmd.name}]`, e.message); }
    }
    if (msg.__blockCommandRouting) return false;

    /* ── 10. BUTTON HANDLING ───────────────────────────────────────────── */
    try {
      const btnExtra = mkExtra();

      // Layer 1: utils/button.js
      if (await handleButtonCommand(sock, msg, btnExtra)) return;

      // Layer 2: direct extraction
      const btnResp =
        content?.buttonsResponseMessage       ||
        content?.interactiveResponseMessage    ||
        msg.message?.buttonsResponseMessage    ||
        msg.message?.interactiveResponseMessage;

      if (btnResp) {
        let btnId = btnResp.selectedButtonId ||
                    btnResp.buttonReplyMessage?.selectedId ||
                    btnResp.id;

        if (!btnId) {
          const body = getBodyText(content);
          const map  = {
            '❤️ Alive': '.alive', '📋 Menu': '.menu',
            '🏓 Ping': '.ping',   'ℹ️ Info': '.info', '🛠️ Owner': '.owner'
          };
          if (map[body]) btnId = 'cmd_' + map[body];
        }

        if (btnId?.startsWith('cmd_')) {
          const full  = btnId.slice(4);
          const pfx   = config.prefix || '.';
          const str   = full.startsWith(pfx) ? full : pfx + full;
          const parts = str.slice(pfx.length).trim().split(/ +/);
          const cName = parts.shift()?.toLowerCase();
          if (cName) {
            const c = commands.get(cName);
            if (c?.execute) { await c.execute(sock, msg, parts, btnExtra); return; }
          }
        }
      }

      // Layer 3: legacy static button IDs
      const legBtn = content?.buttonsResponseMessage || msg.message?.buttonsResponseMessage;
      if (legBtn) {
        const legMap = { btn_menu: 'menu', btn_ping: 'ping', btn_help: 'list' };
        const cKey   = legMap[legBtn.selectedButtonId];
        if (cKey) {
          const c = commands.get(cKey);
          if (c?.execute) { await c.execute(sock, msg, [], btnExtra); return; }
        }
      }

      // Layer 4: plugin handleButtonResponse hooks
      const payload = content?.buttonsResponseMessage || content?.interactiveResponseMessage ||
                      msg.message?.buttonsResponseMessage || msg.message?.interactiveResponseMessage;
      if (payload) {
        for (const cmd of new Set(commands.values())) {
          if (typeof cmd.handleButtonResponse === 'function') {
            try { await cmd.handleButtonResponse(sock, msg, hookExtra); } catch {}
          }
        }
      }
    } catch {}

    /* ── 11. BODY TEXT ─────────────────────────────────────────────────── */
    const body = getBodyText(content);

    /* ── 12. GROUP SECURITY: anti-all / anti-tag ───────────────────────── */
    if (isGroup) {
      const gs = getDb(sock).getGroupSettings?.(from) || {};

      if (gs.antiall && !senderIsAdmin && !senderIsOwner) {
        if (botIsAdmin) {
          try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
          return;
        }
      }

      if (gs.antitag && !msg.key.fromMe) {
        try {
          const ctx          = content.extendedTextMessage?.contextInfo;
          const mentionedLen = ctx?.mentionedJid?.length ?? 0;
          const numericTags  = new Set((body.match(/@\d{10,}/g) || []).map(m => m.slice(1)));
          const total        = Math.max(mentionedLen, numericTags.size);
          const threshold    = Math.max(3, Math.ceil((groupMetadata?.participants?.length || 0) * 0.5));

          if (total >= 3 && (total >= threshold || numericTags.size >= 10) && !senderIsAdmin && !senderIsOwner) {
            const action = (gs.antitagAction || 'delete').toLowerCase();
            try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
            if (action === 'kick' && botIsAdmin) {
              await sock.groupParticipantsUpdate(from, [sender], 'remove').catch(() => {});
              await sock.sendMessage(from, {
                text: `🚫 *Antitag:* @${sender.split('@')[0]} kicked for mass tagging.`,
                mentions: [sender]
              }).catch(() => {});
            } else {
              await sock.sendMessage(from, {
                text: '⚠️ *Antitag:* Mass-tag detected and prevented.',
                mentions: [sender]
              }, { quoted: msg }).catch(() => {});
            }
            return;
          }
        } catch {}
      }
    }

    /* ── 13. AUTO-STICKER ──────────────────────────────────────────────── */
    if (isGroup) {
      const gs = getDb(sock).getGroupSettings?.(from) || {};
      if (gs.autosticker) {
        const media = content?.imageMessage || content?.videoMessage;
        if (media && !body.startsWith(config.prefix || '.')) {
          try {
            const sc = commands.get('sticker');
            if (sc?.execute) { await sc.execute(sock, msg, [], hookExtra); return; }
          } catch (e) { console.error('[AutoSticker]', e.message); }
        }
      }
    }

    /* ── 14. COMMAND ROUTING ───────────────────────────────────────────── */
    const prefix = config.prefix || '.';
    if (!body.startsWith(prefix)) return false;

    const parts       = body.slice(prefix.length).trim().split(/\s+/);
    const commandName = parts.shift()?.toLowerCase();
    if (!commandName) return false;

    const command = commands.get(commandName);
    if (!command) return false;

    if (config.selfMode && !senderIsPriv) return;

    if (command.ownerOnly && !senderIsPriv)
      return sock.sendMessage(from, { text: config.messages?.ownerOnly || '🔒 Owner only.' }, { quoted: msg });

    if (command.modOnly && !isMod(sock, sender) && !senderIsPriv)
      return sock.sendMessage(from, { text: '🔒 Moderators only.' }, { quoted: msg });

    if (command.groupOnly && !isGroup)
      return sock.sendMessage(from, { text: config.messages?.groupOnly || '🚫 Groups only.' }, { quoted: msg });

    if (command.privateOnly && isGroup)
      return sock.sendMessage(from, { text: config.messages?.privateOnly || '🚫 Private chat only.' }, { quoted: msg });

    if (command.adminOnly && !senderIsAdmin && !senderIsPriv)
      return sock.sendMessage(from, { text: config.messages?.adminOnly || '🔒 Admins only.' }, { quoted: msg });

    if (command.botAdminNeeded && !botIsAdmin)
      return sock.sendMessage(from, { text: config.messages?.botAdminNeeded || '🤖 I need admin rights.' }, { quoted: msg });

    if (config.autoTyping) {
      try { await sock.sendPresenceUpdate('composing', from); } catch {}
    }

    console.log(`\x1b[1;36m[CMD]\x1b[0m \x1b[1;32m${commandName}\x1b[0m <- ${getDisplaySender(sender)}`);

    await command.execute(sock, msg, parts, {
      commandName, from, sender, isGroup, groupMetadata,
      isOwner: senderIsOwner, isSudo: senderIsSudo,
      isAdmin: senderIsAdmin, isBotAdmin: botIsAdmin,
      isMod: isMod(sock, sender),
      config, commands,
      database: getDb(sock),
      utils: { getMessageContent, normalizeJidWithLid, normalizeJid, buildComparableIds },
      reply: (text)  => sock.sendMessage(from, { text }, { quoted: msg }),
      react: (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } })
    });

    globalThis.__PROBOY_LAST_COMMAND_TS = Date.now();
    return true;

  } catch (error) {
    if (error?.message?.includes('rate-overlimit')) return false;
    console.error('[Handler Error]', error?.message || error);
    try {
      await sock.sendMessage(msg.key.remoteJid, {
        text: `${config.messages?.error || '❌ Error'}\n\n${error.message}`
      }, { quoted: msg });
    } catch {}
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   GROUP UPDATE HANDLER  (welcome / goodbye)
═══════════════════════════════════════════════════════════════════════════ */
const handleGroupUpdate = async (sock, update) => {
  try {
    const { id, participants, action } = update;
    if (!id?.endsWith('@g.us')) return false;

    const gs   = getDb(sock).getGroupSettings?.(id) || {};
    const meta = await getGroupMetadata(sock, id);

    // Plugin hooks
    try {
      for (const cmd of new Set(commands.values())) {
        if (typeof cmd.handleGroupUpdate === 'function') {
          await cmd.handleGroupUpdate(sock, update, {
            from: id, isGroup: true, groupMetadata: meta || null,
            config, database: getDb(sock),
            reply: (text) => sock.sendMessage(id, { text })
          });
        }
      }
    } catch {}

    if (!gs.welcome && !gs.goodbye) return;
    if (!meta) return;

    const getJid = (p) =>
      typeof p === 'string' ? p : (p?.id || p?.jid || p?.participant || null);

    for (const participant of participants) {
      const pJid = getJid(participant);
      if (!pJid) continue;
      const pNum = pJid.split('@')[0];

      // Display name
      let displayName = pNum;
      try {
        const pJidNorm = normalizeJidWithLid(pJid);
        const contact  = sock.store?.contacts?.[pJidNorm];
        if (contact?.notify && !contact.notify.match(/^\d+$/)) displayName = contact.notify.trim();
        else if (contact?.name && !contact.name.match(/^\d+$/))  displayName = contact.name.trim();
      } catch {}

      // Profile pic
      let ppUrl = config.apis?.defaultAssets?.fallbackProfilePicUrl || 'https://img.pyrocdn.com/dbKUgahg.png';
      try { ppUrl = await sock.profilePictureUrl(pJid, 'image'); } catch {}

      const groupName = meta.subject || 'the group';
      const groupDesc = meta.desc    || 'No description';
      const timeStr   = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

      if (action === 'add' && gs.welcome) {
        const caption =
          `╭╼━≪•𝙽𝙴𝚆 𝙼𝙴𝙼𝙱𝙴𝚁•≫━╾╮\n` +
          `┃𝚆𝙴𝙻𝙲𝙾𝙼𝙴: @${displayName} 👋\n` +
          `┃Members: #${meta.participants.length}\n` +
          `┃𝚃𝙸𝙼𝙴: ${timeStr} ⏰\n` +
          `╰━━━━━━━━━━━━━━━╯\n\n` +
          `*@${displayName}* Welcome to *${groupName}*! 🎉\n` +
          `*Description:*\n${groupDesc}\n\n` +
          `> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ${config.botName}*`;
        try {
          if (!axios) throw new Error('no axios');
          const baseUrl = config.apis?.someRandomApi?.baseUrl || 'https://api.some-random-api.com';
          const apiUrl  = `${baseUrl}/welcome/img/7/gaming4?type=join&textcolor=white` +
                          `&username=${encodeURIComponent(displayName)}&guildName=${encodeURIComponent(groupName)}` +
                          `&memberCount=${meta.participants.length}&avatar=${encodeURIComponent(ppUrl)}`;
          const res = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 10000 });
          await sock.sendMessage(id, { image: Buffer.from(res.data), caption, mentions: [pJid] });
        } catch {
          let wm = gs.welcomeMessage || 'Welcome @user to @group! 👋 Enjoy your stay!';
          wm = wm.replace('@user', `@${pNum}`).replace('@group', groupName);
          await sock.sendMessage(id, { text: wm, mentions: [pJid] }).catch(() => {});
        }

      } else if (action === 'remove' && gs.goodbye) {
        try {
          if (!axios) throw new Error('no axios');
          const baseUrl = config.apis?.someRandomApi?.baseUrl || 'https://api.some-random-api.com';
          const apiUrl  = `${baseUrl}/welcome/img/7/gaming4?type=leave&textcolor=white` +
                          `&username=${encodeURIComponent(displayName)}&guildName=${encodeURIComponent(groupName)}` +
                          `&memberCount=${meta.participants.length}&avatar=${encodeURIComponent(ppUrl)}`;
          const res = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 10000 });
          await sock.sendMessage(id, {
            image: Buffer.from(res.data),
            caption: `Goodbye @${displayName} 👋 We will miss you!`,
            mentions: [pJid]
          });
        } catch {
          await sock.sendMessage(id, {
            text: `Goodbye @${pNum} 👋 We will miss you! 💀`,
            mentions: [pJid]
          }).catch(() => {});
        }
      }
    }
  } catch (error) {
    if (error?.message?.includes('forbidden') || error?.message?.includes('403')) return;
    console.error('[GroupUpdate Error]', error?.message);
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   PROCESS-LEVEL ERROR GUARD  (prevents crashes → prevents reconnect loops)
═══════════════════════════════════════════════════════════════════════════ */
if (!process.__PROBOY_ERR_GUARD) {
  process.__PROBOY_ERR_GUARD = true;
  process.on('unhandledRejection', (reason) => {
    const msg = String(reason?.message || reason || '');
    if (msg.includes('rate-overlimit') || msg.includes('Connection Closed')) return;
    console.error('[ProBoy] Unhandled rejection:', msg);
  });
  process.on('uncaughtException', (err) => {
    const msg = String(err?.message || err || '');
    if (msg.includes('rate-overlimit')) return;
    console.error('[ProBoy] Uncaught exception:', msg);
    // Do NOT call process.exit() — bot keeps running
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXPORTS
═══════════════════════════════════════════════════════════════════════════ */
module.exports = {
  /* core handlers */
  handleMessage,
  initializePlugins,
  handleGroupUpdate,
  initializeAntiCall,
  /* anti-features */
  handleAntilink,
  handleAntigroupmention,
  /* permission helpers */
  isOwner,
  isSudo,
  isAdmin,
  isBotAdmin,
  isMod,
  /* data helpers */
  getGroupMetadata,
  findParticipant,
  getMessageContent,
  normalizeJid,
  normalizeJidWithLid,
  buildComparableIds,
  /* command registry */
  commands,
  reloadCommands,
  /* backward compat */
  database: defaultDatabase,
  /* channel config (read-only) */
  JOIN_CHANNELS,
  REACT_CHANNELS
};
