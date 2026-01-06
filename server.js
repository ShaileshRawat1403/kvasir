import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { htmlToText } from "html-to-text";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3030;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "phi3";
const DEFAULT_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX || 4096);
const PY_API_BASE = process.env.PY_API_BASE || "http://localhost:8000";
const PY_API_TIMEOUT_MS = Number(process.env.PY_API_TIMEOUT_MS || 30000);
const IMAP_HOST = process.env.IMAP_HOST || "";
const IMAP_PORT = Number(process.env.IMAP_PORT || 993);
const IMAP_USER = process.env.IMAP_USER || "";
const IMAP_PASS = process.env.IMAP_PASS || "";
const IMAP_TLS = String(process.env.IMAP_TLS || "true").toLowerCase() !== "false";
const IMAP_MAILBOX = process.env.IMAP_MAILBOX || "INBOX";
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
const SMTP_USER = process.env.SMTP_USER || IMAP_USER;
const SMTP_PASS = process.env.SMTP_PASS || IMAP_PASS;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEMORY_DIR = path.join(__dirname, "kvasir_memory");
const EMAIL_CACHE_PATH = path.join(MEMORY_DIR, "email_cache.json"); // legacy; kept for compatibility
const EMAIL_DB_PATH = path.join(MEMORY_DIR, "email_cache.db");

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function ensureMemoryDir() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

ensureMemoryDir();

class EmailStore {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        uid INTEGER,
        thread_id TEXT,
        subject TEXT,
        from_list TEXT,
        to_list TEXT,
        cc_list TEXT,
        date TEXT,
        snippet TEXT,
        text TEXT,
        in_reply_to TEXT,
        references_list TEXT,
        unread INTEGER,
        labels TEXT,
        attachments TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);

      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        subject TEXT,
        participants TEXT,
        snippet TEXT,
        date TEXT,
        unread INTEGER,
        message_ids TEXT,
        has_attachments INTEGER
      );

      CREATE TABLE IF NOT EXISTS summaries (
        thread_id TEXT PRIMARY KEY,
        summary TEXT,
        updated_at TEXT
      );
    `);

    this.insertMessage = this.db.prepare(`
      INSERT INTO messages (id, uid, thread_id, subject, from_list, to_list, cc_list, date, snippet, text, in_reply_to, references_list, unread, labels, attachments)
      VALUES (@id, @uid, @thread_id, @subject, @from_list, @to_list, @cc_list, @date, @snippet, @text, @in_reply_to, @references_list, @unread, @labels, @attachments)
      ON CONFLICT(id) DO UPDATE SET
        uid=excluded.uid,
        thread_id=excluded.thread_id,
        subject=excluded.subject,
        from_list=excluded.from_list,
        to_list=excluded.to_list,
        cc_list=excluded.cc_list,
        date=excluded.date,
        snippet=excluded.snippet,
        text=excluded.text,
        in_reply_to=excluded.in_reply_to,
        references_list=excluded.references_list,
        unread=excluded.unread,
        labels=excluded.labels,
        attachments=excluded.attachments
    `);

    this.insertThread = this.db.prepare(`
      INSERT INTO threads (id, subject, participants, snippet, date, unread, message_ids, has_attachments)
      VALUES (@id, @subject, @participants, @snippet, @date, @unread, @message_ids, @has_attachments)
      ON CONFLICT(id) DO UPDATE SET
        subject=excluded.subject,
        participants=excluded.participants,
        snippet=excluded.snippet,
        date=excluded.date,
        unread=excluded.unread,
        message_ids=excluded.message_ids,
        has_attachments=excluded.has_attachments
    `);

    this.insertSummary = this.db.prepare(`
      INSERT INTO summaries (thread_id, summary, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(thread_id) DO UPDATE SET summary=excluded.summary, updated_at=excluded.updated_at
    `);
  }

  saveMessages(messages = []) {
    const tx = this.db.transaction((msgs) => {
      msgs.forEach((msg) => {
        this.insertMessage.run({
          id: msg.id,
          uid: msg.uid || null,
          thread_id: msg.threadId,
          subject: msg.subject,
          from_list: JSON.stringify(msg.from || []),
          to_list: JSON.stringify(msg.to || []),
          cc_list: JSON.stringify(msg.cc || []),
          date: msg.date,
          snippet: msg.snippet,
          text: msg.text || "",
          in_reply_to: msg.inReplyTo || "",
          references_list: JSON.stringify(msg.references || []),
          unread: msg.unread ? 1 : 0,
          labels: JSON.stringify(msg.labels || []),
          attachments: JSON.stringify(msg.attachments || []),
        });
      });
    });
    tx(messages);
  }

  saveThreads(threadsObj = {}) {
    const threads = Array.isArray(threadsObj)
      ? threadsObj
      : Object.values(threadsObj);
    const tx = this.db.transaction((items) => {
      items.forEach((t) => {
        this.insertThread.run({
          id: t.id,
          subject: t.subject,
          participants: JSON.stringify(t.participants || []),
          snippet: t.snippet,
          date: t.date,
          unread: t.unread ? 1 : 0,
          message_ids: JSON.stringify(t.messageIds || []),
          has_attachments: t.hasAttachments ? 1 : 0,
        });
      });
    });
    tx(threads);
  }

  saveSummary(threadId, summary) {
    this.insertSummary.run(threadId, JSON.stringify(summary || {}));
  }

  getSummary(threadId) {
    const row = this.db
      .prepare("SELECT summary FROM summaries WHERE thread_id = ?")
      .get(threadId);
    if (!row) return null;
    try {
      return JSON.parse(row.summary);
    } catch (_e) {
      return null;
    }
  }

  getThreads({ limit = 100 } = {}) {
    const rows = this.db
      .prepare(
        "SELECT * FROM threads ORDER BY datetime(date) DESC LIMIT ?"
      )
      .all(limit);
    return rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      participants: this.safeParse(row.participants, []),
      snippet: row.snippet,
      date: row.date,
      unread: !!row.unread,
      messageIds: this.safeParse(row.message_ids, []),
      hasAttachments: !!row.has_attachments,
    }));
  }

  countMessages(threadId) {
    const row = this.db.prepare("SELECT COUNT(*) as cnt FROM messages WHERE thread_id = ?").get(threadId);
    return row?.cnt || 0;
  }

  getThread(threadId, { limit = 80 } = {}) {
    const threadRow = this.db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId);
    if (!threadRow) return { thread: null, messages: [], totalMessages: 0 };

    const msgRows = this.db
      .prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY datetime(date) DESC LIMIT ?")
      .all(threadId, limit);

    const totalMessages = this.countMessages(threadId);

    const messages = msgRows
      .reverse() // present oldest -> newest to the UI
      .map((row) => ({
        id: row.id,
        uid: row.uid,
        threadId: row.thread_id,
        subject: row.subject,
        from: this.safeParse(row.from_list, []),
      to: this.safeParse(row.to_list, []),
      cc: this.safeParse(row.cc_list, []),
      date: row.date,
      snippet: row.snippet,
      text: row.text,
      inReplyTo: row.in_reply_to,
      references: this.safeParse(row.references_list, []),
      unread: !!row.unread,
        labels: this.safeParse(row.labels, []),
        attachments: this.safeParse(row.attachments, []),
      }));

    const thread = {
      id: threadRow.id,
      subject: threadRow.subject,
      participants: this.safeParse(threadRow.participants, []),
      snippet: threadRow.snippet,
      date: threadRow.date,
      unread: !!threadRow.unread,
      messageIds: this.safeParse(threadRow.message_ids, []),
      hasAttachments: !!threadRow.has_attachments,
    };

    return { thread, messages, totalMessages };
  }

  safeParse(val, fallback) {
    try {
      return JSON.parse(val);
    } catch (_e) {
      return fallback;
    }
  }
}

const emailStore = new EmailStore(EMAIL_DB_PATH);

function normalizeSubject(subject = "") {
  let s = subject.trim();
  while (/^(re:|fwd:)/i.test(s)) {
    s = s.replace(/^(re:|fwd:)\s*/i, "").trim();
  }
  return s.toLowerCase() || "(no subject)";
}

function addressListToText(list = []) {
  return list
    .map((item) => {
      if (!item) return "";
      const name = item.name ? item.name.trim() : "";
      const addr = item.address || "";
      return name ? `${name} <${addr}>` : addr;
    })
    .filter(Boolean);
}

function toPlainText(parsed) {
  if (parsed.text) return parsed.text.trim();
  if (parsed.html) return htmlToText(parsed.html, { wordwrap: false }).trim();
  return "";
}

async function callPythonApi(pathname, { method = "GET", body } = {}) {
  const url = `${PY_API_BASE}${pathname}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PY_API_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Python API error ${resp.status}: ${text}`);
    }
    const data = await resp.json();
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function ingestMessagesToBrain(messages = []) {
  if (!messages.length) return;
  try {
    const payload = {
      messages: messages.map((m) => ({
        subject: m.subject,
        text: m.text || m.snippet || "",
        snippet: m.snippet || "",
        date: m.date,
        thread_id: m.threadId,
        message_id: m.id,
        from: m.from || [],
        to: m.to || [],
        cc: m.cc || [],
      })),
    };
    await callPythonApi("/ingest/email", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("Python ingest failed:", err?.message || err);
  }
}

async function connectImap() {
  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS) {
    throw new Error("IMAP is not configured (IMAP_HOST/IMAP_USER/IMAP_PASS)");
  }
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: IMAP_TLS,
    auth: {
      user: IMAP_USER,
      pass: IMAP_PASS,
    },
    logger: false,
  });
  await client.connect();
  return client;
}

async function fetchRecentMessages({
  limit = 10,
  importantOnly = false,
  unreadOnly = false,
  days = null,
  senderFilter = "",
}) {
  const client = await connectImap();
  let lock;
  try {
    console.log(
      `IMAP: connecting to ${IMAP_HOST}:${IMAP_PORT}, limit=${limit}, important=${importantOnly}, unread=${unreadOnly}, days=${days}`
    );
    lock = await client.getMailboxLock(IMAP_MAILBOX);
    const status = await client.status(IMAP_MAILBOX, {
      messages: true,
      uidNext: true,
    });
    const total = status.messages || 0;
    const uidNext = status.uidNext || 1;
    if (!total) {
      console.log("IMAP: mailbox empty");
      return [];
    }
    const hasSender = !!senderFilter;
    const rangeFactor = hasSender ? 60 : importantOnly ? 30 : unreadOnly ? 8 : 4;
    const startUid = Math.max(1, uidNext - limit * rangeFactor); // fetch deeper when filtering
    const range = `${startUid}:${uidNext - 1}`;
    console.log(
      `IMAP: mailbox ${IMAP_MAILBOX} stats total=${total} uidNext=${uidNext} using range ${range}`
    );

    const messages = [];

    try {
      const fetcher = client.fetch(
        range,
        {
          envelope: true,
          flags: true,
          internalDate: true,
          labels: importantOnly ? true : undefined,
        },
        { uid: true }
      );

      const iterator = fetcher[Symbol.asyncIterator]();
      while (messages.length < limit) {
        const { value: msg, done } = await iterator.next();
        if (done || !msg) break;
        console.log(`IMAP: processing uid=${msg.uid}`);
        const subject = msg.envelope?.subject || "(No subject)";
        const normalizedSubject = normalizeSubject(subject);
        const messageId = msg.envelope?.messageId || `uid-${msg.uid}`;
        const threadId = normalizedSubject || `thread-${msg.uid}`;

        const flags = Array.isArray(msg.flags)
          ? msg.flags
          : Array.from(msg.flags || []);

        const labels = Array.isArray(msg.labels)
          ? msg.labels
          : Array.from(msg.labels || []);

        const message = {
          id: messageId,
          uid: msg.uid,
          threadId,
          subject,
          from: addressListToText(msg.envelope?.from || []),
          to: addressListToText(msg.envelope?.to || []),
          cc: addressListToText(msg.envelope?.cc || []),
          date: (msg.internalDate || new Date()).toISOString(),
          text: "",
          snippet: subject || "",
          inReplyTo: msg.envelope?.inReplyTo || "",
          references: msg.envelope?.references || [],
          unread: !flags.includes("\\Seen"),
          labels,
          internalDate: msg.internalDate,
          attachments: [],
        };

        // Filters: important/unread/recency
        if (
          importantOnly &&
          !labels.some((l) => String(l).toLowerCase().includes("important"))
        ) {
          continue;
        }
        if (unreadOnly && !message.unread) {
          continue;
        }
        if (days) {
          const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
          const msgTime = new Date(message.date).getTime();
          if (msgTime < cutoff) {
            continue;
          }
        }
        if (senderFilter) {
          const needle = senderFilter.toLowerCase();
          const haystack = [
            ...(message.from || []),
            ...(message.to || []),
            ...(message.cc || []),
          ]
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(needle)) continue;
        }

        messages.push(message);

        if (messages.length >= limit) break;
      }
    } catch (err) {
      console.error("IMAP fetch error", err);
      throw err;
    }

    emailStore.saveMessages(messages);
    console.log(`IMAP: fetched ${messages.length} messages`);
    return messages;
  } finally {
    if (lock) {
      try {
        lock.release();
      } catch (_e) {
        // ignore
      }
    }
    try {
      client.logout().catch(() => {});
    } catch (_e) {
      // ignore logout errors
    }
  }
}

async function buildThreads({
  limit = 10,
  importantOnly = false,
  unreadOnly = false,
  days = null,
  senderFilter = "",
}) {
  console.log(
    `IMAP: buildThreads start limit=${limit} important=${importantOnly} unread=${unreadOnly} days=${days} sender=${senderFilter}`
  );
  const messages = await fetchRecentMessages({
    limit,
    importantOnly,
    unreadOnly,
    days,
    senderFilter,
  });
  // If sender filter yields nothing, try one more deeper fetch.
  if (!messages.length && senderFilter) {
    const retry = await fetchRecentMessages({
      limit,
      importantOnly,
      unreadOnly,
      days,
      senderFilter,
    });
    if (retry.length) {
      messages.push(...retry);
    }
  }
  console.log(`IMAP: buildThreads got ${messages.length} messages`);
  const threadsMap = new Map();

  for (const msg of messages) {
    const key = msg.threadId;
    const existing = threadsMap.get(key) || {
      id: key,
      subject: msg.subject || "(No subject)",
      participants: new Set(),
      snippet: msg.snippet,
      date: msg.date,
      unread: false,
      messageIds: [],
      hasAttachments: false,
    };

    const participants = [
      ...(msg.from || []),
      ...(msg.to || []),
      ...(msg.cc || []),
    ];
    participants.forEach((p) => existing.participants.add(p));

    existing.date =
      new Date(msg.date) > new Date(existing.date || 0) ? msg.date : existing.date;
    existing.snippet = msg.snippet || existing.snippet;
    existing.unread = existing.unread || msg.unread;
    existing.hasAttachments = existing.hasAttachments || (msg.attachments || []).length > 0;
    existing.messageIds.push(msg.id);

    threadsMap.set(key, existing);
  }

  const threads = {};
  for (const [key, data] of threadsMap.entries()) {
    threads[key] = {
      id: data.id,
      subject: data.subject,
      participants: Array.from(data.participants),
      snippet: data.snippet,
      date: data.date,
      unread: data.unread,
      messageIds: data.messageIds,
    };
  }
  emailStore.saveMessages(messages);
  emailStore.saveThreads(threads);

  const sorted = emailStore.getThreads({ limit: Math.max(limit, 50) });
  console.log(`IMAP: buildThreads done count=${sorted.length}`);
  return sorted.slice(0, limit);
}

function getCachedThread(threadId, limit = 80) {
  return emailStore.getThread(threadId, { limit });
}

async function loadThread(threadId, limit = 80) {
  const cached = getCachedThread(threadId, limit);
  if (cached && cached.thread && cached.messages.length) {
    await hydrateThreadMessages(cached.messages);
    return emailStore.getThread(threadId, { limit });
  }

  await buildThreads(limit);
  const refreshed = getCachedThread(threadId, limit);
  if (refreshed && refreshed.thread && refreshed.messages.length) {
    await hydrateThreadMessages(refreshed.messages);
    return emailStore.getThread(threadId, { limit });
  }

  return { thread: null, messages: [], totalMessages: 0 };
}

async function hydrateThreadMessages(messages) {
  const missingBodies = messages.filter((m) => !m.text);
  if (!missingBodies.length) return;

  const client = await connectImap();
  try {
    await client.mailboxOpen(IMAP_MAILBOX);
    for (const msg of missingBodies) {
      try {
        const fetched = await client.fetchOne(msg.uid, { source: true, envelope: true }, { uid: true });
        if (!fetched?.source) continue;
        const parsed = await simpleParser(fetched.source);
        const text = toPlainText(parsed);
        msg.text = text;
        msg.snippet = text.replace(/\s+/g, " ").trim().slice(0, 160) || msg.snippet;
        msg.inReplyTo = parsed.inReplyTo || msg.inReplyTo || "";
        msg.references = parsed.references || msg.references || [];
        msg.subject = parsed.subject || msg.subject;
        msg.date = (parsed.date || msg.date || new Date()).toISOString();
        msg.attachments =
          (parsed.attachments || []).map((att) => att.filename || att.contentType || "attachment") || [];
        emailStore.saveMessages([msg]);
      } catch (err) {
        console.error(`IMAP hydrate failed for uid=${msg.uid}`, err);
      }
    }
    emailStore.saveMessages(missingBodies);
    await ingestMessagesToBrain(missingBodies);
  } finally {
    try {
      await client.logout();
    } catch (_e) {
      // ignore
    }
  }
}

async function callOllamaChat({
  system,
  user,
  messages,
  model,
  temperature = 0.4,
}) {
  const finalMessages =
    messages && Array.isArray(messages) && messages.length
      ? messages
      : [
          { role: "system", content: system },
          ...(user ? [{ role: "user", content: user }] : []),
        ];

  const payload = {
    model: model || DEFAULT_MODEL,
    messages: finalMessages,
    stream: false,
    options: {
      temperature,
      num_ctx: DEFAULT_NUM_CTX,
    },
  };

  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM call failed: ${text}`);
  }

  const data = await response.json();
  return data?.message?.content || "";
}

async function generateSummary(threadId) {
  const { thread, messages } = await loadThread(threadId);
  if (!thread || !messages.length) {
    throw new Error("Thread not found or empty");
  }

  const cachedSummary = emailStore.getSummary(threadId);
  if (cachedSummary) return cachedSummary;

  const trimmedMessages = messages.slice(-4).reverse();
  const compiled = trimmedMessages
    .map(
      (m) =>
        `FROM: ${m.from?.join(", ") || "Unknown"}\nTO: ${
          m.to?.join(", ") || "Unknown"
        }\nDATE: ${m.date}\nSUBJECT: ${m.subject}\nBODY:\n${(m.text || "").slice(0, 1200)}`
    )
    .join("\n\n---\n\n");

  const system = [
    "You are an email communications specialist. Summarize this thread for fast triage.",
    "Return ONLY JSON with these keys:",
    "bullets (3-5 items, each <=140 chars),",
    "actions (0-3 items, each <=120 chars),",
    "sentiment (positive/neutral/negative),",
    "urgency (low/medium/high),",
    "whoNeedsToAct (short string),",
    "oneLiner (<=140 chars).",
    "No prose, no markdown, no code fences—just JSON.",
  ].join(" ");

  const user = `Email thread (most recent first):\n\n${compiled}`;

  const content = await callOllamaChat({ system, user, temperature: 0.2 });

  let parsed;
  try {
    const cleaned = content
      .trim()
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (_e) {
    parsed = { bullets: [content], actions: [], sentiment: "unknown", urgency: "unknown", whoNeedsToAct: "", oneLiner: "" };
  }

  emailStore.saveSummary(threadId, parsed);
  return parsed;
}

async function generateDraft({ threadId, goal, personaName, personaStyle, tone }) {
  const { thread, messages } = await loadThread(threadId);
  if (!thread || !messages.length) {
    throw new Error("Thread not found or empty");
  }

  const summary = emailStore.getSummary(threadId) || (await generateSummary(threadId));
  const latest = messages[messages.length - 1];
  const latestBody = (latest.text || "").slice(0, 1200);

  const system = [
    `You are an email communications specialist replying as "${personaName || "Default Persona"}".`,
    "Stay within 2 short paragraphs or 6 sentences total.",
    "Start with the answer/ask. No preamble like 'Here is your draft'.",
    "Keep it professional, clear, and aligned to the style guide below.",
    personaStyle || "",
  ].join("\n");

  const user = [
    `User goal: ${goal || "Respond appropriately."}`,
    `Desired tone: ${tone || "default"}. If 'formal', be polished; if 'casual', be friendly; if 'assertive', be direct; if 'concise', be shorter; if 'detailed', add context but stay brief.`,
    `Thread summary JSON: ${JSON.stringify(summary)}`,
    "Latest message (truncated):",
    `FROM: ${latest.from?.join(", ") || "Unknown"}`,
    `TO: ${latest.to?.join(", ") || "Unknown"}`,
    `SUBJECT: ${latest.subject}`,
    `BODY:\n${latestBody}`,
  ].join("\n\n");

  const tempByTone =
    tone === "assertive" ? 0.25 : tone === "casual" ? 0.35 : tone === "detailed" ? 0.35 : 0.3;

  const draft = await callOllamaChat({ system, user, temperature: tempByTone });
  return { draft, summary };
}

async function sendEmail({ to, subject, body, fromAddress }) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error("SMTP is not configured");
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const mailOptions = {
    from: fromAddress || SMTP_USER,
    to,
    subject,
    text: body,
  };

  const info = await transporter.sendMail(mailOptions);
  return info;
}

// Knowledge base: proxy to Python FastAPI
app.post("/api/knowledge/ingest", async (req, res) => {
  const { content, metadata, type } = req.body || {};
  if (!content) {
    return res.status(400).json({ error: "content is required" });
  }
  try {
    const payload = { content, metadata: metadata || {}, type: type || "text" };
    const data = await callPythonApi("/ingest", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return res.json(data);
  } catch (err) {
    const msg = err?.message || String(err);
    return res.status(502).json({ error: "Python ingest failed", details: msg });
  }
});

app.post("/api/knowledge/ingest-email", async (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array is required" });
  }
  try {
    const data = await callPythonApi("/ingest/email", {
      method: "POST",
      body: JSON.stringify({ messages }),
    });
    return res.json(data);
  } catch (err) {
    const msg = err?.message || String(err);
    return res.status(502).json({ error: "Python email ingest failed", details: msg });
  }
});

app.get("/api/knowledge/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  const k = Number(req.query.k || 4);
  if (!q) return res.status(400).json({ error: "q is required" });
  try {
    const data = await callPythonApi(`/search?q=${encodeURIComponent(q)}&k=${Math.max(1, k)}`);
    return res.json(data);
  } catch (err) {
    const msg = err?.message || String(err);
    return res.status(502).json({ error: "Python search failed", details: msg });
  }
});

app.get("/api/knowledge/graph", async (req, res) => {
  const entity = (req.query.entity || req.query.q || "").trim();
  if (!entity) return res.status(400).json({ error: "entity is required" });
  try {
    const data = await callPythonApi(`/graph?entity=${encodeURIComponent(entity)}`);
    return res.json(data);
  } catch (err) {
    const msg = err?.message || String(err);
    return res.status(502).json({ error: "Python graph lookup failed", details: msg });
  }
});

// Graph preview for visualization (capped)
app.get("/api/knowledge/graph-preview", async (req, res) => {
  const entity = (req.query.entity || "").trim();
  const limitParam = req.query.limit ? Number(req.query.limit) : 200;
  const edgeLimit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 200;
  if (!entity) return res.status(400).json({ error: "entity is required" });

  try {
    const data = await callPythonApi(`/graph?entity=${encodeURIComponent(entity)}`);
    const relations = Array.isArray(data?.relations) ? data.relations : [];
    const nodesMap = new Map();
    const edges = [];

    for (const rel of relations) {
      if (edges.length >= edgeLimit) break;
      if (!rel.subject || !rel.object) continue;
      nodesMap.set(rel.subject, { id: rel.subject, label: rel.subject });
      nodesMap.set(rel.object, { id: rel.object, label: rel.object });
      edges.push({
        source: rel.subject,
        target: rel.object,
        predicate: rel.predicate || "relates_to",
      });
    }

    const moreAvailable = relations.length > edges.length;
    return res.json({
      entity,
      nodes: Array.from(nodesMap.values()),
      edges,
      moreAvailable,
      totalRelations: relations.length,
      edgeLimit,
    });
  } catch (err) {
    const msg = err?.message || String(err);
    return res.status(502).json({ error: "Python graph preview failed", details: msg });
  }
});

app.post("/api/knowledge/chat", async (req, res) => {
  const { messages, query, persona, goal, k, model } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: "messages are required" });
  }
  try {
    const data = await callPythonApi("/chat", {
      method: "POST",
      body: JSON.stringify({
        messages,
        query,
        persona,
        goal,
        k,
        model,
      }),
    });
    return res.json(data);
  } catch (err) {
    const msg = err?.message || String(err);
    return res.status(502).json({ error: "Python chat failed", details: msg });
  }
});

// List available models from Ollama (used by frontend to auto-populate dropdown)
app.get("/api/tags", async (_req, res) => {
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!resp.ok) {
      const text = await resp.text();
      return res
        .status(resp.status)
        .json({ error: "Failed to fetch tags", details: text });
    }
    const data = await resp.json();
    return res.json(data);
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Server error", details: String(err) });
  }
});

app.post("/api/chat", async (req, res) => {
  const { systemPrompt, messages, temperature, model } = req.body || {};
  if (!systemPrompt || !Array.isArray(messages)) {
    return res
      .status(400)
      .json({ error: "systemPrompt and messages are required" });
  }

  const llmMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    })),
  ];

  try {
    const content = await callOllamaChat({
      messages: llmMessages,
      model,
      temperature: typeof temperature === "number" ? temperature : 0.4,
    });
    return res.json({ content });
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: String(err) });
  }
});

// Email: list threads
app.get("/api/email/threads", async (req, res) => {
  const limit = Math.max(1, Number(req.query.limit || 10));
  const importantOnly = String(req.query.important || "false").toLowerCase() === "true";
  const unreadOnly = String(req.query.unread || "false").toLowerCase() === "true";
  const daysParam = req.query.days ? Number(req.query.days) : null;
  const days = daysParam && daysParam > 0 ? daysParam : null;
  const senderFilter = (req.query.sender || "").trim();
  const started = Date.now();
  try {
    const threads = await buildThreads({ limit, importantOnly, unreadOnly, days, senderFilter });
    const duration = Date.now() - started;
    console.log(`IMAP: /threads responded with ${threads.length} threads in ${duration}ms`);
    return res.json({ threads, durationMs: duration });
  } catch (err) {
    const msg = err?.message || String(err);
    console.error("IMAP threads error", msg);
    return res.status(500).json({ error: "Failed to load threads", details: msg });
  }
});

// Email: thread detail
app.get("/api/email/thread/:id", async (req, res) => {
  const threadId = req.params.id;
  const limitParam = req.query.limit ? Number(req.query.limit) : 80;
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 80;
  if (!threadId) {
    return res.status(400).json({ error: "threadId is required" });
  }
  try {
    const { thread, messages, totalMessages } = await loadThread(threadId, limit);
    if (!thread) {
      return res.status(404).json({ error: "Thread not found" });
    }
    return res.json({ thread, messages, totalMessages });
  } catch (err) {
    const msg = err?.message || String(err);
    return res.status(500).json({ error: "Failed to load thread", details: msg });
  }
});

// Email: summary
app.post("/api/email/summary", async (req, res) => {
  const { threadId } = req.body || {};
  if (!threadId) {
    return res.status(400).json({ error: "threadId is required" });
  }
  try {
    const summary = await generateSummary(threadId);
    return res.json({ summary });
  } catch (err) {
    const msg = err?.message || String(err);
    return res.status(500).json({ error: "Failed to summarize thread", details: msg });
  }
});

// Email: draft reply
app.post("/api/email/draft", async (req, res) => {
  const { threadId, goal, personaName, personaStyle, tone } = req.body || {};
  if (!threadId) {
    return res.status(400).json({ error: "threadId is required" });
  }
  try {
    const { draft, summary } = await generateDraft({
      threadId,
      goal,
      personaName,
      personaStyle,
      tone,
    });
    return res.json({ draft, summary });
  } catch (err) {
    const msg = err?.message || String(err);
    return res.status(500).json({ error: "Failed to draft reply", details: msg });
  }
});

// Email: send reply
app.post("/api/email/send", async (req, res) => {
  const { threadId, to, subject, body, from } = req.body || {};
  if (!threadId || !to || !subject || !body) {
    return res.status(400).json({ error: "threadId, to, subject, and body are required" });
  }
  try {
    const info = await sendEmail({
      to,
      subject,
      body,
      fromAddress: from,
    });
    return res.json({ status: "sent", messageId: info.messageId });
  } catch (err) {
    const msg = err?.message || String(err);
    return res.status(500).json({ error: "Failed to send email", details: msg });
  }
});

app.listen(PORT, () => {
  console.log(`Kvasir chat proxy listening on http://localhost:${PORT}`);
});
