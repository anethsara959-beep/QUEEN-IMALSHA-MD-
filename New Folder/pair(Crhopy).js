
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FileType = require('file-type');
const fetch = require('node-fetch');
const { MongoClient } = require('mongodb');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  getContentType,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  downloadContentFromMessage,
  DisconnectReason
} = require('baileys');

// ---------------- CONFIG ----------------

const BOT_NAME_FANCY = '✦ 𝐂𝐇𝐀𝐌𝐀  𝐌𝐈𝐍𝐈  𝐁𝐎𝐓 ✦';

const config = {
  AUTO_VIEW_STATUS: 'true',
  AUTO_LIKE_STATUS: 'true',
  AUTO_RECORDING: 'true',
  AUTO_LIKE_EMOJI: ['🔥','😀','👍','😃','😄','😁','😎','🥳','🌞','🌈','❤️'],
  PREFIX: '.',
  MAX_RETRIES: 3,
  GROUP_INVITE_LINK: 'https://chat.whatsapp.com/BbBrjXNB5mBG5fEvMAbAqF?mode=ems_copy_t',
  RCD_IMAGE_PATH: 'https://files.catbox.moe/mwkr87.jpg',
  NEWSLETTER_JID: '120363402094635383@newsletter',
  OTP_EXPIRY: 300000,
  OWNER_NUMBER: process.env.OWNER_NUMBER || '94703229057',
  CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb6UR8S8fewn0otjcc0g',
  BOT_NAME: 'CHAMA MINI BOT',
  BOT_VERSION: '3.0.0V',
  OWNER_NAME: '𝗖𝗛𝗔𝗠𝗜𝙉𝙳𝚄',
  IMAGE_PATH: 'https://files.catbox.moe/mwkr87.jpg',
  BOT_FOOTER: '𝙲𝙷𝙰𝙼𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸',
  BUTTON_IMAGES: { ALIVE: 'https://github.com/Chamijd/KHAN-DATA/raw/refs/heads/main/logo/alive-thumbnail.jpg' },
  // global default mode if session-specific not set. Options: 'public', 'private', 'inbox', 'groups'
  MODE: process.env.BOT_MODE || 'public'
};

// ---------------- MONGO SETUP ----------------

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://chamaminibot:oUW3TqJyWvrqhHEx@chamamini.szsesy0.mongodb.net/';
const MONGO_DB = process.env.MONGO_DB || 'CHAMA_MINI';

let mongoClient, mongoDB;
let sessionsCol, numbersCol, adminsCol, newsletterCol, configsCol, newsletterReactsCol;

async function initMongo() {
  try {
    if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected && mongoClient.topology.isConnected()) return;
  } catch(e){}
  mongoClient = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  await mongoClient.connect();
  mongoDB = mongoClient.db(MONGO_DB);

  sessionsCol = mongoDB.collection('sessions');
  numbersCol = mongoDB.collection('numbers');
  adminsCol = mongoDB.collection('admins');
  newsletterCol = mongoDB.collection('newsletter_list');
  configsCol = mongoDB.collection('configs');
  newsletterReactsCol = mongoDB.collection('newsletter_reacts');

  await sessionsCol.createIndex({ number: 1 }, { unique: true });
  await numbersCol.createIndex({ number: 1 }, { unique: true });
  await newsletterCol.createIndex({ jid: 1 }, { unique: true });
  await newsletterReactsCol.createIndex({ jid: 1 }, { unique: true });
  await configsCol.createIndex({ number: 1 }, { unique: true });
  console.log('✅ Mongo initialized and collections ready');
}

// ---------------- Mongo helpers ----------------

async function saveCredsToMongo(number, creds, keys = null) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = { number: sanitized, creds, keys, updatedAt: new Date() };
    await sessionsCol.updateOne({ number: sanitized }, { $set: doc }, { upsert: true });
    console.log(`Saved creds to Mongo for ${sanitized}`);
  } catch (e) { console.error('saveCredsToMongo error:', e); }
}

async function loadCredsFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = await sessionsCol.findOne({ number: sanitized });
    return doc || null;
  } catch (e) { console.error('loadCredsFromMongo error:', e); return null; }
}

async function removeSessionFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await sessionsCol.deleteOne({ number: sanitized });
    console.log(`Removed session from Mongo for ${sanitized}`);
  } catch (e) { console.error('removeSessionToMongo error:', e); }
}

async function addNumberToMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.updateOne({ number: sanitized }, { $set: { number: sanitized } }, { upsert: true });
    console.log(`Added number ${sanitized} to Mongo numbers`);
  } catch (e) { console.error('addNumberToMongo', e); }
}

async function removeNumberFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.deleteOne({ number: sanitized });
    console.log(`Removed number ${sanitized} from Mongo numbers`);
  } catch (e) { console.error('removeNumberFromMongo', e); }
}

async function getAllNumbersFromMongo() {
  try {
    await initMongo();
    const docs = await numbersCol.find({}).toArray();
    return docs.map(d => d.number);
  } catch (e) { console.error('getAllNumbersFromMongo', e); return []; }
}

async function loadAdminsFromMongo() {
  try {
    await initMongo();
    const docs = await adminsCol.find({}).toArray();
    return docs.map(d => d.jid || d.number).filter(Boolean);
  } catch (e) { console.error('loadAdminsFromMongo', e); return []; }
}

async function addAdminToMongo(jidOrNumber) {
  try {
    await initMongo();
    const doc = { jid: jidOrNumber };
    await adminsCol.updateOne({ jid: jidOrNumber }, { $set: doc }, { upsert: true });
    console.log(`Added admin ${jidOrNumber}`);
  } catch (e) { console.error('addAdminToMongo', e); }
}

async function removeAdminFromMongo(jidOrNumber) {
  try {
    await initMongo();
    await adminsCol.deleteOne({ jid: jidOrNumber });
    console.log(`Removed admin ${jidOrNumber}`);
  } catch (e) { console.error('removeAdminFromMongo', e); }
}

async function addNewsletterToMongo(jid, emojis = []) {
  try {
    await initMongo();
    const doc = { jid, emojis: Array.isArray(emojis) ? emojis : [], addedAt: new Date() };
    await newsletterCol.updateOne({ jid }, { $set: doc }, { upsert: true });
    console.log(`Added newsletter ${jid} -> emojis: ${doc.emojis.join(',')}`);
  } catch (e) { console.error('addNewsletterToMongo', e); throw e; }
}

async function removeNewsletterFromMongo(jid) {
  try {
    await initMongo();
    await newsletterCol.deleteOne({ jid });
    console.log(`Removed newsletter ${jid}`);
  } catch (e) { console.error('removeNewsletterFromMongo', e); throw e; }
}

async function listNewslettersFromMongo() {
  try {
    await initMongo();
    const docs = await newsletterCol.find({}).toArray();
    return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
  } catch (e) { console.error('listNewslettersFromMongo', e); return []; }
}

async function saveNewsletterReaction(jid, messageId, emoji, sessionNumber) {
  try {
    await initMongo();
    const doc = { jid, messageId, emoji, sessionNumber, ts: new Date() };
    if (!mongoDB) await initMongo();
    const col = mongoDB.collection('newsletter_reactions_log');
    await col.insertOne(doc);
    console.log(`Saved reaction ${emoji} for ${jid}#${messageId}`);
  } catch (e) { console.error('saveNewsletterReaction', e); }
}

async function setUserConfigInMongo(number, conf) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await configsCol.updateOne({ number: sanitized }, { $set: { number: sanitized, config: conf, updatedAt: new Date() } }, { upsert: true });
  } catch (e) { console.error('setUserConfigInMongo', e); }
}

async function loadUserConfigFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = await configsCol.findOne({ number: sanitized });
    return doc ? doc.config : null;
  } catch (e) { console.error('loadUserConfigFromMongo', e); return null; }
}

// -------------- newsletter react-config helpers --------------

async function addNewsletterReactConfig(jid, emojis = []) {
  try {
    await initMongo();
    await newsletterReactsCol.updateOne({ jid }, { $set: { jid, emojis, addedAt: new Date() } }, { upsert: true });
    console.log(`Added react-config for ${jid} -> ${emojis.join(',')}`);
  } catch (e) { console.error('addNewsletterReactConfig', e); throw e; }
}

async function removeNewsletterReactConfig(jid) {
  try {
    await initMongo();
    await newsletterReactsCol.deleteOne({ jid });
    console.log(`Removed react-config for ${jid}`);
  } catch (e) { console.error('removeNewsletterReactConfig', e); throw e; }
}

async function listNewsletterReactsFromMongo() {
  try {
    await initMongo();
    const docs = await newsletterReactsCol.find({}).toArray();
    return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
  } catch (e) { console.error('listNewsletterReactsFromMongo', e); return []; }
}

async function getReactConfigForJid(jid) {
  try {
    await initMongo();
    const doc = await newsletterReactsCol.findOne({ jid });
    return doc ? (Array.isArray(doc.emojis) ? doc.emojis : []) : null;
  } catch (e) { console.error('getReactConfigForJid', e); return null; }
}

// ---------------- basic utils ----------------

function formatMessage(title, content, footer) {
  return `*${title}*\n\n${content}\n\n> *${footer}*`;
}
function generateOTP(){ return Math.floor(100000 + Math.random() * 900000).toString(); }
function getSriLankaTimestamp(){ return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss'); }

const activeSockets = new Map();

const socketCreationTime = new Map();

const otpStore = new Map();

// ---------------- helpers kept/adapted ----------------

async function joinGroup(socket) {
  let retries = config.MAX_RETRIES;
  const inviteCodeMatch = (config.GROUP_INVITE_LINK || '').match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
  if (!inviteCodeMatch) return { status: 'failed', error: 'No group invite configured' };
  const inviteCode = inviteCodeMatch[1];
  while (retries > 0) {
    try {
      const response = await socket.groupAcceptInvite(inviteCode);
      if (response?.gid) return { status: 'success', gid: response.gid };
      throw new Error('No group ID in response');
    } catch (error) {
      retries--;
      let errorMessage = error.message || 'Unknown error';
      if (error.message && error.message.includes('not-authorized')) errorMessage = 'Bot not authorized';
      else if (error.message && error.message.includes('conflict')) errorMessage = 'Already a member';
      else if (error.message && error.message.includes('gone')) errorMessage = 'Invite invalid/expired';
      if (retries === 0) return { status: 'failed', error: errorMessage };
      await delay(2000 * (config.MAX_RETRIES - retries));
    }
  }
  return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult, sessionConfig = {}) {
  const admins = await loadAdminsFromMongo();
  const groupStatus = groupResult.status === 'success' ? `Joined (ID: ${groupResult.gid})` : `Failed to join group: ${groupResult.error}`;
  const botName = sessionConfig.botName || BOT_NAME_FANCY;
  const image = sessionConfig.logo || config.RCD_IMAGE_PATH;
  const caption = formatMessage(botName, `📞 Number: ${number}`, botName);
  for (const admin of admins) {
    try {
      const to = admin.includes('@') ? admin : `${admin}@s.whatsapp.net`;
      if (String(image).startsWith('http')) {
        await socket.sendMessage(to, { image: { url: image }, caption });
      } else {
        try {
          const buf = fs.readFileSync(image);
          await socket.sendMessage(to, { image: buf, caption });
        } catch (e) {
          await socket.sendMessage(to, { image: { url: config.RCD_IMAGE_PATH }, caption });
        }
      }
    } catch (err) {
      console.error('Failed to send connect message to admin', admin, err?.message || err);
    }
  }
}

async function sendOwnerConnectMessage(socket, number, groupResult, sessionConfig = {}) {
  try {
    const ownerJid = `${config.OWNER_NUMBER.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
    const activeCount = activeSockets.size;
    const botName = sessionConfig.botName || BOT_NAME_FANCY;
    const image = sessionConfig.logo || config.RCD_IMAGE_PATH;
    const groupStatus = groupResult.status === 'success' ? `Joined (ID: ${groupResult.gid})` : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(`👑 OWNER CONNECT`, `📞 Number: ${number}\n\n🔢 Active sessions: ${activeCount}`, botName);
    if (String(image).startsWith('http')) {
      await socket.sendMessage(ownerJid, { image: { url: image }, caption });
    } else {
      try {
        const buf = fs.readFileSync(image);
        await socket.sendMessage(ownerJid, { image: buf, caption });
      } catch (e) {
        await socket.sendMessage(ownerJid, { image: { url: config.RCD_IMAGE_PATH }, caption });
      }
    }
  } catch (err) { console.error('Failed to send owner connect message:', err); }
}

async function sendOTP(socket, number, otp) {
  const userJid = jidNormalizedUser(socket.user.id);
  const message = formatMessage(`🔐 OTP VERIFICATION — ${BOT_NAME_FANCY}`, `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.\n\nNumber: ${number}`, BOT_NAME_FANCY);
  try { await socket.sendMessage(userJid, { text: message }); console.log(`OTP ${otp} sent to ${number}`); }
  catch (error) { console.error(`Failed to send OTP to ${number}:`, error); throw error; }
}

// ---------------- handlers (newsletter + reactions) ----------------

async function setupNewsletterHandlers(socket, sessionNumber) {
  const rrPointers = new Map();

  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key) return;
    const jid = message.key.remoteJid;

    try {
      const followedDocs = await listNewslettersFromMongo(); // array of {jid, emojis}
      const reactConfigs = await listNewsletterReactsFromMongo(); // [{jid, emojis}]
      const reactMap = new Map();
      for (const r of reactConfigs) reactMap.set(r.jid, r.emojis || []);

      const followedJids = followedDocs.map(d => d.jid);
      if (!followedJids.includes(jid) && !reactMap.has(jid)) return;

      let emojis = reactMap.get(jid) || null;
      if ((!emojis || emojis.length === 0) && followedDocs.find(d => d.jid === jid)) {
        emojis = (followedDocs.find(d => d.jid === jid).emojis || []);
      }
      if (!emojis || emojis.length === 0) emojis = config.AUTO_LIKE_EMOJI;

      let idx = rrPointers.get(jid) || 0;
      const emoji = emojis[idx % emojis.length];
      rrPointers.set(jid, (idx + 1) % emojis.length);

      const messageId = message.newsletterServerId || message.key.id;
      if (!messageId) return;

      let retries = 3;
      while (retries-- > 0) {
        try {
          if (typeof socket.newsletterReactMessage === 'function') {
            await socket.newsletterReactMessage(jid, messageId.toString(), emoji);
          } else {
            await socket.sendMessage(jid, { react: { text: emoji, key: message.key } });
          }
          console.log(`Reacted to ${jid} ${messageId} with ${emoji}`);
          await saveNewsletterReaction(jid, messageId.toString(), emoji, sessionNumber || null);
          break;
        } catch (err) {
          console.warn(`Reaction attempt failed (${3 - retries}/3):`, err?.message || err);
          await delay(1200);
        }
      }

    } catch (error) {
      console.error('Newsletter reaction handler error:', error?.message || error);
    }
  });
}


// ---------------- status + revocation + resizing ----------------

async function setupStatusHandlers(socket) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;
    try {
      // determine session number from socket
      const sanitizedNumber = (socket.user && socket.user.id) ? socket.user.id.split(':')[0] : null;
      const sessionConfig = sanitizedNumber ? (await loadUserConfigFromMongo(sanitizedNumber) || {}) : {};

      // stview handling: session-specific override falls back to global config
      const stviewEnabled = (typeof sessionConfig.stview !== 'undefined') ? !!sessionConfig.stview : (config.AUTO_VIEW_STATUS === 'true');
      if (stviewEnabled) {
        try {
          let retries = config.MAX_RETRIES;
          while (retries > 0) {
            try { await socket.readMessages([message.key]); break; }
            catch (error) { retries--; await delay(1000 * (config.MAX_RETRIES - retries)); if (retries===0) throw error; }
          }
        } catch (e) { console.warn('Failed to auto-view status:', e); }
      }

      // reactions handling: session-specific sr overrides global AUTO_LIKE_EMOJI
      let emojis = Array.isArray(sessionConfig.sr) && sessionConfig.sr.length ? sessionConfig.sr : (config.AUTO_LIKE_STATUS === 'true' ? config.AUTO_LIKE_EMOJI : []);
      if (emojis && emojis.length > 0) {
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try {
            await socket.sendMessage(message.key.remoteJid, { react: { text: randomEmoji, key: message.key } }, { statusJidList: [message.key.participant] });
            break;
          } catch (error) { retries--; await delay(1000 * (config.MAX_RETRIES - retries)); if (retries===0) console.warn('Failed to react to status:', error); }
        }
      }

    } catch (error) { console.error('Status handler error:', error); }
  });
}


async function handleMessageRevocation(socket, number) {
  socket.ev.on('messages.delete', async ({ keys }) => {
    if (!keys || keys.length === 0) return;
    const messageKey = keys[0];
    const userJid = jidNormalizedUser(socket.user.id);
    const deletionTime = getSriLankaTimestamp();
    const message = formatMessage('🗑️ MESSAGE DELETED', `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🍁 Deletion Time: ${deletionTime}`, BOT_NAME_FANCY);
    try { await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: message }); }
    catch (error) { console.error('Failed to send deletion notification:', error); }
  });
}


async function resize(image, width, height) {
  let oyy = await Jimp.read(image);
  return await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
}


// ---------------- command handlers ----------------

function setupCommandHandlers(socket, number) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg || !msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

    const type = getContentType(msg.message);
    if (!msg.message) return;
    msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;

    const from = msg.key.remoteJid;
    const sender = from;
    const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
    const senderNumber = (nowsender || '').split('@')[0];
    const botNumber = socket.user.id ? socket.user.id.split(':')[0] : '';
    const isOwner = senderNumber === config.OWNER_NUMBER.replace(/[^0-9]/g,'');
    const isGroup = String(from || '').endsWith('@g.us');

    const body = (type === 'conversation') ? msg.message.conversation
      : (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text
      : (type === 'imageMessage' && msg.message.imageMessage.caption) ? msg.message.imageMessage.caption
      : (type === 'videoMessage' && msg.message.videoMessage.caption) ? msg.message.videoMessage.caption
      : (type === 'buttonsResponseMessage') ? msg.message.buttonsResponseMessage?.selectedButtonId
      : (type === 'listResponseMessage') ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId
      : (type === 'viewOnceMessage') ? (msg.message.viewOnceMessage?.message?.imageMessage?.caption || '') : '';

    if (!body || typeof body !== 'string') return;

    const prefix = config.PREFIX;
    const isCmd = body && body.startsWith && body.startsWith(prefix);
    const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : null;
    const args = body.trim().split(/ +/).slice(1);

    // helper: download quoted media into buffer
    async function downloadQuotedMedia(quoted) {
      if (!quoted) return null;
      const qTypes = ['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage'];
      const qType = qTypes.find(t => quoted[t]);
      if (!qType) return null;
      const messageType = qType.replace(/Message$/i, '').toLowerCase();
      const stream = await downloadContentFromMessage(quoted[qType], messageType);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      return {
        buffer,
        mime: quoted[qType].mimetype || '',
        caption: quoted[qType].caption || quoted[qType].fileName || '',
        ptt: quoted[qType].ptt || false,
        fileName: quoted[qType].fileName || ''
      };
    }

    if (!command) return;

    // PER-SESSION MODE CHECK (private/inbox/groups/public)
    try {
      const sanitizedNumber = (number || '').replace(/[^0-9]/g, '');
      const sessionConfig = await loadUserConfigFromMongo(sanitizedNumber) || {};
      const sessionMode = (sessionConfig && sessionConfig.mode) ? sessionConfig.mode : (config.MODE || 'public');

      const permissionQuote = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_PERM" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nEND:VCARD` } }
      };

      if (!isOwner) {
        if (sessionMode === 'private') {
          await socket.sendMessage(sender, { text: '❌ Permission denied. Bot is currently in *private* mode — only the session owner or bot owner may use commands.' }, { quoted: permissionQuote });
          return;
        }
        if (isGroup && sessionMode === 'inbox') {
          await socket.sendMessage(sender, { text: '❌ Permission denied. Bot is in *inbox* mode — commands are restricted to private chats only.' }, { quoted: permissionQuote });
          return;
        }
        if (!isGroup && sessionMode === 'groups') {
          await socket.sendMessage(sender, { text: '❌ Permission denied. Bot is in *groups* mode — commands are restricted to group chats only.' }, { quoted: permissionQuote });
          return;
        }
      }
    } catch (permErr) {
      console.error('Permission check error:', permErr);
    }

    if (!command) return;

    try {
      switch (command) {

      
  // --- existing commands (deletemenumber, unfollow, newslist, admin commands etc.) ---
        // ... (keep existing other case handlers unchanged) ...
          case 'ts': {
    const axios = require('axios');

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    let query = q.replace(/^[.\/!]ts\s*/i, '').trim();

    if (!query) {
        return await socket.sendMessage(sender, {
            text: '[❗] TikTok එකේ මොකද්ද බලන්න ඕනෙ කියපං! 🔍'
        }, { quoted: msg });
    }

    // 🔹 Load bot name dynamically
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || 'CHAMA MINI BOT AI';

    // 🔹 Fake contact for quoting
    const shonux = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "META_AI_FAKE_ID_TS"
        },
        message: {
            contactMessage: {
                displayName: botName,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
            }
        }
    };

    try {
        await socket.sendMessage(sender, { text: `🔎 Searching TikTok for: ${query}...` }, { quoted: shonux });

        const searchParams = new URLSearchParams({ keywords: query, count: '10', cursor: '0', HD: '1' });
        const response = await axios.post("https://tikwm.com/api/feed/search", searchParams, {
            headers: { 'Content-Type': "application/x-www-form-urlencoded; charset=UTF-8", 'Cookie': "current_language=en", 'User-Agent': "Mozilla/5.0" }
        });

        const videos = response.data?.data?.videos;
        if (!videos || videos.length === 0) {
            return await socket.sendMessage(sender, { text: '⚠️ No videos found.' }, { quoted: shonux });
        }

        // Limit number of videos to send
        const limit = 3; 
        const results = videos.slice(0, limit);

        // 🔹 Send videos one by one
        for (let i = 0; i < results.length; i++) {
            const v = results[i];
            const videoUrl = v.play || v.download || null;
            if (!videoUrl) continue;

            await socket.sendMessage(sender, { text: `⏳ Downloading: ${v.title || 'No Title'}` }, { quoted: shonux });

            await socket.sendMessage(sender, {
                video: { url: videoUrl },
                caption: `🎵 ${botName} TikTok Downloader\n\nTitle: ${v.title || 'No Title'}\nAuthor: ${v.author?.nickname || 'Unknown'}`
            }, { quoted: shonux });
        }

    } catch (err) {
        console.error('TikTok Search Error:', err);
        await socket.sendMessage(sender, { text: `❌ Error: ${err.message}` }, { quoted: shonux });
    }

    break;
}

case 'cvideo': {
  try {
    const axios = require('axios');

    // react
    try { await socket.sendMessage(sender, { react: { text: "🎬", key: msg.key } }); } catch(e){}

    // args: <targetJid> <search keywords>
    const targetArg = args[0];
    const query = args.slice(1).join(" ").trim();

    if (!targetArg || !query) {
      return await socket.sendMessage(sender, { 
        text: "*❌ Format වැරදියි!* Use: `.cvideo <jid|number|channelId> <TikTok keyword>`" 
      }, { quoted: msg });
    }

    // normalize target jid
    let targetJid = targetArg;
    if (!targetJid.includes('@')) {
      if (/^0029/.test(targetJid)) {
        targetJid = `${targetJid}@newsletter`;
      } else {
        targetJid = `${targetJid.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
      }
    }

    // TikTok search
    await socket.sendMessage(sender, { text: `🔎 TikTok එකෙන් සෙවීම සිදු වෙමින්... (${query})` }, { quoted: msg });

    const params = new URLSearchParams({ keywords: query, count: '5', cursor: '0', HD: '1' });
    const response = await axios.post("https://tikwm.com/api/feed/search", params, {
      headers: {
        'Content-Type': "application/x-www-form-urlencoded; charset=UTF-8",
        'Cookie': "current_language=en",
        'User-Agent': "Mozilla/5.0"
      }
    });

    const videos = response.data?.data?.videos;
    if (!videos || videos.length === 0) {
      return await socket.sendMessage(sender, { text: '⚠️ TikTok video එකක් හමුනොවුණා.' }, { quoted: msg });
    }

    // get first video
    const v = videos[0];
    const videoUrl = v.play || v.download;
    if (!videoUrl) {
      return await socket.sendMessage(sender, { text: '❌ Video එක බාගත කළ නොහැක.' }, { quoted: msg });
    }

    // resolve channel name
    let channelname = targetJid;
    try {
      if (typeof socket.newsletterMetadata === 'function') {
        const meta = await socket.newsletterMetadata("jid", targetJid);
        if (meta && meta.name) channelname = meta.name;
      }
    } catch(e){}

    // format date
    const dateStr = v.create_time ? new Date(v.create_time * 1000).toLocaleDateString() : 'Unknown';

    // ✨ caption style
    const caption = `☘️ ᴛɪᴛʟᴇ : ${v.title || 'Unknown'}

🎭 ${v.play_count || 'N/A'} Views, ${v.duration || 'N/A'} sec, ${dateStr}
*00:00 ───●────────── ${v.duration || '00:00'}*
ලස්සන රියැක්ට් ඕනී ...💗😽🍃
> ${channelname}`;

    // send video (no ref / no meta / no bot name)
    await socket.sendMessage(targetJid, {
      video: { url: videoUrl },
      caption
    });

    // confirm to sender
    if (targetJid !== sender) {
      await socket.sendMessage(sender, { 
        text: `✅ TikTok video එක *${channelname}* වෙත සාර්ථකව යැවුණා! 🎬😎` 
      }, { quoted: msg });
    }

  } catch (err) {
    console.error('cvideo TT error:', err);
    await socket.sendMessage(sender, { text: `❌ දෝෂයක්: ${err.message}` }, { quoted: msg });
  }
  break;
}

case 'getdp': {
    try {
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        const cfg = await loadUserConfigFromMongo(sanitized) || {};
        const botName = cfg.botName || BOT_NAME_FANCY;
        const logo = cfg.logo || config.RCD_IMAGE_PATH;

        const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');

        let q = msg.message?.conversation?.split(" ")[1] || 
                msg.message?.extendedTextMessage?.text?.split(" ")[1];

        if (!q) return await socket.sendMessage(sender, { text: "❌ Please provide a number.\n\nUsage: .getdp <number>" });

        // 🔹 Format number into JID
        let jid = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

        // 🔹 Try to get profile picture
        let ppUrl;
        try {
            ppUrl = await socket.profilePictureUrl(jid, "image");
        } catch {
            ppUrl = "https://telegra.ph/file/4cc2712eaba1c5c1488d3.jpg"; // default dp
        }

        // 🔹 BotName meta mention
        const metaQuote = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_GETDP" },
            message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
        };

        // 🔹 Send DP with botName meta mention
        await socket.sendMessage(sender, { 
            image: { url: ppUrl }, 
            caption: `🖼 *Profile Picture of* +${q}\nFetched by: ${botName}`,
            footer: `📌 ${botName} GETDP`,
            buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 }],
            headerType: 4
        }, { quoted: metaQuote }); // <-- botName meta mention

    } catch (e) {
        console.log("❌ getdp error:", e);
        await socket.sendMessage(sender, { text: "⚠️ Error: Could not fetch profile picture." });
    }
    break;
}
  
case 'ai':
case 'chat':
case 'gpt': {
  try {
    const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
    const q = text.split(" ").slice(1).join(" ").trim();

    if (!q) {
      await socket.sendMessage(sender, { 
        text: '*🚫 Please provide a message for AI.*',
        buttons: [
          { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
        ]
      });
      return;
    }

    // Session number
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    // Load bot name from DB or default
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || 'CHAMA MINI BOT AI';

    // Meta AI mention for quote
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: `META_AI_${Date.now()}` },
      message: { 
        contactMessage: { 
          displayName: botName, 
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` 
        } 
      }
    };

    await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });
    await socket.sendMessage(sender, { text: '*⏳ AI thinking...*', quoted: metaQuote });

    const prompt = `
ඔබ සැබෑ ගැහැනු ලමයෙකු මෙන් හැසිරිය යුතුය. ඉමෝජි පමනක් තිබේනම් ඔබද ඉමෝජි පමනක් යවන්න... 
ඔයාගේ නම ${botName} , ඔයාගෙන් කවුරුහරි "ඔයාව හැදුවේ කවුද?" කියලා ඇහුවොත් විතරක් ඔයා කියන්නේ "මාව හැදුවේ CHAMINDU RANSIKA අයියලා" කියලා. User Message: ${q}
    `;

    const payload = { contents: [{ parts: [{ text: prompt }] }] };

    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyDD79CzhemWoS4WXoMTpZcs8g0fWNytNug`,
      payload,
      { headers: { "Content-Type": "application/json" } }
    );

    if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      await socket.sendMessage(sender, { 
        text: '*🚩 AI reply not found.*',
        buttons: [
          { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
        ],
        quoted: metaQuote
      });
      return;
    }

    const aiReply = data.candidates[0].content.parts[0].text;

    await socket.sendMessage(sender, {
      text: aiReply,
      footer: `🤖 ${botName}`,
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: '🤖 BOT INFO' }, type: 1 }
      ],
      headerType: 1,
      quoted: metaQuote
    });

  } catch (err) {
    console.error("Error in AI chat:", err);
    await socket.sendMessage(sender, { 
      text: '*❌ Internal AI Error. Please try again later.*',
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
      ]
    });
  }
  break;
}

case 'aiimg': 
case 'aiimg2': {
    const axios = require('axios');

    const q =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption || '';

    const prompt = q.trim();

    if (!prompt) {
        return await socket.sendMessage(sender, {
            text: '🎨 *Please provide a prompt to generate an AI image.*'
        }, { quoted: msg });
    }

    try {
        // 🔹 Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'CHAMA MINI BOT AI';

        // 🔹 Fake contact with dynamic bot name
        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_AIIMG"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        // Notify user
        await socket.sendMessage(sender, { text: '🧠 *Creating your AI image...*' });

        // Determine API URL based on command
        let apiUrl = '';
        if (command === 'aiimg') {
            apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(prompt)}`;
        } else if (command === 'aiimg2') {
            apiUrl = `https://api.siputzx.my.id/api/ai/magicstudio?prompt=${encodeURIComponent(prompt)}`;
        }

        // Call AI API
        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

        if (!response || !response.data) {
            return await socket.sendMessage(sender, {
                text: '❌ *API did not return a valid image. Please try again later.*'
            }, { quoted: shonux });
        }

        const imageBuffer = Buffer.from(response.data, 'binary');

        // Send AI Image with bot name in caption
        await socket.sendMessage(sender, {
            image: imageBuffer,
            caption: `🧠 *${botName} AI IMAGE*\n\n📌 Prompt: ${prompt}`
        }, { quoted: shonux });

    } catch (err) {
        console.error('AI Image Error:', err);

        await socket.sendMessage(sender, {
            text: `❗ *An error occurred:* ${err.response?.data?.message || err.message || 'Unknown error'}`
        }, { quoted: msg });
    }
    break;
}

case 'deleteme': {
  // 'number' is the session number passed to setupCommandHandlers (sanitized in caller)
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  // determine who sent the command
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');

  // Permission: only the session owner or the bot OWNER can delete this session
  if (senderNum !== sanitized && senderNum !== ownerNum) {
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or the bot owner can delete this session.' }, { quoted: msg });
    break;
  }

  try {
    // 1) Remove from Mongo
    await removeSessionFromMongo(sanitized);
    await removeNumberFromMongo(sanitized);

    // 2) Remove temp session dir
    const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
    try {
      if (fs.existsSync(sessionPath)) {
        fs.removeSync(sessionPath);
        console.log(`Removed session folder: ${sessionPath}`);
      }
    } catch (e) {
      console.warn('Failed removing session folder:', e);
    }

    // 3) Try to logout & close socket
    try {
      if (typeof socket.logout === 'function') {
        await socket.logout().catch(err => console.warn('logout error (ignored):', err?.message || err));
      }
    } catch (e) { console.warn('socket.logout failed:', e?.message || e); }
    try { socket.ws?.close(); } catch (e) { console.warn('ws close failed:', e?.message || e); }

    // 4) Remove from runtime maps
    activeSockets.delete(sanitized);
    socketCreationTime.delete(sanitized);

    // 5) notify user
    await socket.sendMessage(sender, {
      image: { url: config.RCD_IMAGE_PATH },
      caption: formatMessage('🗑️ SESSION DELETED', '✅ Your session has been successfully deleted from MongoDB and local storage.', BOT_NAME_FANCY)
    }, { quoted: msg });

    console.log(`Session ${sanitized} deleted by ${senderNum}`);
  } catch (err) {
    console.error('deleteme command error:', err);
    await socket.sendMessage(sender, { text: `❌ Failed to delete session: ${err.message || err}` }, { quoted: msg });
  }
  break;
}
case 'deletemenumber': {
  // args is available in the handler (body split). Expect args[0] = target number
  const targetRaw = (args && args[0]) ? args[0].trim() : '';
  if (!targetRaw) {
    await socket.sendMessage(sender, { text: '❗ Usage: .deletemenumber <number>\nExample: .deletemenumber 94783314361' }, { quoted: msg });
    break;
  }

  const target = targetRaw.replace(/[^0-9]/g, '');
  if (!/^\\d{6,}$/.test(target)) {
    await socket.sendMessage(sender, { text: '❗ Invalid number provided.' }, { quoted: msg });
    break;
  }

  // Permission check: only OWNER or configured admins can run this
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');

  let allowed = false;
  if (senderNum === ownerNum) allowed = true;
  else {
    try {
      const adminList = await loadAdminsFromMongo();
      if (Array.isArray(adminList) && adminList.some(a => a.replace(/[^0-9]/g,'') === senderNum || a === senderNum || a === `${senderNum}@s.whatsapp.net`)) {
        allowed = true;
      }
    } catch (e) {
      console.warn('Failed checking admin list', e);
    }
  }

  if (!allowed) {
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only bot owner or admins can delete other sessions.' }, { quoted: msg });
    break;
  }

  try {
    // notify start
    await socket.sendMessage(sender, { text: `🗑️ Deleting session for ${target} — attempting now...` }, { quoted: msg });

    // 1) If active, try to logout + close
    const runningSocket = activeSockets.get(target);
    if (runningSocket) {
      try {
        if (typeof runningSocket.logout === 'function') {
          await runningSocket.logout().catch(e => console.warn('logout error (ignored):', e?.message || e));
        }
      } catch (e) { console.warn('Error during logout:', e); }
      try { runningSocket.ws?.close(); } catch (e) { console.warn('ws close error:', e); }
      activeSockets.delete(target);
      socketCreationTime.delete(target);
    }

    // 2) Remove from Mongo (sessions + numbers)
    await removeSessionFromMongo(target);
    await removeNumberFromMongo(target);

    // 3) Remove temp session dir if exists
    const tmpSessionPath = path.join(os.tmpdir(), `session_${target}`);
    try {
      if (fs.existsSync(tmpSessionPath)) {
        fs.removeSync(tmpSessionPath);
        console.log(`Removed temp session folder: ${tmpSessionPath}`);
      }
    } catch (e) {
      console.warn('Failed removing tmp session folder:', e);
    }

    // 4) Confirm to caller & notify owner
    await socket.sendMessage(sender, {
      image: { url: config.RCD_IMAGE_PATH },
      caption: formatMessage('🗑️ SESSION REMOVED', `✅ Session for number *${target}* has been deleted from MongoDB and runtime.`, BOT_NAME_FANCY)
    }, { quoted: msg });

    // optional: inform owner
    try {
      const ownerJid = `${ownerNum}@s.whatsapp.net`;
      await socket.sendMessage(ownerJid, {
        text: `👑 Notice: Session removed by ${senderNum}\n→ Number: ${target}\n→ Time: ${getSriLankaTimestamp()}`
      });
    } catch (e) { /* ignore notification errors */ }

    console.log(`deletemenumber: removed ${target} (requested by ${senderNum})`);
  } catch (err) {
    console.error('deletemenumber error:', err);
    await socket.sendMessage(sender, { text: `❌ Failed to delete session for ${target}: ${err.message || err}` }, { quoted: msg });
  }

  break;
}
 
 

case 'fb':
case 'fbdl':
case 'facebook':
case 'fbd': {
    try {
        let text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        let url = text.split(" ")[1]; // e.g. .fb <link>

        if (!url) {
            return await socket.sendMessage(sender, { 
                text: '🚫 *Please send a Facebook video link.*\n\nExample: .fb <url>' 
            }, { quoted: msg });
        }

        const axios = require('axios');

        // 🔹 Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'CHAMA MINI BOT AI';

        // 🔹 Fake contact for Meta AI mention
        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_FB"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        // 🔹 Call API
        let api = `https://tharuzz-ofc-api-v2.vercel.app/api/download/fbdl?url=${encodeURIComponent(url)}`;
        let { data } = await axios.get(api);

        if (!data.success || !data.result) {
            return await socket.sendMessage(sender, { text: '❌ *Failed to fetch Facebook video.*' }, { quoted: shonux });
        }

        let title = data.result.title || 'Facebook Video';
        let thumb = data.result.thumbnail;
        let hdLink = data.result.dlLink?.hdLink || data.result.dlLink?.sdLink; // Prefer HD else SD

        if (!hdLink) {
            return await socket.sendMessage(sender, { text: '⚠️ *No video link available.*' }, { quoted: shonux });
        }

        // 🔹 Send thumbnail + title first
        await socket.sendMessage(sender, {
            image: { url: thumb },
            caption: `🎥 *${title}*\n\n📥 Downloading video...\n_© Powered by ${botName}_`
        }, { quoted: shonux });

        // 🔹 Send video automatically
        await socket.sendMessage(sender, {
            video: { url: hdLink },
            caption: `🎥 *${title}*\n\n✅ Downloaded by ${botName}`
        }, { quoted: shonux });

    } catch (e) {
        console.log(e);
        await socket.sendMessage(sender, { text: '⚠️ *Error downloading Facebook video.*' });
    }
}
break;


 

case 'cfn': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const cfg = await loadUserConfigFromMongo(sanitized) || {};
  const botName = cfg.botName || BOT_NAME_FANCY;
  const logo = cfg.logo || config.RCD_IMAGE_PATH;

  const full = body.slice(config.PREFIX.length + command.length).trim();
  if (!full) {
    await socket.sendMessage(sender, { text: `❗ Provide input: .cfn <jid@newsletter> | emoji1,emoji2\nExample: .cfn 120363402094635383@newsletter | 🔥,❤️` }, { quoted: msg });
    break;
  }

  const admins = await loadAdminsFromMongo();
  const normalizedAdmins = (admins || []).map(a => (a || '').toString());
  const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');
  const isAdmin = normalizedAdmins.includes(nowsender) || normalizedAdmins.includes(senderNumber) || normalizedAdmins.includes(senderIdSimple);
  if (!(isOwner || isAdmin)) {
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only owner or configured admins can add follow channels.' }, { quoted: msg });
    break;
  }

  let jidPart = full;
  let emojisPart = '';
  if (full.includes('|')) {
    const split = full.split('|');
    jidPart = split[0].trim();
    emojisPart = split.slice(1).join('|').trim();
  } else {
    const parts = full.split(/\s+/);
    if (parts.length > 1 && parts[0].includes('@newsletter')) {
      jidPart = parts.shift().trim();
      emojisPart = parts.join(' ').trim();
    } else {
      jidPart = full.trim();
      emojisPart = '';
    }
  }

  const jid = jidPart;
  if (!jid || !jid.endsWith('@newsletter')) {
    await socket.sendMessage(sender, { text: '❗ Invalid JID. Example: 120363402094635383@newsletter' }, { quoted: msg });
    break;
  }

  let emojis = [];
  if (emojisPart) {
    emojis = emojisPart.includes(',') ? emojisPart.split(',').map(e => e.trim()) : emojisPart.split(/\s+/).map(e => e.trim());
    if (emojis.length > 20) emojis = emojis.slice(0, 20);
  }

  try {
    if (typeof socket.newsletterFollow === 'function') {
      await socket.newsletterFollow(jid);
    }

    await addNewsletterToMongo(jid, emojis);

    const emojiText = emojis.length ? emojis.join(' ') : '(default set)';

    // Meta mention for botName
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CFN" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: `✅ Channel followed and saved!\n\nJID: ${jid}\nEmojis: ${emojiText}\nSaved by: @${senderIdSimple}`,
      footer: `📌 ${botName} FOLLOW CHANNEL`,
      mentions: [nowsender], // user mention
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 }],
      headerType: 4
    }, { quoted: metaQuote }); // <-- botName meta mention

  } catch (e) {
    console.error('cfn error', e);
    await socket.sendMessage(sender, { text: `❌ Failed to save/follow channel: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'apkdownload':
case 'apk': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const id = text.split(" ")[1]; // .apkdownload <id>

        // ✅ Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'CHAMA MINI BOT AI';

        // ✅ Fake Meta contact message
        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_APKDL"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        if (!id) {
            return await socket.sendMessage(sender, {
                text: '🚫 *Please provide an APK package ID.*\n\nExample: .apkdownload com.whatsapp',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            }, { quoted: shonux });
        }

        // ⏳ Notify start
        await socket.sendMessage(sender, { text: '*⏳ Fetching APK info...*' }, { quoted: shonux });

        // 🔹 Call API
        const apiUrl = `https://tharuzz-ofc-apis.vercel.app/api/download/apkdownload?id=${encodeURIComponent(id)}`;
        const { data } = await axios.get(apiUrl);

        if (!data.success || !data.result) {
            return await socket.sendMessage(sender, { text: '*❌ Failed to fetch APK info.*' }, { quoted: shonux });
        }

        const result = data.result;
        const caption = `📱 *${result.name}*\n\n` +
                        `🆔 Package: \`${result.package}\`\n` +
                        `📦 Size: ${result.size}\n` +
                        `🕒 Last Update: ${result.lastUpdate}\n\n` +
                        `✅ Downloaded by ${botName}`;

        // 🔹 Send APK as document
        await socket.sendMessage(sender, {
            document: { url: result.dl_link },
            fileName: `${result.name}.apk`,
            mimetype: 'application/vnd.android.package-archive',
            caption: caption,
            jpegThumbnail: result.image ? await axios.get(result.image, { responseType: 'arraybuffer' }).then(res => Buffer.from(res.data)) : undefined
        }, { quoted: shonux });

    } catch (err) {
        console.error("Error in APK download:", err);

        // Catch block Meta mention
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'CHAMA MINI BOT AI';

        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_APKDL"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
    }
    break;
}

// Modified nn4 / sinhalasub and chr handlers — bot name + meta mention added

 
case 'nn4':
case 'nnnn4':
case 'sinhalasub': {
    const from = msg.key.remoteJid;
    let text = '';
    if (msg.message?.conversation) text = msg.message.conversation;
    else if (msg.message?.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
    else if (msg.message?.imageMessage?.caption) text = msg.message.imageMessage.caption;
    else if (msg.message?.videoMessage?.caption) text = msg.message.videoMessage.caption;

    // Robustly extract query
    const fullText = text.trim();
    text = fullText.replace(new RegExp(`^(\\.?)(nn|nnnn|sinhalasub)\\s*`, 'i'), '').trim();

    console.log(`[SINHALASUB] Command started: fullText="${fullText}", extracted query="${text}", from=${from}`);

    if (!socket || !socket.sendMessage) return console.error('[SINHALASUB] Socket invalid');
    if (!msg || !msg.key) return console.error('[SINHALASUB] Msg invalid');

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await (typeof loadUserConfigFromMongo === 'function' ? loadUserConfigFromMongo(sanitized) : {}) || {};
    const botName = cfg.botName || 'CHAMA MINI BOT AI';
    const metaQuote = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "META_AI_SINHALASUB"
        },
        message: {
            contactMessage: {
                displayName: botName,
                vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`
            }
        }
    };

    function cineFormat(title, body, footer = config.FOOTER || '*•𝙲𝙷𝙰𝙼𝙰 ᴍɪɴɪ•*') {
        return `_*${title}*_\n\n${body}\n\n> ${footer}`;
    }

    try {
        // Premium check
        let pr;
        try {
            pr = (await axios.get('https://mv-visper-full-db.pages.dev/Main/main_var.json')).data;
        } catch {
            pr = { mvfree: "false", chlink: '' };
        }

        const isFree = pr.mvfree === "true";
        const sender = msg.key.participant || msg.key.remoteJid;
        const isMe = false, isPre = false, isSudo = false, isOwner = false;

        if (!isFree && !isMe && !isPre) {
            await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
            return await socket.sendMessage(from, {
                text: `*\`You are not a premium user⚠️\`*\n\n*Send a message to one of the 2 numbers below and buy Lifetime premium 🎉.*\n\n_Price : 200 LKR ✔️_\n\n*👨‍💻Contact us : 94703229057 , 94703229057*`
            }, { quoted: metaQuote });
        }

        if (config.MV_BLOCK == "true" && !isMe && !isSudo && !isOwner) {
            await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
            return await socket.sendMessage(from, { text: "*This command currently only works for the Bot owner.*" }, { quoted: metaQuote });
        }

        await socket.sendMessage(from, { react: { text: `🕐`, key: msg.key } });

        if (!text || text.length < 1) {
            await socket.sendMessage(from, {
                text: cineFormat(
                    '🎬 SINHALASUB MOVIE SEARCH',
                    '❌ Please provide a movie name!\n\n*Examples:*\n.nn Ne Zha\n.nnnn Ratatouille\n.sinhalasub Inception'
                )
            }, { quoted: metaQuote });
            return;
        }

        const normalizedQuery = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        if (normalizedQuery.length < 2) {
            await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', '❌ Query too short. Use at least 2 characters.') });
            return;
        }

        const searchQuery = encodeURIComponent(text);
        let searchData;
        try {
            const response = await axios.get(`https://visper-md-ap-is.vercel.app/movie/sinhalasub/search?q=${searchQuery}`, { timeout: 10000 });
            searchData = response.data;
        } catch (error) {
            await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Failed to search: ${error.message}`) });
            return;
        }

        let resultsArray = [];
        if (searchData && searchData.success && Array.isArray(searchData.result)) resultsArray = searchData.result;
        else if (Array.isArray(searchData)) resultsArray = searchData;

        if (resultsArray.length === 0) {
            await socket.sendMessage(from, { text: cineFormat('🎬 NO RESULTS', `❗ No movies found for "${text}"`) });
            return;
        }

        const queryWords = normalizedQuery.split(' ').filter(w => w.length > 1);
        let availableMovies = resultsArray
            .filter(m => m && (m.Type || m.type || '').toLowerCase() === 'movie')
            .map(m => ({
                Title: m.Title || m.title || 'Unknown',
                Link: m.Link || m.link || '#',
                Img: m.Img || m.img || '',
                Rating: m.Rating || m.rating || ''
            }))
            .filter(m => m.Link !== '#' && m.Title !== 'Unknown')
            .slice(0, 5);

        if (availableMovies.length === 0) {
            await socket.sendMessage(from, { text: cineFormat('🎬 NO VALID MOVIES', `❗ No valid movies found for "${text}".`) });
            return;
        }

        // ✅ UPDATED CREATOR + CHANNEL LINK
        let movieList = `_*SINHALASUB MOVIE SEARCH RESULTS 🎬 — ${botName}*_\n\n*\`Input :\`* ${text}\n\n`;
        availableMovies.forEach((movie, index) => {
            let year = 'N/A';
            const yearMatch = movie.Title.match(/\(\d{4}\)/);
            if (yearMatch) year = yearMatch[0];
            else if (movie.Rating && movie.Rating.includes('IMDb')) year = movie.Rating.split('IMDb ')[1]?.slice(-4) || 'N/A';

            movieList += `*${index + 1}. ${movie.Title}*\n📅 Year: ${year}\n⭐ Rating: ${movie.Rating || 'N/A'}\n👤 *Creator:* ${botName} \n📢 *Channel:* https://whatsapp.com/channel/0029Vb6UR8S8fewn0otjcc0g\n\n`;
        });
        movieList += `Reply with number (1-${availableMovies.length}) for details/download.\n\n> Fuzzy search enabled!\n> ${botName}`;

        await socket.sendMessage(from, { text: cineFormat('🎬 LOADING', '*Fetching best matches...*') });

        const fixedImageUrl = 'https://files.catbox.moe/31eoa8.png';
        let sentMessage;
        try {
            sentMessage = await socket.sendMessage(from, {
                image: { url: fixedImageUrl },
                caption: movieList
            }, { quoted: metaQuote });
        } catch {
            sentMessage = await socket.sendMessage(from, { text: movieList }, { quoted: metaQuote });
        }

        // Movie selection listener
        const movieSelectionHandler = async (chatUpdate) => {
            try {
                const mek = chatUpdate.messages[0];
                if (
                    !mek.message ||
                    !mek.message.extendedTextMessage ||
                    !mek.message.extendedTextMessage.contextInfo ||
                    mek.message.extendedTextMessage.contextInfo.stanzaId !== sentMessage.key.id
                ) return;

                const comm = mek.message.extendedTextMessage.text.trim();
                const movieIndex = parseInt(comm) - 1;
                if (isNaN(movieIndex) || movieIndex < 0 || movieIndex >= availableMovies.length) {
                    await socket.sendMessage(from, {
                        text: cineFormat('🎬 ERROR', `❗ Invalid selection. Reply with a number (1-${availableMovies.length}).`)
                    });
                    return;
                }

                const selectedMovie = availableMovies[movieIndex];
                const detailsUrl = `https://visper-md-ap-is.vercel.app/movie/sinhalasub/info?q=${encodeURIComponent(selectedMovie.Link)}`;
                const response = await axios.get(detailsUrl, { timeout: 8000 });
                const detailsData = response.data;

                if (!detailsData || !detailsData.success || !detailsData.result) {
                    await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', '❗ Invalid details from API.') });
                    socket.ev.off('messages.upsert', movieSelectionHandler);
                    return;
                }

                const result = detailsData.result;
                let descriptionShort = result.description ? result.description.split(' ').slice(0, 50).join(' ') + '...' : 'No description available.';

                let qualityCaption = `*☘️ 𝗧𝗶𝘁𝗹𝗲 ➮* _${result.title || 'N/A'}_\n\n` +
                    `*📅 𝗥𝗲𝗹𝗲𝗮𝘀𝗲𝗱 ➮* _${result.date || 'N/A'}_\n` +
                    `*🌎 𝗖𝗼𝘂𝗻𝘁𝗿𝘆 ➮* _${result.country || 'N/A'}_\n` +
                    `*💃 𝗥𝗮𝘁𝗶𝗻𝗴 ➮* _${result.rating || 'N/A'}_\n` +
                    `*⏰ 𝗥𝘂𝗻𝘁𝗶𝗺𝗲 ➮* _${result.duration || 'N/A'}_\n` +
                    `*💁‍♂️ 𝗦𝘂𝗯𝘁𝗶𝘁𝗹𝗲 𝗯𝘆 ➮* _${result.author || 'N/A'}_\n` +
                    `📝 *Description:* ${descriptionShort}\n` +
                    `> 🌟 Follow us : https://whatsapp.com/channel/0029Vb6UR8S8fewn0otjcc0g\n\n> ${botName}`;

                const qualityOptions = result.downloadLinks.map((link, index) => `*${index + 1}.* ${link.quality} (${link.size || 'N/A'})`).join('\n');
                qualityCaption += `\n\n📥 *Choose quality:*\n${qualityOptions}\n\n_Reply with the number!_`;

                const qualityImageUrl = result.images?.[0] || 'https://i.imgur.com/3k5K7zC.jpg';
                const qualityMsg = await socket.sendMessage(from, { image: { url: qualityImageUrl }, caption: qualityCaption }, { quoted: metaQuote });

                socket.ev.off('messages.upsert', movieSelectionHandler);

                const qualityMap = result.downloadLinks.reduce((map, link, i) => { map[i + 1] = link.link; return map; }, {});
                const qualitySelectionHandler = async (qualityUpdate) => {
                    try {
                        const qmek = qualityUpdate.messages[0];
                        if (
                            !qmek.message ||
                            !qmek.message.extendedTextMessage ||
                            !qmek.message.extendedTextMessage.contextInfo ||
                            qmek.message.extendedTextMessage.contextInfo.stanzaId !== qualityMsg.key.id
                        ) return;

                        const qIndex = parseInt(qmek.message.extendedTextMessage.text.trim());
                        if (isNaN(qIndex) || !qualityMap[qIndex]) {
                            await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', '❗ Invalid option!') });
                            return;
                        }

                        const pixApi = `https://www.dark-yasiya-api.site/download/pixeldrain?url=${encodeURIComponent(qualityMap[qIndex])}`;
                        const pixData = (await axios.get(pixApi, { timeout: 8000 })).data;
                        const dlLink = pixData.result?.dl_link;
                        const fileName = pixData.result?.fileName || 'movie.mp4';

                        await socket.sendMessage(from, {
                            document: { url: dlLink },
                            mimetype: 'video/mp4',
                            fileName: fileName,
                            caption: `Downloaded by ${botName}`
                        }, { quoted: metaQuote });

                        socket.ev.off('messages.upsert', qualitySelectionHandler);
                    } catch (err) {
                        await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Download failed: ${err.message}`) });
                        socket.ev.off('messages.upsert', qualitySelectionHandler);
                    }
                };

                socket.ev.on('messages.upsert', qualitySelectionHandler);
                setTimeout(() => socket.ev.off('messages.upsert', qualitySelectionHandler), 300000);
            } catch (err) {
                await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ ${err.message}`) });
                socket.ev.off('messages.upsert', movieSelectionHandler);
            }
        };

        socket.ev.on('messages.upsert', movieSelectionHandler);
        setTimeout(() => socket.ev.off('messages.upsert', movieSelectionHandler), 300000);

    } catch (error) {
        await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Unexpected error: ${error.message}`) }, { quoted: metaQuote });
    }
    break;
}

case 'chr': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const cfg = await loadUserConfigFromMongo(sanitized) || {};
  const botName = cfg.botName || BOT_NAME_FANCY;
  const logo = cfg.logo || config.RCD_IMAGE_PATH;

  const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');

  const q = body.split(' ').slice(1).join(' ').trim();
  if (!q.includes(',')) return await socket.sendMessage(sender, { text: "❌ Usage: chr <channelJid/messageId>,<emoji>" }, { quoted: msg });

  const parts = q.split(',');
  let channelRef = parts[0].trim();
  const reactEmoji = parts[1].trim();

  let channelJid = channelRef;
  let messageId = null;
  const maybeParts = channelRef.split('/');
  if (maybeParts.length >= 2) {
    messageId = maybeParts[maybeParts.length - 1];
    channelJid = maybeParts[maybeParts.length - 2].includes('@newsletter') ? maybeParts[maybeParts.length - 2] : channelJid;
  }

  if (!channelJid.endsWith('@newsletter')) {
    if (/^\d+$/.test(channelJid)) channelJid = `${channelJid}@newsletter`;
  }

  if (!channelJid.endsWith('@newsletter') || !messageId) {
    return await socket.sendMessage(sender, { text: '❌ Provide channelJid/messageId format.' }, { quoted: msg });
  }

  try {
    await socket.newsletterReactMessage(channelJid, messageId.toString(), reactEmoji);
    await saveNewsletterReaction(channelJid, messageId.toString(), reactEmoji, sanitized);

    // BotName meta mention
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CHR" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: `✅ Reacted successfully!\n\nChannel: ${channelJid}\nMessage: ${messageId}\nEmoji: ${reactEmoji}\nBy: @${senderIdSimple}\n\n— ${botName}`,
      footer: `📌 ${botName} REACTION`,
      mentions: [nowsender], // user mention
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 }],
      headerType: 4
    }, { quoted: metaQuote }); // <-- botName meta mention

  } catch (e) {
    console.error('chr command error', e);
    await socket.sendMessage(sender, { text: `❌ Failed to react: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'xv':
case 'xvsearch':
case 'xvdl': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const query = text.split(" ").slice(1).join(" ").trim();

        // ✅ Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'CHAMA MINI BOT AI';

        // ✅ Fake Meta contact message
        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_XV"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        if (!query) {
            return await socket.sendMessage(sender, {
                text: '🚫 *Please provide a search query.*\n\nExample: .xv mia',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            }, { quoted: shonux });
        }

        await socket.sendMessage(sender, { text: '*⏳ Searching XVideos...*' }, { quoted: shonux });

        // 🔹 Search API
        const searchUrl = `https://tharuzz-ofc-api-v2.vercel.app/api/search/xvsearch?query=${encodeURIComponent(query)}`;
        const { data } = await axios.get(searchUrl);

        if (!data.success || !data.result?.xvideos?.length) {
            return await socket.sendMessage(sender, { text: '*❌ No results found.*' }, { quoted: shonux });
        }

        // 🔹 Show top 10 results
        const results = data.result.xvideos.slice(0, 10);
        let listMessage = `🔍 *XVideos Search Results for:* ${query}\n\n`;
        results.forEach((item, idx) => {
            listMessage += `*${idx + 1}.* ${item.title}\n${item.info}\n➡️ ${item.link}\n\n`;
        });
        listMessage += `_© Powered by ${botName}_`;

        await socket.sendMessage(sender, {
            text: listMessage,
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ],
            contextInfo: { mentionedJid: [sender] }
        }, { quoted: shonux });

        // 🔹 Store search results for reply handling
        global.xvReplyCache = global.xvReplyCache || {};
        global.xvReplyCache[sender] = results.map(r => r.link);

    } catch (err) {
        console.error("Error in XVideos search/download:", err);
        await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
    }
}
break;

// ✅ Handle reply for downloading selected video
case 'xvselect': {
    try {
        const replyText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const selection = parseInt(replyText);

        const links = global.xvReplyCache?.[sender];
        if (!links || isNaN(selection) || selection < 1 || selection > links.length) {
            return await socket.sendMessage(sender, { text: '🚫 Invalid selection number.' }, { quoted: msg });
        }

        const videoUrl = links[selection - 1];
        await socket.sendMessage(sender, { text: '*⏳ Downloading video...*' }, { quoted: msg });

        // 🔹 Call XVideos download API
        const dlUrl = `https://tharuzz-ofc-api-v2.vercel.app/api/download/xvdl?url=${encodeURIComponent(videoUrl)}`;
        const { data } = await axios.get(dlUrl);

        if (!data.success || !data.result) {
            return await socket.sendMessage(sender, { text: '*❌ Failed to fetch video.*' }, { quoted: msg });
        }

        const result = data.result;
        await socket.sendMessage(sender, {
            video: { url: result.dl_Links.highquality || result.dl_Links.lowquality },
            caption: `🎥 *${result.title}*\n\n⏱ Duration: ${result.duration}s\n\n_© Powered by ${botName}_`,
            jpegThumbnail: result.thumbnail ? await axios.get(result.thumbnail, { responseType: 'arraybuffer' }).then(res => Buffer.from(res.data)) : undefined
        }, { quoted: msg });

        // 🔹 Clean cache
        delete global.xvReplyCache[sender];

    } catch (err) {
        console.error("Error in XVideos selection/download:", err);
        await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: msg });
    }
}
break;
case 'csend':
case 'csong': {
  try {
    // react to the command
    try { await socket.sendMessage(sender, { react: { text: "🎧", key: msg.key } }); } catch(e){}

    // args: <targetJid> <song name or url>
    const targetArg = args[0];
    const query = args.slice(1).join(" ").trim();

    if (!targetArg || !query) {
      return await socket.sendMessage(sender, { text: "*❌ Format වැරදියි!* Use: `.csong <jid|number|channelId> <song name or YouTube url>`" }, { quoted: msg });
    }

    // normalize targetJid
    let targetJid = targetArg;
    if (!targetJid.includes('@')) {
      // if looks like channel id (starts with 0029...) assume full channel short id -> try newsletter jid
      if (/^\d{12,}$/.test(targetJid) || /^0029/.test(targetJid)) {
        // try newsletter form
        if (!targetJid.endsWith('@newsletter')) targetJid = `${targetJid}@newsletter`;
      } else {
        // assume regular user jid
        targetJid = `${targetJid.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
      }
    }

    // search on YouTube
    const yts = require('yt-search');
    const search = await yts(query);
    if (!search || !search.videos || search.videos.length === 0) {
      return await socket.sendMessage(sender, { text: "*ගීතය හමුනොවුණා... ❌*"}, { quoted: msg });
    }

    const video = search.videos[0];
    const ytUrl = video.url;
    const ago = video.ago || 'Unknown';

    // download mp3 via API
    const axios = require('axios');
    const apiUrl = `https://sadiya-tech-apis.vercel.app/download/ytdl?url=${encodeURIComponent(ytUrl)}&format=mp3&apikey=sadiya`;

    const { data: apiRes } = await axios.get(apiUrl).catch(err => ({ data: null }));
    if (!apiRes || !apiRes.status || !apiRes.result || !apiRes.result.download) {
      return await socket.sendMessage(sender, { text: "❌ ගීතය බාගත කළ නොහැක. වෙනත් එකක් උත්සහ කරන්න!" }, { quoted: msg });
    }

    const downloadUrl = apiRes.result.download;

    // prepare temp files
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const crypto = require('crypto');
    const tmpId = crypto.randomBytes(8).toString('hex');
    const tempMp3 = path.join(os.tmpdir(), `cm_${tmpId}.mp3`);
    const tempOpus = path.join(os.tmpdir(), `cm_${tmpId}.opus`);

    // fetch mp3
    const resp = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 60000 }).catch(() => null);
    if (!resp || !resp.data) {
      return await socket.sendMessage(sender, { text: "❌ ගීතය බාගත කළ නොහැක (API/Network issue)." }, { quoted: msg });
    }
    fs.writeFileSync(tempMp3, Buffer.from(resp.data));

    // convert to opus (ogg) using ffmpeg
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

    await new Promise((resolve, reject) => {
      ffmpeg(tempMp3)
        .noVideo()
        .audioCodec('libopus')
        .format('opus')
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .save(tempOpus);
    });

    if (!fs.existsSync(tempOpus)) {
      throw new Error('Opus conversion failed');
    }

    // try to resolve channel name if newsletter metadata available
    let channelname = targetJid;
    try {
      if (typeof socket.newsletterMetadata === 'function') {
        const meta = await socket.newsletterMetadata("jid", targetJid);
        if (meta && meta.name) channelname = meta.name;
      }
    } catch (e) { /* ignore */ }

    // build caption in Sinhala (as in original)
    const caption = `☘️ ᴛɪᴛʟᴇ : ${video.title}

❒ *🎭 Vɪᴇᴡꜱ :* ${video.views || 'N/A'}
❒ *⏱️ Dᴜʀᴀᴛɪᴏɴ :* ${video.timestamp || 'N/A'}
❒ *📅 Rᴇʟᴇᴀꜱᴇ Dᴀᴛᴇ :* ${ago}

*00:00 ───●────────── ${video.timestamp || '00:00'}*

* *ලස්සන රියැක්ට් ඕනී ...💗😽🍃*

> *${channelname}*`;

    // send thumbnail+caption
    try {
      if (apiRes.result.thumbnail) {
        await socket.sendMessage(targetJid, { image: { url: apiRes.result.thumbnail }, caption }, { quoted: msg });
      } else {
        await socket.sendMessage(targetJid, { text: caption }, { quoted: msg });
      }
    } catch (e) {
      // If sending to target failed, still try to send audio
      console.warn('Failed to send thumbnail/caption to target:', e?.message || e);
    }

    // send opus as voice (ptt)
    const opusBuffer = fs.readFileSync(tempOpus);
    await socket.sendMessage(targetJid, { audio: opusBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });

    // notify the command issuer
    await socket.sendMessage(sender, { text: `✅ *"${video.title}"* Successfully sent to *${channelname}* (${targetJid}) 😎🎶` }, { quoted: msg });

    // cleanup
    try { if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3); } catch(e){}
    try { if (fs.existsSync(tempOpus)) fs.unlinkSync(tempOpus); } catch(e){}

  } catch (e) {
    console.error('csong error:', e);
    try { await socket.sendMessage(sender, { text: "*ඇතැම් දෝෂයකි! පසුව නැවත උත්සහ කරන්න.*" }, { quoted: msg }); } catch(e){}
  }
  break;
}

case 'දාපන්':
case 'ඔන':
case 'save': {
  try {
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    if (!quotedMsg) {
      return await socket.sendMessage(sender, { text: '*❌ Please reply to a message (status/media) to save it.*' }, { quoted: msg });
    }

    try { await socket.sendMessage(sender, { react: { text: '💾', key: msg.key } }); } catch(e){}

    // 🟢 Instead of bot’s own chat, use same chat (sender)
    const saveChat = sender;

    if (quotedMsg.imageMessage || quotedMsg.videoMessage || quotedMsg.audioMessage || quotedMsg.documentMessage || quotedMsg.stickerMessage) {
      const media = await downloadQuotedMedia(quotedMsg);
      if (!media || !media.buffer) {
        return await socket.sendMessage(sender, { text: '❌ Failed to download media.' }, { quoted: msg });
      }

      if (quotedMsg.imageMessage) {
        await socket.sendMessage(saveChat, { image: media.buffer, caption: media.caption || '✅ Status Saved' });
      } else if (quotedMsg.videoMessage) {
        await socket.sendMessage(saveChat, { video: media.buffer, caption: media.caption || '✅ Status Saved', mimetype: media.mime || 'video/mp4' });
      } else if (quotedMsg.audioMessage) {
        await socket.sendMessage(saveChat, { audio: media.buffer, mimetype: media.mime || 'audio/mp4', ptt: media.ptt || false });
      } else if (quotedMsg.documentMessage) {
        const fname = media.fileName || `saved_document.${(await FileType.fromBuffer(media.buffer))?.ext || 'bin'}`;
        await socket.sendMessage(saveChat, { document: media.buffer, fileName: fname, mimetype: media.mime || 'application/octet-stream' });
      } else if (quotedMsg.stickerMessage) {
        await socket.sendMessage(saveChat, { image: media.buffer, caption: media.caption || '✅ Sticker Saved' });
      }

      await socket.sendMessage(sender, { text: '🔥 *Status saved successfully!*' }, { quoted: msg });

    } else if (quotedMsg.conversation || quotedMsg.extendedTextMessage) {
      const text = quotedMsg.conversation || quotedMsg.extendedTextMessage.text;
      await socket.sendMessage(saveChat, { text: `✅ *Status Saved*\n\n${text}` });
      await socket.sendMessage(sender, { text: '🔥 *Text status saved successfully!*' }, { quoted: msg });
    } else {
      if (typeof socket.copyNForward === 'function') {
        try {
          const key = msg.message?.extendedTextMessage?.contextInfo?.stanzaId || msg.key;
          await socket.copyNForward(saveChat, msg.key, true);
          await socket.sendMessage(sender, { text: '🔥 *Saved (forwarded) successfully!*' }, { quoted: msg });
        } catch (e) {
          await socket.sendMessage(sender, { text: '❌ Could not forward the quoted message.' }, { quoted: msg });
        }
      } else {
        await socket.sendMessage(sender, { text: '❌ Unsupported quoted message type.' }, { quoted: msg });
      }
    }

  } catch (error) {
    console.error('❌ Save error:', error);
    await socket.sendMessage(sender, { text: '*❌ Failed to save status*' }, { quoted: msg });
  }
  break;
}
case 'alive': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;
    const logo = cfg.logo || config.RCD_IMAGE_PATH;

    // Meta AI mention
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_ALIVE" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    const text = `
🤖 *${botName}* is online!
👑 *Owner*: ${config.OWNER_NAME || 'CHAMINDU'}
⏳ *Uptime*: ${hours}h ${minutes}m ${seconds}s
☁️ *Platform*: ${process.env.PLATFORM || 'Heroku'}
🔗 *Prefix*: ${config.PREFIX}
`;

    const buttons = [
      { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 },
      { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: "⚡ PING" }, type: 1 }
    ];

    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: text,
      footer: `🔥 ${botName} ALIVE 🔥`,
      buttons,
      headerType: 4
    }, { quoted: metaQuote });

  } catch(e) {
    console.error('alive error', e);
    await socket.sendMessage(sender, { text: '❌ Failed to send alive status.' }, { quoted: msg });
  }
  break;
}

// ---------------------- PING ----------------------
case 'ping': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;
    const logo = cfg.logo || config.RCD_IMAGE_PATH;

    const latency = Date.now() - (msg.messageTimestamp * 1000 || Date.now());

    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_PING" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    const text = `
⚡ *${botName} PING*
🏓 Latency: ${latency}ms
⏱ Server time: ${new Date().toLocaleString()}
`;

    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: text,
      footer: `🔥 ${botName} PING 🔥`,
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 }],
      headerType: 4
    }, { quoted: metaQuote });

  } catch(e) {
    console.error('ping error', e);
    await socket.sendMessage(sender, { text: '❌ Failed to get ping.' }, { quoted: msg });
  }
  break;
}
case 'activesessions':
case 'active':
case 'bots': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;
    const logo = cfg.logo || config.RCD_IMAGE_PATH;

    // Permission check - only owner and admins can use this
    const admins = await loadAdminsFromMongo();
    const normalizedAdmins = (admins || []).map(a => (a || '').toString());
    const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');
    const isAdmin = normalizedAdmins.includes(nowsender) || normalizedAdmins.includes(senderNumber) || normalizedAdmins.includes(senderIdSimple);
    
    if (!isOwner && !isAdmin) {
      await socket.sendMessage(sender, { 
        text: '❌ Permission denied. Only bot owner or admins can check active sessions.' 
      }, { quoted: msg });
      break;
    }

    const activeCount = activeSockets.size;
    const activeNumbers = Array.from(activeSockets.keys());
    
    // Meta AI mention
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_ACTIVESESSIONS" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let text = `🤖 *ACTIVE SESSIONS - ${botName}*\n\n`;
    text += `📊 *Total Active Sessions:* ${activeCount}\n\n`;
    
    if (activeCount > 0) {
      text += `📱 *Active Numbers:*\n`;
      activeNumbers.forEach((num, index) => {
        text += `${index + 1}. ${num}\n`;
      });
    } else {
      text += `⚠️ No active sessions found.`;
    }

    text += `\n🕒 Checked at: ${getSriLankaTimestamp()}`;

    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: text,
      footer: `📊 ${botName} SESSION STATUS`,
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 },
        { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: "⚡ PING" }, type: 1 }
      ],
      headerType: 4
    }, { quoted: metaQuote });

  } catch(e) {
    console.error('activesessions error', e);
    await socket.sendMessage(sender, { 
      text: '❌ Failed to fetch active sessions information.' 
    }, { quoted: msg });
  }
  break;
}


case 'song': {
    const yts = require('yt-search');
    const axios = require('axios');

    // Extract YT video id & normalize link (reuse from original)
    function extractYouTubeId(url) {
        const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }
    function convertYouTubeLink(input) {
        const videoId = extractYouTubeId(input);
        if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
        return input;
    }

    // get message text
    const q = msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption || '';

    if (!q || q.trim() === '') {
        await socket.sendMessage(sender, { text: '*`Need YT_URL or Title`*' });
        break;
    }

    // load bot name
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || 'CHAMA MINI BOT AI';

    // fake contact for quoted card
    const botMention = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "META_AI_FAKE_ID_SONG"
        },
        message: {
            contactMessage: {
                displayName: botName,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
            }
        }
    };

    try {
        // Determine video URL: if q contains YT id/url, use it; otherwise search by title
        let videoUrl = null;
        const maybeLink = convertYouTubeLink(q.trim());
        if (extractYouTubeId(q.trim())) {
            videoUrl = maybeLink;
        } else {
            // search by title
            const search = await yts(q.trim());
            const first = (search?.videos || [])[0];
            if (!first) {
                await socket.sendMessage(sender, { text: '*`No results found for that title`*' }, { quoted: botMention });
                break;
            }
            videoUrl = first.url;
        }

        // call your mp3 API (the one you provided)
        const apiUrl = `https://chama-api-web-47s1.vercel.app/mp3?id=${encodeURIComponent(videoUrl)}`;
        const apiRes = await axios.get(apiUrl, { timeout: 15000 }).then(r => r.data).catch(e => null);

        if (!apiRes || (!apiRes.downloadUrl && !apiRes.result?.download?.url && !apiRes.result?.url)) {
            await socket.sendMessage(sender, { text: '*`MP3 API returned no download link`*' }, { quoted: botMention });
            break;
        }

        // Normalize download URL and metadata
        const downloadUrl = apiRes.downloadUrl || apiRes.result?.download?.url || apiRes.result?.url;
        const title = apiRes.title || apiRes.result?.title || 'Unknown title';
        const thumb = apiRes.thumbnail || apiRes.result?.thumbnail || null;
        const duration = apiRes.duration || apiRes.result?.duration || null;
        const quality = apiRes.quality || apiRes.result?.quality || '128';

        const caption = `🎵 *Title:* ${title}
⏱️ *Duration:* ${duration || 'N/A'}
🔊 *Quality:* ${quality}
🔗 *Source:* ${videoUrl}

*Reply to this message (quote it) with a number to choose format:*
1️⃣. 📄 MP3 as Document
2️⃣. 🎧 MP3 as Audio
3️⃣. 🎙 MP3 as Voice Note (PTT)

_© Powered by ${botName}_`;

        // send thumbnail card if available
        const sendOpts = { quoted: botMention };
        const media = thumb ? { image: { url: thumb }, caption } : { text: caption };
        const resMsg = await socket.sendMessage(sender, media, sendOpts);

        // handler waits for quoted reply from same sender
        const handler = async (msgUpdate) => {
            try {
                const received = msgUpdate.messages && msgUpdate.messages[0];
                if (!received) return;

                const fromId = received.key.remoteJid || received.key.participant || (received.key.fromMe && sender);
                if (fromId !== sender) return;

                const text = received.message?.conversation || received.message?.extendedTextMessage?.text;
                if (!text) return;

                // ensure they quoted our card
                const quotedId = received.message?.extendedTextMessage?.contextInfo?.stanzaId ||
                    received.message?.extendedTextMessage?.contextInfo?.quotedMessage?.key?.id;
                if (!quotedId || quotedId !== resMsg.key.id) return;

                const choice = text.toString().trim().split(/\s+/)[0];

                await socket.sendMessage(sender, { react: { text: "📥", key: received.key } });

                switch (choice) {
                    case "1":
                        await socket.sendMessage(sender, {
                            document: { url: downloadUrl },
                            mimetype: "audio/mpeg",
                            fileName: `${title}.mp3`
                        }, { quoted: received });
                        break;
                    case "2":
                        await socket.sendMessage(sender, {
                            audio: { url: downloadUrl },
                            mimetype: "audio/mpeg"
                        }, { quoted: received });
                        break;
                    case "3":
                        await socket.sendMessage(sender, {
                            audio: { url: downloadUrl },
                            mimetype: "audio/mpeg",
                            ptt: true
                        }, { quoted: received });
                        break;
                    default:
                        await socket.sendMessage(sender, { text: "*Invalid option. Reply with 1, 2 or 3 (quote the card).*" }, { quoted: received });
                        return;
                }

                // cleanup listener after successful send
                socket.ev.off('messages.upsert', handler);
            } catch (err) {
                console.error("Song handler error:", err);
                try { socket.ev.off('messages.upsert', handler); } catch (e) {}
            }
        };

        socket.ev.on('messages.upsert', handler);

        // auto-remove handler after 60s
        setTimeout(() => {
            try { socket.ev.off('messages.upsert', handler); } catch (e) {}
        }, 60 * 1000);

        // react to original command
        await socket.sendMessage(sender, { react: { text: '🔎', key: msg.key } });

    } catch (err) {
        console.error('Song case error:', err);
        await socket.sendMessage(sender, { text: "*`Error occurred while processing song request`*" }, { quoted: botMention });
    }

    break;
}
// ---------------------- SYSTEM ----------------------
case 'system': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;
    const logo = cfg.logo || config.RCD_IMAGE_PATH;

    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SYSTEM" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    const os = require('os');
    const text = `
🖥️ *System Info for ${botName}*
💻 OS: ${os.type()} ${os.release()}
🖥️ Platform: ${os.platform()}
🧠 CPU cores: ${os.cpus().length}
💾 Memory: ${(os.totalmem()/1024/1024/1024).toFixed(2)} GB
`;

    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: text,
      footer: `🔥 ${botName} SYSTEM INFO 🔥`,
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 }],
      headerType: 4
    }, { quoted: metaQuote });

  } catch(e) {
    console.error('system error', e);
    await socket.sendMessage(sender, { text: '❌ Failed to get system info.' }, { quoted: msg });
  }
  break;
}
case 'menu': {
  try { await socket.sendMessage(sender, { react: { text: "📋", key: msg.key } }); } catch(e){}

  try {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    // load per-session config (logo, botName)
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; }
    catch(e){ console.warn('menu: failed to load config', e); userCfg = {}; }

    const title = userCfg.botName || '💖 𝗖𝗛𝗔𝗠𝗔 𝐌𝐈𝐍𝐈 𝐁𝐎𝐓 💖';

    // 🔹 Fake contact for Meta AI mention
    const shonux = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "META_AI_FAKE_ID_MENU"
        },
        message: {
            contactMessage: {
                displayName: title,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:${title};;;;
FN:${title}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
            }
        }
    };

    const text = `
╭───❏ *BOT STATUS* ❏
│ 🤖 *Bot Name*: ${title}
│ 👑 *Owner*: ${config.OWNER_NAME || 'CHAMINDU'}
│ 🏷️ *Version*: ${config.BOT_VERSION || '0.0001+'}
│ ☁️ *Platform*: ${process.env.PLATFORM || 'Heroku'}
│ ⏳ *Uptime*: ${hours}h ${minutes}m ${seconds}s
╰───────────────❏

╭───❏ *𝗠𝗔𝗜𝗡 𝗠𝗘𝗡𝗨* ❏
│ 
│ 📥 *DOWNLOAD MENU*
│ ${config.PREFIX}download
│ 
│ 🎨 *CREATIVE MENU*  
│ ${config.PREFIX}creative
│
│ 🔧 *TOOLS MENU*
│ ${config.PREFIX}tools
│
│ ⚙️ *SETTINGS MENU*
│ ${config.PREFIX}settings
│
│ 👑 *OWNER MENU*
│ ${config.PREFIX}owner
│ 
│ ⚡ *PING TEST*
│ ${config.PREFIX}ping
│ 
│ 🤖 *BOT INFO*
│ ${config.PREFIX}alive
│
> © ${config.BOT_FOOTER || '𝐂𝐇𝐀𝐌𝐀 𝐌𝐈𝐍𝐈'}
`.trim();

    const buttons = [
      { buttonId: `${config.PREFIX}download`, buttonText: { displayText: "📥 DOWNLOAD" }, type: 1 },
      { buttonId: `${config.PREFIX}creative`, buttonText: { displayText: "🎨 CREATIVE" }, type: 1 },
      { buttonId: `${config.PREFIX}tools`, buttonText: { displayText: "🔧 TOOLS" }, type: 1 },
      { buttonId: `${config.PREFIX}settings`, buttonText: { displayText: "⚙️ SETTINGS" }, type: 1 },
      { buttonId: `${config.PREFIX}owner`, buttonText: { displayText: "👑 OWNER" }, type: 1 }
    ];

    const defaultImg = 'https://files.catbox.moe/hggfta.jpg';
    const useLogo = userCfg.logo || defaultImg;

    // build image payload (url or buffer)
    let imagePayload;
    if (String(useLogo).startsWith('http')) imagePayload = { url: useLogo };
    else {
      try { imagePayload = fs.readFileSync(useLogo); } catch(e){ imagePayload = { url: defaultImg }; }
    }

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: text,
      footer: "🔥 CHAMA MINI BOT MENU 🔥",
      buttons,
      headerType: 4
    }, { quoted: shonux });

  } catch (err) {
    console.error('menu command error:', err);
    try { await socket.sendMessage(sender, { text: '❌ Failed to show menu.' }, { quoted: msg }); } catch(e){}
  }
  break;
}

// ==================== DOWNLOAD MENU ====================
case 'download': {
  try { await socket.sendMessage(sender, { react: { text: "📥", key: msg.key } }); } catch(e){}

  try {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';

    const shonux = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "META_AI_FAKE_ID_DOWNLOAD"
        },
        message: {
            contactMessage: {
                displayName: title,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:${title};;;;
FN:${title}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
            }
        }
    };

    const text = `
╭───❏ *DOWNLOAD MENU* ❏
│ 
│ 🎵 *Music Downloaders*
│ ${config.PREFIX}song [query]
│ ${config.PREFIX}csong [jid] [query]
│ ${config.PREFIX}ringtone [name]
│ 
│ 🎬 *Video Downloaders*
│ ${config.PREFIX}tiktok [url]
│ ${config.PREFIX}video [query]
│ ${config.PREFIX}xvideo [query]
│ ${config.PREFIX}xnxx [query]
│ ${config.PREFIX}fb [url]
│ ${config.PREFIX}ig [url]
│ 
│ 📱 *App & Files*
│ ${config.PREFIX}apk [app id]
│ ${config.PREFIX}apksearch [app name]
│ ${config.PREFIX}mediafire [url]
│ ${config.PREFIX}gdrive [url]
│ 
╰───────────────❏
`.trim();

    const buttons = [
      { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🔙 MAIN MENU" }, type: 1 },
      { buttonId: `${config.PREFIX}creative`, buttonText: { displayText: "🎨 CREATIVE" }, type: 1 }
    ];

    await socket.sendMessage(sender, {
      text,
      footer: "📥 DOWNLOAD COMMANDS",
      buttons
    }, { quoted: shonux });

  } catch (err) {
    console.error('download command error:', err);
    try { await socket.sendMessage(sender, { text: '❌ Failed to show download menu.' }, { quoted: msg }); } catch(e){}
  }
  break;
}

// ==================== CREATIVE MENU ====================
case 'creative': {
  try { await socket.sendMessage(sender, { react: { text: "🎨", key: msg.key } }); } catch(e){}

  try {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';

    const shonux = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "META_AI_FAKE_ID_CREATIVE"
        },
        message: {
            contactMessage: {
                displayName: title,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:${title};;;;
FN:${title}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
            }
        }
    };

    const text = `
╭───❏ *CREATIVE MENU* ❏
│ 
│ 🤖 *AI Features*
│ ${config.PREFIX}ai [message]
│ ${config.PREFIX}aiimg [prompt]
│ ${config.PREFIX}aiimg2 [prompt]
│ 
│ ✍️ *Text Tools*
│ ${config.PREFIX}font [text]
│ 
│ 🖼️ *Image Tools*
│ ${config.PREFIX}getdp [number]
│ 
│ 💾 *Media Saver*
│ ${config.PREFIX}save (reply to status)
│ 
╰───────────────❏
`.trim();

    const buttons = [
      { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🔙 MAIN MENU" }, type: 1 },
      { buttonId: `${config.PREFIX}download`, buttonText: { displayText: "📥 DOWNLOAD" }, type: 1 }
    ];

    await socket.sendMessage(sender, {
      text,
      footer: "🎨 CREATIVE COMMANDS",
      buttons
    }, { quoted: shonux });

  } catch (err) {
    console.error('creative command error:', err);
    try { await socket.sendMessage(sender, { text: '❌ Failed to show creative menu.' }, { quoted: msg }); } catch(e){}
  }
  break;
}

// ==================== TOOLS MENU ====================
case 'tools': {
  try { await socket.sendMessage(sender, { react: { text: "🔧", key: msg.key } }); } catch(e){}

  try {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';

    const shonux = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "META_AI_FAKE_ID_TOOLS"
        },
        message: {
            contactMessage: {
                displayName: title,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:${title};;;;
FN:${title}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
            }
        }
    };

    const text = `
╭───❏ *TOOLS MENU* ❏
│ 
│ 🆔 *Info Tools*
│ ${config.PREFIX}jid
│ ${config.PREFIX}cid [chaneel-link]
│ ${config.PREFIX}system
│ 
│ 👥 *Group Tools*
│ ${config.PREFIX}tagall [message]
│ ${config.PREFIX}online
│ ${config.PREFIX}gjid
│ ${config.PREFIX}left
│ ${config.PREFIX}leave
│ ${config.PREFIX}hidetag
│ ${config.PREFIX}savecontact [GJID)
│ ${config.PREFIX}tagadmins
│
│ 📡 *Channel forward Tools*
│ ${config.PREFIX}cimg
│ ${config.PREFIX}ctx
│ ${config.PREFIX}cvid
│
│ 📰 *News Tools*
│ ${config.PREFIX}adanews
│ ${config.PREFIX}sirasanews
│ ${config.PREFIX}lankadeepanews
│ ${config.PREFIX}gagananews
│ 
│ 🔒 *User Management*
│ ${config.PREFIX}block [number]
│ ${config.PREFIX}unblock [number]
│
│ 👥 *Google Search Tools*
│ ${config.PREFIX}img [query]
│ ${config.PREFIX}google [query]
│ 
│ 📊 *Bot Status*
│ ${config.PREFIX}ping
│ ${config.PREFIX}alive
│
│ 🏷️ *Other Tools*
│ ${config.PREFIX}emix
│ 
╰───────────────❏
`.trim();

    const buttons = [
      { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🔙 MAIN MENU" }, type: 1 },
      { buttonId: `${config.PREFIX}settings`, buttonText: { displayText: "⚙️ SETTINGS" }, type: 1 }
    ];

    await socket.sendMessage(sender, {
      text,
      footer: "🔧 TOOLS COMMANDS",
      buttons
    }, { quoted: shonux });

  } catch (err) {
    console.error('tools command error:', err);
    try { await socket.sendMessage(sender, { text: '❌ Failed to show tools menu.' }, { quoted: msg }); } catch(e){}
  }
  break;
}


case 'settings': {
  try { 
    await socket.sendMessage(sender, { react: { text: "⚙️", key: msg.key } }); 
  } catch(e){}

  try {
    let userCfg = {};
    try { 
      if (number && typeof loadUserConfigFromMongo === 'function') 
        userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; 
    } catch(e){ userCfg = {}; }

    const botName = userCfg.botName || 'CHAMA MINI BOT AI';

    const metaQuote = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "META_AI_SETTINGS_MENU"
        },
        message: {
            contactMessage: {
                displayName: botName,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
            }
        }
    };

    const text = `
╭───❏ *SETTINGS MENU* ❏
│ 
│ 🤖 *Bot Customization*
│ ${config.PREFIX}setbotname [name]
│ ${config.PREFIX}setlogo (reply to image/url)
│ 
│ ⚡ *Session Mode*
│ ${config.PREFIX}setmode <public|private|inbox|groups>
│ ${config.PREFIX}getmode
│ 
│ 😎 *Status Reactions*
│ ${config.PREFIX}setsr <emoji1,emoji2,...|clear>
│ ${config.PREFIX}getsr
│ 
│ 📊 *Config Management*
│ ${config.PREFIX}showconfig
│ ${config.PREFIX}resetconfig
│ 
│ 🗑️ *Session Management*
│ ${config.PREFIX}deleteme
│ 
╰───────────────❏
`.trim();

    const buttons = [
      { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🔙 MAIN MENU" }, type: 1 },
      { buttonId: `${config.PREFIX}owner`, buttonText: { displayText: "👑 OWNER" }, type: 1 }
    ];

    await socket.sendMessage(sender, {
      text,
      footer: `⚙️ SETTINGS COMMANDS • Powered by ${botName}`,
      buttons
    }, { quoted: metaQuote });

  } catch (err) {
    console.error('settings command error:', err);
    try { await socket.sendMessage(sender, { text: '❌ Failed to show settings menu.' }, { quoted: msg }); } catch(e){}
  }
  break;
}


// ==================== OWNER MENU ====================
case 'owner': {
  try { await socket.sendMessage(sender, { react: { text: "👑", key: msg.key } }); } catch(e){}

  try {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';

    const shonux = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "META_AI_FAKE_ID_OWNER"
        },
        message: {
            contactMessage: {
                displayName: title,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:${title};;;;
FN:${title}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
            }
        }
    };

    const text = `
╭───❏ *OWNER INFO* ❏
│ 
│ 👑 *Name*: CHAMINDU RANSIKA
│ 📞 *Contact*: +94703229057
│ 📧 *Email*: ransikachamindu43@@gmail.com
│ 🌐 *GitHub*: github.com/Chama-ofc
│ 
│ 💬 *For support or queries*
│ contact the owner directly
│ 
╰───────────────❏
`.trim();

    const buttons = [
      { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "🔙 MAIN MENU" }, type: 1 },
      { buttonId: `${config.PREFIX}settings`, buttonText: { displayText: "⚙️ SETTINGS" }, type: 1 }
    ];

    await socket.sendMessage(sender, {
      text,
      footer: "👑 OWNER INFORMATION",
      buttons
    }, { quoted: shonux });

  } catch (err) {
    console.error('owner command error:', err);
    try { await socket.sendMessage(sender, { text: '❌ Failed to show owner info.' }, { quoted: msg }); } catch(e){}
  }
  break;
}
case 'google':
case 'gsearch':
case 'search':
    try {
        if (!args || args.length === 0) {
            await socket.sendMessage(sender, {
                text: '⚠️ *Please provide a search query.*\n\n*Example:*\n.google how to code in javascript'
            });
            break;
        }

        const sanitized = (number || '').replace(/[^0-9]/g, '');
        const userCfg = await loadUserConfigFromMongo(sanitized) || {};
        const botName = userCfg.botName || BOT_NAME_FANCY;

        const botMention = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_GOOGLE" },
            message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD` } }
        };

        const query = args.join(" ");
        const apiKey = "AIzaSyDMbI3nvmQUrfjoCJYLS69Lej1hSXQjnWI";
        const cx = "baf9bdb0c631236e5";
        const apiUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${cx}`;

        const response = await axios.get(apiUrl);

        if (response.status !== 200 || !response.data.items || response.data.items.length === 0) {
            await socket.sendMessage(sender, { text: `⚠️ *No results found for:* ${query}` }, { quoted: botMention });
            break;
        }

        let results = `🔍 *Google Search Results for:* "${query}"\n\n`;
        response.data.items.slice(0, 5).forEach((item, index) => {
            results += `*${index + 1}. ${item.title}*\n\n🔗 ${item.link}\n\n📝 ${item.snippet}\n\n`;
        });

        const firstResult = response.data.items[0];
        const thumbnailUrl = firstResult.pagemap?.cse_image?.[0]?.src || firstResult.pagemap?.cse_thumbnail?.[0]?.src || 'https://via.placeholder.com/150';

        await socket.sendMessage(sender, {
            image: { url: thumbnailUrl },
            caption: results.trim(),
            contextInfo: { mentionedJid: [sender] }
        }, { quoted: botMention });

    } catch (error) {
        console.error(`Google search error:`, error);
        await socket.sendMessage(sender, { text: `⚠️ *An error occurred while fetching search results.*\n\n${error.message}` });
    }
    break;
case 'img': {
    const q = body.replace(/^[.\/!]img\s*/i, '').trim();
    if (!q) return await socket.sendMessage(sender, {
        text: '🔍 Please provide a search query. Ex: `.img sunset`'
    }, { quoted: msg });

    try {
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        const userCfg = await loadUserConfigFromMongo(sanitized) || {};
        const botName = userCfg.botName || BOT_NAME_FANCY;

        const botMention = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_IMG" },
            message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD` } }
        };

        const res = await axios.get(`https://allstars-apis.vercel.app/pinterest?search=${encodeURIComponent(q)}`);
        const data = res.data.data;
        if (!data || data.length === 0) return await socket.sendMessage(sender, { text: '❌ No images found for your query.' }, { quoted: botMention });

        const randomImage = data[Math.floor(Math.random() * data.length)];

        const buttons = [{ buttonId: `${config.PREFIX}img ${q}`, buttonText: { displayText: "⏩ Next Image" }, type: 1 }];

        const buttonMessage = {
            image: { url: randomImage },
            caption: `🖼️ *Image Search:* ${q}\n\n_Provided by ${botName}_`,
            footer: config.FOOTER || '> 𝗖𝗛𝗔𝗠𝗔 𝗠𝗗 𝗠𝗜𝗡𝗜',
            buttons: buttons,
            headerType: 4,
            contextInfo: { mentionedJid: [sender] }
        };

        await socket.sendMessage(from, buttonMessage, { quoted: botMention });

    } catch (err) {
        console.error("Image search error:", err);
        await socket.sendMessage(sender, { text: '❌ Failed to fetch images.' }, { quoted: botMention });
    }
    break;
}
case 'gdrive': {
    try {
        const text = args.join(' ').trim();
        if (!text) return await socket.sendMessage(sender, { text: '⚠️ Please provide a Google Drive link.\n\nExample: `.gdrive <link>`' }, { quoted: msg });

        // 🔹 Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        const userCfg = await loadUserConfigFromMongo(sanitized) || {};
        const botName = userCfg.botName || BOT_NAME_FANCY;

        // 🔹 Meta AI fake contact mention
        const botMention = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_GDRIVE" },
            message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD` } }
        };

        // 🔹 Fetch Google Drive file info
        const res = await axios.get(`https://saviya-kolla-api.koyeb.app/download/gdrive?url=${encodeURIComponent(text)}`);
        if (!res.data?.status || !res.data.result) return await socket.sendMessage(sender, { text: '❌ Failed to fetch file info.' }, { quoted: botMention });

        const file = res.data.result;

        // 🔹 Send as document
        await socket.sendMessage(sender, {
            document: { 
                url: file.downloadLink, 
                mimetype: file.mimeType || 'application/octet-stream', 
                fileName: file.name 
            },
            caption: `📂 *File Name:* ${file.name}\n💾 *Size:* ${file.size}\n\n_Provided by ${botName}_`,
            contextInfo: { mentionedJid: [sender] }
        }, { quoted: botMention });

    } catch (err) {
        console.error('GDrive command error:', err);
        await socket.sendMessage(sender, { text: '❌ Error fetching Google Drive file.' }, { quoted: botMention });
    }
    break;
}
case 'newmovie1': {
  const from = msg.key.remoteJid;
  let text = '';
  if (msg.message?.conversation) text = msg.message.conversation;
  else if (msg.message?.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
  else if (msg.message?.imageMessage?.caption) text = msg.message.imageMessage.caption;
  else if (msg.message?.videoMessage?.caption) text = msg.message.videoMessage.caption;
  const fullText = (text || '').trim();
  text = fullText.replace(new RegExp(`^(\\.?)(newmovie)\\s*`, 'i'), '').trim();

  console.log(`[NEWMOVIE] started: fullText="${fullText}", query="${text}", from=${from}`);

  if (!socket || !socket.sendMessage) return console.error('[NEWMOVIE] Socket invalid');
  if (!msg || !msg.key) return console.error('[NEWMOVIE] Msg invalid');

  const number = msg.key.participant || msg.key.remoteJid;
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const cfg = await (typeof loadUserConfigFromMongo === 'function' ? loadUserConfigFromMongo(sanitized) : {}) || {};
  const botName = cfg.botName || 'CHAMA MINI BOT AI';
  const creatorName = 'CHAMA';
  const ownerContact = config?.OWNER_NUMBER || '94783314361';

  const metaQuote = {
    key: {
      remoteJid: "status@broadcast",
      participant: "0@s.whatsapp.net",
      fromMe: false,
      id: "META_NEW_MOVIE"
    },
    message: {
      contactMessage: {
        displayName: botName,
        vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:CHAMA\nTEL;type=CELL;type=VOICE;waid=${ownerContact}:${ownerContact}\nEND:VCARD`
      }
    }
  };

  function cineFormat(title, body, footer = config?.FOOTER || '*•𝙲𝙷𝙰𝙼𝙰 ᴍɪɴɪ•*') {
    return `_*${title}*_\n\n${body}\n\n> ${footer}`;
  }

  function getMimeFromName(name = '') {
    const ext = (name.split('.').pop() || '').toLowerCase();
    switch (ext) {
      case 'mp4': return 'video/mp4';
      case 'mkv': return 'video/x-matroska';
      case 'webm': return 'video/webm';
      case 'mov': return 'video/quicktime';
      case 'avi': return 'video/x-msvideo';
      case 'mp3': return 'audio/mpeg';
      case 'm4a': return 'audio/mp4';
      default: return 'application/octet-stream';
    }
  }

  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  // reply collector (quoted or plain number)
  function createReplyCollector(chatId, targetMsgId, opts = {}) {
    const { timeout = 3 * 60 * 1000 } = opts;
    return new Promise((resolve, reject) => {
      const onUpsert = async (up) => {
        try {
          const msgs = Array.isArray(up.messages) ? up.messages : (up.messagesV1 || []);
          for (const m of msgs) {
            if (!m || !m.key) continue;
            if ((m.key.remoteJid || '') !== chatId) continue;
            if (m.key.fromMe) continue;
            const replyText = (
              m.message?.extendedTextMessage?.text ||
              m.message?.conversation ||
              m.message?.imageMessage?.caption ||
              m.message?.videoMessage?.caption ||
              ''
            ).trim();
            const quotedStanzaId = m.message?.extendedTextMessage?.contextInfo?.stanzaId || null;
            const quoted = !!quotedStanzaId && quotedStanzaId === targetMsgId;

            if (!quoted && !/^\d+$/.test(replyText)) continue;

            socket.ev.off('messages.upsert', onUpsert);
            clearTimeout(timeoutHandle);
            resolve({ raw: m, text: replyText, quoted });
            return;
          }
        } catch (e) {
          console.error('[NEWMOVIE collector] onUpsert error', e);
        }
      };

      const timeoutHandle = setTimeout(() => {
        socket.ev.off('messages.upsert', onUpsert);
        reject(new Error('timeout'));
      }, timeout);

      socket.ev.on('messages.upsert', onUpsert);
    });
  }

  try {
    await socket.sendMessage(from, { react: { text: '🕐', key: msg.key } });

    if (!text || text.length < 1) {
      await socket.sendMessage(from, {
        text: cineFormat(
          '🎬 NEWMOVIE SEARCH',
          '❌ කරුණාකර චිත්‍රපටයක් දැනගන්න නාමය ටයිප් කරන්න.\n\n*උදාහරණ:* .newmovie Lemony'
        )
      }, { quoted: metaQuote });
      return;
    }

    // call search API
    let searchData;
    try {
      const resp = await axios.get(`https://nadeeeeee.netlify.app/api/Search/search?text=${encodeURIComponent(text)}`, { timeout: 10000 });
      searchData = resp.data;
    } catch (err) {
      await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Search failed: ${err.message}`) }, { quoted: metaQuote });
      return;
    }

    if (!Array.isArray(searchData) || searchData.length === 0) {
      await socket.sendMessage(from, { text: cineFormat('🎬 NO RESULTS', `❗ "${text}" සඳහා කිසිදු movie result එකක් නොපැවතියි.`) }, { quoted: metaQuote });
      return;
    }

    // top 5
    const results = searchData.slice(0, 5).map((r, i) => ({
      idx: i,
      title: r.title || r.Title || 'Unknown',
      year: r.year || r.Year || 'N/A',
      creator: r.creater || r.creator || creatorName,
      link: r.link || r.Link || '',
      image: r.image || r.img || ''
    })).filter(r => !!r.link);

    if (results.length === 0) {
      await socket.sendMessage(from, { text: cineFormat('🎬 NO VALID MOVIES', '❗ Valid movie links not found in results.') }, { quoted: metaQuote });
      return;
    }

    // list message (include Creator CHAMA)
    let movieList = `_*NEWMOVIE SEARCH RESULTS 🎬 — ${botName}*_\n\n*\`Input :\`* ${text}\n\n`;
    results.forEach((m, i) => {
      movieList += `*${i + 1}. ${m.title}*\n📅 Year: ${m.year}\n👤 Creator: ${creatorName}\n\n`;
    });
    movieList += `Reply with number (1-${results.length}) to get details & downloads.\n\n> Creator: ${creatorName}\n> ${botName}`;

    const fallbackImage = 'https://i.imgur.com/3k5K7zC.jpg';
    let sentMsg;
    try {
      sentMsg = await socket.sendMessage(from, {
        image: { url: results[0].image || fallbackImage },
        caption: movieList
      }, { quoted: metaQuote });
    } catch (e) {
      sentMsg = await socket.sendMessage(from, { text: movieList }, { quoted: metaQuote });
    }

    // wait for selection
    let selectionIndex;
    try {
      const reply = await createReplyCollector(from, sentMsg.key.id, { timeout: 3 * 60 * 1000 });
      const raw = (reply.text || '').trim();
      const idx = parseInt(raw, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= results.length) {
        await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❗ Invalid selection. Reply with a number (1-${results.length}).`) }, { quoted: metaQuote });
        return;
      }
      selectionIndex = idx;
    } catch (err) {
      if (err.message === 'timeout') {
        await socket.sendMessage(from, { text: cineFormat('🎬 TIMEOUT', '⏳ Selection timed out. කරුණාකර නැවත .newmovie command එක ක්‍රියාත්මක කරන්න.') }, { quoted: metaQuote });
        return;
      } else {
        await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Selection listener failed: ${err.message}`) }, { quoted: metaQuote });
        return;
      }
    }

    const chosen = results[selectionIndex];

    // fetch details API
    let details;
    try {
      const dresp = await axios.get(`https://nadeeeedetailes.netlify.app/api/details/functions?url=${encodeURIComponent(chosen.link)}`, { timeout: 10000 });
      details = dresp.data;
    } catch (err) {
      await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Details fetch failed: ${err.message}`) }, { quoted: metaQuote });
      return;
    }

    if (!details || (details.status && (details.status !== 200 && details.status !== '200'))) {
      await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', '❗ Invalid details response from details API.') }, { quoted: metaQuote });
      return;
    }

    const title = details.title || chosen.title;
    const desc = details.description ? (details.description.split(' ').slice(0, 60).join(' ') + '...') : 'No description available.';
    const images = Array.isArray(details.image_links) ? details.image_links : (details.image_links ? [details.image_links] : []);
    const downloads = Array.isArray(details.download_links) ? details.download_links : (details.download_links ? [details.download_links] : []);

    let detailCaption = `*🎞️ Title:* _${title}_\n*👤 Creator:* _${details.creator || chosen.creator || creatorName}_\n*📝 Description:* ${desc}\n\n`;
    if (downloads.length === 0) detailCaption += '⚠️ No download links found.';
    else {
      detailCaption += '📥 Available Qualities:\n';
      downloads.forEach((dl, i) => detailCaption += `*${i + 1}.* ${dl.quality || 'Unknown'}\n`);
      detailCaption += '\nReply with the quality number to download.';
    }
    detailCaption += `\n\n> Creator: ${creatorName}\n> ${botName}`;

    const detailImage = images[0] || chosen.image || fallbackImage;
    let qualityMsg;
    try {
      qualityMsg = await socket.sendMessage(from, { image: { url: detailImage }, caption: detailCaption }, { quoted: metaQuote });
    } catch (e) {
      qualityMsg = await socket.sendMessage(from, { text: detailCaption }, { quoted: metaQuote });
    }

    if (downloads.length === 0) return;

    // wait for quality selection
    let qualityIndex;
    try {
      const qReply = await createReplyCollector(from, qualityMsg.key.id, { timeout: 3 * 60 * 1000 });
      const qText = (qReply.text || '').trim();
      const qNum = parseInt(qText, 10);
      if (isNaN(qNum) || qNum < 1 || qNum > downloads.length) {
        await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', '❗ Invalid quality selection.') }, { quoted: metaQuote });
        return;
      }
      qualityIndex = qNum - 1;
    } catch (err) {
      if (err.message === 'timeout') {
        await socket.sendMessage(from, { text: cineFormat('🎬 TIMEOUT', '⏳ Selection timed out. කරුණාකර නැවත .newmovie command එක ක්‍රියාත්මක කරන්න.') }, { quoted: metaQuote });
        return;
      } else {
        await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Quality selection failed: ${err.message}`) }, { quoted: metaQuote });
        return;
      }
    }

    const chosenDownload = downloads[qualityIndex];
    const rawUrl = chosenDownload.url || chosenDownload.link || chosenDownload.file || '';

    if (!rawUrl) {
      await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', '❗ Download URL missing.') }, { quoted: metaQuote });
      return;
    }

    await socket.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

    // Try pixeldrain first (if available)
    let resolvedUrl = null;
    try {
      const pix = await axios.get(`https://www.dark-yasiya-api.site/download/pixeldrain?url=${encodeURIComponent(rawUrl)}`, { timeout: 15000 });
      resolvedUrl = pix?.data?.result?.dl_link || pix?.data?.result?.dllink || null;
    } catch (pixErr) {
      resolvedUrl = null;
    }
    if (!resolvedUrl) resolvedUrl = rawUrl;

    // Now TRY to download and send as document (no links)
    try {
      // HEAD to get size
      let headResp = null;
      try {
        headResp = await axios.head(resolvedUrl, { timeout: 8000 });
      } catch (hErr) {
        headResp = null;
      }

      const contentLength = headResp?.headers?.['content-length'] ? parseInt(headResp.headers['content-length'], 10) : NaN;
      const contentType = headResp?.headers?.['content-type'] || null;

      // safety caps - adjust as needed
      const MAX_MEM_BYTES = 300 * 1024 * 1024; // 300 MB for in-memory buffer
      const MAX_FILE_BYTES = 800 * 1024 * 1024; // 800 MB for disk-stream approach

      // If size known and very large -> refuse and tell user (because server might run out)
      if (!isNaN(contentLength) && contentLength > MAX_FILE_BYTES) {
        await socket.sendMessage(from, { text: cineFormat('🎬 TOO LARGE', `⚠️ File size is too large to fetch automatically (${Math.round(contentLength / (1024*1024))} MB). ඔබට local browser/PC එකෙන් download කරගන්න raw link එක භාවිතා කරන්න.`) }, { quoted: metaQuote });
        return;
      }

      // If small enough to keep in memory -> GET arraybuffer and send buffer
      if (isNaN(contentLength) || contentLength <= MAX_MEM_BYTES) {
        try {
          const r = await axios.get(resolvedUrl, { responseType: 'arraybuffer', timeout: 60000, maxContentLength: Infinity, maxBodyLength: Infinity });
          const buf = Buffer.from(r.data);
          const fileName = (resolvedUrl.split('/').pop()?.split('?')[0]) || `${title.replace(/\s+/g, '_')}.mp4`;
          const mimetype = contentType || getMimeFromName(fileName) || getMimeFromName(fileName);
          await socket.sendMessage(from, {
            document: buf,
            mimetype,
            fileName: `${fileName}`,
            caption: `Downloaded by ${botName} — Creator: ${creatorName}`
          }, { quoted: metaQuote });
          return;
        } catch (memErr) {
          console.warn('[NEWMOVIE] in-memory download failed', memErr.message);
          // fall through to disk-stream attempt
        }
      }

      // Disk-stream fallback: download to temp file then send as stream
      const tmpDir = os.tmpdir();
      const safeName = `${Date.now()}_${Math.random().toString(36).slice(2,8)}_${(resolvedUrl.split('/').pop() || 'movie.bin').split('?')[0]}`;
      const tmpPath = path.join(tmpDir, safeName);
      try {
        const writer = fs.createWriteStream(tmpPath);
        const response = await axios.get(resolvedUrl, { responseType: 'stream', timeout: 0, maxContentLength: Infinity, maxBodyLength: Infinity });
        const total = response.headers['content-length'] ? parseInt(response.headers['content-length'], 10) : NaN;
        // pipe
        await new Promise((res, rej) => {
          response.data.pipe(writer);
          let errored = false;
          writer.on('error', err => { errored = true; rej(err); });
          writer.on('finish', () => { if (!errored) res(); });
        });

        // check final size
        const stats = fs.statSync(tmpPath);
        if (stats.size > MAX_FILE_BYTES) {
          fs.unlinkSync(tmpPath);
          await socket.sendMessage(from, { text: cineFormat('🎬 TOO LARGE', `⚠️ The downloaded file is too large to send (${Math.round(stats.size / (1024*1024))} MB). Please use the link manually.`) }, { quoted: metaQuote });
          return;
        }

        const fileName = path.basename(tmpPath);
        const mimetype = contentType || getMimeFromName(fileName);
        await socket.sendMessage(from, {
          document: fs.createReadStream(tmpPath),
          mimetype,
          fileName,
          caption: `Downloaded by ${botName} — Creator: ${creatorName}`
        }, { quoted: metaQuote });

        // cleanup
        try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
        return;

      } catch (diskErr) {
        console.warn('[NEWMOVIE] disk-stream failed', diskErr.message);
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch(e){}
        // final fallback: tell user failure (we DO NOT send raw link if user explicitly forbids, so explain)
        await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', '❌ මේ වෙලාවේ මට file එක server එකට download කරලා document ලෙස යවන්න බැහැ. කරුණාකර තවත් quality එකක් محاولة කරන්න (ඔබට ලියාපදිංචි කරවා ගත කල premium server මගින් වැඩි files support කළ හැක).') }, { quoted: metaQuote });
        return;
      }

    } catch (finalErr) {
      console.error('[NEWMOVIE] final download/send error', finalErr);
      await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Download/send failed: ${finalErr.message || finalErr}`) }, { quoted: metaQuote });
      return;
    }

  } catch (error) {
    console.error('[NEWMOVIE] unexpected error', error);
    await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Unexpected error: ${error.message || error}`) }, { quoted: metaQuote });
  }
  break;
}

case 'newmovie': {
  const from = msg.key.remoteJid;
  let text = '';
  if (msg.message?.conversation) text = msg.message.conversation;
  else if (msg.message?.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
  else if (msg.message?.imageMessage?.caption) text = msg.message.imageMessage.caption;
  else if (msg.message?.videoMessage?.caption) text = msg.message.videoMessage.caption;
  const fullText = (text || '').trim();
  text = fullText.replace(new RegExp(`^(\\.?)(newmovie)\\s*`, 'i'), '').trim();
  console.log(`[NEWMOVIE] started: fullText="${fullText}", query="${text}", from=${from}`);

  if (!socket || !socket.sendMessage) return console.error('[NEWMOVIE] Socket invalid');
  if (!msg || !msg.key) return console.error('[NEWMOVIE] Msg invalid');

  const number = msg.key.participant || msg.key.remoteJid;
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const cfg = await (typeof loadUserConfigFromMongo === 'function' ? loadUserConfigFromMongo(sanitized) : {}) || {};
  const botName = cfg.botName || 'CHAMA MINI BOT AI';
  const creatorName = 'CHAMA';
  const ownerContact = config?.OWNER_NUMBER || '94783314361';

  const metaQuote = {
    key: {
      remoteJid: "status@broadcast",
      participant: "0@s.whatsapp.net",
      fromMe: false,
      id: "META_NEW_MOVIE"
    },
    message: {
      contactMessage: {
        displayName: botName,
        vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:CHAMA\nTEL;type=CELL;type=VOICE;waid=${ownerContact}:${ownerContact}\nEND:VCARD`
      }
    }
  };

  function cineFormat(title, body, footer = config?.FOOTER || '*•𝙲𝙷𝙰𝙼𝙰 ᴍɪɴɪ•*') {
    return `_*${title}*_\n\n${body}\n\n> ${footer}`;
  }

  function getMimeFromName(name = '') {
    const ext = (name.split('.').pop() || '').toLowerCase();
    switch (ext) {
      case 'mp4': return 'video/mp4';
      case 'mkv': return 'video/x-matroska';
      case 'webm': return 'video/webm';
      case 'mov': return 'video/quicktime';
      case 'avi': return 'video/x-msvideo';
      case 'mp3': return 'audio/mpeg';
      case 'm4a': return 'audio/mp4';
      default: return 'application/octet-stream';
    }
  }

  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const axios = require('axios');

  // reply collector (quoted or plain number)
  function createReplyCollector(chatId, targetMsgId, opts = {}) {
    const { timeout = 3 * 60 * 1000 } = opts;
    return new Promise((resolve, reject) => {
      const onUpsert = async (up) => {
        try {
          const msgs = Array.isArray(up.messages) ? up.messages : (up.messagesV1 || []);
          for (const m of msgs) {
            if (!m || !m.key) continue;
            if ((m.key.remoteJid || '') !== chatId) continue;
            if (m.key.fromMe) continue;
            const replyText = (
              m.message?.extendedTextMessage?.text ||
              m.message?.conversation ||
              m.message?.imageMessage?.caption ||
              m.message?.videoMessage?.caption ||
              ''
            ).trim();
            const quotedStanzaId = m.message?.extendedTextMessage?.contextInfo?.stanzaId || null;
            const quoted = !!quotedStanzaId && quotedStanzaId === targetMsgId;
            if (!quoted && !/^\d+$/.test(replyText)) continue;
            socket.ev.off('messages.upsert', onUpsert);
            clearTimeout(timeoutHandle);
            resolve({ raw: m, text: replyText, quoted });
            return;
          }
        } catch (e) {
          console.error('[NEWMOVIE collector] onUpsert error', e);
        }
      };
      const timeoutHandle = setTimeout(() => {
        socket.ev.off('messages.upsert', onUpsert);
        reject(new Error('timeout'));
      }, timeout);
      socket.ev.on('messages.upsert', onUpsert);
    });
  }

  try {
    await socket.sendMessage(from, { react: { text: '🕐', key: msg.key } });

    if (!text || text.length < 1) {
      await socket.sendMessage(from, {
        text: cineFormat(
          '🎬 NEWMOVIE SEARCH',
          '❌ කරුණාකර චිත්‍රපටයක් දැනගන්න නාමය ටයිප් කරන්න.\n\n*උදාහරණ:* .newmovie Lemony'
        )
      }, { quoted: metaQuote });
      return;
    }

    // search API
    let searchData;
    try {
      const resp = await axios.get(`https://nadeeeeee.netlify.app/api/Search/search?text=${encodeURIComponent(text)}`, { timeout: 10000 });
      searchData = resp.data;
    } catch (err) {
      await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Search failed: ${err.message}`) }, { quoted: metaQuote });
      return;
    }

    if (!Array.isArray(searchData) || searchData.length === 0) {
      await socket.sendMessage(from, { text: cineFormat('🎬 NO RESULTS', `❗ "${text}" සඳහා කිසිදු movie result එකක් නොපැවතියි.`) }, { quoted: metaQuote });
      return;
    }

    const results = searchData.slice(0, 5).map((r, i) => ({
      idx: i,
      title: r.title || r.Title || 'Unknown',
      year: r.year || r.Year || 'N/A',
      creator: r.creater || r.creator || creatorName,
      link: r.link || r.Link || '',
      image: r.image || r.img || ''
    })).filter(r => !!r.link);

    if (results.length === 0) {
      await socket.sendMessage(from, { text: cineFormat('🎬 NO VALID MOVIES', '❗ Valid movie links not found in results.') }, { quoted: metaQuote });
      return;
    }

    // list message
    let movieList = `_*NEWMOVIE SEARCH RESULTS 🎬 — ${botName}*_\n\n*\`Input :\`* ${text}\n\n`;
    results.forEach((m, i) => {
      movieList += `*${i + 1}. ${m.title}*\n📅 Year: ${m.year}\n👤 Creator: ${creatorName}\n\n`;
    });
    movieList += `Reply with number (1-${results.length}) to get details & downloads.\n\n> Creator: ${creatorName}\n> ${botName}`;
    const fallbackImage = 'https://i.imgur.com/3k5K7zC.jpg';
    let sentMsg;
    try {
      sentMsg = await socket.sendMessage(from, {
        image: { url: results[0].image || fallbackImage },
        caption: movieList
      }, { quoted: metaQuote });
    } catch (e) {
      sentMsg = await socket.sendMessage(from, { text: movieList }, { quoted: metaQuote });
    }

    // wait for selection
    let selectionIndex;
    try {
      const reply = await createReplyCollector(from, sentMsg.key.id, { timeout: 3 * 60 * 1000 });
      const raw = (reply.text || '').trim();
      const idx = parseInt(raw, 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= results.length) {
        await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❗ Invalid selection. Reply with a number (1-${results.length}).`) }, { quoted: metaQuote });
        return;
      }
      selectionIndex = idx;
    } catch (err) {
      if (err.message === 'timeout') {
        await socket.sendMessage(from, { text: cineFormat('🎬 TIMEOUT', '⏳ Selection timed out. කරුණාකර නැවත .newmovie command එක ක්‍රියාත්මක කරන්න.') }, { quoted: metaQuote });
        return;
      } else {
        await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Selection listener failed: ${err.message}`) }, { quoted: metaQuote });
        return;
      }
    }

    const chosen = results[selectionIndex];

    // details API (must return direct download links in details.download_links)
    let details;
    try {
      const dresp = await axios.get(`https://nadeeeedetailes.netlify.app/api/details/functions?url=${encodeURIComponent(chosen.link)}`, { timeout: 10000 });
      details = dresp.data;
    } catch (err) {
      await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Details fetch failed: ${err.message}`) }, { quoted: metaQuote });
      return;
    }

    if (!details || (details.status && (details.status !== 200 && details.status !== '200'))) {
      await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', '❗ Invalid details response from details API.') }, { quoted: metaQuote });
      return;
    }

    const title = details.title || chosen.title;
    const desc = details.description ? (details.description.split(' ').slice(0, 60).join(' ') + '...') : 'No description available.';
    const images = Array.isArray(details.image_links) ? details.image_links : (details.image_links ? [details.image_links] : []);
    const downloads = Array.isArray(details.download_links) ? details.download_links : (details.download_links ? [details.download_links] : []);

    let detailCaption = `*🎞️ Title:* _${title}_\n*👤 Creator:* _${details.creator || chosen.creator || creatorName}_\n*📝 Description:* ${desc}\n\n`;
    if (downloads.length === 0) detailCaption += '⚠️ No download links found.';
    else {
      detailCaption += '📥 Available Qualities:\n';
      downloads.forEach((dl, i) => detailCaption += `*${i + 1}.* ${dl.quality || 'Unknown'}\n`);
      detailCaption += '\nReply with the quality number to download.';
    }
    detailCaption += `\n\n> Creator: ${creatorName}\n> ${botName}`;

    const detailImage = images[0] || chosen.image || fallbackImage;
    let qualityMsg;
    try {
      qualityMsg = await socket.sendMessage(from, { image: { url: detailImage }, caption: detailCaption }, { quoted: metaQuote });
    } catch (e) {
      qualityMsg = await socket.sendMessage(from, { text: detailCaption }, { quoted: metaQuote });
    }

    if (downloads.length === 0) return;

    // wait for quality selection
    let qualityIndex;
    try {
      const qReply = await createReplyCollector(from, qualityMsg.key.id, { timeout: 3 * 60 * 1000 });
      const qText = (qReply.text || '').trim();
      const qNum = parseInt(qText, 10);
      if (isNaN(qNum) || qNum < 1 || qNum > downloads.length) {
        await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', '❗ Invalid quality selection.') }, { quoted: metaQuote });
        return;
      }
      qualityIndex = qNum - 1;
    } catch (err) {
      if (err.message === 'timeout') {
        await socket.sendMessage(from, { text: cineFormat('🎬 TIMEOUT', '⏳ Selection timed out. කරුණාකර නැවත .newmovie command එක ක්‍රියාත්මක කරන්න.') }, { quoted: metaQuote });
        return;
      } else {
        await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Quality selection failed: ${err.message}`) }, { quoted: metaQuote });
        return;
      }
    }

    const chosenDownload = downloads[qualityIndex];
    const rawUrl = chosenDownload.url || chosenDownload.link || chosenDownload.file || '';
    if (!rawUrl) {
      await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', '❗ Download URL missing.') }, { quoted: metaQuote });
      return;
    }

    await socket.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

    // === STREAM-TO-DISK (NO memory caps) + fallback external upload ===
    const resolvedUrl = rawUrl; // direct file link expected from details API

    try {
      // Optional: check free disk space (simple)
      const tmpDir = os.tmpdir();
      // NOTE: os.freemem is system RAM not disk; for production you'd check disk free with a native lib.
      // We'll proceed but you can add better disk-space checks if needed.

      const safeName = `${Date.now()}_${Math.random().toString(36).slice(2,8)}_${(resolvedUrl.split('/').pop() || 'movie.bin').split('?')[0]}`;
      const tmpPath = path.join(tmpDir, safeName);

      // Start streaming download
      const response = await axios.get(resolvedUrl, {
        responseType: 'stream',
        timeout: 0,
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      });

      // Pipe to disk
      await new Promise((resolvePipe, rejectPipe) => {
        const writer = fs.createWriteStream(tmpPath);
        response.data.pipe(writer);
        let errored = false;
        writer.on('error', err => { errored = true; rejectPipe(err); });
        writer.on('finish', () => { if (!errored) resolvePipe(); else rejectPipe(new Error('write error')); });
      });

      // Prepare metadata
      const stats = fs.statSync(tmpPath);
      const fileName = path.basename(tmpPath);
      const mimetype = response.headers['content-type'] || getMimeFromName(fileName);

      // Try sending as a document (stream)
      try {
        await socket.sendMessage(from, {
          document: fs.createReadStream(tmpPath),
          mimetype,
          fileName,
          caption: `Downloaded by ${botName} — Creator: ${creatorName}`
        }, { quoted: metaQuote });

        // cleanup
        try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore cleanup errors */ }
        return;
      } catch (sendErr) {
        console.warn('[NEWMOVIE] direct send failed:', sendErr && sendErr.message ? sendErr.message : sendErr);

        // Fallback: upload to transfer.sh (or other external host) and send link
        try {
          const readStream = fs.createReadStream(tmpPath);
          const uploadUrl = `https://transfer.sh/${encodeURIComponent(fileName)}`;
          // transfer.sh PUT should accept raw stream and return link in response.data
          const uploadResp = await axios.put(uploadUrl, readStream, {
            headers: {
              'Content-Type': mimetype || 'application/octet-stream'
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 0
          });

          const link = (uploadResp && uploadResp.data) ? (typeof uploadResp.data === 'string' ? uploadResp.data.trim() : uploadResp.data) : null;
          if (link) {
            await socket.sendMessage(from, {
              text: cineFormat('🎬 UPLOAD LINK', `🔗 File uploaded externally because direct send failed.\n\nLink: ${link}\n\n(If link expired or upload failed, try another quality or use a different source.)`)
            }, { quoted: metaQuote });
          } else {
            await socket.sendMessage(from, {
              text: cineFormat('🎬 ERROR', '❌ Upload to external host failed and direct send failed as well.')
            }, { quoted: metaQuote });
          }
        } catch (uploadErr) {
          console.error('[NEWMOVIE] external upload also failed:', uploadErr);
          await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Sending failed: ${sendErr.message || sendErr}\nAlso failed to upload externally: ${uploadErr.message || uploadErr}`) }, { quoted: metaQuote });
        } finally {
          try { fs.unlinkSync(tmpPath); } catch(e){ /* ignore */ }
        }
        return;
      }
    } catch (finalErr) {
      console.error('[NEWMOVIE] final download/send error', finalErr);
      await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Download/send failed: ${finalErr.message || finalErr}`) }, { quoted: metaQuote });
      return;
    }

  } catch (error) {
    console.error('[NEWMOVIE] unexpected error', error);
    await socket.sendMessage(from, { text: cineFormat('🎬 ERROR', `❌ Unexpected error: ${error.message || error}`) }, { quoted: metaQuote });
  }

  break;
}


case 'adanews': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = userCfg.botName || BOT_NAME_FANCY;

    const botMention = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADA" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD` } }
    };

    const res = await axios.get('https://saviya-kolla-api.koyeb.app/news/ada');
    if (!res.data?.status || !res.data.result) return await socket.sendMessage(sender, { text: '❌ Failed to fetch Ada News.' }, { quoted: botMention });

    const n = res.data.result;
    const caption = `📰 *${n.title}*\n\n📅 Date: ${n.date}\n⏰ Time: ${n.time}\n\n${n.desc}\n\n🔗 [Read more](${n.url})\n\n_Provided by ${botName}_`;

    await socket.sendMessage(sender, { image: { url: n.image }, caption, contextInfo: { mentionedJid: [sender] } }, { quoted: botMention });

  } catch (err) {
    console.error('adanews error:', err);
    await socket.sendMessage(sender, { text: '❌ Error fetching Ada News.' }, { quoted: botMention });
  }
  break;
}

case 'setsong': {
  try {
    const axios = require('axios');
    const crypto = require('crypto');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath);

    // derive sanitized session id similar to your other handler
    const sanitized = ((typeof number !== 'undefined' ? number : '') || String(sender || '')).toString().replace(/[^0-9]/g, '') || 'session';
    const chatId = sender;
    const subcmdRaw = args[0] || '';
    const subcmd = subcmdRaw.toString().toLowerCase();

    // default categories map
    const CATEGORY_MAP = {
      sin: 'sin',
      sinhala: 'sin',
      eng: 'eng',
      english: 'eng',
      rap: 'rap',
      dj: 'dj'
    };

    // -- storage helpers (persist into user config) --
    async function loadCfg() {
      const cfg = await loadUserConfigFromMongo(sanitized) || {};
      cfg.songSubscriptions = cfg.songSubscriptions || []; // [{ chatId, intervalMinutes, categories:[], nextRun, enabled }]
      cfg.songPool = cfg.songPool || []; // [{ id, title, url, category, thumbnail, addedBy, addedAt }]
      return cfg;
    }
    async function persistCfg(cfg) {
      cfg.songSubscriptions = cfg.songSubscriptions || [];
      cfg.songPool = cfg.songPool || [];
      await setUserConfigInMongo(sanitized, cfg);
    }

    // helpers for pool
    function makeSongId() { return crypto.randomBytes(6).toString('hex'); }
    function normalizeCategories(arr) {
      if (!arr) return ['all'];
      return arr.map(a => (CATEGORY_MAP[a.toString().toLowerCase()] || a.toString().toLowerCase())).filter(Boolean);
    }

    async function addSongToPool(title, url, category = 'all', addedBy = 'unknown') {
      const cfg = await loadCfg();
      const id = makeSongId();
      const thumb = null; // optionally fetch thumbnail later
      cfg.songPool.push({ id, title, url, category, thumbnail: thumb, addedBy, addedAt: Date.now() });
      await persistCfg(cfg);
      return id;
    }

    async function removeSongFromPool(id) {
      const cfg = await loadCfg();
      const before = cfg.songPool.length;
      cfg.songPool = cfg.songPool.filter(s => s.id !== id);
      await persistCfg(cfg);
      return cfg.songPool.length !== before;
    }

    // pick a random song by categories
    async function pickRandomSong(categories = ['all']) {
      const cfg = await loadCfg();
      const pool = cfg.songPool || [];
      let candidates = [];
      if (!pool.length) return null;
      if (categories.includes('all')) candidates = pool.slice();
      else candidates = pool.filter(s => categories.includes(s.category));
      if (!candidates.length) return null;
      const idx = Math.floor(Math.random() * candidates.length);
      return candidates[idx];
    }

    // dispatcher tracking
    if (!global.__sessionSongDispatchers) global.__sessionSongDispatchers = {};

    function ensureSongDispatcherRunning() {
      if (global.__sessionSongDispatchers[sanitized]) return;

      // runtime config
      const TICK_MS = 30 * 1000; // check every 30s
      const INITIAL_DOWNLOAD_TIMEOUT = 60 * 1000; // 60s

      const iv = setInterval(async () => {
        try {
          const cfg = await loadCfg();
          const subs = cfg.songSubscriptions || [];
          const now = Date.now();

          for (let i = 0; i < subs.length; i++) {
            const sub = subs[i];
            if (!sub.enabled) continue;
            if (!sub.nextRun || sub.nextRun <= now) {
              // pick a random category from subscription's categories
              const cats = sub.categories && sub.categories.length ? sub.categories : ['all'];
              // rotate categories randomly
              const chosenCategory = cats[Math.floor(Math.random() * cats.length)];

              const song = await pickRandomSong([chosenCategory].concat(chosenCategory === 'all' ? [] : ['all']));
              if (!song) {
                // nothing to send: schedule next and continue
                sub.nextRun = Date.now() + (sub.intervalMinutes || 15) * 60000;
                continue;
              }

              // attempt download via same API used in csong
              let ytUrl = song.url;
              // if url looks not like youtube, try to treat it as direct downloadable url
              try {
                const apiUrl = `https://sadiya-tech-apis.vercel.app/download/ytdl?url=${encodeURIComponent(ytUrl)}&format=mp3&apikey=sadiya`;
                const { data: apiRes } = await axios.get(apiUrl).catch(() => ({ data: null }));
                if (!apiRes || !apiRes.status || !apiRes.result || !apiRes.result.download) {
                  // failed to fetch; schedule next
                  sub.nextRun = Date.now() + (sub.intervalMinutes || 15) * 60000;
                  continue;
                }

                const downloadUrl = apiRes.result.download;
                // prepare temp files
                const tmpId = crypto.randomBytes(8).toString('hex');
                const tempMp3 = path.join(os.tmpdir(), `setsong_${tmpId}.mp3`);
                const tempOpus = path.join(os.tmpdir(), `setsong_${tmpId}.opus`);

                const resp = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: INITIAL_DOWNLOAD_TIMEOUT }).catch(() => null);
                if (!resp || !resp.data) {
                  sub.nextRun = Date.now() + (sub.intervalMinutes || 15) * 60000;
                } else {
                  fs.writeFileSync(tempMp3, Buffer.from(resp.data));

                  // convert to opus
                  try {
                    await new Promise((resolve, reject) => {
                      ffmpeg(tempMp3)
                        .noVideo()
                        .audioCodec('libopus')
                        .format('opus')
                        .on('end', () => resolve())
                        .on('error', (err) => reject(err))
                        .save(tempOpus);
                    });

                    if (fs.existsSync(tempOpus)) {
                      // send thumbnail/caption then audio as ptt
                      const caption = `🎵 ${song.title}\nCategory: ${song.category}\nAdded by: ${song.addedBy || 'unknown'}`;
                      try {
                        if (song.thumbnail) {
                          await socket.sendMessage(sub.chatId, { image: { url: song.thumbnail }, caption });
                        } else {
                          await socket.sendMessage(sub.chatId, { text: caption });
                        }
                      } catch (e) {
                        console.warn('Failed to send caption to chat', sub.chatId, e?.message || e);
                      }

                      try {
                        const opusBuffer = fs.readFileSync(tempOpus);
                        await socket.sendMessage(sub.chatId, { audio: opusBuffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                      } catch (e) {
                        console.error('Failed to send audio to chat', sub.chatId, e?.message || e);
                      }
                    }
                  } catch (convErr) {
                    console.error('Opus conversion error', convErr);
                  }

                  // cleanup
                  try { if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3); } catch(e){}
                  try { if (fs.existsSync(tempOpus)) fs.unlinkSync(tempOpus); } catch(e){}
                }

                // schedule next run
                sub.nextRun = Date.now() + (sub.intervalMinutes || 15) * 60000;
                await persistCfg(cfg);
              } catch (err) {
                console.error('Error in setsong dispatcher for', sub.chatId, err);
                sub.nextRun = Date.now() + (sub.intervalMinutes || 15) * 60000;
                await persistCfg(cfg);
              }
            }
          }

          // persist subscriptions updates
          await persistCfg(cfg);

          // stop dispatcher if nothing to do
          const remaining = (await loadCfg()).songSubscriptions || [];
          if (!remaining.length) {
            clearInterval(iv);
            delete global.__sessionSongDispatchers[sanitized];
          }
        } catch (topErr) {
          console.error('setsong dispatcher top-level error:', topErr);
        }
      }, TICK_MS);

      global.__sessionSongDispatchers[sanitized] = { intervalId: iv, startedAt: Date.now() };
    }

    // --- Command handling ---
    if (!subcmd) {
      return await socket.sendMessage(chatId, { text: 'Usage: .setsong <minutes|on|off|list|pool|add|remove> [options]' });
    }

    if (subcmd === 'list') {
      const cfg = await loadCfg();
      const subs = cfg.songSubscriptions.filter(s => s.chatId === chatId);
      if (!subs.length) return await socket.sendMessage(chatId, { text: 'No auto-song subscriptions for this chat.' });
      let txt = '*Auto-song subscriptions for this chat:*\n';
      subs.forEach(s => txt += `• every ${s.intervalMinutes} min — categories: ${s.categories.join(', ')} — ${s.enabled ? 'enabled' : 'disabled'}\n`);
      return await socket.sendMessage(chatId, { text: txt });
    }

    if (subcmd === 'off' || subcmd === 'stop' || subcmd === 'disable') {
      const cfg = await loadCfg();
      cfg.songSubscriptions = cfg.songSubscriptions.filter(s => !(s.chatId === chatId));
      await persistCfg(cfg);
      if (global.__sessionSongDispatchers[sanitized]) {
        clearInterval(global.__sessionSongDispatchers[sanitized].intervalId);
        delete global.__sessionSongDispatchers[sanitized];
      }
      return await socket.sendMessage(chatId, { text: '✅ Auto-song disabled for this chat.' });
    }

    if (subcmd === 'on' || subcmd === 'enable') {
      // enable with default interval 15
      const intervalMinutes = 15;
      const cfg = await loadCfg();
      const existsIdx = cfg.songSubscriptions.findIndex(s => s.chatId === chatId);
      const sub = { chatId, intervalMinutes, categories: ['all'], nextRun: Date.now(), enabled: true };
      if (existsIdx >= 0) cfg.songSubscriptions[existsIdx] = { ...cfg.songSubscriptions[existsIdx], ...sub };
      else cfg.songSubscriptions.push(sub);
      await persistCfg(cfg);
      ensureSongDispatcherRunning();
      return await socket.sendMessage(chatId, { text: `✅ Auto-song enabled (every ${intervalMinutes} min, categories: all).` });
    }

    if (/^\d+$/.test(subcmd)) {
      // numeric -> interval minutes
      const intervalMins = parseInt(subcmd, 10);
      const catArg = args[1] || 'all';
      const cats = catArg.split(',').map(s => s.trim().toLowerCase()).map(s => CATEGORY_MAP[s] || s);
      const cfg = await loadCfg();
      const existsIdx = cfg.songSubscriptions.findIndex(s => s.chatId === chatId);
      const sub = { chatId, intervalMinutes: intervalMins, categories: cats, nextRun: Date.now(), enabled: true };
      if (existsIdx >= 0) cfg.songSubscriptions[existsIdx] = { ...cfg.songSubscriptions[existsIdx], ...sub };
      else cfg.songSubscriptions.push(sub);
      await persistCfg(cfg);
      ensureSongDispatcherRunning();
      return await socket.sendMessage(chatId, { text: `✅ Auto-song enabled for this chat every ${intervalMins} minutes. Categories: ${cats.join(', ')}` });
    }

    // Pool management
    if (subcmd === 'add') {
      // .setsong add <category> <title>|<youtubeUrl>
      const categoryArg = args[1] || 'all';
      const rest = args.slice(2).join(' ').trim();
      if (!rest) return await socket.sendMessage(chatId, { text: 'Usage: .setsong add <category> <title>|<youtubeUrl>' });
      // attempt to split title|url if pipe used
      let title = rest;
      let url = rest;
      if (rest.includes('|')) {
        const parts = rest.split('|');
        title = parts[0].trim();
        url = parts[1].trim();
      }
      const id = await addSongToPool(title, url, CATEGORY_MAP[categoryArg.toLowerCase()] || categoryArg.toLowerCase(), sender);
      return await socket.sendMessage(chatId, { text: `✅ Added song to pool (id: ${id}).` });
    }

    if (subcmd === 'remove') {
      const id = args[1];
      if (!id) return await socket.sendMessage(chatId, { text: 'Usage: .setsong remove <songId>' });
      const ok = await removeSongFromPool(id);
      return await socket.sendMessage(chatId, { text: ok ? '✅ Removed song.' : '❌ Song not found.' });
    }

    if (subcmd === 'pool') {
      const cfg = await loadCfg();
      const pool = cfg.songPool || [];
      if (!pool.length) return await socket.sendMessage(chatId, { text: 'Song pool is empty. Use .setsong add to add songs.' });
      let txt = '*Song pool (top 25)*\n';
      pool.slice(0, 25).forEach(s => { txt += `• ${s.id} — ${s.title} — ${s.category} — addedBy: ${s.addedBy}\n`; });
      return await socket.sendMessage(chatId, { text: txt });
    }

    // unknown subcmd
    return await socket.sendMessage(chatId, { text: 'Unknown setsong subcommand. Use: <minutes|on|off|list|pool|add|remove>' });

  } catch (e) {
    console.error('setsong error:', e);
    try { await socket.sendMessage(sender, { text: 'Error processing .setsong. පසුව නැවත උත්සහ කරන්න.' }, { quoted: msg }); } catch (ignore){}
  }
  break;
}

case 'sirasanews': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = userCfg.botName || BOT_NAME_FANCY;

    const botMention = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_SIRASA" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD` } }
    };

    const res = await axios.get('https://saviya-kolla-api.koyeb.app/news/sirasa');
    if (!res.data?.status || !res.data.result) return await socket.sendMessage(sender, { text: '❌ Failed to fetch Sirasa News.' }, { quoted: botMention });

    const n = res.data.result;
    const caption = `📰 *${n.title}*\n\n📅 Date: ${n.date}\n⏰ Time: ${n.time}\n\n${n.desc}\n\n🔗 [Read more](${n.url})\n\n_Provided by ${botName}_`;

    await socket.sendMessage(sender, { image: { url: n.image }, caption, contextInfo: { mentionedJid: [sender] } }, { quoted: botMention });

  } catch (err) {
    console.error('sirasanews error:', err);
    await socket.sendMessage(sender, { text: '❌ Error fetching Sirasa News.' }, { quoted: botMention });
  }
  break;
}
case 'lankadeepanews': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = userCfg.botName || BOT_NAME_FANCY;

    const botMention = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_LANKADEEPA" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD` } }
    };

    const res = await axios.get('https://saviya-kolla-api.koyeb.app/news/lankadeepa');
    if (!res.data?.status || !res.data.result) return await socket.sendMessage(sender, { text: '❌ Failed to fetch Lankadeepa News.' }, { quoted: botMention });

    const n = res.data.result;
    const caption = `📰 *${n.title}*\n\n📅 Date: ${n.date}\n⏰ Time: ${n.time}\n\n${n.desc}\n\n🔗 [Read more](${n.url})\n\n_Provided by ${botName}_`;

    await socket.sendMessage(sender, { image: { url: n.image }, caption, contextInfo: { mentionedJid: [sender] } }, { quoted: botMention });

  } catch (err) {
    console.error('lankadeepanews error:', err);
    await socket.sendMessage(sender, { text: '❌ Error fetching Lankadeepa News.' }, { quoted: botMention });
  }
  break;
}
case 'gagananews': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = userCfg.botName || BOT_NAME_FANCY;

    const botMention = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_GAGANA" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD` } }
    };

    const res = await axios.get('https://saviya-kolla-api.koyeb.app/news/gagana');
    if (!res.data?.status || !res.data.result) return await socket.sendMessage(sender, { text: '❌ Failed to fetch Gagana News.' }, { quoted: botMention });

    const n = res.data.result;
    const caption = `📰 *${n.title}*\n\n📅 Date: ${n.date}\n⏰ Time: ${n.time}\n\n${n.desc}\n\n🔗 [Read more](${n.url})\n\n_Provided by ${botName}_`;

    await socket.sendMessage(sender, { image: { url: n.image }, caption, contextInfo: { mentionedJid: [sender] } }, { quoted: botMention });

  } catch (err) {
    console.error('gagananews error:', err);
    await socket.sendMessage(sender, { text: '❌ Error fetching Gagana News.' }, { quoted: botMention });
  }
  break;
}


//💐💐💐💐💐💐




   
 
        case 'unfollow': {
  const jid = args[0] ? args[0].trim() : null;
  if (!jid) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❗ Provide channel JID to unfollow. Example:\n.unfollow 120363396379901844@newsletter' }, { quoted: shonux });
  }

  const admins = await loadAdminsFromMongo();
  const normalizedAdmins = admins.map(a => (a || '').toString());
  const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');
  const isAdmin = normalizedAdmins.includes(nowsender) || normalizedAdmins.includes(senderNumber) || normalizedAdmins.includes(senderIdSimple);
  if (!(isOwner || isAdmin)) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW2" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { text: '❌ Permission denied. Only owner or admins can remove channels.' }, { quoted: shonux });
  }

  if (!jid.endsWith('@newsletter')) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW3" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { text: '❗ Invalid JID. Must end with @newsletter' }, { quoted: shonux });
  }

  try {
    if (typeof socket.newsletterUnfollow === 'function') {
      await socket.newsletterUnfollow(jid);
    }
    await removeNewsletterFromMongo(jid);

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW4" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Unfollowed and removed from DB: ${jid}` }, { quoted: shonux });
  } catch (e) {
    console.error('unfollow error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW5" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: `❌ Failed to unfollow: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}
case 'tiktok':
case 'ttdl':
case 'tt':
case 'tiktokdl': {
    try {
        // 🔹 Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'CHAMA MINI BOT AI';

        // 🔹 Fake contact for Meta AI mention
        const botMention = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_TT"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const q = text.split(" ").slice(1).join(" ").trim();

        if (!q) {
            await socket.sendMessage(sender, { 
                text: '*🚫 Please provide a TikTok video link.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            }, { quoted: botMention });
            return;
        }

        if (!q.includes("tiktok.com")) {
            await socket.sendMessage(sender, { 
                text: '*🚫 Invalid TikTok link.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            }, { quoted: botMention });
            return;
        }

        await socket.sendMessage(sender, { react: { text: '🎵', key: msg.key } });
        await socket.sendMessage(sender, { text: '*⏳ Downloading TikTok video...*' }, { quoted: botMention });

        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(q)}`;
        const { data } = await axios.get(apiUrl);

        if (!data.status || !data.data) {
            await socket.sendMessage(sender, { 
                text: '*🚩 Failed to fetch TikTok video.*',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            }, { quoted: botMention });
            return;
        }

        const { title, like, comment, share, author, meta } = data.data;
        const videoUrl = meta.media.find(v => v.type === "video").org;

        const titleText = `*${botName} TIKTOK DOWNLOADER*`;
        const content = `┏━━━━━━━━━━━━━━━━\n` +
                        `┃👤 \`User\` : ${author.nickname} (@${author.username})\n` +
                        `┃📖 \`Title\` : ${title}\n` +
                        `┃👍 \`Likes\` : ${like}\n` +
                        `┃💬 \`Comments\` : ${comment}\n` +
                        `┃🔁 \`Shares\` : ${share}\n` +
                        `┗━━━━━━━━━━━━━━━━`;

        const footer = config.BOT_FOOTER || '';
        const captionMessage = formatMessage(titleText, content, footer);

        await socket.sendMessage(sender, {
            video: { url: videoUrl },
            caption: captionMessage,
            contextInfo: { mentionedJid: [sender] },
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 },
                { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: '🤖 BOT INFO' }, type: 1 }
            ]
        }, { quoted: botMention });

    } catch (err) {
        console.error("Error in TikTok downloader:", err);
        await socket.sendMessage(sender, { 
            text: '*❌ Internal Error. Please try again later.*',
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
            ]
        });
    }
    break;
}
case 'xvideo': {
  try {
    // ---------------------------
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = userCfg.botName || BOT_NAME_FANCY;

    const botMention = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_XVIDEO" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    // ---------------------------

    if (!args[0]) return await socket.sendMessage(sender, { text: '*❌ Usage: .xvideo <url/query>*' }, { quoted: botMention });

    let video, isURL = false;
    if (args[0].startsWith('http')) { video = args[0]; isURL = true; } 
    else {
      await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } }, { quoted: botMention });
      const s = await axios.get(`https://saviya-kolla-api.koyeb.app/search/xvideos?query=${encodeURIComponent(args.join(' '))}`);
      if (!s.data?.status || !s.data.result?.length) throw new Error('No results');
      video = s.data.result[0];
    }

    const dlRes = await axios.get(`https://saviya-kolla-api.koyeb.app/download/xvideos?url=${encodeURIComponent(isURL ? video : video.url)}`);
    if (!dlRes.data?.status) throw new Error('Download API failed');

    const dl = dlRes.data.result;

    await socket.sendMessage(sender, {
      video: { url: dl.url },
      caption: `*📹 ${dl.title}*\n\n⏱️ ${isURL ? '' : `Duration: ${video.duration}`}\n👁️ Views: ${dl.views}\n👍 ${dl.likes} | 👎 ${dl.dislikes}\n\n_Provided by ${botName}_`,
      mimetype: 'video/mp4'
    }, { quoted: botMention });

  } catch (err) {
    console.error('xvideo error:', err);
    await socket.sendMessage(sender, { text: '*❌ Failed to fetch video*' }, { quoted: botMention });
  }
  break;
}
case 'xvideo2': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = userCfg.botName || BOT_NAME_FANCY;

    const botMention = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_XVIDEO2" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    if (!args[0]) return await socket.sendMessage(sender, { text: '*❌ Usage: .xvideo2 <url/query>*' }, { quoted: botMention });

    let video = null, isURL = false;
    if (args[0].startsWith('http')) { video = args[0]; isURL = true; } 
    else {
      await socket.sendMessage(sender, { react: { text: '🔍', key: msg.key } }, { quoted: botMention });
      const s = await axios.get(`https://saviya-kolla-api.koyeb.app/search/xvideos?query=${encodeURIComponent(args.join(' '))}`);
      if (!s.data?.status || !s.data.result?.length) throw new Error('No results');
      video = s.data.result[0];
    }

    const dlRes = await axios.get(`https://saviya-kolla-api.koyeb.app/download/xvideos?url=${encodeURIComponent(isURL ? video : video.url)}`);
    if (!dlRes.data?.status) throw new Error('Download API failed');

    const dl = dlRes.data.result;

    await socket.sendMessage(sender, {
      video: { url: dl.url },
      caption: `*📹 ${dl.title}*\n\n⏱️ ${isURL ? '' : `Duration: ${video.duration}`}\n👁️ Views: ${dl.views}\n👍 Likes: ${dl.likes} | 👎 Dislikes: ${dl.dislikes}\n\n_Provided by ${botName}_`,
      mimetype: 'video/mp4'
    }, { quoted: botMention });

  } catch (err) {
    console.error('xvideo2 error:', err);
    await socket.sendMessage(sender, { text: '*❌ Failed to fetch video*' }, { quoted: botMention });
  }
  break;
}
case 'left': {
  try {
    const from = msg.key.remoteJid;
    // Extract full text and remove command prefix
    let text = '';
    if (msg.message?.conversation) text = msg.message.conversation;
    else if (msg.message?.extendedTextMessage?.text) text = msg.message.extendedTextMessage?.text;
    else if (msg.message?.imageMessage?.caption) text = msg.message.imageMessage.caption;
    else if (msg.message?.videoMessage?.caption) text = msg.message.videoMessage.caption;
    const fullText = text.trim();
    // remove leading . or / and the command word
    const rawArgs = fullText.replace(new RegExp(`^(\\.?|\\/)?(left)\\s*`, 'i'), '').trim();

    if (!rawArgs) {
      await socket.sendMessage(from, { text:
        '*Usage:* .left >gjid<,>gjid2<,>gjid3<\n\nExample:\n.left 123456789-123456@g.us, 987654321-987654@g.us'
      }, { quoted: msg });
      break;
    }

    // split by comma, new line or space-but-keep-joined-ids
    const parts = rawArgs
      .replace(/<|>/g, ' ')          // remove angle brackets if any
      .split(/[\n,]+/)               // split by newline or comma
      .map(p => p.trim())
      .filter(p => p.length > 0);

    if (parts.length === 0) {
      await socket.sendMessage(from, { text: '❌ කිසිම valid group id එකක් නොලැබුණා. දරා ඇති format එක පරික්ෂා කරන්න.' }, { quoted: msg });
      break;
    }

    // normalize each part into a group JID if possible
    const candidates = parts.map(p => {
      // ignore common invite links (not supported here)
      if (/chat\.whatsapp\.com/i.test(p) || /^https?:\/\//i.test(p)) return { raw: p, jid: null, reason: 'UNSUPPORTED_LINK' };
      // if already contains @g.us use as-is
      if (/@g\.us$/i.test(p)) return { raw: p, jid: p.replace(/\s+/g, '') };
      // if looks like "123456789-123456" append @g.us
      const onlyDigitsDash = p.replace(/[^\d\-]/g, '');
      if (/^\d+\-\d+$/.test(onlyDigitsDash)) return { raw: p, jid: `${onlyDigitsDash}@g.us` };
      // if looks like numeric (maybe group id without suffix)
      if (/^\d{5,}$/.test(p)) return { raw: p, jid: `${p}@g.us` };
      // otherwise unknown
      return { raw: p, jid: null, reason: 'MALFORMED' };
    });

    // Prepare lists
    const toLeave = candidates.filter(c => c.jid).map(c => c.jid);
    const invalids = candidates.filter(c => !c.jid);

    if (toLeave.length === 0) {
      await socket.sendMessage(from, { text: '❌ කවුරුත් valid group JID එකක් supply කරලා නැහැ. Format එක පරික්ෂාකර නැවත උත්සාහ කරන්න.' }, { quoted: msg });
      break;
    }

    // Inform starting
    await socket.sendMessage(from, { text: `⏳ ${toLeave.length} group(s) සඳහා ඉවත් වීම ආරම්භ කරනවා...` }, { quoted: msg });

    const success = [];
    const failed = [];

    for (const gid of toLeave) {
      try {
        // small delay between operations to avoid throttling
        await sleep(800);
        await socket.groupLeave(gid);
        success.push(gid);
      } catch (err) {
        console.error('[LEFT] leave error for', gid, err);
        failed.push({ gid, error: (err && err.message) ? err.message : String(err) });
      }
    }

    // Build summary (Sinhala)
    let summary = `✅ ඉවත් වූවා: ${success.length}\n`;
    if (success.length > 0) summary += success.map((g, i) => `${i+1}. ${g}`).join('\n') + '\n\n';

    summary += `❌ අසමත් වුනවා: ${failed.length}\n`;
    if (failed.length > 0) summary += failed.map((f, i) => `${i+1}. ${f.gid} — ${f.error}`).join('\n') + '\n\n';

    if (invalids.length > 0) {
      summary += `⚠️ නොසැකසු හැකි entries: ${invalids.length}\n`;
      summary += invalids.map((iv, i) => `${i+1}. ${iv.raw} — ${iv.reason || 'INVALID'}`).join('\n');
    }

    // send summary back to the chat where command was used
    await socket.sendMessage(from, { text: `*Left Summary*\n\n${summary}` }, { quoted: msg });

  } catch (e) {
    console.error('[CASE left bulk] error', e);
    await socket.sendMessage(msg.key.remoteJid, { text: `❌ Error: ${e.message || e}` }, { quoted: msg });
  }
  break;
}


case 'setnews': {
  try {
    const crypto = require('crypto');
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const chatId = sender; // chat/group/channel id
    const subcmdRaw = args[0] || '';
    const subcmd = subcmdRaw.toString().toLowerCase();

    // --- news sources (edit / extend as needed) ---
    const newsSources = {
      adanews: { key: 'adanews', name: 'Ada News', api: 'https://saviya-kolla-api.koyeb.app/news/ada' },
      sirasanews: { key: 'sirasanews', name: 'Sirasa News', api: 'https://saviya-kolla-api.koyeb.app/news/sirasa' },
derananews: { key: 'derana', name: 'Derana News', api: 'https://tharuzz-news-api.vercel.app/api/news/derana' },
hirunews: { key: 'hirunews', name: 'Hiru News', api: 'https://tharuzz-news-api.vercel.app/api/news/hiru' },
      lankadeepanews: { key: 'lankadeepanews', name: 'Lankadeepa', api: 'https://saviya-kolla-api.koyeb.app/news/lankadeepa' },
      gagananews: { key: 'gagananews', name: 'Gagana', api: 'https://saviya-kolla-api.koyeb.app/news/gagana' }
    };

    // --- small in-case helpers (fully local to this block) ---
    async function loadCfg() {
      const cfg = await loadUserConfigFromMongo(sanitized) || {};
      cfg.newsSubscriptions = cfg.newsSubscriptions || [];
      // sentNews stores history of sent items to prevent duplicates:
      // [{ chatId, source, id, hash, sentAt }]
      cfg.sentNews = cfg.sentNews || [];
      return cfg;
    }
    async function persistCfg(cfg) {
      cfg.newsSubscriptions = cfg.newsSubscriptions || [];
      cfg.sentNews = cfg.sentNews || [];
      await setUserConfigInMongo(sanitized, cfg);
    }

    // create stable uid for item
    function deriveUid(n) {
      if (!n) return null;
      if (n.url) return n.url;
      if (n.id) return String(n.id);
      if (n.title) return `${n.title}||${n.date||''}||${n.time||''}`;
      return null;
    }

    // create content hash to detect updates
    function contentHashFor(n) {
      const str = JSON.stringify({
        title: n.title || '',
        desc: n.desc || n.summary || '',
        image: n.image || '',
        date: n.date || '',
        time: n.time || ''
      });
      return crypto.createHash('sha256').update(str).digest('hex');
    }

    // Helper: check whether item already sent; returns object { found, updated }
    function checkSent(cfg, chatIdLocal, sourceKey, itemId) {
      if (!itemId) return { found: false, entry: null };
      const entry = (cfg.sentNews || []).find(e => e.chatId === chatIdLocal && e.source === sourceKey && e.id === itemId);
      return { found: Boolean(entry), entry: entry || null };
    }

    // record (or update) sent item (and trim history to limit)
    function recordSent(cfg, chatIdLocal, sourceKey, itemId, hash) {
      if (!itemId) return;
      cfg.sentNews = cfg.sentNews || [];
      const idx = cfg.sentNews.findIndex(e => e.chatId === chatIdLocal && e.source === sourceKey && e.id === itemId);
      const now = Date.now();
      if (idx >= 0) {
        cfg.sentNews[idx].hash = hash;
        cfg.sentNews[idx].sentAt = now;
      } else {
        cfg.sentNews.push({ chatId: chatIdLocal, source: sourceKey, id: itemId, hash, sentAt: now });
      }
      // keep history bounded
      const MAX_HISTORY = 1000;
      if (cfg.sentNews.length > MAX_HISTORY) {
        cfg.sentNews = cfg.sentNews.slice(cfg.sentNews.length - MAX_HISTORY);
      }
    }

    // --- Add/Remove/List subscriptions (same as before) ---
    async function addNewsSubscription(chatIdLocal, sourceKey, intervalMinutes = 15) {
      if (!newsSources[sourceKey]) throw new Error('Unknown source: ' + sourceKey);
      const cfg = await loadCfg();
      const existsIdx = cfg.newsSubscriptions.findIndex(s => s.chatId === chatIdLocal && s.source === sourceKey);
      const now = Date.now();
      // immediate first-run so user sees news quickly
      const sub = { chatId: chatIdLocal, source: sourceKey, intervalMinutes, nextRun: now, enabled: true };
      if (existsIdx >= 0) {
        cfg.newsSubscriptions[existsIdx] = { ...cfg.newsSubscriptions[existsIdx], ...sub };
      } else {
        cfg.newsSubscriptions.push(sub);
      }
      await persistCfg(cfg);
      return cfg.newsSubscriptions;
    }

    async function removeNewsSubscription(chatIdLocal, sourceKey = null) {
      const cfg = await loadCfg();
      if (!sourceKey) cfg.newsSubscriptions = cfg.newsSubscriptions.filter(s => s.chatId !== chatIdLocal);
      else cfg.newsSubscriptions = cfg.newsSubscriptions.filter(s => !(s.chatId === chatIdLocal && s.source === sourceKey));
      await persistCfg(cfg);
      return cfg.newsSubscriptions;
    }

    async function listNewsSubscriptionsForChat(chatIdLocal) {
      const cfg = await loadCfg();
      return cfg.newsSubscriptions.filter(s => s.chatId === chatIdLocal);
    }

    // --- dispatcher (one-per-session) inside this block but global-tracked to avoid duplicates ---
    if (!global.__sessionNewsDispatchers) global.__sessionNewsDispatchers = {}; // global map

    function ensureDispatcherRunning() {
      if (global.__sessionNewsDispatchers[sanitized]) return; // already running for this session
      // start interval
      const iv = setInterval(async () => {
        try {
          const cfg = await loadCfg();
          const subs = cfg.newsSubscriptions || [];
          const now = Date.now();

          for (let i = 0; i < subs.length; i++) {
            const sub = subs[i];
            if (!sub.enabled) continue;
            if (!sub.nextRun || sub.nextRun <= now) {
              const src = newsSources[sub.source];
              if (!src) {
                console.warn('Unknown source in subscription, skipping:', sub.source);
                sub.nextRun = Date.now() + (sub.intervalMinutes || 15) * 60000;
                continue;
              }

              try {
                const res = await axios.get(src.api, { timeout: 10000 });
                if (!res.data || !res.data.status || !res.data.result) {
                  console.warn('No valid data from news API for', sub.source);
                  sub.nextRun = Date.now() + (sub.intervalMinutes || 15) * 60000;
                  continue;
                }

                const results = Array.isArray(res.data.result) ? res.data.result : [res.data.result];

                // For each candidate news item, check dedupe then send if new or updated
                for (let ri = 0; ri < results.length; ri++) {
                  const n = results[ri];
                  const uid = deriveUid(n);
                  if (!uid) continue;

                  // reload fresh cfg to check latest sentNews (avoid race)
                  const freshCfg = await loadCfg();
                  const existing = checkSent(freshCfg, sub.chatId, sub.source, uid);
                  const newHash = contentHashFor(n);

                  if (!existing.found) {
                    // NEW item -> send normally
                    const caption = `📰 *${n.title || 'No title'}*\n\n📅 ${n.date || ''} ${n.time || ''}\n\n${n.desc || ''}\n\n🔗 ${n.url || ''}\n\n_Provided by ${freshCfg.botName || (typeof BOT_NAME_FANCY !== 'undefined' ? BOT_NAME_FANCY : 'Bot')}_`;
                    try {
                      if (n.image) {
                        await socket.sendMessage(sub.chatId, { image: { url: n.image }, caption });
                      } else {
                        await socket.sendMessage(sub.chatId, { text: caption });
                      }
                      // record as sent (persist)
                      recordSent(freshCfg, sub.chatId, sub.source, uid, newHash);
                      await persistCfg(freshCfg);
                    } catch (sendErr) {
                      console.error('Failed to send news message to', sub.chatId, sendErr);
                    }
                  } else {
                    // Already sent before: check if hash changed (i.e., updated content)
                    const prevHash = existing.entry.hash || null;
                    if (prevHash && prevHash !== newHash) {
                      // content updated -> send UPDATE message
                      const caption = `🔄 *UPDATE* — ${n.title || 'No title'}\n\n📅 ${n.date || ''} ${n.time || ''}\n\n${n.desc || ''}\n\n🔗 ${n.url || ''}\n\n_Provided by ${freshCfg.botName || (typeof BOT_NAME_FANCY !== 'undefined' ? BOT_NAME_FANCY : 'Bot')}_`;
                      try {
                        if (n.image) {
                          await socket.sendMessage(sub.chatId, { image: { url: n.image }, caption });
                        } else {
                          await socket.sendMessage(sub.chatId, { text: caption });
                        }
                        // update recorded hash & sentAt
                        recordSent(freshCfg, sub.chatId, sub.source, uid, newHash);
                        await persistCfg(freshCfg);
                      } catch (sendErr) {
                        console.error('Failed to send UPDATE message to', sub.chatId, sendErr);
                      }
                    } else {
                      // same item, not updated -> skip
                      // console.log('Skipping already-sent news for', sub.chatId, sub.source, uid);
                      continue;
                    }
                  }
                }

                // schedule next run (after processing all items)
                sub.nextRun = Date.now() + (sub.intervalMinutes || 15) * 60000;
              } catch (fetchErr) {
                console.error('Error fetching news for', sub.source, fetchErr);
                sub.nextRun = Date.now() + (sub.intervalMinutes || 15) * 60000;
              }
            }
          }
          // persist any nextRun updates
          cfg.newsSubscriptions = subs;
          await persistCfg(cfg);

          // if no subscriptions left for this session, stop dispatcher to save resources
          const remaining = (await loadCfg()).newsSubscriptions || [];
          if (!remaining.length) {
            clearInterval(iv);
            delete global.__sessionNewsDispatchers[sanitized];
          }
        } catch (topErr) {
          console.error('News dispatcher top-level error:', topErr);
        }
      }, 60 * 1000); // checks every 60s

      global.__sessionNewsDispatchers[sanitized] = { intervalId: iv, startedAt: Date.now() };
    }

    // --- command handling inside single case ---
    if (!subcmd) {
      const keys = Object.keys(newsSources).join(', ');
      return await socket.sendMessage(chatId, { text: `❗ Usage:\n• .setnews <sourceKey> [intervalMinutes]\n• .setnews del [sourceKey]\n• .setnews list\n• .setnews [minutes]  -> enable ALL sources (e.g. .setnews 15)\n\nAvailable sources: ${keys}` });
    }

    // list
    if (subcmd === 'list') {
      const subs = await listNewsSubscriptionsForChat(chatId);
      if (!subs.length) {
        return await socket.sendMessage(chatId, { text: 'ℹ️ No auto-news subscriptions for this chat.' });
      }
      let txt = '*Auto-news subscriptions for this chat:*\n\n';
      subs.forEach(s => {
        txt += `• ${s.source} (${newsSources[s.source]?.name || 'Unknown'}) — every ${s.intervalMinutes} min — ${s.enabled ? 'enabled' : 'disabled'}\n`;
      });
      return await socket.sendMessage(chatId, { text: txt });
    }

    // delete/remove
    if (subcmd === 'del' || subcmd === 'remove' || subcmd === 'off') {
      const targetSource = args[1] ? args[1].toString().toLowerCase() : null;
      await removeNewsSubscription(chatId, targetSource);
      const cfgAfter = await loadCfg();
      if (!cfgAfter.newsSubscriptions.length && global.__sessionNewsDispatchers[sanitized]) {
        clearInterval(global.__sessionNewsDispatchers[sanitized].intervalId);
        delete global.__sessionNewsDispatchers[sanitized];
      }
      if (targetSource) {
        return await socket.sendMessage(chatId, { text: `✅ Removed news source *${targetSource}* from this chat.` });
      } else {
        return await socket.sendMessage(chatId, { text: `✅ Removed all auto-news subscriptions from this chat.` });
      }
    }

    // if the first arg is purely numeric -> treat as interval and enable ALL sources
    if (/^\d+$/.test(subcmd)) {
      const intervalMins = parseInt(subcmd, 10);
      if (isNaN(intervalMins) || intervalMins < 1) {
        return await socket.sendMessage(chatId, { text: '❗ Invalid interval. Provide minutes as a number (>=1).' });
      }

      const keys = Object.keys(newsSources);
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        try {
          await addNewsSubscription(chatId, key, intervalMins);
        } catch (err) {
          console.warn('Failed to add subscription for', key, err);
        }
      }

      // ensure dispatcher is running for this session
      ensureDispatcherRunning();

      return await socket.sendMessage(chatId, { text: `✅ Auto-news enabled for *all sources* (${keys.join(', ')}) every *${intervalMins}* minutes.` });
    }

    // otherwise treat subcmd as a sourceKey to add
    const sourceKey = subcmd;
    const intervalArg = args[1];
    const intervalMins = intervalArg ? parseInt(intervalArg, 10) : 15;
    if (!newsSources[sourceKey]) {
      const keys = Object.keys(newsSources).join(', ');
      return await socket.sendMessage(chatId, { text: `❗ Unknown source. Available sources: ${keys}\nExample: .setnews adanews 30` });
    }
    if (isNaN(intervalMins) || intervalMins < 1) {
      return await socket.sendMessage(chatId, { text: '❗ Invalid interval. Provide minutes as a number (>=1).' });
    }

    // add subscription and ensure dispatcher
    await addNewsSubscription(chatId, sourceKey, intervalMins);
    ensureDispatcherRunning();

    return await socket.sendMessage(chatId, { text: `✅ Auto-news enabled for *${newsSources[sourceKey].name}* in this chat every *${intervalMins}* minutes.` });
  } catch (e) {
    console.error('setnews (single-block) error:', e);
    try {
      await socket.sendMessage(sender, { text: `❌ Failed to process .setnews: ${e.message || e}` });
    } catch (ignore) {}
  }
  break;
}

case 'gdp': {
  try {
    // helper delay (if you already have one in your project you can remove this)
    const delay = (ms) => new Promise(res => setTimeout(res, ms));

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;
    const logo = cfg.logo || config.RCD_IMAGE_PATH;

    const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');

    // get the argument (number or group JID)
    let q = msg.message?.conversation?.split(" ")[1] ||
            msg.message?.extendedTextMessage?.text?.split(" ")[1];

    if (!q) return await socket.sendMessage(sender, { text: "❌ Please provide a number or group JID.\n\nUsage:\n.getdp <number>\n.getdp <groupJID@g.us>" });

    // build metaQuote for consistent quoted message
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_GETDP" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    // If argument looks like a group JID (endsWith @g.us) -> fetch all members' DPs
    if (q.endsWith('@g.us')) {
      const groupJid = q;
      let groupMetadata;
      try {
        groupMetadata = await socket.groupMetadata(groupJid);
      } catch (err) {
        return await socket.sendMessage(sender, { text: "❌ Invalid group JID or bot is not in that group." }, { quoted: msg });
      }

      const { participants, subject } = groupMetadata;
      await socket.sendMessage(sender, { text: `🔎 Fetching profile pictures for *${subject}* (${participants.length} members)...` }, { quoted: msg });

      let idx = 1;
      for (const participant of participants) {
        const pid = participant.id; // e.g., 9477xxxxxxx@s.whatsapp.net OR 9477xxxxxxx@g.us for devices
        // normalize to user JID (ensure @s.whatsapp.net for direct profilePictureUrl)
        const userJid = pid.includes('@s.whatsapp.net') || pid.includes('@c.us') ? pid : pid.split('@')[0] + '@s.whatsapp.net';

        let ppUrl;
        try {
          ppUrl = await socket.profilePictureUrl(userJid, "image");
        } catch {
          ppUrl = "https://telegra.ph/file/4cc2712eaba1c5c1488d3.jpg"; // default fallback
        }

        // Build caption — show index + sanitized group subject + number (no personal names to respect privacy)
        const sanitizedSubject = (subject || 'Group').replace(/[\r\n]+/g, ' ').trim();
        const memberNumber = userJid.split('@')[0];
        const caption = `🖼 *${sanitizedSubject}* — Member ${idx}\n📞 +${memberNumber}\nFetched by: ${botName}`;

        try {
          // send each image as a separate message (quoted with metaQuote)
          await socket.sendMessage(sender, {
            image: { url: ppUrl },
            caption,
            footer: `📌 ${botName} GETDP`,
            buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 }],
            headerType: 4
          }, { quoted: metaQuote });
        } catch (sendErr) {
          console.warn(`Failed to send DP for ${userJid}:`, sendErr);
          // if sending image failed, send a text fallback with the URL
          try {
            await socket.sendMessage(sender, { text: `⚠️ Could not send image for +${memberNumber}. URL: ${ppUrl}` }, { quoted: metaQuote });
          } catch (e) {
            console.warn('fallback send failed', e);
          }
        }

        idx++;
        // small delay to avoid hitting rate limits (adjust if needed)
        await delay(700);
      }

      // final summary
      await socket.sendMessage(sender, { text: `✅ Completed. Sent DPs for ${participants.length} members of *${subject}*.` }, { quoted: msg });
      return;
    }

    // otherwise treat as single number (original behavior)
    let jid = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
    let ppUrl;
    try {
      ppUrl = await socket.profilePictureUrl(jid, "image");
    } catch {
      ppUrl = "https://telegra.ph/file/4cc2712eaba1c5c1488d3.jpg";
    }

    await socket.sendMessage(sender, {
      image: { url: ppUrl },
      caption: `🖼 *Profile Picture of* +${q}\nFetched by: ${botName}`,
      footer: `📌 ${botName} GETDP`,
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 }],
      headerType: 4
    }, { quoted: metaQuote });

  } catch (e) {
    console.log("❌ getdp error:", e);
    await socket.sendMessage(sender, { text: "⚠️ Error: Could not fetch profile pictures." });
  }
  break;
}

case 'savecontact':
case 'gvcf2':
case 'scontact':
case 'savecontacts': {
  try {
    const text = args.join(" ").trim();

    if (!text) {
      return await socket.sendMessage(sender, {
        text: "📌 *Usage:* .savecontact <group JID>\n📥 Example: .savecontact 9477xxxxxxx-123@g.us"
      }, { quoted: msg });
    }

    const groupJid = text.trim();

    if (!groupJid.endsWith('@g.us')) {
      return await socket.sendMessage(sender, {
        text: "❌ *Invalid group JID*. Must end with @g.us"
      }, { quoted: msg });
    }

    let groupMetadata;
    try {
      groupMetadata = await socket.groupMetadata(groupJid);
    } catch {
      return await socket.sendMessage(sender, {
        text: "❌ *Invalid group JID* or bot not in that group.*"
      }, { quoted: msg });
    }

    const { participants, subject } = groupMetadata;
    let vcard = '';
    let index = 1;

    await socket.sendMessage(sender, {
      text: `🔎 Fetching contact names from *${subject}*...`
    }, { quoted: msg });

    // sanitize group subject for safe use in vCard FN (remove newlines & control chars)
    const sanitizedSubjectForFN = (subject || 'Group').replace(/[\r\n]+/g, ' ').trim();

    for (const participant of participants) {
      const num = participant.id.split('@')[0];
      // Instead of using participant's real name, build name as: "<GroupName> <index>"
      const contactName = `${sanitizedSubjectForFN} ${index}`;

      // Build vCard entry
      vcard += `BEGIN:VCARD\n`;
      vcard += `VERSION:3.0\n`;
      vcard += `FN:${contactName}\n`; // <-- group name + index used here
      vcard += `TEL;type=CELL;type=VOICE;waid=${num}:+${num}\n`;
      vcard += `END:VCARD\n`;
      index++;
    }

    const safeSubject = (subject || 'group').replace(/[^\w\s]/gi, "_");
    const tmpDir = path.join(os.tmpdir(), `contacts_${Date.now()}`);
    fs.ensureDirSync(tmpDir);

    const filePath = path.join(tmpDir, `contacts-${safeSubject}.vcf`);
    fs.writeFileSync(filePath, vcard.trim());

    await socket.sendMessage(sender, {
      text: `📁 *${participants.length}* contacts found in group *${subject}*.\n💾 Preparing VCF file...`
    }, { quoted: msg });

    await delay(1500);

    await socket.sendMessage(sender, {
      document: fs.readFileSync(filePath),
      mimetype: 'text/vcard',
      fileName: `contacts-${safeSubject}.vcf`,
      caption: `✅ *Contacts Exported Successfully!*\n👥 Group: *${subject}*\n?? Total Contacts: *${participants.length}*\n\n> ᴘᴏᴡᴇʀᴇᴅ ʙʏ 𝙲𝙷𝙼𝙰 𝙼𝙳`
    }, { quoted: msg });

    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (cleanupError) {
      console.warn('Failed to cleanup temp file:', cleanupError);
    }

  } catch (err) {
    console.error('Save contact error:', err);
    await socket.sendMessage(sender, {
      text: `❌ Error: ${err.message || err}`
    }, { quoted: msg });
  }
  break;
}


case 'xnxx':
case 'xnxxvideo': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = userCfg.botName || BOT_NAME_FANCY;

    const botMention = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_XNXX" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    if (!Array.isArray(config.PREMIUM) || !config.PREMIUM.includes(senderNumber)) 
      return await socket.sendMessage(sender, { text: '❗ This command is for Premium users only.' }, { quoted: botMention });

    if (!text) return await socket.sendMessage(sender, { text: '❌ Provide a search name. Example: .xnxx <name>' }, { quoted: botMention });

    await socket.sendMessage(from, { react: { text: "🎥", key: msg.key } }, { quoted: botMention });

    const res = await axios.get(`https://api.genux.me/api/download/xnxx-download?query=${encodeURIComponent(text)}&apikey=GENUX-SANDARUX`);
    const d = res.data?.result;
    if (!d || !d.files) return await socket.sendMessage(sender, { text: '❌ No results.' }, { quoted: botMention });

    await socket.sendMessage(from, { image: { url: d.image }, caption: `💬 *Title*: ${d.title}\n👀 *Duration*: ${d.duration}\n🗯 *Desc*: ${d.description}\n💦 *Tags*: ${d.tags || ''}` }, { quoted: botMention });

    await socket.sendMessage(from, { video: { url: d.files.high, fileName: d.title + ".mp4", mimetype: "video/mp4", caption: "*Done ✅*" } }, { quoted: botMention });

    await socket.sendMessage(from, { text: "*Uploaded ✅*" }, { quoted: botMention });

  } catch (err) {
    console.error('xnxx error:', err);
    await socket.sendMessage(sender, { text: "❌ Error fetching video." }, { quoted: botMention });
  }
  break;
}
case 'gjid':
case 'groupjid':
case 'grouplist': {
  try {
    // ✅ Owner check removed — now everyone can use it!

    await socket.sendMessage(sender, { 
      react: { text: "📝", key: msg.key } 
    });

    await socket.sendMessage(sender, { 
      text: "📝 Fetching group list..." 
    }, { quoted: msg });

    const groups = await socket.groupFetchAllParticipating();
    const groupArray = Object.values(groups);
    
    // Sort by creation time (oldest to newest)
    groupArray.sort((a, b) => a.creation - b.creation);

    if (groupArray.length === 0) {
      return await socket.sendMessage(sender, { 
        text: "❌ No groups found!" 
      }, { quoted: msg });
    }

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY || "CHMA MD";

    // ✅ Pagination setup — 10 groups per message
    const groupsPerPage = 10;
    const totalPages = Math.ceil(groupArray.length / groupsPerPage);

    for (let page = 0; page < totalPages; page++) {
      const start = page * groupsPerPage;
      const end = start + groupsPerPage;
      const pageGroups = groupArray.slice(start, end);

      // ✅ Build message for this page
      const groupList = pageGroups.map((group, index) => {
        const globalIndex = start + index + 1;
        const memberCount = group.participants ? group.participants.length : 'N/A';
        const subject = group.subject || 'Unnamed Group';
        const jid = group.id;
        return `*${globalIndex}. ${subject}*\n👥 Members: ${memberCount}\n🆔 ${jid}`;
      }).join('\n\n');

      const textMsg = `📝 *Group List - ${botName}*\n\n📄 Page ${page + 1}/${totalPages}\n👥 Total Groups: ${groupArray.length}\n\n${groupList}`;

      await socket.sendMessage(sender, {
        text: textMsg,
        footer: `🤖 Powered by ${botName}`
      });

      // Add short delay to avoid spam
      if (page < totalPages - 1) {
        await delay(1000);
      }
    }

  } catch (err) {
    console.error('GJID command error:', err);
    await socket.sendMessage(sender, { 
      text: "❌ Failed to fetch group list. Please try again later." 
    }, { quoted: msg });
  }
  break;
}
case 'hidetag':
case 'tag':
case 'h': {
  try {
    const from = msg.key.remoteJid;
    const isGroup = (from || '').endsWith('@g.us');
    if (!isGroup) {
      await socket.sendMessage(from, { text: '❌ This command can only be used in groups.' }, { quoted: msg });
      break;
    }

    // derive botName meta
    const senderIdRaw = (msg.key.participant || msg.key.remoteJid || '') + '';
    const sanitized = (senderIdRaw.split('@')[0] || '').replace(/[^0-9]/g, '');
    const cfg = await (typeof loadUserConfigFromMongo === 'function' ? loadUserConfigFromMongo(sanitized) : Promise.resolve({}));
    const botName = (cfg && cfg.botName) ? cfg.botName : (typeof BOT_NAME_FANCY !== 'undefined' ? BOT_NAME_FANCY : 'Bot');

    const metaQuote = {
      key: { remoteJid: 'status@broadcast', participant: '0@s.whatsapp.net', fromMe: false, id: 'META_AI_HIDETAG' },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`
        }
      }
    };

    // fetch metadata to get participants
    let groupInfo;
    try {
      groupInfo = await socket.groupMetadata(from);
    } catch (err) {
      console.warn('[HIDETAG] groupMetadata failed', err);
      groupInfo = null;
    }
    if (!groupInfo) {
      await socket.sendMessage(from, { text: '❌ Failed to fetch group information.' }, { quoted: msg });
      break;
    }

    // participants list normalized to JIDs
    const participants = (groupInfo.participants || []).map(p => {
      return (p.id?.user ? `${p.id.user}@s.whatsapp.net` : (p.id || p.jid || '')).toString();
    }).filter(Boolean);

    if (!participants || participants.length === 0) {
      await socket.sendMessage(from, { text: '❌ No participants found.' }, { quoted: msg });
      break;
    }

    // mentions payload (we will attach metaQuote when sending)
    const mentionAll = { mentions: participants };

    // extract command text / arg
    let text = '';
    if (msg.message?.conversation) text = msg.message.conversation;
    else if (msg.message?.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
    else if (msg.message?.imageMessage?.caption) text = msg.message.imageMessage.caption;
    else if (msg.message?.videoMessage?.caption) text = msg.message.videoMessage.caption;
    text = (text || '').trim();
    const rawArgs = text.replace(/^(?:\.|\/)??(?:hidetag|tag|h)\s*/i, '').trim();
    const q = rawArgs;

    // helper to detect url
    const isUrl = (u) => /https?:\/\/(www\.)?[\w\-@:%._\\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([\w\-@:%_\\+.~#?&//=]*)/.test(u);

    // if quoted message exists -> forward quoted content with mentions
    const quotedCtx = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = quotedCtx?.quotedMessage || null;

    if (!q && !quoted) {
      await socket.sendMessage(from, { text: '❌ Please provide a message or reply to a message to tag all members.' }, { quoted: msg });
      break;
    }

    // If quoted -> handle different media types
    if (quoted) {
      // Determine type
      const type = Object.keys(quoted)[0] || 'extendedTextMessage';

      // Text quoted
      if (type === 'conversation' || type === 'extendedTextMessage') {
        const quotedText = quoted.conversation || quoted.extendedTextMessage?.text || 'No message content found.';
        await socket.sendMessage(from, { text: quotedText, ...mentionAll }, { quoted: metaQuote });
        break;
      }

      // Media quoted types (image, video, audio, document, sticker)
      if (type === 'imageMessage' || type === 'videoMessage' || type === 'audioMessage' || type === 'stickerMessage' || type === 'documentMessage') {
        try {
          // try to download buffer from quoted using possible methods
          let buffer = null;
          try {
            if (typeof quoted.download === 'function') buffer = await quoted.download();
          } catch (e) { /* ignore */ }

          // fallback to socket.downloadContentFromMessage if available
          if (!buffer && socket && typeof socket.downloadContentFromMessage === 'function') {
            const stream = await socket.downloadContentFromMessage(quoted, type.replace('Message','').toLowerCase());
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            if (chunks.length) buffer = Buffer.concat(chunks);
          }

          if (!buffer) {
            await socket.sendMessage(from, { text: '❌ Failed to download the quoted media. Sending as text instead.', ...mentionAll }, { quoted: metaQuote });
            break;
          }

          // assemble content based on type
          let content = {};
          if (type === 'imageMessage') content = { image: buffer, caption: quoted.imageMessage?.caption || '', ...mentionAll };
          else if (type === 'videoMessage') content = { video: buffer, caption: quoted.videoMessage?.caption || '', gifPlayback: quoted.videoMessage?.gifPlayback || false, ...mentionAll };
          else if (type === 'audioMessage') content = { audio: buffer, mimetype: 'audio/mp4', ptt: quoted.audioMessage?.ptt || false, ...mentionAll };
          else if (type === 'stickerMessage') content = { sticker: buffer, ...mentionAll };
          else if (type === 'documentMessage') content = {
            document: buffer,
            mimetype: quoted.documentMessage?.mimetype || 'application/octet-stream',
            fileName: quoted.documentMessage?.fileName || 'file',
            caption: quoted.documentMessage?.fileName ? (quoted.documentMessage?.fileName) : '',
            ...mentionAll
          };

          // send media / forward with meta-quote so botName is shown
          await socket.sendMessage(from, content, { quoted: metaQuote });
          break;
        } catch (e) {
          console.error('[HIDETAG] media forward error', e);
          await socket.sendMessage(from, { text: '❌ Failed to process the media. Sending as text instead.', ...mentionAll }, { quoted: metaQuote });
          break;
        }
      }

      // default fallback
      await socket.sendMessage(from, { text: quoted.conversation || '📨 Message', ...mentionAll }, { quoted: metaQuote });
      break;
    }

    // if no quoted and q present -> send text (or raw url)
    if (q) {
      if (isUrl(q)) {
        await socket.sendMessage(from, { text: q, ...mentionAll }, { quoted: metaQuote });
      } else {
        await socket.sendMessage(from, { text: q, ...mentionAll }, { quoted: metaQuote });
      }
    }

  } catch (e) {
    console.error('[CASE hidetag] Error:', e);
    await socket.sendMessage(msg.key.remoteJid, { text: `❌ *Error Occurred !!*\n\n${e.message || e}` }, { quoted: msg });
  }
  break;
}
case 'tagadmins': {
  try {
    const from = msg.key.remoteJid;
    const isGroup = (from || '').endsWith('@g.us');
    if (!isGroup) {
      await socket.sendMessage(from, { text: '❌ This command can only be used in groups.' }, { quoted: msg });
      break;
    }

    // derive botName meta
    const senderIdRaw = (msg.key.participant || msg.key.remoteJid || '') + '';
    const sanitized = (senderIdRaw.split('@')[0] || '').replace(/[^0-9]/g, '');
    const cfg = await (typeof loadUserConfigFromMongo === 'function' ? loadUserConfigFromMongo(sanitized) : Promise.resolve({}));
    const botName = (cfg && cfg.botName) ? cfg.botName : (typeof BOT_NAME_FANCY !== 'undefined' ? BOT_NAME_FANCY : 'Bot');

    const metaQuote = {
      key: { remoteJid: 'status@broadcast', participant: '0@s.whatsapp.net', fromMe: false, id: 'META_AI_TAGADMINS' },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`
        }
      }
    };

    // fetch metadata
    let groupInfo;
    try {
      groupInfo = await socket.groupMetadata(from);
    } catch (err) {
      console.warn('[TAGADMINS] groupMetadata failed', err);
      groupInfo = null;
    }
    if (!groupInfo) {
      await socket.sendMessage(from, { text: '❌ Failed to fetch group information.' }, { quoted: msg });
      break;
    }

    // participants array from metadata
    const participants = (groupInfo.participants || []).map(p => {
      const id = p.id?.user ? `${p.id.user}@s.whatsapp.net` : (p.id || p.jid || '');
      const jid = id || (typeof p === 'string' ? p : '');
      return { id: jid };
    });

    // determine admins
    let admins = [];
    if (typeof getGroupAdmins === 'function') {
      admins = getGroupAdmins(participants.map(p => p.id || p));
    } else {
      admins = (groupInfo.participants || []).filter(p => p.isAdmin || p.admin === 'admin' || p.admin === true).map(p => p.id || p.jid || p);
      admins = admins.map(a => (typeof a === 'object' ? (a.id || a.jid || '') : a)).filter(Boolean);
    }

    // normalize admins to full JIDs
    admins = admins.map(a => {
      if (typeof a === 'string') return a.includes('@') ? a : `${a}@s.whatsapp.net`;
      return (a.id || a.jid || '').toString();
    }).filter(Boolean);

    if (!admins || admins.length === 0) {
      await socket.sendMessage(from, { text: '❌ No admins found in this group.' }, { quoted: msg });
      break;
    }

    // extract message after command
    let text = '';
    if (msg.message?.conversation) text = msg.message.conversation;
    else if (msg.message?.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
    else if (msg.message?.imageMessage?.caption) text = msg.message.imageMessage.caption;
    else if (msg.message?.videoMessage?.caption) text = msg.message.videoMessage.caption;
    text = (text || '').trim();
    const rawArgs = text.replace(new RegExp(`^(\\.?)(tagadmins|gc_tagadmins)\\s*`, 'i'), '').trim();
    let customMsg = rawArgs || 'Attention Admins';

    // random emoji for style
    const emojis = ['👑','⚡','🌟','✨','🎖️','💎','🔱','🛡️','🚀','🏆'];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

    // build text
    let adminText = `▢ Group : *${groupInfo.subject || 'Unknown Group'}*\n▢ Admins : *${admins.length}*\n▢ Message: *${customMsg}*\n\n┌───⊷ *ADMIN MENTIONS*\n`;
    admins.forEach(a => {
      const short = (a.split('@')[0] || a);
      adminText += `${randomEmoji} @${short}\n`;
    });
    adminText += `└──✪ ${botName} ✪──`;

    // ensure mentions array is full JIDs
    const mentions = admins.map(a => a.includes('@') ? a : `${a}@s.whatsapp.net`);

    // send admin mention message quoted to metaQuote (so botName meta mention is shown)
    await socket.sendMessage(from, { text: adminText, mentions }, { quoted: metaQuote });
  } catch (e) {
    console.error('[CASE tagadmins] Error:', e);
    await socket.sendMessage(msg.key.remoteJid, { text: `❌ *Error Occurred !!*\n\n${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'nanobanana': {
  const fs = require('fs');
  const path = require('path');
  const { GoogleGenAI } = require("@google/genai");

  // 🧩 Helper: Download quoted image
  async function downloadQuotedImage(socket, msg) {
    try {
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      if (!ctx || !ctx.quotedMessage) return null;

      const quoted = ctx.quotedMessage;
      const imageMsg = quoted.imageMessage || quoted[Object.keys(quoted).find(k => k.endsWith('Message'))];
      if (!imageMsg) return null;

      if (typeof socket.downloadMediaMessage === 'function') {
        const quotedKey = {
          remoteJid: msg.key.remoteJid,
          id: ctx.stanzaId,
          participant: ctx.participant || undefined
        };
        const fakeMsg = { key: quotedKey, message: ctx.quotedMessage };
        const stream = await socket.downloadMediaMessage(fakeMsg, 'image');
        const bufs = [];
        for await (const chunk of stream) bufs.push(chunk);
        return Buffer.concat(bufs);
      }

      return null;
    } catch (e) {
      console.error('downloadQuotedImage err', e);
      return null;
    }
  }

  // ⚙️ Main command logic
  try {
    const promptRaw = args.join(' ').trim();
    if (!promptRaw && !msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      return await socket.sendMessage(sender, {
        text: "📸 *Usage:* `.nanobanana <prompt>`\n💬 Or reply to an image with `.nanobanana your prompt`"
      }, { quoted: msg });
    }

    await socket.sendMessage(sender, { react: { text: "🎨", key: msg.key } });

    const imageBuf = await downloadQuotedImage(socket, msg);
    await socket.sendMessage(sender, {
      text: `🔮 *Generating image...*\n🖊️ Prompt: ${promptRaw || '(no text)'}\n📷 Mode: ${imageBuf ? 'Edit (Image + Prompt)' : 'Text to Image'}`
    }, { quoted: msg });

    // 🧠 Setup Gemini SDK
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || "AIzaSyB6ZQwLHZFHxDCbBFJtc0GIN2ypdlga4vw"
    });

    // 🧩 Build contents
    const contents = imageBuf
      ? [
          { role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: imageBuf.toString("base64") } }, { text: promptRaw }] }
        ]
      : [
          { role: "user", parts: [{ text: promptRaw }] }
        ];

    // ✨ Generate Image using Gemini SDK
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents,
    });

    // 🖼️ Extract Image Data
    const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!part) {
      console.log('Gemini response:', response);
      throw new Error('⚠️ No image data returned from Gemini API.');
    }

    const imageData = part.inlineData.data;
    const buffer = Buffer.from(imageData, "base64");

    const tmpPath = path.join(__dirname, `gemini-nano-${Date.now()}.png`);
    fs.writeFileSync(tmpPath, buffer);

    await socket.sendMessage(sender, {
      image: fs.readFileSync(tmpPath),
      caption: `✅ *Here you go!*\n🎨 Prompt: ${promptRaw}`
    }, { quoted: msg });

    try { fs.unlinkSync(tmpPath); } catch {}

  } catch (err) {
    console.error('nanobanana error:', err);
    await socket.sendMessage(sender, { text: `❌ *Error:* ${err.message || err}` }, { quoted: msg });
  }
  break;
}


case 'font': {
    const axios = require("axios");

    // ?? Load bot name dynamically
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || 'CHAMA MINI BOT AI';

    // 🔹 Fake contact for Meta AI mention
    const botMention = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "META_AI_FAKE_ID_FONT"
        },
        message: {
            contactMessage: {
                displayName: botName,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
            }
        }
    };

    const q =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption || '';

    const text = q.trim().replace(/^.fancy\s+/i, ""); // remove .fancy prefix

    if (!text) {
        return await socket.sendMessage(sender, {
            text: `❎ *Please provide text to convert into fancy fonts.*\n\n📌 *Example:* \`.font Chama\``
        }, { quoted: botMention });
    }

    try {
        const apiUrl = `https://www.dark-yasiya-api.site/other/font?text=${encodeURIComponent(text)}`;
        const response = await axios.get(apiUrl);

        if (!response.data.status || !response.data.result) {
            return await socket.sendMessage(sender, {
                text: "❌ *Error fetching fonts from API. Please try again later.*"
            }, { quoted: botMention });
        }

        const fontList = response.data.result
            .map(font => `*${font.name}:*\n${font.result}`)
            .join("\n\n");

        const finalMessage = `🎨 *Fancy Fonts Converter*\n\n${fontList}\n\n_© ${botName}_`;

        await socket.sendMessage(sender, {
            text: finalMessage
        }, { quoted: botMention });

    } catch (err) {
        console.error("Fancy Font Error:", err);
        await socket.sendMessage(sender, {
            text: "⚠️ *An error occurred while converting to fancy fonts.*"
        }, { quoted: botMention });
    }

    break;
}

case 'mediafire':
case 'mf':
case 'mfdl': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const url = text.split(" ")[1]; // .mediafire <link>

        // ✅ Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'CHAMA MINI BOT AI';

        // ✅ Fake Meta contact message (like Facebook style)
        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_MEDIAFIRE"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        if (!url) {
            return await socket.sendMessage(sender, {
                text: '🚫 *Please send a MediaFire link.*\n\nExample: .mediafire <url>'
            }, { quoted: shonux });
        }

        // ⏳ Notify start
        await socket.sendMessage(sender, { react: { text: '📥', key: msg.key } });
        await socket.sendMessage(sender, { text: '*⏳ Fetching MediaFire file info...*' }, { quoted: shonux });

        // 🔹 Call API
        let api = `https://tharuzz-ofc-apis.vercel.app/api/download/mediafire?url=${encodeURIComponent(url)}`;
        let { data } = await axios.get(api);

        if (!data.success || !data.result) {
            return await socket.sendMessage(sender, { text: '❌ *Failed to fetch MediaFire file.*' }, { quoted: shonux });
        }

        const result = data.result;
        const title = result.title || result.filename;
        const filename = result.filename;
        const fileSize = result.size;
        const downloadUrl = result.url;

        const caption = `📦 *${title}*\n\n` +
                        `📁 *Filename:* ${filename}\n` +
                        `📏 *Size:* ${fileSize}\n` +
                        `🌐 *From:* ${result.from}\n` +
                        `📅 *Date:* ${result.date}\n` +
                        `🕑 *Time:* ${result.time}\n\n` +
                        `✅ Downloaded by ${botName}`;

        // 🔹 Send file automatically (document type for .zip etc.)
        await socket.sendMessage(sender, {
            document: { url: downloadUrl },
            fileName: filename,
            mimetype: 'application/octet-stream',
            caption: caption
        }, { quoted: shonux });

    } catch (err) {
        console.error("Error in MediaFire downloader:", err);

        // ✅ In catch also send Meta mention style
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'CHAMA MINI BOT AI';

        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_MEDIAFIRE"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
    }
    break;
}


case 'apksearch':
case 'apks':
case 'apkfind': {
    try {
        const tharuzz_footer = "> © powerd by tsandipa"
        
        
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const query = text.split(" ").slice(1).join(" ").trim();

        // ✅ Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'CHAMA MINI BOT AI';

        // ✅ Fake Meta contact message
        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_APK"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        if (!query) {
            return await socket.sendMessage(sender, {
                text: '🚫 *Please provide an app name to search.*\n\nExample: .apksearch whatsapp',
                buttons: [
                    { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }
                ]
            }, { quoted: shonux });
        }

        await socket.sendMessage(sender, { text: '*⏳ Searching APKs...*' }, { quoted: shonux });

        // 🔹 Call API
        const apiUrl = `https://tharuzz-ofc-apis.vercel.app/api/search/apksearch?query=${encodeURIComponent(query)}`;
        const { data } = await axios.get(apiUrl);

        if (!data.success || !data.result || !data.result.length) {
            return await socket.sendMessage(sender, { text: '*❌ No APKs found for your query.*' }, { quoted: shonux });
        }

        // 🔹 Format results
        let message = `🔍 *APK Search Results for:* ${query}\n\n`;
        data.result.slice(0, 20).forEach((item, idx) => {
            message += `*${idx + 1}.* ${item.name}\n➡️ ID: \`${item.id}\`\n\n`;
        });
        message += `_© Powered by ${botName}_`;

        // 🔹 Send results
        const listApk = await socket.sendMessage(sender, {
            text: message,
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 },
                { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: '🤖 BOT INFO' }, type: 1 }
            ],
            contextInfo: { mentionedJid: [sender] }
        }, { quoted: shonux });
        
        const listAppid = listApk.key.id;
        
        socket.ev.on("messages.upsert", async (update) => {
            const msg = update?.messages?.[0];
            if (!msg?.message) return;
      
            const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
            const isReplyToList = msg?.message?.extendedTextMessage?.contextInfo?.stanzaId === listAppid;
            if (!isReplyToList) return;
            
            
            const index = parseInt(text.trim()) - 1;
            if (isNaN(index) || index < 0 || index >= data.result.length) return reply("❌ *Invalid number please enter valid number*");
            await socket.sendMessage(from, { react: { text: '✅', key: msg.key }})
            
            const chooseApp = data.result[index]
            
            const {data} = await axios.get(`https://tharuzz-ofc-apis.vercel.app/api/download/apkdownload?id=${chooseApp.id}`);
            
            const apkdl = data.result;
            
            const captionApp = `📦 *\`PLAYSTORE APK SEARCH RESULTS\`*\n\n` +
            `*┏━━━━━━━━━━━━━━━━*\n` +
            `*┃ 📌 \`App name:\` ${apkdl.name || "No app name"}*\n` +
            `*┃ 📦 \`Package:\` ${apkdl.package || "No data"}*\n` +
            `*┃ 📥 \`App size:\` ${apkdl.size}*\n` +
            `*┃ 📅 \`Last Update:\` ${apkdl.lastUpdate}*\n` +
            `*┗━━━━━━━━━━━━━━━━━━━*\n\n` + tharuzz_footer
            
            await socket.sendMessage(from, {
                image: {url: apkdl.image },
                caption: captionApp
            }, {quoted: shonux});
            
            const ulMessg = await socket.sendMessage(from, { text: "*📥 Downloading your application . . .*" });
      
            const dom = await socket.sendMessage(from, { document: { url: apkdl.dl_link }, mimetype: "application/vnd.android.package-archive", fileName: apkdl.name + '.apk', caption: `${apkdl.name}\n\n${tharuzz_footer}` }, { quoted: msg });
      
            await socket.sendMessage(from, { text : '*✅ Sucessfully download your application . . .*' , edit : ulMessg.key });
      
            await socket.sendMessage(from, { react: { text: '📦', key: dom.key } });
        
            await socket.sendMessage(from, { react: { text: `✅`, key: msg.key }});    
        })
    } catch (err) {
        console.error("Error in APK search:", err);

        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'CHAMA MINI BOT AI';

        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_APK"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
    }
    break;
}
case 'gjid': {
  try {
    const from = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;

    // Sanitize owner + sender
    const ownerNum = (config?.OWNER_NUMBER || '').replace(/[^0-9]/g, '');
    const senderNum = (sender.split('@')[0] || '').replace(/[^0-9]/g, '');

    // Load bot name (Mongo or default)
    const cfg = await (typeof loadUserConfigFromMongo === 'function' ? loadUserConfigFromMongo(senderNum) : Promise.resolve({}));
    const botName = (cfg && cfg.botName) ? cfg.botName : (typeof BOT_NAME_FANCY !== 'undefined' ? BOT_NAME_FANCY : 'CHAMA-MD');

    // Meta mention (for botName)
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_GJID" },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`
        }
      }
    };

    // Owner-only check
    if (ownerNum && senderNum !== ownerNum) {
      await socket.sendMessage(from, { text: `❌ *You are not the owner!*` }, { quoted: metaQuote });
      break;
    }

    const groupsObj = await socket.groupFetchAllParticipating();
    const groupArray = Object.values(groupsObj || {});

    if (groupArray.length === 0) {
      await socket.sendMessage(from, { text: `📝 No groups found.` }, { quoted: metaQuote });
      break;
    }

    // Sort by creation time if available
    groupArray.sort((a, b) => (a.creation || 0) - (b.creation || 0));

    // Build formatted list
    const groupList = groupArray.map((group, idx) => {
      const name = group.subject || 'Unknown';
      const jid = group.id || group.jid || group.groupJid || 'UnknownJid';
      return `*${idx + 1}. ${name}*\n🆔 ${jid}`;
    }).join('\n\n');

    // Chunk if too large
    const maxChunk = 6000;
    if (groupList.length <= maxChunk) {
      await socket.sendMessage(from, {
        text: `📜 *Group JID List*\n━━━━━━━━━━━━━━\n\n${groupList}\n\n━━━━━━━━━━━━━━\n👑 *Generated by:* ${botName}`,
      }, { quoted: metaQuote });
    } else {
      await socket.sendMessage(from, { text: `📜 *Group JID List* (too long, sending in parts...)`, quoted: metaQuote });
      for (let i = 0; i < groupList.length; i += maxChunk) {
        const part = groupList.slice(i, i + maxChunk);
        await socket.sendMessage(from, { text: part }, { quoted: metaQuote });
      }
    }

  } catch (err) {
    console.error('[CASE gjid] error', err);
    await socket.sendMessage(msg.key.remoteJid, {
      text: `❌ *Error while fetching groups:*\n${err.message || err}`,
    }, { quoted: msg });
  }
  break;
}

 case 'cimg': {
  try {
    const from = msg.key.remoteJid;

    // derive bot name dynamically
    const senderIdRaw = (msg.key.participant || msg.key.remoteJid || '') + '';
    const sanitized = (senderIdRaw.split('@')[0] || '').replace(/[^0-9]/g, '');
    const cfg = await (typeof loadUserConfigFromMongo === 'function' ? loadUserConfigFromMongo(sanitized) : Promise.resolve({}));
    const botName = (cfg && cfg.botName) ? cfg.botName : (typeof BOT_NAME_FANCY !== 'undefined' ? BOT_NAME_FANCY : 'Bot');

    // meta mention
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CIMG" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let fullText = '';
    if (msg.message?.conversation) fullText = msg.message.conversation;
    else if (msg.message?.extendedTextMessage?.text) fullText = msg.message.extendedTextMessage.text;
    else if (msg.message?.imageMessage?.caption) fullText = msg.message.imageMessage.caption;
    else if (msg.message?.videoMessage?.caption) fullText = msg.message.videoMessage.caption;
    fullText = fullText.trim();

    const rawArgs = fullText.replace(new RegExp(`^(\\.?)(cimg)\\s*`, 'i'), '').trim();
    const parts = rawArgs.split(/\s+/).filter(p => p.length > 0);
    const jid = parts[0];
    const name = parts.slice(1).join(' ');

    if (!jid || !name) {
      await socket.sendMessage(from, { text: '✏️ Usage: .cimg <channelJid> <channelName>\n(Reply to an image message)' }, { quoted: metaQuote });
      break;
    }

    const quotedCtx = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = quotedCtx?.quotedMessage || msg.message?.imageMessage || null;
    if (!quoted) {
      await socket.sendMessage(from, { text: '⚠️ Reply to an *image* message.' }, { quoted: metaQuote });
      break;
    }

    let buffer;
    try {
      if (typeof quoted.download === 'function') {
        buffer = await quoted.download();
      } else if (quotedCtx?.quotedMessage?.imageMessage?.jpegThumbnail) {
        buffer = quotedCtx.quotedMessage.imageMessage.jpegThumbnail;
      }
    } catch (err) {
      console.warn('[CASE cimg] quoted.download failed', err);
    }

    if (!buffer) {
      await socket.sendMessage(from, { text: '❌ Failed to download the quoted image.' }, { quoted: metaQuote });
      break;
    }

    const forwardMsg = {
      contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: jid,
          newsletterName: name,
          serverMessageId: Math.floor(Math.random() * 9999) + 100
        }
      },
      image: buffer,
      caption: `📢 Forwarded by *${botName}*`
    };

    await socket.sendMessage(from, forwardMsg, { quoted: metaQuote });
    await socket.sendMessage(from, { text: `✅ Image forwarded as channel "${name}".` }, { quoted: metaQuote });
  } catch (e) {
    console.error('[CASE cimg] error', e);
    await socket.sendMessage(msg.key.remoteJid, { text: `❌ Error: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'leave': {
  try {
    const from = msg.key.remoteJid;
    const isGroup = (from || '').endsWith('@g.us');

    const senderIdRaw = (msg.key.participant || msg.key.remoteJid || '') + '';
    const sanitized = (senderIdRaw.split('@')[0] || '').replace(/[^0-9]/g, '');
    const cfg = await (typeof loadUserConfigFromMongo === 'function' ? loadUserConfigFromMongo(sanitized) : Promise.resolve({}));
    const botName = (cfg && cfg.botName) ? cfg.botName : (typeof BOT_NAME_FANCY !== 'undefined' ? BOT_NAME_FANCY : 'Bot');

    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_LEAVE" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    if (!isGroup) {
      await socket.sendMessage(from, { text: '❌ This command can only be used in groups.' }, { quoted: metaQuote });
      break;
    }

    await socket.sendMessage(from, { text: `👋 ${botName} is leaving group...` }, { quoted: metaQuote });
    await sleep(1200);
    await socket.groupLeave(from);

  } catch (e) {
    console.error('[CASE leave] error', e);
    await socket.sendMessage(msg.key.remoteJid, { text: `❌ Error: ${e.message || e}` }, { quoted: msg });
  }
  break;
}
case 'emix': {
  try {
    const from = msg.key.remoteJid;

    // derive sanitized sender id (safe)
    const senderIdRaw = (msg.key.participant || msg.key.remoteJid || '') + '';
    const sanitized = (senderIdRaw.split('@')[0] || '').replace(/[^0-9]/g, '');
    const cfg = await (typeof loadUserConfigFromMongo === 'function' ? loadUserConfigFromMongo(sanitized) : Promise.resolve({}));
    const botName = (cfg && cfg.botName) ? cfg.botName : (typeof BOT_NAME_FANCY !== 'undefined' ? BOT_NAME_FANCY : 'Bot');


    const metaQuote = {
      key: { remoteJid: 'status@broadcast', participant: '0@s.whatsapp.net', fromMe: false, id: 'CHAMA-MINI' },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`
        }
      }
    };

    // Extract command text
    let text = '';
    if (msg.message?.conversation) text = msg.message.conversation;
    else if (msg.message?.extendedTextMessage?.text) text = msg.message?.extendedTextMessage?.text;
    else if (msg.message?.imageMessage?.caption) text = msg.message.imageMessage.caption;
    else if (msg.message?.videoMessage?.caption) text = msg.message.videoMessage.caption;
    const fullText = (text || '').trim();

    // Remove command prefix (e.g. ".emix ")
    const q = fullText.replace(new RegExp(`^(\\.?)(emix)\\s*`, 'i'), '').trim();

    if (!q || !q.includes(',')) {
      await socket.sendMessage(from, { text: '❌ *Usage:* .emix 😂,🙂\n_Send two emojis separated by a comma._' }, { quoted: msg });
      break;
    }

    let [emoji1, emoji2] = q.split(',').map(e => e.trim());
    if (!emoji1 || !emoji2) {
      await socket.sendMessage(from, { text: '❌ Please provide two emojis separated by a comma. Example: .emix 😂,🙂' }, { quoted: msg });
      break;
    }

    // quick reaction to show processing
    try { await socket.sendMessage(from, { react: { text: '🕐', key: msg.key } }); } catch (e) { /* ignore if react not supported */ }

    // generate image url from emoji mix util
    const imageUrl = await fetchEmix(emoji1, emoji2);
    if (!imageUrl) {
      await socket.sendMessage(from, { text: '❌ Could not generate emoji mix. Try different emojis.' }, { quoted: metaQuote });
      break;
    }

    const buffer = await getBuffer(imageUrl);
    if (!buffer) {
      await socket.sendMessage(from, { text: '❌ Failed to download generated image.' }, { quoted: metaQuote });
      break;
    }

    // Create sticker using botName as author and include botName in pack (keeps attribution dynamic)
    const sticker = new Sticker(buffer, {
      pack: `Emoji Mix - ${botName}`,
      author: botName,
      type: StickerTypes.FULL,
      categories: ['🤩', '🎉'],
      quality: 75,
      background: 'transparent'
    });

    const stickerBuffer = await sticker.toBuffer();

    // send sticker with meta mention quote
    await socket.sendMessage(from, { sticker: stickerBuffer }, { quoted: metaQuote });

  } catch (e) {
    console.error('[CASE emix] Error:', e);
    try {
      await socket.sendMessage(msg.key.remoteJid, { text: `❌ Could not generate emoji mix: ${e.message || e}` }, { quoted: msg });
    } catch (inner) {
      console.error('[CASE emix] reply send failed', inner);
    }
  }
  break;
}

case 'cvid': {
  try {
    const from = msg.key.remoteJid;

    const senderIdRaw = (msg.key.participant || msg.key.remoteJid || '') + '';
    const sanitized = (senderIdRaw.split('@')[0] || '').replace(/[^0-9]/g, '');
    const cfg = await (typeof loadUserConfigFromMongo === 'function' ? loadUserConfigFromMongo(sanitized) : Promise.resolve({}));
    const botName = (cfg && cfg.botName) ? cfg.botName : (typeof BOT_NAME_FANCY !== 'undefined' ? BOT_NAME_FANCY : 'Bot');

    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CVID" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let fullText = '';
    if (msg.message?.conversation) fullText = msg.message.conversation;
    else if (msg.message?.extendedTextMessage?.text) fullText = msg.message.extendedTextMessage.text;
    else if (msg.message?.imageMessage?.caption) fullText = msg.message.imageMessage.caption;
    else if (msg.message?.videoMessage?.caption) fullText = msg.message.videoMessage.caption;
    fullText = fullText.trim();

    const rawArgs = fullText.replace(new RegExp(`^(\\.?)(cvid)\\s*`, 'i'), '').trim();
    const parts = rawArgs.split(/\s+/).filter(p => p.length > 0);
    const jid = parts[0];
    const name = parts.slice(1).join(' ');

    if (!jid || !name) {
      await socket.sendMessage(from, { text: '✏️ Usage: .cvid <channelJid> <channelName>\n(Reply to a video message)' }, { quoted: metaQuote });
      break;
    }

    const quotedCtx = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = quotedCtx?.quotedMessage || msg.message?.videoMessage || null;
    if (!quoted) {
      await socket.sendMessage(from, { text: '⚠️ Reply to a *video* message.' }, { quoted: metaQuote });
      break;
    }

    let buffer;
    try {
      if (typeof quoted.download === 'function') {
        buffer = await quoted.download();
      } else if (quotedCtx?.quotedMessage?.videoMessage?.jpegThumbnail) {
        buffer = quotedCtx.quotedMessage.videoMessage.jpegThumbnail;
      }
    } catch (err) {
      console.warn('[CASE cvid] quoted.download failed', err);
    }

    if (!buffer) {
      await socket.sendMessage(from, { text: '❌ Failed to download the quoted video.' }, { quoted: metaQuote });
      break;
    }

    const forwardMsg = {
      contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: jid,
          newsletterName: name,
          serverMessageId: Math.floor(Math.random() * 9999) + 100
        }
      },
      video: buffer,
      caption: `🎬 Forwarded by *${botName}*`
    };

    await socket.sendMessage(from, forwardMsg, { quoted: metaQuote });
    await socket.sendMessage(from, { text: `✅ Video forwarded as channel "${name}".` }, { quoted: metaQuote });
  } catch (e) {
    console.error('[CASE cvid] error', e);
    await socket.sendMessage(msg.key.remoteJid, { text: `❌ Error: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'ctx': {
  try {
    const from = msg.key.remoteJid;

    const senderIdRaw = (msg.key.participant || msg.key.remoteJid || '') + '';
    const sanitized = (senderIdRaw.split('@')[0] || '').replace(/[^0-9]/g, '');
    const cfg = await (typeof loadUserConfigFromMongo === 'function' ? loadUserConfigFromMongo(sanitized) : Promise.resolve({}));
    const botName = (cfg && cfg.botName) ? cfg.botName : (typeof BOT_NAME_FANCY !== 'undefined' ? BOT_NAME_FANCY : 'Bot');

    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CTX" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let fullText = '';
    if (msg.message?.conversation) fullText = msg.message.conversation;
    else if (msg.message?.extendedTextMessage?.text) fullText = msg.message.extendedTextMessage.text;
    else if (msg.message?.imageMessage?.caption) fullText = msg.message.imageMessage.caption;
    else if (msg.message?.videoMessage?.caption) fullText = msg.message.videoMessage.caption;
    fullText = fullText.trim();

    const rawArgs = fullText.replace(new RegExp(`^(\\.?)(ctx)\\s*`, 'i'), '').trim();
    const parts = rawArgs.split(/\s+/).filter(p => p.length > 0);
    const jid = parts[0];
    const name = parts.slice(1).join(' ');

    if (!jid || !name) {
      await socket.sendMessage(from, { text: '✏️ Usage: .ctx <channelJid> <channelName>\n(Reply to a text message)' }, { quoted: metaQuote });
      break;
    }

    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
    if (!quoted) {
      await socket.sendMessage(from, { text: '⚠️ Reply to a *text* message.' }, { quoted: metaQuote });
      break;
    }

    const quotedText = quoted.conversation || quoted.extendedTextMessage?.text || '';
    if (!quotedText) {
      await socket.sendMessage(from, { text: '📄 Reply must be a text message.' }, { quoted: metaQuote });
      break;
    }

    const forwardMsg = {
      contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: jid,
          newsletterName: name,
          serverMessageId: Math.floor(Math.random() * 9999) + 100
        }
      },
      text: `📝 ${quotedText}\n\n— Forwarded by *${botName}*`
    };

    await socket.sendMessage(from, forwardMsg, { quoted: metaQuote });
    await socket.sendMessage(from, { text: `✅ Text forwarded as channel "${name}".` }, { quoted: metaQuote });
  } catch (e) {
    console.error('[CASE ctx] error', e);
    await socket.sendMessage(msg.key.remoteJid, { text: `❌ Error: ${e.message || e}` }, { quoted: msg });
  }
  break;
}
    
case 'xvdl2':
case 'xvnew': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const query = text.split(" ").slice(1).join(" ").trim();

        if (!query) return await socket.sendMessage(sender, { text: '🚫 Please provide a search query.\nExample: .xv mia' }, { quoted: msg });

        // 1️⃣ Send searching message
        await socket.sendMessage(sender, { text: '*⏳ Searching XVideos...*' }, { quoted: msg });

        // 2️⃣ Call search API
        const searchRes = await axios.get(`https://tharuzz-ofc-api-v2.vercel.app/api/search/xvsearch?query=${encodeURIComponent(query)}`);
        const videos = searchRes.data.result?.xvideos?.slice(0, 10);
        if (!videos || videos.length === 0) return await socket.sendMessage(sender, { text: '*❌ No results found.*' }, { quoted: msg });

        // 3️⃣ Prepare list message
        let listMsg = `🔍 *XVideos Results for:* ${query}\n\n`;
        videos.forEach((vid, idx) => {
            listMsg += `*${idx + 1}.* ${vid.title}\n${vid.info}\n➡️ ${vid.link}\n\n`;
        });
        listMsg += '_Reply with the number to download the video._';

        await socket.sendMessage(sender, { text: listMsg }, { quoted: msg });

        // 4️⃣ Cache results for reply handling
        global.xvCache = global.xvCache || {};
        global.xvCache[sender] = videos.map(v => v.link);

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '*❌ Error occurred.*' }, { quoted: msg });
    }
}
break;

// Handle reply to download selected video
case 'xvselect': {
    try {
        const replyText = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const selection = parseInt(replyText);

        const links = global.xvCache?.[sender];
        if (!links || isNaN(selection) || selection < 1 || selection > links.length) {
            return await socket.sendMessage(sender, { text: '🚫 Invalid selection number.' }, { quoted: msg });
        }

        const videoUrl = links[selection - 1];

        await socket.sendMessage(sender, { text: '*⏳ Downloading video...*' }, { quoted: msg });

        // Call download API
        const dlRes = await axios.get(`https://tharuzz-ofc-api-v2.vercel.app/api/download/xvdl?url=${encodeURIComponent(videoUrl)}`);
        const result = dlRes.data.result;

        if (!result) return await socket.sendMessage(sender, { text: '*❌ Failed to fetch video.*' }, { quoted: msg });

        // Send video
        await socket.sendMessage(sender, {
            video: { url: result.dl_Links.highquality },
            caption: `🎥 *${result.title}*\n⏱ Duration: ${result.duration}s`,
            jpegThumbnail: result.thumbnail ? await axios.get(result.thumbnail, { responseType: 'arraybuffer' }).then(res => Buffer.from(res.data)) : undefined
        }, { quoted: msg });

        // Clear cache
        delete global.xvCache[sender];

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: '*❌ Error downloading video.*' }, { quoted: msg });
    }
}
break;

// ---------------- list saved newsletters (show emojis) ----------------
case 'newslist': {
  try {
    const docs = await listNewslettersFromMongo();
    if (!docs || docs.length === 0) {
      let userCfg = {};
      try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
      const title = userCfg.botName || 'CHAMA MINI BOT AI';
      const shonux = {
          key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_NEWSLIST" },
          message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '📭 No channels saved in DB.' }, { quoted: shonux });
    }

    let txt = '*📚 Saved Newsletter Channels:*\n\n';
    for (const d of docs) {
      txt += `• ${d.jid}\n  Emojis: ${Array.isArray(d.emojis) && d.emojis.length ? d.emojis.join(' ') : '(default)'}\n\n`;
    }

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_NEWSLIST2" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: txt }, { quoted: shonux });
  } catch (e) {
    console.error('newslist error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_NEWSLIST3" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to list channels.' }, { quoted: shonux });
  }
  break;
}
case 'cid': {
    // Extract query from message
    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    // ✅ Dynamic botName load
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || 'CHAMA MINI BOT AI';

    // ✅ Fake Meta AI vCard (for quoted msg)
    const shonux = {
        key: {
            remoteJid: "status@broadcast",
            participant: "0@s.whatsapp.net",
            fromMe: false,
            id: "META_AI_FAKE_ID_CID"
        },
        message: {
            contactMessage: {
                displayName: botName,
                vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
            }
        }
    };

    // Clean command prefix (.cid, /cid, !cid, etc.)
    const channelLink = q.replace(/^[.\/!]cid\s*/i, '').trim();

    // Check if link is provided
    if (!channelLink) {
        return await socket.sendMessage(sender, {
            text: '❎ Please provide a WhatsApp Channel link.\n\n📌 *Example:* .cid https://whatsapp.com/channel/123456789'
        }, { quoted: shonux });
    }

    // Validate link
    const match = channelLink.match(/whatsapp\.com\/channel\/([\w-]+)/);
    if (!match) {
        return await socket.sendMessage(sender, {
            text: '⚠️ *Invalid channel link format.*\n\nMake sure it looks like:\nhttps://whatsapp.com/channel/xxxxxxxxx'
        }, { quoted: shonux });
    }

    const inviteId = match[1];

    try {
        // Send fetching message
        await socket.sendMessage(sender, {
            text: `🔎 Fetching channel info for: *${inviteId}*`
        }, { quoted: shonux });

        // Get channel metadata
        const metadata = await socket.newsletterMetadata("invite", inviteId);

        if (!metadata || !metadata.id) {
            return await socket.sendMessage(sender, {
                text: '❌ Channel not found or inaccessible.'
            }, { quoted: shonux });
        }

        // Format details
        const infoText = `
📡 *WhatsApp Channel Info*

🆔 *ID:* ${metadata.id}
📌 *Name:* ${metadata.name}
👥 *Followers:* ${metadata.subscribers?.toLocaleString() || 'N/A'}
📅 *Created on:* ${metadata.creation_time ? new Date(metadata.creation_time * 1000).toLocaleString("si-LK") : 'Unknown'}

_© Powered by ${botName}_
`;

        // Send preview if available
        if (metadata.preview) {
            await socket.sendMessage(sender, {
                image: { url: `https://pps.whatsapp.net${metadata.preview}` },
                caption: infoText
            }, { quoted: shonux });
        } else {
            await socket.sendMessage(sender, {
                text: infoText
            }, { quoted: shonux });
        }

    } catch (err) {
        console.error("CID command error:", err);
        await socket.sendMessage(sender, {
            text: '⚠️ An unexpected error occurred while fetching channel info.'
        }, { quoted: shonux });
    }

    break;
}

case 'owner': {
  try {
    // vCard with multiple details
    let vcard = 
      'BEGIN:VCARD\n' +
      'VERSION:3.0\n' +
      'FN:CHAMA\n' + // Name
      'ORG:WhatsApp Bot Developer;\n' + // Organization
      'TITLE:Founder & CEO of CHAMA MD Mini Bot;\n' + // Title / Role
      'EMAIL;type=INTERNET:chamaofc@gmail.com\n' + // Email
      'ADR;type=WORK:;;Colombo;;Sri Lanka\n' + // Address
      'URL:https://github.com/Chama-ofc\n' + // Website
      'TEL;type=CELL;type=VOICE;waid=94703229057:+94703229057\n' + // WhatsApp Number
      'TEL;type=CELL;type=VOICE;waid=94783314361:+94783314361\n' + // Second Number (Owner)
      'END:VCARD';

    await conn.sendMessage(
      m.chat,
      {
        contacts: {
          displayName: 'CHAMA',
          contacts: [{ vcard }]
        }
      },
      { quoted: m }
    );

  } catch (err) {
    console.error(err);
    await conn.sendMessage(m.chat, { text: '⚠️ Owner info fetch error.' }, { quoted: m });
  }
}
break;

case 'addadmin': {
  if (!args || args.length === 0) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❗ Provide a jid or number to add as admin\nExample: .addadmin 9477xxxxxxx' }, { quoted: shonux });
  }

  const jidOr = args[0].trim();
  if (!isOwner) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN2" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❌ Only owner can add admins.' }, { quoted: shonux });
  }

  try {
    await addAdminToMongo(jidOr);

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN3" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Added admin: ${jidOr}` }, { quoted: shonux });
  } catch (e) {
    console.error('addadmin error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN4" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `❌ Failed to add admin: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}
case 'tagall': {
  try {
    if (!from || !from.endsWith('@g.us')) return await socket.sendMessage(sender, { text: '❌ This command can only be used in groups.' }, { quoted: msg });

    let gm = null;
    try { gm = await socket.groupMetadata(from); } catch(e) { gm = null; }
    if (!gm) return await socket.sendMessage(sender, { text: '❌ Failed to fetch group info.' }, { quoted: msg });

    const participants = gm.participants || [];
    if (!participants.length) return await socket.sendMessage(sender, { text: '❌ No members found in the group.' }, { quoted: msg });

    const text = args && args.length ? args.join(' ') : '📢 Announcement';

    let groupPP = 'https://i.ibb.co/9q2mG0Q/default-group.jpg';
    try { groupPP = await socket.profilePictureUrl(from, 'image'); } catch(e){}

    const mentions = participants.map(p => p.id || p.jid);
    const groupName = gm.subject || 'Group';
    const totalMembers = participants.length;

    const emojis = ['📢','🔊','🌐','🛡️','🚀','🎯','🧿','🪩','🌀','💠','🎊','🎧','📣','🗣️'];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    // BotName meta mention
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_TAGALL" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let caption = `╭───❰ *📛 Group Announcement* ❱───╮\n`;
    caption += `│ 📌 *Group:* ${groupName}\n`;
    caption += `│ 👥 *Members:* ${totalMembers}\n`;
    caption += `│ 💬 *Message:* ${text}\n`;
    caption += `╰────────────────────────────╯\n\n`;
    caption += `📍 *Mentioning all members below:*\n\n`;
    for (const m of participants) {
      const id = (m.id || m.jid);
      if (!id) continue;
      caption += `${randomEmoji} @${id.split('@')[0]}\n`;
    }
    caption += `\n━━━━━━⊱ *${botName}* ⊰━━━━━━`;

    await socket.sendMessage(from, {
      image: { url: groupPP },
      caption,
      mentions,
    }, { quoted: metaQuote }); // <-- botName meta mention

  } catch (err) {
    console.error('tagall error', err);
    await socket.sendMessage(sender, { text: '❌ Error running tagall.' }, { quoted: msg });
  }
  break;
}
case 'savecontact': {
  try {
    const from = msg.key.remoteJid;
    // extract text after command
    let full = '';
    if (msg.message?.conversation) full = msg.message.conversation;
    else if (msg.message?.extendedTextMessage?.text) full = msg.message.extendedTextMessage.text;
    full = full.trim();
    const rawArg = full.replace(new RegExp(`^(\\.?)(savecontact|gvcf2|scontact|savecontacts)\\s*`, 'i'), '').trim();

    if (!rawArg) {
      await socket.sendMessage(from, { text: "📌 *Usage:* .savecontact <group JID>\n📥 Example: .savecontact 9477xxxxxxx-123@g.us" }, { quoted: msg });
      break;
    }

    const groupJid = rawArg;
    // fetch group metadata
    let groupMetadata = null;
    try {
      if (socket && typeof socket.groupMetadata === 'function') groupMetadata = await socket.groupMetadata(groupJid);
      else if (typeof conn !== 'undefined' && typeof conn.groupMetadata === 'function') groupMetadata = await conn.groupMetadata(groupJid);
    } catch (err) {
      groupMetadata = null;
    }

    if (!groupMetadata) {
      await socket.sendMessage(from, { text: "❌ *Invalid group JID* or I'm not in that group." }, { quoted: msg });
      break;
    }

    const participants = groupMetadata.participants || [];
    if (!participants || participants.length === 0) {
      await socket.sendMessage(from, { text: "❌ No participants found in that group." }, { quoted: msg });
      break;
    }

    await socket.sendMessage(from, { text: `🔍 Fetching contact names for *${groupMetadata.subject || 'Unknown Group'}*...` }, { quoted: msg });

    // build vcard contents
    let vcard = '';
    let index = 1;
    for (const p of participants) {
      // normalize id
      let id = (typeof p === 'string') ? p : (p.id?.user ? `${p.id.user}@s.whatsapp.net` : (p.id || p.jid || p));
      id = ('' + id).toString();
      const num = id.split('@')[0] || `unknown${index}`;

      // try to resolve display name via available getName
      let name = null;
      try {
        if (socket && typeof socket.getName === 'function') name = await socket.getName(id);
        else if (typeof conn !== 'undefined' && typeof conn.getName === 'function') name = await conn.getName(id);
      } catch (e) {
        name = null;
      }

      // fallback to participant fields
      if (!name) {
        name = (p.notify || p.name || p.pushname || '').toString().trim();
      }
      if (!name) name = `User-${index}`;

      vcard += `BEGIN:VCARD\n`;
      vcard += `VERSION:3.0\n`;
      vcard += `FN:${name}\n`;
      vcard += `TEL;type=CELL;type=VOICE;waid=${num}:+${num}\n`;
      vcard += `END:VCARD\n`;
      index++;
    }

    const filePath = `./group-contacts-${Date.now()}.vcf`;
    // write file
    require('fs').writeFileSync(filePath, vcard.trim());

    await socket.sendMessage(from, { text: `📁 Saving *${participants.length}* contacts from *${groupMetadata.subject || groupJid}*...` }, { quoted: msg });
    if (typeof sleep === 'function') await sleep(1200);

    // send vcf as document
    const fileBuffer = require('fs').readFileSync(filePath);
    await socket.sendMessage(from, {
      document: fileBuffer,
      mimetype: 'text/vcard',
      fileName: 'group-contacts.vcf',
      caption: `✅ *Contacts Saved!*\n👥 Group: *${groupMetadata.subject || groupJid}*\n📇 Total: *${participants.length}*\n\n> ᴘᴏᴡᴇʀᴇᴅ ʙʏ 𝚌𝚑𝚊𝚖𝚊 𝚖𝚍`
    }, { quoted: msg });

    // cleanup
    try { require('fs').unlinkSync(filePath); } catch (e) { /* ignore */ }

  } catch (err) {
    console.error('[CASE savecontact] Error:', err);
    await socket.sendMessage(msg.key.remoteJid, { text: `❌ Error: ${err.message || err}` }, { quoted: msg });
  }
  break;
}
case 'spam':
case 'spm':
case 'spam3': {
  try {
    const from = msg.key.remoteJid;

    // build a long blank-ish text (adjust length if you want more/less)
    const blankRepeat = 100000; // increase/decrease to change size
    const text = Array(blankRepeat).fill('\n').join('') + '\n';

    // send multiple times similar to original
    await socket.sendMessage(from, { text }, { quoted: msg });
    await socket.sendMessage(from, { text }, { quoted: msg });
    await socket.sendMessage(from, { text }, { quoted: msg });
    await socket.sendMessage(from, { text }, { quoted: msg });
    await socket.sendMessage(from, { text }, { quoted: msg });
    await socket.sendMessage(from, { text }, { quoted: msg });
    await socket.sendMessage(from, { text }, { quoted: msg });
    await socket.sendMessage(from, { text }, { quoted: msg });
    await socket.sendMessage(from, { text }, { quoted: msg });

    // final reaction
    await socket.sendMessage(from, { react: { text: "✅", key: msg.key } });

  } catch (e) {
    console.error('[CASE spam] Error:', e);
    try {
      await socket.sendMessage(msg.key.remoteJid, { text: `An error occurred: ${e.message || e}` }, { quoted: msg });
    } catch (sendErr) {
      console.error('[CASE spam] reply failed', sendErr);
    }
  }
  break;
}

case'pair':
case 'freebot': {
    // ✅ Fix for node-fetch v3.x (ESM-only module)
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

    if (!number) {
        return await socket.sendMessage(sender, {
            text: '*📃 Usage:* .freebot +9476XXX'
        }, { quoted: msg });
    }

    try {
        const url = `https://chamamini.onrender.com/code?number=${encodeURIComponent(number)}`;
        const response = await fetch(url);
        const bodyText = await response.text();

        console.log("🌐 API Response:", bodyText);

        let result;
        try {
            result = JSON.parse(bodyText);
        } catch (e) {
            console.error("❌ JSON Parse Error:", e);
            return await socket.sendMessage(sender, {
                text: '❌ Invalid response from server. Please contact support.'
            }, { quoted: msg });
        }

        if (!result || !result.code) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to retrieve pairing code. Please check the number.'
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            text: `*𝙲𝙷𝙰𝙼𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸 𝙱𝙾𝚃 𝚅3 ᴘᴀɪʀ ᴄᴏɴɴᴇᴄᴛᴇᴅ* ✅\n\n*🔑 ʏᴏᴜʀ ᴘᴀɪʀ ᴄᴏᴅᴇ :* ${result.code}\n\n> *© ᴄʀᴇᴀᴛᴇᴅ ʙʏ ᴄʜᴀᴍᴀ*`
        }, { quoted: msg });

        await sleep(2000);

        await socket.sendMessage(sender, {
            text: `${result.code}`
        }, { quoted: msg });

    } catch (err) {
        console.error("❌ Pair Command Error:", err);
        await socket.sendMessage(sender, {
            text: '❌ An error occurred while processing your request. Please try again later.'
        }, { quoted: msg });
    }

    break;
}
case 'ig':
case 'insta':
case 'instagram': {
  try {
    const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
    const q = text.split(" ").slice(1).join(" ").trim();

    // Validate
    if (!q) {
      await socket.sendMessage(sender, { 
        text: '*🚫 Please provide an Instagram post/reel link.*',
        buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }]
      });
      return;
    }

    const igRegex = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[^\s]+/;
    if (!igRegex.test(q)) {
      await socket.sendMessage(sender, { 
        text: '*🚫 Invalid Instagram link.*',
        buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }]
      });
      return;
    }

    await socket.sendMessage(sender, { react: { text: '🎥', key: msg.key } });
    await socket.sendMessage(sender, { text: '*⏳ Downloading Instagram media...*' });

    // 🔹 Load session bot name
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    let botName = cfg.botName || 'CHAMA MINI BOT AI';

    // 🔹 Meta style fake contact
    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_002"
      },
      message: {
        contactMessage: {
          displayName: botName, // dynamic bot name
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550003:+1 313 555 0003
END:VCARD`
        }
      }
    };

    // API request
    let apiUrl = `https://delirius-apiofc.vercel.app/download/instagram?url=${encodeURIComponent(q)}`;
    let { data } = await axios.get(apiUrl).catch(() => ({ data: null }));

    // Backup API if first fails
    if (!data?.status || !data?.downloadUrl) {
      const backupUrl = `https://api.tiklydown.me/api/instagram?url=${encodeURIComponent(q)}`;
      const backup = await axios.get(backupUrl).catch(() => ({ data: null }));
      if (backup?.data?.video) {
        data = {
          status: true,
          downloadUrl: backup.data.video
        };
      }
    }

    if (!data?.status || !data?.downloadUrl) {
      await socket.sendMessage(sender, { 
        text: '*🚩 Failed to fetch Instagram video.*',
        buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }]
      });
      return;
    }

    // Caption (Dynamic Bot Name)
    const titleText = `*📸 ${botName} INSTAGRAM DOWNLOADER*`;
    const content = `┏━━━━━━━━━━━━━━━━\n` +
                    `┃📌 \`Source\` : Instagram\n` +
                    `┃📹 \`Type\` : Video/Reel\n` +
                    `┗━━━━━━━━━━━━━━━━`;

    const footer = `🤖 ${botName}`;
    const captionMessage = typeof formatMessage === 'function'
      ? formatMessage(titleText, content, footer)
      : `${titleText}\n\n${content}\n${footer}`;

    // Send video with fake contact quoted
    await socket.sendMessage(sender, {
      video: { url: data.downloadUrl },
      caption: captionMessage,
      contextInfo: { mentionedJid: [sender] },
      buttons: [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 },
        { buttonId: `${config.PREFIX}alive`, buttonText: { displayText: '🤖 BOT INFO' }, type: 1 }
      ]
    }, { quoted: shonux }); // 🔹 fake contact quoted

  } catch (err) {
    console.error("Error in Instagram downloader:", err);
    await socket.sendMessage(sender, { 
      text: '*❌ Internal Error. Please try again later.*',
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 }]
    });
  }
  break;
}

case 'online': {
  try {
    if (!(from || '').endsWith('@g.us')) {
      await socket.sendMessage(sender, { text: '❌ This command works only in group chats.' }, { quoted: msg });
      break;
    }

    let groupMeta;
    try { groupMeta = await socket.groupMetadata(from); } catch (err) { console.error(err); break; }

    const callerJid = (nowsender || '').replace(/:.*$/, '');
    const callerId = callerJid.includes('@') ? callerJid : `${callerJid}@s.whatsapp.net`;
    const ownerNumberClean = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    const isOwnerCaller = callerJid.startsWith(ownerNumberClean);
    const groupAdmins = (groupMeta.participants || []).filter(p => p.admin === 'admin' || p.admin === 'superadmin').map(p => p.id);
    const isGroupAdminCaller = groupAdmins.includes(callerId);

    if (!isOwnerCaller && !isGroupAdminCaller) {
      await socket.sendMessage(sender, { text: '❌ Only group admins or the bot owner can use this command.' }, { quoted: msg });
      break;
    }

    try { await socket.sendMessage(sender, { text: '🔄 Scanning for online members... please wait ~15 seconds' }, { quoted: msg }); } catch(e){}

    const participants = (groupMeta.participants || []).map(p => p.id);
    const onlineSet = new Set();
    const presenceListener = (update) => {
      try {
        if (update?.presences) {
          for (const id of Object.keys(update.presences)) {
            const pres = update.presences[id];
            if (pres?.lastKnownPresence && pres.lastKnownPresence !== 'unavailable') onlineSet.add(id);
            if (pres?.available === true) onlineSet.add(id);
          }
        }
      } catch (e) { console.warn('presenceListener error', e); }
    };

    for (const p of participants) {
      try { if (typeof socket.presenceSubscribe === 'function') await socket.presenceSubscribe(p); } catch(e){}
    }
    socket.ev.on('presence.update', presenceListener);

    const checks = 3; const intervalMs = 5000;
    await new Promise((resolve) => { let attempts=0; const iv=setInterval(()=>{ attempts++; if(attempts>=checks){ clearInterval(iv); resolve(); } }, intervalMs); });
    try { socket.ev.off('presence.update', presenceListener); } catch(e){}

    if (onlineSet.size === 0) {
      await socket.sendMessage(sender, { text: '⚠️ No online members detected (they may be hiding presence or offline).' }, { quoted: msg });
      break;
    }

    const onlineArray = Array.from(onlineSet).filter(j => participants.includes(j));
    const mentionList = onlineArray.map(j => j);

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    // BotName meta mention
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_ONLINE" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let txt = `🟢 *Online Members* — ${onlineArray.length}/${participants.length}\n\n`;
    onlineArray.forEach((jid, i) => {
      txt += `${i+1}. @${jid.split('@')[0]}\n`;
    });

    await socket.sendMessage(sender, {
      text: txt.trim(),
      mentions: mentionList
    }, { quoted: metaQuote }); // <-- botName meta mention

  } catch (err) {
    console.error('Error in online command:', err);
    try { await socket.sendMessage(sender, { text: '❌ An error occurred while checking online members.' }, { quoted: msg }); } catch(e){}
  }
  break;
}



case 'deladmin': {
  if (!args || args.length === 0) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN1" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❗ Provide a jid/number to remove\nExample: .deladmin 9477xxxxxxx' }, { quoted: shonux });
  }

  const jidOr = args[0].trim();
  if (!isOwner) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN2" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❌ Only owner can remove admins.' }, { quoted: shonux });
  }

  try {
    await removeAdminFromMongo(jidOr);

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN3" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Removed admin: ${jidOr}` }, { quoted: shonux });
  } catch (e) {
    console.error('deladmin error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN4" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `❌ Failed to remove admin: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}

case 'admins': {
  try {
    const list = await loadAdminsFromMongo();
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADMINS" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    if (!list || list.length === 0) {
      return await socket.sendMessage(sender, { text: 'No admins configured.' }, { quoted: shonux });
    }

    let txt = '*👑 Admins:*\n\n';
    for (const a of list) txt += `• ${a}\n`;

    await socket.sendMessage(sender, { text: txt }, { quoted: shonux });
  } catch (e) {
    console.error('admins error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'CHAMA MINI BOT AI';
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADMINS2" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: '❌ Failed to list admins.' }, { quoted: shonux });
  }
  break;
}
case 'setlogo': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
  if (senderNum !== sanitized && senderNum !== ownerNum) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETLOGO1" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change this session logo.' }, { quoted: shonux });
    break;
  }

  const ctxInfo = (msg.message.extendedTextMessage || {}).contextInfo || {};
  const quotedMsg = ctxInfo.quotedMessage;
  const media = await downloadQuotedMedia(quotedMsg).catch(()=>null);
  let logoSetTo = null;

  try {
    if (media && media.buffer) {
      const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
      fs.ensureDirSync(sessionPath);
      const mimeExt = (media.mime && media.mime.split('/').pop()) || 'jpg';
      const logoPath = path.join(sessionPath, `logo.${mimeExt}`);
      fs.writeFileSync(logoPath, media.buffer);
      let cfg = await loadUserConfigFromMongo(sanitized) || {};
      cfg.logo = logoPath;
      await setUserConfigInMongo(sanitized, cfg);
      logoSetTo = logoPath;
    } else if (args && args[0] && (args[0].startsWith('http') || args[0].startsWith('https'))) {
      let cfg = await loadUserConfigFromMongo(sanitized) || {};
      cfg.logo = args[0];
      await setUserConfigInMongo(sanitized, cfg);
      logoSetTo = args[0];
    } else {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETLOGO2" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: '❗ Usage: Reply to an image with `.setlogo` OR provide an image URL: `.setlogo https://example.com/logo.jpg`' }, { quoted: shonux });
      break;
    }

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETLOGO3" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Logo set for this session: ${logoSetTo}` }, { quoted: shonux });
  } catch (e) {
    console.error('setlogo error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETLOGO4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: `❌ Failed to set logo: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}
case 'jid': {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || 'CHAMA MINI BOT AI'; // dynamic bot name

    const userNumber = sender.split('@')[0]; 

    // Reaction
    await socket.sendMessage(sender, { 
        react: { text: "🆔", key: msg.key } 
    });

    // Fake contact quoting for meta style
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_FAKE_ID" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, {
        text: `*🆔 Chat JID:* ${sender}\n*📞 Your Number:* +${userNumber}`,
    }, { quoted: shonux });
    break;
}

// use inside your switch(command) { ... } block

case 'block': {
  try {
    // caller number (who sent the command)
    const callerNumberClean = (senderNumber || '').replace(/[^0-9]/g, '');
    const ownerNumberClean = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    const sessionOwner = (number || '').replace(/[^0-9]/g, '');

    // allow if caller is global owner OR this session's owner
    if (callerNumberClean !== ownerNumberClean && callerNumberClean !== sessionOwner) {
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❌ ඔබට මෙය භාවිත කිරීමට අවසර නැත. (Owner හෝ මෙහි session owner විය යුතුයි)' }, { quoted: msg });
      break;
    }

    // determine target JID: reply / mention / arg
    let targetJid = null;
    const ctx = msg.message?.extendedTextMessage?.contextInfo;

    if (ctx?.participant) targetJid = ctx.participant; // replied user
    else if (ctx?.mentionedJid && ctx.mentionedJid.length) targetJid = ctx.mentionedJid[0]; // mentioned
    else if (args && args.length > 0) {
      const possible = args[0].trim();
      if (possible.includes('@')) targetJid = possible;
      else {
        const digits = possible.replace(/[^0-9]/g,'');
        if (digits) targetJid = `${digits}@s.whatsapp.net`;
      }
    }

    if (!targetJid) {
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❗ කරුණාකර reply කරන හෝ mention කරන හෝ number එක යොදන්න. උදාහරණය: .block 9477xxxxxxx' }, { quoted: msg });
      break;
    }

    // normalize
    if (!targetJid.includes('@')) targetJid = `${targetJid}@s.whatsapp.net`;
    if (!targetJid.endsWith('@s.whatsapp.net') && !targetJid.includes('@')) targetJid = `${targetJid}@s.whatsapp.net`;

    // perform block
    try {
      if (typeof socket.updateBlockStatus === 'function') {
        await socket.updateBlockStatus(targetJid, 'block');
      } else {
        // some bailey builds use same method name; try anyway
        await socket.updateBlockStatus(targetJid, 'block');
      }
      try { await socket.sendMessage(sender, { react: { text: "✅", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: `✅ @${targetJid.split('@')[0]} blocked successfully.`, mentions: [targetJid] }, { quoted: msg });
    } catch (err) {
      console.error('Block error:', err);
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❌ Failed to block the user. (Maybe invalid JID or API failure)' }, { quoted: msg });
    }

  } catch (err) {
    console.error('block command general error:', err);
    try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
    await socket.sendMessage(sender, { text: '❌ Error occurred while processing block command.' }, { quoted: msg });
  }
  break;
}

case 'unblock': {
  try {
    // caller number (who sent the command)
    const callerNumberClean = (senderNumber || '').replace(/[^0-9]/g, '');
    const ownerNumberClean = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    const sessionOwner = (number || '').replace(/[^0-9]/g, '');

    // allow if caller is global owner OR this session's owner
    if (callerNumberClean !== ownerNumberClean && callerNumberClean !== sessionOwner) {
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❌ ඔබට මෙය භාවිත කිරීමට අවසර නැත. (Owner හෝ මෙහි session owner විය යුතුයි)' }, { quoted: msg });
      break;
    }

    // determine target JID: reply / mention / arg
    let targetJid = null;
    const ctx = msg.message?.extendedTextMessage?.contextInfo;

    if (ctx?.participant) targetJid = ctx.participant;
    else if (ctx?.mentionedJid && ctx.mentionedJid.length) targetJid = ctx.mentionedJid[0];
    else if (args && args.length > 0) {
      const possible = args[0].trim();
      if (possible.includes('@')) targetJid = possible;
      else {
        const digits = possible.replace(/[^0-9]/g,'');
        if (digits) targetJid = `${digits}@s.whatsapp.net`;
      }
    }

    if (!targetJid) {
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❗ කරුණාකර reply කරන හෝ mention කරන හෝ number එක යොදන්න. උදාහරණය: .unblock 9477xxxxxxx' }, { quoted: msg });
      break;
    }

    // normalize
    if (!targetJid.includes('@')) targetJid = `${targetJid}@s.whatsapp.net`;
    if (!targetJid.endsWith('@s.whatsapp.net') && !targetJid.includes('@')) targetJid = `${targetJid}@s.whatsapp.net`;

    // perform unblock
    try {
      if (typeof socket.updateBlockStatus === 'function') {
        await socket.updateBlockStatus(targetJid, 'unblock');
      } else {
        await socket.updateBlockStatus(targetJid, 'unblock');
      }
      try { await socket.sendMessage(sender, { react: { text: "✅", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: `🔓 @${targetJid.split('@')[0]} unblocked successfully.`, mentions: [targetJid] }, { quoted: msg });
    } catch (err) {
      console.error('Unblock error:', err);
      try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
      await socket.sendMessage(sender, { text: '❌ Failed to unblock the user.' }, { quoted: msg });
    }

  } catch (err) {
    console.error('unblock command general error:', err);
    try { await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } }); } catch(e){}
    await socket.sendMessage(sender, { text: '❌ Error occurred while processing unblock command.' }, { quoted: msg });
  }
  break;
}
case 'setantilink': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');

  // Only session owner or bot owner can change setting
  if (senderNum !== sanitized && senderNum !== ownerNum) {
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change anti-link settings.' });
    break;
  }

  const val = (args[0] || '').toLowerCase();
  if (!['true','false','on','off','1','0'].includes(val)) {
    await socket.sendMessage(sender, { text: 'Usage: .setantilink <true|false>\nExample: .setantilink true' });
    break;
  }

  const boolVal = ['true','on','1'].includes(val);
  try {
    const existing = await loadUserConfigFromMongo(sanitized) || {};
    existing.antilink = boolVal;
    await setUserConfigInMongo(sanitized, existing);
    await socket.sendMessage(sender, { text: `✅ Anti-link system is now *${boolVal ? 'ENABLED' : 'DISABLED'}* for this session.` });
    try { await socket.sendMessage(sender, { react: { text: boolVal ? '🛡️' : '🚫', key: msg.key } }); } catch(e){}
  } catch (e) {
    console.error('Failed to set anti-link:', e);
    await socket.sendMessage(sender, { text: '❌ Failed to update anti-link setting. Check logs.' });
  }
  break;
}


case 'body': {
  try {
    if (!global.warnings) global.warnings = {};

    // Only act in groups where bot is admin and sender isn't admin
    if (!isGroup || isAdmins) break;

    // Load user config (session specific)
    const sessionNum = (m.key?.remoteJid || '').replace(/[^0-9]/g, '');
    const userCfg = await loadUserConfigFromMongo(sessionNum) || {};

    // Check if anti-link enabled
    if (!userCfg.antilink) break;

    // Detect link patterns
    const linkPatterns = [
      /https?:\/\/(?:chat\.whatsapp\.com|wa\.me)\/\S+/gi,
      /https?:\/\/(?:t\.me|telegram\.me)\/\S+/gi,
      /https?:\/\/(?:www\.)?discord\.com\/\S+/gi,
      /https?:\/\/(?:www\.)?twitter\.com\/\S+/gi,
      /https?:\/\/(?:www\.)?youtube\.com\/\S+/gi,
      /https?:\/\/(?:www\.)?facebook\.com\/\S+/gi,
      /https?:\/\/(?:www\.)?instagram\.com\/\S+/gi,
      /https?:\/\/(?:www\.)?tiktok\.com\/\S+/gi
    ];

    const containsLink = linkPatterns.some(pattern => pattern.test(body));
    if (!containsLink) break;

    // Try to delete message
    try {
      await socket.sendMessage(from, { delete: m.key });
    } catch (error) {
      console.error("Failed to delete message:", error);
    }

    // Warning count system
    global.warnings[sender] = (global.warnings[sender] || 0) + 1;
    const warningCount = global.warnings[sender];

    if (warningCount < 4) {
      await socket.sendMessage(from, {
        text: `⚠️ *LINK DETECTED!*\n\n` +
              `*👤 USER:* @${sender.split('@')[0]}\n` +
              `*📊 WARNING:* ${warningCount}/3\n` +
              `*🚫 REASON:* Sending links not allowed.`,
        mentions: [sender]
      });
    } else {
      await socket.sendMessage(from, {
        text: `@${sender.split('@')[0]} *has been removed for exceeding the warning limit!* 🚷`,
        mentions: [sender]
      });
      await socket.groupParticipantsUpdate(from, [sender], "remove");
      delete global.warnings[sender];
    }
  } catch (error) {
    console.error("Anti-link error:", error);
    reply("❌ Error while checking links.");
  }
  break;
}

case 'setbotname': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
  if (senderNum !== sanitized && senderNum !== ownerNum) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME1" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change this session bot name.' }, { quoted: shonux });
    break;
  }

  const name = args.join(' ').trim();
  if (!name) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { text: '❗ Provide bot name. Example: `.setbotname CHAMA MINI - 01`' }, { quoted: shonux });
  }

  try {
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    cfg.botName = name;
    await setUserConfigInMongo(sanitized, cfg);

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME3" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Bot display name set for this session: ${name}` }, { quoted: shonux });
  } catch (e) {
    console.error('setbotname error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETBOTNAME4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: `❌ Failed to set bot name: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}

case 'showconfig': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  try {
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SHOWCONFIG" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let txt = `*Session config for ${sanitized}:*\n`;
    txt += `• Bot name: ${botName}\n`;
    txt += `• Logo: ${cfg.logo || config.RCD_IMAGE_PATH}\n`;
    await socket.sendMessage(sender, { text: txt }, { quoted: shonux });
  } catch (e) {
    console.error('showconfig error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SHOWCONFIG2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to load config.' }, { quoted: shonux });
  }
  break;
}




case 'resetconfig': {
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        const senderNum = (nowsender || '').split('@')[0];
        const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
        if (senderNum !== sanitized && senderNum !== ownerNum) {
          const shonux = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RESETCONFIG1" },
            message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
          };
          await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can reset configs.' }, { quoted: shonux });
          break;
        }

        try {
          await setUserConfigInMongo(sanitized, {});

          const shonux = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RESETCONFIG2" },
            message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
          };

          await socket.sendMessage(sender, { text: '✅ Session config reset to defaults.' }, { quoted: shonux });
        } catch (e) {
          console.error('resetconfig error', e);
          const shonux = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_RESETCONFIG3" },
            message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
          };

          await socket.sendMessage(sender, { text: '❌ Failed to reset config.' }, { quoted: shonux });
        }
        break;
      }




// End of drop-in replacements

case 'setmode': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');

    // 🔹 Load user config from Mongo
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    // 🪪 Meta-style quote
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETMODE" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    // 🔐 Permission check
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const denyQuote = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETMODE_DENY" },
        message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { 
        text: `❌ Permission denied.\nOnly the session owner or *${botName}* owner can change the mode.` 
      }, { quoted: denyQuote });
      break;
    }

    // 🧭 Mode argument
    const modeArg = (args[0] || '').toLowerCase();
    const allowed = ['private','inbox','groups','public'];

    if (!modeArg || !allowed.includes(modeArg)) {
      await socket.sendMessage(sender, { 
        text: `📘 *${botName} MODE SETTINGS*\n\nUsage: .setmode <public|private|inbox|groups>\n\n🔹 public → everyone can use\n🔹 private → only session owner & bot owner\n🔹 inbox → only private chats allowed\n🔹 groups → only group chats allowed\n\n💡 Example:\n.setmode public`,
      }, { quoted: metaQuote });
      break;
    }

    // 🛠 Save to Mongo
    const existing = await loadUserConfigFromMongo(sanitized) || {};
    existing.mode = modeArg;
    await setUserConfigInMongo(sanitized, existing);

    await socket.sendMessage(sender, { 
      text: `✅ *${botName} Mode Updated!*\nCurrent Mode: *${modeArg.toUpperCase()}*\n\nUse .ping to check active settings.`,
    }, { quoted: metaQuote });

  } catch (e) {
    console.error('Failed to set mode:', e);
    await socket.sendMessage(sender, { 
      text: `❌ *${BOT_NAME_FANCY}* failed to update mode.\nPlease check logs or contact the owner.`,
    });
  }
  break;
}


      case 'getmode': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;
    const mode = cfg.mode || config.MODE || 'public';

    // 🪪 Meta-style vCard quote
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_GETMODE" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    // 🧭 Mode info message
    const text = `
🔎 *${botName} MODE INFO*

🟢 Current session mode: *${mode.toUpperCase()}*

📘 Mode Types:
- public → everyone can use
- private → only session owner & bot owner
- inbox → only private chats allowed
- groups → only group chats allowed
`;

    await socket.sendMessage(sender, { 
      text: text.trim(),
      footer: `✨ Powered by ${botName}`,
      buttons: [{ buttonId: `${config.PREFIX}setmode`, buttonText: { displayText: "⚙️ CHANGE MODE" }, type: 1 }],
      headerType: 1
    }, { quoted: metaQuote });

  } catch (e) {
    console.error('Failed to get mode:', e);
    await socket.sendMessage(sender, { text: `❌ *${BOT_NAME_FANCY}* failed to fetch mode.` });
  }
  break;
}

case 'getsr': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;
    const sr = cfg.sr || [];

    // 🪪 Meta-style vCard quote
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_GETSR" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    const text = sr.length
      ? `🔎 *${botName} Status Reactions*\n\n${sr.join(' ')}`
      : `ℹ️ *${botName}* has no status reaction emojis set for this session.\nUse .setsr to add some.`;

    await socket.sendMessage(sender, {
      text: text,
      footer: `✨ Powered by ${botName}`,
      buttons: [{ buttonId: `${config.PREFIX}setsr`, buttonText: { displayText: "⚙️ EDIT REACTIONS" }, type: 1 }],
      headerType: 1
    }, { quoted: metaQuote });

  } catch (e) {
    console.error('Failed to get sr:', e);
    await socket.sendMessage(sender, {
      text: `❌ *${BOT_NAME_FANCY}* failed to fetch status reactions.\nPlease check logs or contact the owner.`
    });
  }
  break;
}
case 'setsr': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');

    // 🔹 Load user config
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    // 🪪 Meta-style quote
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETSR" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    // 🔐 Permission check
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      await socket.sendMessage(sender, {
        text: `❌ Permission denied.\nOnly the session owner or *${botName}* owner can change status reaction settings.`
      }, { quoted: metaQuote });
      break;
    }

    // 🧩 Check args
    if (!args.length) {
      await socket.sendMessage(sender, {
        text: `📘 *${botName} STATUS REACTION SETTINGS*\n\nUsage: .setsr <emoji1,emoji2,...|clear>\n\nExamples:\n• .setsr ❤️,🔥,😂\n• .setsr clear`
      }, { quoted: metaQuote });
      break;
    }

    const joined = args.join(' ').trim();

    // 🧹 Clear reactions
    if (joined.toLowerCase() === 'clear' || joined.toLowerCase() === 'none') {
      const existing = await loadUserConfigFromMongo(sanitized) || {};
      existing.sr = [];
      await setUserConfigInMongo(sanitized, existing);
      await socket.sendMessage(sender, {
        text: `✅ All status reaction emojis have been *cleared* for this session.`,
      }, { quoted: metaQuote });
      break;
    }

    // 🧠 Parse emojis (commas or spaces)
    let emojis = joined.split(',').map(s => s.trim()).filter(Boolean);
    if (emojis.length === 1 && emojis[0].includes(' '))
      emojis = emojis[0].split(/\s+/).map(s => s.trim()).filter(Boolean);
    if (emojis.length > 20) emojis = emojis.slice(0, 20);

    // 💾 Save to Mongo
    const existing = await loadUserConfigFromMongo(sanitized) || {};
    existing.sr = emojis;
    await setUserConfigInMongo(sanitized, existing);

    await socket.sendMessage(sender, {
      text: `✅ *${botName}* status reaction list updated!\n\nNew Reactions:\n${emojis.join(' ')}`,
      footer: `✨ Powered by ${botName}`,
      buttons: [{ buttonId: `${config.PREFIX}getsr`, buttonText: { displayText: "?? VIEW REACTIONS" }, type: 1 }],
      headerType: 1
    }, { quoted: metaQuote });

  } catch (e) {
    console.error('Failed to set sr:', e);
    await socket.sendMessage(sender, {
      text: `❌ *${BOT_NAME_FANCY}* failed to update status reaction emojis.\nPlease check logs or contact the owner.`
    });
  }
  break;
}


      case 'getst': {
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        try {
          const existing = await loadUserConfigFromMongo(sanitized) || {};
          const stview = (typeof existing.stview !== 'undefined') ? (existing.stview ? 'ENABLED' : 'DISABLED') : (config.AUTO_VIEW_STATUS === 'true' ? 'ENABLED (global)' : 'DISABLED (global)');
          const sr = Array.isArray(existing.sr) && existing.sr.length ? existing.sr.join(' ') : (config.AUTO_LIKE_EMOJI.join(' '));
          await socket.sendMessage(sender, { text: `🔎 Status settings for this session:\n• Auto-view: *${stview}*\n• Status reacts: ${sr}` });
        } catch (e) { console.error('Failed to getst:', e); await socket.sendMessage(sender, { text: '❌ Failed to fetch status settings.' }); }
        break;
      }

      // default
      default:
        break;
      }
    } catch (err) {
      console.error('Command handler error:', err);
      try { await socket.sendMessage(sender, { image: { url: config.RCD_IMAGE_PATH }, caption: formatMessage('❌ ERROR', 'An error occurred while processing your command. Please try again.', BOT_NAME_FANCY) }); } catch(e){}
    }

  });
}

// ---------------- message handlers ----------------

function setupMessageHandlers(socket) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;
    if (config.AUTO_RECORDING === 'true') {
      try { await socket.sendPresenceUpdate('recording', msg.key.remoteJid); } catch (e) {}
    }
  });
}

// ---------------- cleanup helper ----------------

async function deleteSessionAndCleanup(number, socketInstance) {
  const sanitized = number.replace(/[^0-9]/g, '');
  try {
    const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
    try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch(e){}
    activeSockets.delete(sanitized); socketCreationTime.delete(sanitized);
    try { await removeSessionFromMongo(sanitized); } catch(e){}
    try { await removeNumberFromMongo(sanitized); } catch(e){}
    try {
      const ownerJid = `${config.OWNER_NUMBER.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
      const caption = formatMessage('👑 OWNER NOTICE — SESSION REMOVED', `Number: ${sanitized}\nSession removed due to logout.\n\nActive sessions now: ${activeSockets.size}`, BOT_NAME_FANCY);
      if (socketInstance && socketInstance.sendMessage) await socketInstance.sendMessage(ownerJid, { image: { url: config.RCD_IMAGE_PATH }, caption });
    } catch(e){}
    console.log(`Cleanup completed for ${sanitized}`);
  } catch (err) { console.error('deleteSessionAndCleanup error:', err); }
}

// ---------------- auto-restart ----------------

function setupAutoRestart(socket, number) {
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
                         || lastDisconnect?.error?.statusCode
                         || (lastDisconnect?.error && lastDisconnect.error.toString().includes('401') ? 401 : undefined);
      const isLoggedOut = statusCode === 401
                          || (lastDisconnect?.error && lastDisconnect.error.code === 'AUTHENTICATION')
                          || (lastDisconnect?.error && String(lastDisconnect.error).toLowerCase().includes('logged out'))
                          || (lastDisconnect?.reason === DisconnectReason?.loggedOut);
      if (isLoggedOut) {
        console.log(`User ${number} logged out. Cleaning up...`);
        try { await deleteSessionAndCleanup(number, socket); } catch(e){ console.error(e); }
      } else {
        console.log(`Connection closed for ${number} (not logout). Attempt reconnect...`);
        try { await delay(10000); activeSockets.delete(number.replace(/[^0-9]/g,'')); socketCreationTime.delete(number.replace(/[^0-9']/g,'')); const mockRes = { headersSent:false, send:() => {}, status: () => mockRes }; await EmpirePair(number, mockRes); } catch(e){ console.error('Reconnect attempt failed', e); }
      }

    }

  });
}

// ---------------- EmpirePair (pairing, temp dir, persist to Mongo) ----------------

async function EmpirePair(number, res) {
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const sessionPath = path.join(os.tmpdir(), `session_${sanitizedNumber}`);
  await initMongo().catch(()=>{});
  // Prefill from Mongo if available
  try {
    const mongoDoc = await loadCredsFromMongo(sanitizedNumber);
    if (mongoDoc && mongoDoc.creds) {
      fs.ensureDirSync(sessionPath);
      fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(mongoDoc.creds, null, 2));
      if (mongoDoc.keys) fs.writeFileSync(path.join(sessionPath, 'keys.json'), JSON.stringify(mongoDoc.keys, null, 2));
      console.log('Prefilled creds from Mongo');
    }
  } catch (e) { console.warn('Prefill from Mongo failed', e); }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

  try {
    const socket = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      printQRInTerminal: false,
      logger,
      browser: Browsers.macOS('Safari')
    });

    socketCreationTime.set(sanitizedNumber, Date.now());

    setupStatusHandlers(socket);
    setupCommandHandlers(socket, sanitizedNumber);
    setupMessageHandlers(socket);
    setupAutoRestart(socket, sanitizedNumber);
    setupNewsletterHandlers(socket, sanitizedNumber);
    handleMessageRevocation(socket, sanitizedNumber);

    if (!socket.authState.creds.registered) {
      let retries = config.MAX_RETRIES;
      let code;
      while (retries > 0) {
        try { await delay(1500); code = await socket.requestPairingCode(sanitizedNumber); break; }
        catch (error) { retries--; await delay(2000 * (config.MAX_RETRIES - retries)); }
      }
      if (!res.headersSent) res.send({ code });
    }

    // Save creds to Mongo when updated
    socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
        const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
        const credsObj = JSON.parse(fileContent);
        const keysObj = state.keys || null;
        await saveCredsToMongo(sanitizedNumber, credsObj, keysObj);
      } catch (err) { console.error('Failed saving creds on creds.update:', err); }
    });


    socket.ev.on('connection.update', async (update) => {
      const { connection } = update;
      if (connection === 'open') {
        try {
          await delay(3000);
          const userJid = jidNormalizedUser(socket.user.id);
          const groupResult = await joinGroup(socket).catch(()=>({ status: 'failed', error: 'joinGroup not configured' }));

          // try follow newsletters if configured
          try {
            const newsletterListDocs = await listNewslettersFromMongo();
            for (const doc of newsletterListDocs) {
              const jid = doc.jid;
              try { if (typeof socket.newsletterFollow === 'function') await socket.newsletterFollow(jid); } catch(e){}
            }
          } catch(e){}

          activeSockets.set(sanitizedNumber, socket);
          const groupStatus = groupResult.status === 'success' ? 'Joined successfully' : `Failed to join group: ${groupResult.error}`;

          // Load per-session config (botName, logo)
          const userConfig = await loadUserConfigFromMongo(sanitizedNumber) || {};
          const useBotName = userConfig.botName || BOT_NAME_FANCY;
          const useLogo = userConfig.logo || config.RCD_IMAGE_PATH;

          const initialCaption = formatMessage(useBotName,
            `✅\n\n✅ Successfully connected!\n\n🔢 Number: ${sanitizedNumber}\n🕒 Connecting: Bot will become active in a few seconds`,
            useBotName
          );

          // send initial message
          let sentMsg = null;
          try {
            if (String(useLogo).startsWith('http')) {
              sentMsg = await socket.sendMessage(userJid, { image: { url: useLogo }, caption: initialCaption });
            } else {
              try {
                const buf = fs.readFileSync(useLogo);
                sentMsg = await socket.sendMessage(userJid, { image: buf, caption: initialCaption });
              } catch (e) {
                sentMsg = await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: initialCaption });
              }
            }
          } catch (e) {
            console.warn('Failed to send initial connect message (image). Falling back to text.', e?.message || e);
            try { sentMsg = await socket.sendMessage(userJid, { text: initialCaption }); } catch(e){}
          }

          await delay(4000);

          const updatedCaption = formatMessage(useBotName,
            `✅\n\n✅ Successfully connected and ACTIVE!\n\n🔢 Number: ${sanitizedNumber}\n🩵 🕒 Connected at: ${getSriLankaTimestamp()}`,
            useBotName
          );

          try {
            if (sentMsg && sentMsg.key) {
              try {
                await socket.sendMessage(userJid, { delete: sentMsg.key });
              } catch (delErr) {
                console.warn('Could not delete original connect message (not fatal):', delErr?.message || delErr);
              }
            }

            try {
              if (String(useLogo).startsWith('http')) {
                await socket.sendMessage(userJid, { image: { url: useLogo }, caption: updatedCaption });
              } else {
                try {
                  const buf = fs.readFileSync(useLogo);
                  await socket.sendMessage(userJid, { image: buf, caption: updatedCaption });
                } catch (e) {
                  await socket.sendMessage(userJid, { text: updatedCaption });
                }
              }
            } catch (imgErr) {
              await socket.sendMessage(userJid, { text: updatedCaption });
            }
          } catch (e) {
            console.error('Failed during connect-message edit sequence:', e);
          }

          // send admin + owner notifications as before, with session overrides
          await sendAdminConnectMessage(socket, sanitizedNumber, groupResult, userConfig);
          await sendOwnerConnectMessage(socket, sanitizedNumber, groupResult, userConfig);
          await addNumberToMongo(sanitizedNumber);

        } catch (e) { 
          console.error('Connection open error:', e); 
          try { exec(`pm2.restart ${process.env.PM2_NAME || 'CHAMA-MINI-main'}`); } catch(e) { console.error('pm2 restart failed', e); }
        }
      }
      if (connection === 'close') {
        try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch(e){}
      }

    });


    activeSockets.set(sanitizedNumber, socket);

  } catch (error) {
    console.error('Pairing error:', error);
    socketCreationTime.delete(sanitizedNumber);
    if (!res.headersSent) res.status(503).send({ error: 'Service Unavailable' });
  }

}


// ---------------- endpoints (admin/newsletter management + others) ----------------

router.post('/newsletter/add', async (req, res) => {
  const { jid, emojis } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  if (!jid.endsWith('@newsletter')) return res.status(400).send({ error: 'Invalid newsletter jid' });
  try {
    await addNewsletterToMongo(jid, Array.isArray(emojis) ? emojis : []);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.post('/newsletter/remove', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await removeNewsletterFromMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.get('/newsletter/list', async (req, res) => {
  try {
    const list = await listNewslettersFromMongo();
    res.status(200).send({ status: 'ok', channels: list });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


// admin endpoints

router.post('/admin/add', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await addAdminToMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.post('/admin/remove', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await removeAdminFromMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.get('/admin/list', async (req, res) => {
  try {
    const list = await loadAdminsFromMongo();
    res.status(200).send({ status: 'ok', admins: list });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


// existing endpoints (connect, reconnect, active, etc.)

router.get('/', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).send({ error: 'Number parameter is required' });
  if (activeSockets.has(number.replace(/[^0-9]/g, ''))) return res.status(200).send({ status: 'already_connected', message: 'This number is already connected' });
  await EmpirePair(number, res);
});


router.get('/active', (req, res) => {
  res.status(200).send({ botName: BOT_NAME_FANCY, count: activeSockets.size, numbers: Array.from(activeSockets.keys()), timestamp: getSriLankaTimestamp() });
});


router.get('/ping', (req, res) => {
  res.status(200).send({ status: 'active', botName: BOT_NAME_FANCY, message: '🇱🇰CHAMA  FREE BOT', activesession: activeSockets.size });
});


router.get('/connect-all', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No numbers found to connect' });
    const results = [];
    for (const number of numbers) {
      if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); continue; }
      const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
      await EmpirePair(number, mockRes);
      results.push({ number, status: 'connection_initiated' });
    }
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { console.error('Connect all error:', error); res.status(500).send({ error: 'Failed to connect all bots' }); }
});


router.get('/reconnect', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No session numbers found in MongoDB' });
    const results = [];
    for (const number of numbers) {
      if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); continue; }
      const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
      try { await EmpirePair(number, mockRes); results.push({ number, status: 'connection_initiated' }); } catch (err) { results.push({ number, status: 'failed', error: err.message }); }
      await delay(1000);
    }
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { console.error('Reconnect error:', error); res.status(500).send({ error: 'Failed to reconnect bots' }); }
});

router.get('/update-config', async (req, res) => {
  const { number, config: configString } = req.query;
  if (!number || !configString) return res.status(400).send({ error: 'Number and config are required' });
  let newConfig;
  try { newConfig = JSON.parse(configString); } catch (error) { return res.status(400).send({ error: 'Invalid config format' }); }
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const socket = activeSockets.get(sanitizedNumber);
  if (!socket) return res.status(404).send({ error: 'No active session found for this number' });
  const otp = generateOTP();
  otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });
  try { await sendOTP(socket, sanitizedNumber, otp); res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' }); }
  catch (error) { otpStore.delete(sanitizedNumber); res.status(500).send({ error: 'Failed to send OTP' }); }
});


router.get('/verify-otp', async (req, res) => {
  const { number, otp } = req.query;
  if (!number || !otp) return res.status(400).send({ error: 'Number and OTP are required' });
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const storedData = otpStore.get(sanitizedNumber);
  if (!storedData) return res.status(400).send({ error: 'No OTP request found for this number' });
  if (Date.now() >= storedData.expiry) { otpStore.delete(sanitizedNumber); return res.status(400).send({ error: 'OTP has expired' }); }
  if (storedData.otp !== otp) return res.status(400).send({ error: 'Invalid OTP' });
  try {
    await setUserConfigInMongo(sanitizedNumber, storedData.newConfig);
    otpStore.delete(sanitizedNumber);
    const sock = activeSockets.get(sanitizedNumber);
    if (sock) await sock.sendMessage(jidNormalizedUser(sock.user.id), { image: { url: config.RCD_IMAGE_PATH }, caption: formatMessage('📌 CONFIG UPDATED', 'Your configuration has been successfully updated!', BOT_NAME_FANCY) });
    res.status(200).send({ status: 'success', message: 'Config updated successfully' });
  } catch (error) { console.error('Failed to update config:', error); res.status(500).send({ error: 'Failed to update config' }); }
});

router.get('/getabout', async (req, res) => {
  const { number, target } = req.query;
  if (!number || !target) return res.status(400).send({ error: 'Number and target number are required' });
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const socket = activeSockets.get(sanitizedNumber);
  if (!socket) return res.status(404).send({ error: 'No active session found for this number' });
  const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  try {
    const statusData = await socket.fetchStatus(targetJid);
    const aboutStatus = statusData.status || 'No status available';
    const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
    res.status(200).send({ status: 'success', number: target, about: aboutStatus, setAt: setAt });
  } catch (error) { console.error(`Failed to fetch status for ${target}:`, error); res.status(500).send({ status: 'error', message: `Failed to fetch About status for ${target}.` }); }
});


// ---------------- Dashboard endpoints & static ----------------

const dashboardStaticDir = path.join(__dirname, 'dashboard_static');
if (!fs.existsSync(dashboardStaticDir)) fs.ensureDirSync(dashboardStaticDir);
router.use('/dashboard/static', express.static(dashboardStaticDir));
router.get('/dashboard', async (req, res) => {
  res.sendFile(path.join(dashboardStaticDir, 'index.html'));
});


// API: sessions & active & delete

router.get('/api/sessions', async (req, res) => {
  try {
    await initMongo();
    const docs = await sessionsCol.find({}, { projection: { number: 1, updatedAt: 1 } }).sort({ updatedAt: -1 }).toArray();
    res.json({ ok: true, sessions: docs });
  } catch (err) {
    console.error('API /api/sessions error', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


router.get('/api/active', async (req, res) => {
  try {
    const keys = Array.from(activeSockets.keys());
    res.json({ ok: true, active: keys, count: keys.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


router.post('/api/session/delete', async (req, res) => {
  try {
    const { number } = req.body;
    if (!number) return res.status(400).json({ ok: false, error: 'number required' });
    const sanitized = ('' + number).replace(/[^0-9]/g, '');
    const running = activeSockets.get(sanitized);
    if (running) {
      try { if (typeof running.logout === 'function') await running.logout().catch(()=>{}); } catch(e){}
      try { running.ws?.close(); } catch(e){}
      activeSockets.delete(sanitized);
      socketCreationTime.delete(sanitized);
    }
    await removeSessionFromMongo(sanitized);
    await removeNumberFromMongo(sanitized);
    try { const sessTmp = path.join(os.tmpdir(), `session_${sanitized}`); if (fs.existsSync(sessTmp)) fs.removeSync(sessTmp); } catch(e){}
    res.json({ ok: true, message: `Session ${sanitized} removed` });
  } catch (err) {
    console.error('API /api/session/delete error', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});

router.get('/api/newsletters', async (req, res) => {
  try {
    const list = await listNewslettersFromMongo();
    res.json({ ok: true, list });
  } catch (err) { res.status(500).json({ ok: false, error: err.message || err }); }
});
router.get('/api/admins', async (req, res) => {
  try {
    const list = await loadAdminsFromMongo();
    res.json({ ok: true, list });
  } catch (err) { res.status(500).json({ ok: false, error: err.message || err }); }
});


// ---------------- cleanup + process events ----------------

process.on('exit', () => {
  activeSockets.forEach((socket, number) => {
    try { socket.ws.close(); } catch (e) {}
    activeSockets.delete(number);
    socketCreationTime.delete(number);
    try { fs.removeSync(path.join(os.tmpdir(), `session_${number}`)); } catch(e){}
  });
});


process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  try { exec(`pm2.restart ${process.env.PM2_NAME || 'CHAMA-MINI-main'}`); } catch(e) { console.error('Failed to restart pm2:', e); }
});


// initialize mongo & auto-reconnect attempt

initMongo().catch(err => console.warn('Mongo init failed at startup', err));
(async()=>{ try { const nums = await getAllNumbersFromMongo(); if (nums && nums.length) { for (const n of nums) { if (!activeSockets.has(n)) { const mockRes = { headersSent:false, send:()=>{}, status:()=>mockRes }; await EmpirePair(n, mockRes); await delay(500); } } } } catch(e){} })();


module.exports = router;
