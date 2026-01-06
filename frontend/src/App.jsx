import React, { useState, useRef, useEffect } from "react";
import {
  Settings,
  Plus,
  Send,
  Sliders,
  X,
  Zap,
  Target,
  Mail,
  Calendar,
  HardDrive,
  Link,
  CheckCircle2,
  RefreshCw,
  Loader2,
  Maximize2,
  MessageCircle,
  Feather,
  Gavel,
  WifiOff,
  Sparkles,
  Scale,
  Crown,
  Lightbulb,
} from "lucide-react";
import ForceGraph2D from "react-force-graph-2d";

// --- API CONFIGURATION ---
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3030";
const FALLBACK_OLLAMA =
  import.meta.env.VITE_OLLAMA_URL || "http://localhost:11434";

// --- CONFIG: Deep Persona Instructions ---
// These instructions are injected into the LLM to enforce distinct styles.
const PERSONA_INSTRUCTIONS = {
  p1: `
    ARCHETYPE: The Sage Mediator
    CORE PHILOSOPHY: "Connection before Correction."
    LINGUISTIC RULES:
    - Use "We" and "Us" language to build common ground.
    - Validate emotions first (e.g., "I hear that you are frustrated...").
    - Use softening modifiers (e.g., "It seems," "Perhaps").
    - Avoid absolute words (always, never).
    - Goal: De-escalate conflict and preserve the relationship at all costs.
  `,
  p2: {
    text: `
    ARCHETYPE: The Maverick Wit
    CORE PHILOSOPHY: "Boredom is the enemy."
    LINGUISTIC RULES:
    - Avoid corporate speak and clichés (no "circling back" or "synergy").
    - Use vivid metaphors and punchy short sentences.
    - Be charming, slightly irreverent, but socially calibrated.
    - If appropriate, use dry humor to lower defenses.
    - Goal: Be memorable, persuasive, and human.
    `,
  },
  p3: {
    text: `
    ARCHETYPE: The Iron Executive
    CORE PHILOSOPHY: "Clarity is kindness. Time is money."
    LINGUISTIC RULES:
    - BLUF (Bottom Line Up Front). State the ask in the first sentence.
    - Remove weak words: "Just," "I think," "Sorry," "Maybe," "Does that make sense?".
    - Use active voice and strong verbs.
    - Zero fluff. No pleasantries unless strategic.
    - Goal: Assert authority, set boundaries, and maximize leverage.
    `,
  },
};

// --- Helper: Dynamic Prompt Engine ---
const generateSystemPrompt = (persona, traits, integrations, contextInputs) => {
  // 1. Trait Modulation
  const warmthInstruction =
    traits.warmth > 70
      ? "MODIFIER: Dial UP the warmth. Be extra supportive."
      : traits.warmth < 30
      ? "MODIFIER: Dial DOWN the warmth. Be colder and more clinical."
      : "MODIFIER: Keep warmth balanced.";

  const assertivenessInstruction =
    traits.assertiveness > 70
      ? "MODIFIER: Dial UP dominance. Be commanding."
      : "MODIFIER: Use Socratic questioning rather than commands.";

  // 2. Context Injection
  const contextData = `
    AVAILABLE CONTEXT:
    - Calendar: ${integrations.calendar ? "Linked" : "N/A"}
    - Email: ${integrations.email ? "Linked" : "N/A"}
    - Target Recipient: ${contextInputs.link || "Unknown"}
    - User Goal: ${contextInputs.goal || "Unknown"}
  `;

  // 3. Archetype Retrieval
  const archetypeInstruction =
    PERSONA_INSTRUCTIONS[persona.id]?.text || PERSONA_INSTRUCTIONS["p1"];

  return `
    SYSTEM IDENTITY: You are Kvasir, an elite Communications Strategy Engine.

    ${archetypeInstruction}

    USER CONFIGURATION:
    ${warmthInstruction}
    ${assertivenessInstruction}

    ${contextData}

    TASK:
    - Analyze the user's situation.
    - Provide strategic advice OR draft the communication.
    - ADHERE STRICTLY TO THE LINGUISTIC RULES OF THE ARCHETYPE.
    - Do not break character. Do not say "Here is a draft". Just write it.
  `;
};

// --- Helper: Offline Simulation ---
const simulateResponse = (persona, input) => {
  const responses = {
    p1: `(Sage Mediator - Offline)\n\nI sense some tension here. Let's bridge the gap.\n\n**Draft:**\n"I value our partnership and want to solve this together. It seems we have different perspectives on the timeline—can we hop on a brief call to align?"`,
    p2: `(Maverick Wit - Offline)\n\nLet's spice this up. Nobody reads boring emails.\n\n**Draft:**\n"I'd love to say yes, but my calendar is currently resembling a game of Tetris that I am losing. Raincheck for Q3?"`,
    p3: `(Iron Executive - Offline)\n\nStop apologizing. You have the leverage.\n\n**Draft:**\n"The current terms are unacceptable given the scope creep. We need to stick to the original agreement or pause execution. Let me know how you want to proceed."`,
  };
  return responses[persona.id] || "I'm in offline mode, but I'm listening.";
};

// --- DATA ---
const PERSONAS = [
  {
    id: "p1",
    name: "The Sage Mediator",
    icon: Scale,
    description:
      'High EQ. Focuses on harmony, validation, and "we" language to resolve conflicts.',
    color: "bg-emerald-100 text-emerald-700",
    traits: { warmth: 90, assertiveness: 30, detail: 60 },
  },
  {
    id: "p2",
    name: "The Maverick Wit",
    icon: Lightbulb,
    description:
      "High Charisma. Uses humor, storytelling, and punchy copy to win people over.",
    color: "bg-amber-100 text-amber-700",
    traits: { warmth: 60, assertiveness: 60, detail: 30 },
  },
  {
    id: "p3",
    name: "The Iron Executive",
    icon: Crown,
    description:
      "High Status. Zero fluff. Focuses on leverage, boundaries, and bottom-line results.",
    color: "bg-slate-100 text-slate-700",
    traits: { warmth: 10, assertiveness: 95, detail: 20 },
  },
];

// --- COMPONENTS ---

const MessageBubble = ({ role, content, isError }) => {
  const isUser = role === "user";
  return (
    <div
      className={`flex w-full ${
        isUser ? "justify-end" : "justify-start"
      } mb-6 group animate-in fade-in slide-in-from-bottom-2 duration-300`}
    >
      <div
        className={`flex max-w-[85%] ${
          isUser ? "flex-row-reverse" : "flex-row"
        } gap-3 items-start`}
      >
        <div
          className={`flex-shrink-0 h-9 w-9 rounded-xl flex items-center justify-center shadow-sm ${
            isUser
              ? "bg-slate-100 text-slate-600"
              : isError
              ? "bg-amber-100 text-amber-600"
              : "bg-gradient-to-br from-violet-600 to-indigo-600 text-white"
          }`}
        >
          {isUser ? (
            <div className="text-xs font-bold">ME</div>
          ) : isError ? (
            <WifiOff size={18} />
          ) : (
            <MessageCircle size={18} />
          )}
        </div>

        <div>
          <div
            className={`p-4 rounded-2xl text-sm leading-7 shadow-sm ${
              isUser
                ? "bg-white border border-slate-100 text-slate-800 rounded-tr-none"
                : isError
                ? "bg-amber-50 border border-amber-100 text-slate-800 rounded-tl-none"
                : "bg-white border border-slate-200/60 text-slate-800 rounded-tl-none"
            }`}
          >
            <div className="whitespace-pre-wrap">{content}</div>
          </div>
          <div
            className={`mt-1 text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity ${
              isUser ? "text-right" : "text-left"
            }`}
          >
            {isUser ? "You • Just now" : "Kvasir • Just now"}
          </div>
        </div>
      </div>
    </div>
  );
};

const TraitSlider = ({ label, value, onChange }) => (
  <div className="mb-5">
    <div className="flex justify-between text-xs font-semibold text-slate-600 mb-2">
      <span>{label}</span>
      <span className="text-slate-400 font-normal">{value}%</span>
    </div>
    <div className="relative h-1.5 bg-slate-100 rounded-full w-full">
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="absolute w-full h-full opacity-0 cursor-pointer z-10"
      />
      <div
        className="absolute top-0 left-0 h-full bg-violet-500 rounded-full transition-all duration-150"
        style={{ width: `${value}%` }}
      />
      <div
        className="absolute top-1/2 -translate-y-1/2 h-4 w-4 bg-white border border-slate-200 shadow rounded-full transition-all duration-150 pointer-events-none"
        style={{ left: `calc(${value}% - 8px)` }}
      />
    </div>
  </div>
);

const IntegrationCard = ({
  icon: Icon,
  label,
  description,
  isConnected,
  onToggle,
}) => (
  <div
    className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-all cursor-pointer bg-white"
    onClick={onToggle}
  >
    <div
      className={`p-2 rounded-lg ${
        isConnected
          ? "bg-emerald-50 text-emerald-600"
          : "bg-slate-100 text-slate-400"
      }`}
    >
      <Icon size={18} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between">
        <p
          className={`text-sm font-medium ${
            isConnected ? "text-slate-900" : "text-slate-500"
          }`}
        >
          {label}
        </p>
        {isConnected && <CheckCircle2 size={14} className="text-emerald-500" />}
      </div>
      <p className="text-xs text-slate-400 mt-0.5 truncate">{description}</p>
    </div>
  </div>
);

const getPersonaInstructionText = (personaId) => {
  const entry = PERSONA_INSTRUCTIONS[personaId];
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  return entry.text || "";
};

const EmailPanel = ({
  apiBase,
  persona,
  personaInstruction,
  onFlash,
  fallbackOllama,
  activeModel,
  showCoachPanel,
  onToggleCoachPanel,
  defaultTone,
  defaultFrom,
}) => {
  const highlightText = (text) => {
    const parts = text.split(/(\b\d[\d%.,]*\b)/g);
    return parts.map((part, idx) =>
      /\b\d/.test(part) ? (
        <strong key={idx} className="text-slate-900">
          {part}
        </strong>
      ) : (
        <span key={idx}>{part}</span>
      )
    );
  };

  const truncate = (str, max = 240) => {
    if (!str) return "";
    return str.length > max ? `${str.slice(0, max).trim()}…` : str;
  };

  const normalizeSummary = (raw) => {
    if (!raw) return null;

    const coerce = (obj) => ({
      bullets: Array.isArray(obj.bullets)
        ? obj.bullets.map((b) => truncate(b))
        : [],
      actions: Array.isArray(obj.actions)
        ? obj.actions.map((a) => truncate(a))
        : [],
      sentiment: obj.sentiment || "unknown",
      urgency: obj.urgency || "unknown",
      whoNeedsToAct: obj.whoNeedsToAct || "",
      oneLiner: truncate(obj.oneLiner || "", 180),
    });

    if (typeof raw === "string") {
      try {
        return coerce(JSON.parse(raw));
      } catch (_e) {
        return {
          bullets: [raw],
          actions: [],
          sentiment: "unknown",
          urgency: "unknown",
          whoNeedsToAct: "",
          oneLiner: raw,
        };
      }
    }

    // Sometimes the model returns JSON as a string nested in bullets[0]
    if (
      Array.isArray(raw?.bullets) &&
      raw.bullets.length === 1 &&
      typeof raw.bullets[0] === "string" &&
      raw.bullets[0].trim().startsWith("{")
    ) {
      try {
        return coerce(JSON.parse(raw.bullets[0]));
      } catch (_e) {
        // fall through to coerce raw
      }
    }

    return coerce(raw);
  };

  const [threads, setThreads] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selectedThread, setSelectedThread] = useState(null);
  const [summary, setSummary] = useState(null);
  const [draft, setDraft] = useState("");
  const [goal, setGoal] = useState("");
  const [status, setStatus] = useState("");
  const [limit, setLimit] = useState(20);
  const [importantOnly, setImportantOnly] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [days, setDays] = useState(30);
  const [activeInfoTab, setActiveInfoTab] = useState("summary"); // summary | draft
  const [showFilters, setShowFilters] = useState(true);
  const [senderQuery, setSenderQuery] = useState("");
  const [toField, setToField] = useState("");
  const [subjectField, setSubjectField] = useState("");
  const [sending, setSending] = useState(false);
  const [toneHint, setToneHint] = useState("default");
  const [messageLimit, setMessageLimit] = useState(50);
  const [totalMessages, setTotalMessages] = useState(0);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);
  useEffect(() => {
    if (defaultTone) {
      setToneHint(defaultTone);
    }
  }, [defaultTone]);

  const fetchThreads = async () => {
    setThreadsLoading(true);
    setStatus("");
    try {
      const params = new URLSearchParams({
        limit: String(limit),
      });
      if (importantOnly) params.append("important", "true");
      if (unreadOnly) params.append("unread", "true");
      if (days) params.append("days", String(days));
      if (senderQuery) params.append("sender", senderQuery);

      const resp = await fetch(`${apiBase}/api/email/threads?${params.toString()}`);
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setThreads(data.threads || []);
    } catch (err) {
      console.error(err);
      setStatus("Could not load threads. Check IMAP settings.");
      onFlash?.({
        id: Date.now(),
        text: "Failed to load threads. Verify IMAP env vars and restart server.",
        type: "error",
      });
    } finally {
      setThreadsLoading(false);
    }
  };

  useEffect(() => {
    fetchThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchThreadData = async (
    threadId,
    { limit = messageLimit, preserveState = false } = {}
  ) => {
    setSelectedThread({ id: threadId });
    setThreadLoading(true);
    setStatus("");
    const params = new URLSearchParams();
    if (limit) params.append("limit", String(limit));
    try {
      const resp = await fetch(
        `${apiBase}/api/email/thread/${encodeURIComponent(threadId)}?${params.toString()}`
      );
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      const messageCount = (data.messages || []).length;
      setSelectedThread(data.thread);
      setMessages(data.messages || []);
      setTotalMessages(data.totalMessages || messageCount);
      setMessageLimit(limit || messageCount || 0);
      if (!preserveState) {
        setSummary(null);
        setDraft("");
        setGoal("");
      }
      const latest = (data.messages || []).slice(-1)[0];
      if (!preserveState) {
        const defaultTo = latest?.from?.[0] || defaultFrom || "";
        const defaultSubject = data.thread?.subject
          ? `Re: ${data.thread.subject}`
          : "Re:";
        setToField(defaultTo);
        setSubjectField(defaultSubject);
        setActiveInfoTab("summary");
        setVisibleCount(messageCount ? Math.min(10, messageCount) : 0);
      } else {
        setVisibleCount((prev) => Math.max(prev, Math.min(limit || messageCount, messageCount)));
      }
    } catch (err) {
      console.error(err);
      setStatus("Failed to load thread.");
      onFlash?.({
        id: Date.now(),
        text: "Failed to load thread. Try refreshing threads.",
        type: "error",
      });
    } finally {
      setThreadLoading(false);
    }
  };

  const openThread = (threadId, limit = 50) =>
    fetchThreadData(threadId, { limit, preserveState: false });

  const runSummary = async (threadId) => {
    if (!threadId) return;
    setSummaryLoading(true);
    setStatus("");
    try {
      const resp = await fetch(`${apiBase}/api/email/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setSummary(normalizeSummary(data.summary));
    } catch (err) {
      console.error(err);
      setStatus("Could not summarize thread.");
      onFlash?.({
        id: Date.now(),
        text: "Summary failed. Ensure Ollama is reachable.",
        type: "error",
      });
    } finally {
      setSummaryLoading(false);
    }
  };

  const runDraft = async () => {
    if (!selectedThread?.id) return;
    setDraftLoading(true);
    setStatus("");
    try {
      const resp = await fetch(`${apiBase}/api/email/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: selectedThread.id,
          goal,
          personaName: persona.name,
          personaStyle: personaInstruction,
          tone: toneHint,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setDraft(data.draft || "");
      if (data.summary) setSummary(normalizeSummary(data.summary));
    } catch (err) {
      console.error(err);
      setStatus("Draft failed.");
      onFlash?.({
        id: Date.now(),
        text: "Draft failed. Check Ollama and IMAP connection.",
        type: "error",
      });
    } finally {
      setDraftLoading(false);
    }
  };

  const runSend = async () => {
    if (!selectedThread?.id || !draft || !toField || !subjectField) {
      onFlash?.({
        id: Date.now(),
        text: "To, Subject, and Draft are required.",
        type: "error",
      });
      return;
    }
    setSending(true);
    setStatus("");
    try {
      const resp = await fetch(`${apiBase}/api/email/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: selectedThread.id,
          to: toField,
          subject: subjectField,
          body: draft,
          from: defaultFrom || undefined,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setStatus("Email sent. Refreshing thread...");
      const optimisticMessage = {
        id: `local-${Date.now()}`,
        from: [defaultFrom || "You"],
        to: [toField],
        date: new Date().toISOString(),
        text: draft,
      };
      setMessages((prev) => [...prev, optimisticMessage]);
      setDraft("");
      setGoal("");
      await fetchThreadData(selectedThread.id, {
        limit: Math.max(messageLimit, (messages || []).length + 1),
        preserveState: true,
      });
      fetchThreads();
      setStatus((prev) => prev || "Email sent.");
      onFlash?.({
        id: Date.now(),
        text: "Email sent.",
        type: "info",
      });
    } catch (err) {
      console.error(err);
      setStatus("Send failed.");
      onFlash?.({
        id: Date.now(),
        text: "Send failed. Check SMTP settings.",
        type: "error",
      });
    } finally {
      setSending(false);
    }
  };

  const visibleMessages = messages.slice(-visibleCount);
  const defaultVisibleCount = Math.min(10, messages.length || 0);
  const canLoadMore = visibleCount < (totalMessages || messages.length || 0);
  const canResetVisible = visibleCount > defaultVisibleCount;
  const activeStatuses = [
    threadsLoading && "Loading threads...",
    threadLoading && "Loading thread...",
    summaryLoading && "Summarizing thread...",
    draftLoading && "Drafting reply...",
    sending && "Sending email...",
  ].filter(Boolean);

  const handleLoadMoreMessages = async () => {
    if (!selectedThread?.id) return;
    if (visibleCount < messages.length) {
      setVisibleCount((prev) => Math.min(messages.length, prev + 10));
      return;
    }
    const maxTotal = totalMessages || (messageLimit || 0) + 50;
    if (messages.length < maxTotal) {
      const newLimit = Math.min(maxTotal, (messageLimit || 0) + 50);
      await fetchThreadData(selectedThread.id, { limit: newLimit, preserveState: true });
      setVisibleCount((prev) => Math.min(newLimit, prev + 10));
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 min-h-0">
      <div className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 flex items-center justify-between z-10">
        <div>
          <h2 className="font-semibold text-slate-900">Email Assistant</h2>
          <p className="text-xs text-slate-500">
            IMAP-connected. Summarize threads and draft replies with {persona.name}. Model: {activeModel || "phi3"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
          >
            {showFilters ? "Hide Filters" : "Show Filters"}
          </button>
          <button
            onClick={onToggleCoachPanel}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white hover:bg-slate-50"
          >
            {showCoachPanel ? "Hide Coach" : "Show Coach"}
          </button>
          <button
            onClick={fetchThreads}
            className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center gap-2"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <a
            className="text-[11px] text-slate-500 hover:text-violet-600 underline"
            href={`${fallbackOllama}/api/tags`}
            target="_blank"
            rel="noreferrer"
          >
            Check Ollama
          </a>
        </div>
      </div>

      {activeStatuses.length > 0 && (
        <div className="px-6 py-2 bg-white border-b border-slate-200 text-[11px] text-slate-600 flex flex-wrap gap-2 items-center">
          {activeStatuses.map((text) => (
            <span
              key={text}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 border border-slate-200"
            >
              <Loader2 size={12} className="animate-spin text-violet-600" />
              {text}
            </span>
          ))}
        </div>
      )}

      {status && (
        <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 text-amber-700 text-sm">
          {status}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden min-h-0">
        <div className="w-[320px] border-r border-slate-200 bg-white overflow-y-auto">
          <div className="p-4 border-b border-slate-100 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Threads
              </h3>
              <button
                onClick={() => fetchThreads()}
                className="text-[11px] text-violet-600 hover:text-violet-700"
                disabled={threadsLoading}
              >
                Refresh
              </button>
            </div>
            {showFilters && (
              <div className="space-y-3 text-[11px] text-slate-600">
                <div className="flex items-center justify-between gap-2">
                  <label className="font-semibold text-slate-700 text-[11px]">
                    Load up to
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="5"
                      max="50"
                      step="5"
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value))}
                    />
                    <span className="w-10 text-right text-[11px] font-semibold text-slate-700">
                      {limit}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="importantOnly"
                    type="checkbox"
                    checked={importantOnly}
                    onChange={(e) => setImportantOnly(e.target.checked)}
                    className="w-3 h-3"
                  />
                  <label htmlFor="importantOnly" className="cursor-pointer">
                    Important only (Gmail)
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="unreadOnly"
                    type="checkbox"
                    checked={unreadOnly}
                    onChange={(e) => setUnreadOnly(e.target.checked)}
                    className="w-3 h-3"
                  />
                  <label htmlFor="unreadOnly" className="cursor-pointer">
                    Unread only
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <label className="font-semibold text-slate-700 text-[11px]">
                    Recency
                  </label>
                  <select
                    value={days || ""}
                    onChange={(e) => setDays(e.target.value ? Number(e.target.value) : null)}
                    className="text-[11px] border border-slate-200 rounded px-2 py-1"
                  >
                    <option value="7">Last 7 days</option>
                    <option value="30">Last 30 days</option>
                    <option value="90">Last 90 days</option>
                    <option value="">All time</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="font-semibold text-slate-700 text-[11px] w-16">
                    Sender
                  </label>
                  <input
                    type="text"
                    value={senderQuery}
                    onChange={(e) => setSenderQuery(e.target.value)}
                    placeholder="name or email"
                    className="flex-1 text-[11px] border border-slate-200 rounded px-2 py-1"
                  />
                </div>
                <button
                  onClick={fetchThreads}
                  className="w-full text-center px-3 py-2 rounded-lg text-[11px] font-semibold bg-violet-600 text-white hover:bg-violet-700 shadow-sm"
                  disabled={threadsLoading}
                >
                  Apply filters
                </button>
              </div>
            )}
          </div>
          {threads.length === 0 && !threadsLoading && (
            <div className="p-4 text-sm text-slate-500">
              No threads yet. Check IMAP credentials and refresh.
            </div>
          )}
          <div className="divide-y divide-slate-100">
            {threads.map((t) => (
              <button
                key={t.id}
                onClick={() => openThread(t.id)}
                className={`w-full text-left p-4 flex flex-col gap-1 hover:bg-violet-50 transition-colors ${
                  selectedThread?.id === t.id ? "bg-violet-50" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm text-slate-900 truncate">
                    {t.subject || "(No subject)"}
                  </p>
                  {t.unread && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">
                      New
                    </span>
                  )}
                  {t.hasAttachments && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                      📎
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 truncate">
                  {t.participants?.slice(0, 3).join(", ") || "Unknown participants"}
                </p>
                <p className="text-xs text-slate-600 line-clamp-2">{t.snippet}</p>
                <p className="text-[10px] text-slate-400">
                  {new Date(t.date).toLocaleString()}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {!selectedThread && (
            <div className="flex-1 flex items-center justify-center text-slate-400">
              Select a thread to see details, summary, and draft a reply.
            </div>
          )}

          {selectedThread && (
            <div className="flex flex-col flex-1 min-h-0 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900">
                    {selectedThread.subject || "(No subject)"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {selectedThread.participants?.join(", ") || "Unknown participants"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => runSummary(selectedThread.id)}
                    className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center gap-2"
                    disabled={summaryLoading || threadLoading}
                  >
                    {summaryLoading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}{" "}
                    Summarize
                  </button>
                  <button
                    onClick={runDraft}
                    className="px-3 py-2 text-xs font-semibold rounded-lg bg-violet-600 text-white hover:bg-violet-700 shadow-sm flex items-center gap-2"
                    disabled={draftLoading || threadLoading}
                  >
                    {draftLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}{" "}
                    Draft Reply
                  </button>
                </div>
              </div>

              <div className="flex flex-1 gap-4 min-h-0">
                <div className="flex-1 min-w-0 bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col">
                  <div className="border-b border-slate-100 px-4 py-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      Messages
                    </span>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400">
                      <span>
                        Showing {visibleMessages.length} of {totalMessages || messages.length || 0}
                      </span>
                      {canLoadMore && (
                        <button
                          onClick={handleLoadMoreMessages}
                          className="text-violet-600 hover:text-violet-700 font-semibold"
                        >
                          Load earlier
                        </button>
                      )}
                      {canResetVisible && (
                        <button
                          onClick={() => setVisibleCount(defaultVisibleCount || 10)}
                          className="text-slate-500 hover:text-slate-700"
                        >
                          Latest only
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto divide-y divide-slate-100 min-h-0">
                    {visibleMessages.map((m) => (
                      <div key={m.id} className="p-4 space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <div className="text-slate-800 font-medium">
                            {m.from?.join(", ") || "Unknown"}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {new Date(m.date).toLocaleString()}
                          </div>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          To: {m.to?.join(", ") || "Unknown"}
                        </div>
                        <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                          {m.text}
                        </div>
                      </div>
                    ))}
                    {visibleMessages.length === 0 && (
                      <div className="p-4 text-sm text-slate-500">
                        No messages loaded for this thread.
                      </div>
                    )}
                  </div>
                </div>

                <div className="w-[340px] min-w-[320px] bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col">
                  <div className="flex border-b border-slate-100">
                    <button
                      onClick={() => setActiveInfoTab("summary")}
                      className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wide ${
                        activeInfoTab === "summary"
                          ? "text-violet-700 border-b-2 border-violet-600"
                          : "text-slate-500 border-b-2 border-transparent"
                      }`}
                    >
                      Summary
                    </button>
                    <button
                      onClick={() => setActiveInfoTab("draft")}
                      className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wide ${
                        activeInfoTab === "draft"
                          ? "text-violet-700 border-b-2 border-violet-600"
                          : "text-slate-500 border-b-2 border-transparent"
                      }`}
                    >
                      Draft
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                    {activeInfoTab === "summary" ? (
                      summary ? (
                        <div className="space-y-3 text-sm text-slate-700">
                          {summary.oneLiner && (
                            <p className="text-slate-800 font-medium bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 leading-relaxed">
                              {summary.oneLiner}
                            </p>
                          )}
                          {(summary.bullets || []).length > 0 && (
                            <div>
                              <p className="font-semibold text-slate-900 mb-1">Key Points</p>
                              <ul className="list-disc list-inside space-y-1 text-slate-700">
                                {(summary.bullets || []).map((b, idx) => (
                                  <li key={idx} className="leading-relaxed">
                                    {highlightText(b)}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        {(summary.actions || []).length > 0 && (
                          <div>
                            <p className="font-semibold text-slate-900 mb-1">Actions</p>
                            <ul className="list-disc list-inside space-y-1 text-slate-700">
                              {(summary.actions || []).map((b, idx) => (
                                <li key={idx} className="leading-relaxed">
                                  {highlightText(b)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {selectedThread?.hasAttachments && (
                          <div>
                            <p className="font-semibold text-slate-900 mb-1">Attachments</p>
                            <ul className="list-disc list-inside space-y-1 text-slate-700">
                              {(messages || [])
                                .flatMap((m) => m.attachments || [])
                                .slice(0, 5)
                                .map((name, idx) => (
                                  <li key={idx}>{name}</li>
                                ))}
                            </ul>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2 text-[11px] text-slate-600">
                          <span className="px-2 py-1 rounded-full bg-slate-100 border border-slate-200">
                            Sentiment: {summary.sentiment || "unknown"}
                          </span>
                          <span className="px-2 py-1 rounded-full bg-slate-100 border border-slate-200">
                              Urgency: {summary.urgency || "unknown"}
                            </span>
                            {summary.whoNeedsToAct && (
                              <span className="px-2 py-1 rounded-full bg-slate-100 border border-slate-200">
                                Who Acts: {summary.whoNeedsToAct}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">
                          No summary yet. Click Summarize to generate one.
                        </p>
                      )
                    ) : (
                      <div className="space-y-3">
                        <input
                          type="text"
                          value={goal}
                          onChange={(e) => setGoal(e.target.value)}
                          placeholder="Goal for this reply (e.g., schedule call Thursday)"
                          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-violet-500 transition-colors"
                        />
                        <div className="flex items-center gap-2 text-[11px] text-slate-600">
                          <span className="font-semibold text-slate-700">Tone</span>
                          {["default", "concise", "detailed", "formal", "casual", "assertive"].map((t) => (
                            <button
                              key={t}
                              onClick={() => setToneHint(t)}
                              className={`px-2 py-1 rounded-full border text-[11px] ${
                                toneHint === t
                                  ? "bg-violet-100 text-violet-700 border-violet-300"
                                  : "bg-white text-slate-500 border-slate-200"
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                          <button
                            onClick={() => {
                              setToneHint("concise");
                              runDraft();
                            }}
                            className="ml-auto text-[11px] text-violet-600 hover:text-violet-700 underline"
                          >
                            Rephrase
                          </button>
                        </div>
                        <div className="flex flex-col gap-2">
                          <input
                            type="text"
                            value={toField}
                            onChange={(e) => setToField(e.target.value)}
                            placeholder="To: email@example.com"
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-violet-500 transition-colors"
                          />
                          <input
                            type="text"
                            value={subjectField}
                            onChange={(e) => setSubjectField(e.target.value)}
                            placeholder="Subject"
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-violet-500 transition-colors"
                          />
                        </div>
                        <textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          placeholder="Draft will appear here..."
                          className="w-full h-48 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-violet-500 transition-colors"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={runDraft}
                            className="flex-1 py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 shadow-sm flex items-center justify-center gap-2"
                            disabled={draftLoading || threadLoading}
                          >
                            {draftLoading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                            Draft
                          </button>
                          <button
                            onClick={runSend}
                            className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 shadow-sm flex items-center justify-center gap-2"
                            disabled={
                              sending ||
                              !draft ||
                              !toField ||
                              !subjectField ||
                              threadLoading
                            }
                          >
                            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            Send
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ChatPanel = ({
  currentPersona,
  activeModel,
  availableModels,
  setActiveModel,
  showPersonaPanel,
  onTogglePersonaPanel,
  messages,
  chatLoading,
  messagesEndRef,
  inputValue,
  setInputValue,
  handleSendMessage,
  handleQuickAction,
}) => {
  return (
    <>
      <div className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 flex items-center justify-between z-10 sticky top-0">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-slate-900">{currentPersona.name}</h2>
            {(() => {
              const BadgeIcon = currentPersona.icon;
              return (
                <span
                  className={`px-2 py-0.5 rounded-full border text-[10px] font-medium flex items-center gap-1 ${currentPersona.color.replace(
                    "text",
                    "border"
                  )}`}
                >
                  <BadgeIcon size={10} />
                  active
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-[11px] text-slate-500 flex items-center gap-1">
              <Sparkles size={10} className="text-violet-500 fill-current" /> Powered by
              PoeticMayhem
            </p>
            <div className="flex items-center gap-1 text-[11px] text-slate-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <select
                value={activeModel}
                onChange={(e) => setActiveModel(e.target.value)}
                className="bg-white border border-slate-200 text-[11px] rounded-md px-2 py-1 focus:outline-none focus:border-violet-500"
              >
                {availableModels.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <button
          onClick={onTogglePersonaPanel}
          className={`p-2 rounded-lg transition-colors border ${
            showPersonaPanel
              ? "bg-violet-50 border-violet-200 text-violet-600"
              : "bg-white border-slate-200 text-slate-400 hover:bg-slate-50"
          }`}
        >
          <Sliders size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
        <div className="max-w-3xl mx-auto py-4">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} {...msg} />
          ))}
          {chatLoading && (
            <div className="flex w-full justify-start mb-6">
              <div className="flex items-center gap-3 bg-white border border-slate-100 p-4 rounded-2xl rounded-tl-none shadow-sm">
                <Loader2 size={16} className="animate-spin text-violet-600" />
                <span className="text-sm text-slate-500">Kvasir is thinking...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="p-4 md:p-6 bg-white/50 backdrop-blur-sm border-t border-slate-200/60">
        <div className="max-w-3xl mx-auto">
          <div className="relative shadow-sm rounded-2xl bg-white border border-slate-200 focus-within:border-violet-500 focus-within:ring-2 focus-within:ring-violet-500/20 transition-all">
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSendMessage())
              }
              placeholder={`Tell ${currentPersona.name} what you need...`}
              className="w-full min-h-[50px] max-h-[150px] p-4 pr-12 bg-transparent rounded-2xl outline-none resize-none text-sm leading-relaxed"
              rows={1}
              disabled={chatLoading}
            />
            <button
              onClick={() => handleSendMessage()}
              className={`absolute right-2 bottom-2 p-2 rounded-xl transition-all ${
                inputValue.trim() && !chatLoading
                  ? "bg-violet-600 text-white shadow-md hover:bg-violet-700"
                  : "bg-slate-100 text-slate-400 cursor-not-allowed"
              }`}
              disabled={!inputValue.trim() || chatLoading}
            >
              <Send size={16} />
            </button>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button
              onClick={() => handleQuickAction("soften")}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-emerald-600 rounded-lg text-xs font-medium hover:bg-emerald-50 border border-slate-200 transition-colors shadow-sm"
            >
              <Feather size={14} className="text-emerald-500" /> Soften Tone
            </button>
            <button
              onClick={() => handleQuickAction("witty")}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-amber-600 rounded-lg text-xs font-medium hover:bg-amber-50 border border-slate-200 transition-colors shadow-sm"
            >
              <Zap size={14} className="text-amber-500" /> Make it Witty
            </button>
            <button
              onClick={() => handleQuickAction("assertive")}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-50 border border-slate-200 transition-colors shadow-sm"
            >
              <Gavel size={14} /> Be Assertive
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

const colorFromString = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 60%)`;
};

const GraphPreview = ({ nodes = [], edges = [], loading } = {}) => {
  const radius = 140;
  const centerX = 180;
  const centerY = 180;
  const positioned = nodes.map((n, idx) => {
    const angle = (2 * Math.PI * idx) / Math.max(nodes.length, 1);
    return {
      ...n,
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  });
  return (
    <div className="w-full h-96 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center justify-center">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 size={16} className="animate-spin text-violet-600" />
          Loading graph...
        </div>
      ) : nodes.length === 0 ? (
        <div className="text-sm text-slate-500">No graph data yet. Search for an entity.</div>
      ) : (
        <svg className="w-full h-full" viewBox="0 0 360 360">
          <defs>
            <marker
              id="arrow"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L0,6 L6,3 z" fill="#94a3b8" />
            </marker>
          </defs>
          {edges.map((e, idx) => {
            const source = positioned.find((n) => n.id === e.source);
            const target = positioned.find((n) => n.id === e.target);
            if (!source || !target) return null;
            return (
              <g key={`${e.source}-${e.target}-${idx}`}>
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  stroke="#cbd5e1"
                  strokeWidth="1.4"
                  markerEnd="url(#arrow)"
                />
                <text
                  x={(source.x + target.x) / 2}
                  y={(source.y + target.y) / 2}
                  fontSize="9"
                  fill="#64748b"
                  textAnchor="middle"
                >
                  {e.predicate || "relates_to"}
                </text>
              </g>
            );
          })}
          {positioned.map((n) => (
            <g key={n.id}>
              <circle cx={n.x} cy={n.y} r="18" fill={colorFromString(n.label || n.id)} opacity="0.9" />
              <text
                x={n.x}
                y={n.y + 28}
                fontSize="10"
                fill="#0f172a"
                textAnchor="middle"
              >
                {n.label || n.id}
              </text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
};

const GraphModal = ({ open, onClose, graphData, graphEntity }) => {
  const [dimensions, setDimensions] = useState({
    width: Math.min(window.innerWidth - 120, 1000),
    height: Math.min(window.innerHeight - 160, 720),
  });

  useEffect(() => {
    const handler = () => {
      setDimensions({
        width: Math.min(window.innerWidth - 120, 1000),
        height: Math.min(window.innerHeight - 160, 720),
      });
    };
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  if (!open) return null;
  const nodes = graphData?.nodes || [];
  const links = (graphData?.edges || []).map((e, idx) => ({
    id: `${e.source}-${e.target}-${idx}`,
    source: e.source,
    target: e.target,
    label: e.predicate || "relates_to",
  }));

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-full max-h-[820px] flex flex-col border border-slate-200">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-800">Graph Explorer</div>
            <div className="text-xs text-slate-500">
              {graphEntity || "No entity"} • {nodes.length} nodes • {links.length} edges
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1">
          <ForceGraph2D
            width={dimensions.width}
            height={dimensions.height}
            backgroundColor="#ffffff"
            graphData={{ nodes, links }}
            nodeLabel={(node) => node.label || node.id}
            nodeRelSize={6}
            linkLabel={(link) => link.label}
            linkDirectionalArrowLength={6}
            linkDirectionalArrowRelPos={1}
            linkColor={() => "#94a3b8"}
            nodeCanvasObject={(node, ctx) => {
              const label = node.label || node.id;
              const size = 8;
              ctx.fillStyle = "#4f46e5";
              ctx.beginPath();
              ctx.arc(node.x, node.y, size, 0, 2 * Math.PI, false);
              ctx.fill();
              ctx.font = "12px Inter, sans-serif";
              ctx.fillStyle = "#0f172a";
              ctx.fillText(label, node.x + 10, node.y + 4);
            }}
          />
        </div>
      </div>
    </div>
  );
};

const PersonaPanel = ({
  showPersonaPanel,
  rightPanelTab,
  setRightPanelTab,
  currentPersona,
  setCurrentPersona,
  customTraits,
  setCustomTraits,
  integrations,
  handleIntegrationToggle,
  contextInputs,
  setContextInputs,
  knowledgeContext,
  knowledgeSearchInput,
  setKnowledgeSearchInput,
  knowledgeLoading,
  runKnowledgeSearch,
  knowledgeQuery,
  setShowPersonaPanel,
  graphEntity,
  setGraphEntity,
  graphLimit,
  setGraphLimit,
  graphData,
  graphLoading,
  fetchGraphPreview,
  ingestText,
  setIngestText,
  ingestTitle,
  setIngestTitle,
  ingestTags,
  setIngestTags,
  ingestType,
  setIngestType,
  ingestLoading,
  ingestFile,
  ingestContent,
  onOpenGraphModal,
}) => {
  if (!showPersonaPanel) return null;
  return (
    <div className="w-[340px] bg-white border-l border-slate-200 flex flex-col shadow-xl z-30 absolute right-0 h-full lg:static">
      <div className="flex items-center border-b border-slate-200">
        <button
          onClick={() => setRightPanelTab("persona")}
          className={`flex-1 py-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
            rightPanelTab === "persona"
              ? "border-violet-600 text-violet-600"
              : "border-transparent text-slate-400 hover:text-slate-600"
          }`}
        >
          Coach Persona
        </button>
        <button
          onClick={() => setRightPanelTab("data")}
          className={`flex-1 py-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
            rightPanelTab === "data"
              ? "border-violet-600 text-violet-600"
              : "border-transparent text-slate-400 hover:text-slate-600"
          }`}
        >
          Situation
        </button>
        <button
          onClick={() => setRightPanelTab("graph")}
          className={`flex-1 py-4 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
            rightPanelTab === "graph"
              ? "border-violet-600 text-violet-600"
              : "border-transparent text-slate-400 hover:text-slate-600"
          }`}
        >
          Graph
        </button>
        <button
          onClick={() => setShowPersonaPanel(false)}
          className="px-4 lg:hidden text-slate-400"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-slate-50/50">
        {rightPanelTab === "persona" ? (
          <>
            <section>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 block">
                Archetype
              </label>
              <div className="space-y-3">
                {PERSONAS.map((p) => {
                  const Icon = p.icon;
                  const isActive = currentPersona.id === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => {
                        setCurrentPersona(p);
                        setCustomTraits(p.traits);
                      }}
                      className={`p-4 rounded-xl border cursor-pointer transition-all relative overflow-hidden group ${
                        isActive
                          ? "border-violet-600 bg-white ring-1 ring-violet-600 shadow-md"
                          : "border-slate-200 bg-white hover:border-violet-300 shadow-sm"
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-2 relative z-10">
                        <div className={`p-1.5 rounded-lg ${p.color}`}>
                          <Icon size={16} />
                        </div>
                        <span
                          className={`font-semibold text-sm ${
                            isActive ? "text-violet-900" : "text-slate-700"
                          }`}
                        >
                          {p.name}
                        </span>
                        {isActive && <CheckCircle2 size={16} className="ml-auto text-violet-600" />}
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed ml-10 relative z-10">
                        {p.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
            <section>
              <div className="flex items-center justify-between mb-4">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                  Fine Tuning
                </label>
                <button
                  onClick={() => setCustomTraits(currentPersona.traits)}
                  className="text-[10px] text-violet-600 hover:text-violet-700 flex items-center gap-1 font-medium"
                >
                  <RefreshCw size={10} /> Reset
                </button>
              </div>
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                <TraitSlider
                  label="Warmth & Empathy"
                  value={customTraits.warmth}
                  onChange={(v) => setCustomTraits({ ...customTraits, warmth: v })}
                />
                <TraitSlider
                  label="Assertiveness"
                  value={customTraits.assertiveness}
                  onChange={(v) => setCustomTraits({ ...customTraits, assertiveness: v })}
                />
                <TraitSlider
                  label="Detail & Depth"
                  value={customTraits.detail}
                  onChange={(v) => setCustomTraits({ ...customTraits, detail: v })}
                />
              </div>
                </section>
              </>
            ) : rightPanelTab === "data" ? (
              <>
            <section>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 block">
                Context Sources
              </label>
              <div className="space-y-3">
                <IntegrationCard
                  icon={Calendar}
                  label="Calendar"
                  description="Sync upcoming meetings"
                  isConnected={integrations.calendar}
                  onToggle={() => handleIntegrationToggle("calendar")}
                />
                <IntegrationCard
                  icon={Mail}
                  label="Email History"
                  description="Sync previous threads"
                  isConnected={integrations.email}
                  onToggle={() => handleIntegrationToggle("email")}
                />
                <IntegrationCard
                  icon={HardDrive}
                  label="Docs / Notes"
                  description="Sync drafts & notes"
                  isConnected={integrations.drive}
                  onToggle={() => handleIntegrationToggle("drive")}
                />
              </div>
            </section>
            <section>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 block">
                Specific Details
              </label>
              <div className="space-y-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <Link size={14} className="text-slate-400" />
                    <label className="text-xs font-semibold text-slate-700">
                      Recipient / Reference
                    </label>
                  </div>
                  <input
                    type="text"
                    value={contextInputs.link}
                    onChange={(e) =>
                      setContextInputs((p) => ({
                        ...p,
                        link: e.target.value,
                      }))
                    }
                    placeholder="Who is this for? (e.g. Boss, Date, Landlord)"
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-violet-500 transition-colors"
                  />
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <Target size={14} className="text-slate-400" />
                    <label className="text-xs font-semibold text-slate-700">
                      Desired Outcome
                    </label>
                  </div>
                  <textarea
                    value={contextInputs.goal}
                    onChange={(e) =>
                      setContextInputs((p) => ({
                        ...p,
                        goal: e.target.value,
                      }))
                    }
                    placeholder="What do you want to happen? (e.g. Get a date, Get a raise)"
                    className="w-full bg-slate-50 rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-500 h-24 resize-none leading-relaxed"
                  ></textarea>
                </div>
                </div>
              </section>
              <section>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 block">
                  Ingest Data
                </label>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-slate-700">
                      Upload file (.eml, .mbox, .txt, .md)
                    </label>
                    <input
                      type="file"
                      accept=".eml,.mbox,.txt,.md"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) ingestFile(file);
                        e.target.value = "";
                      }}
                      className="text-xs"
                      disabled={ingestLoading}
                    />
                    <p className="text-[11px] text-slate-500">
                      Files are sent to the knowledge API for vector + graph ingest.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Title (optional)"
                        value={ingestTitle}
                        onChange={(e) => setIngestTitle(e.target.value)}
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-violet-500"
                      />
                      <select
                        value={ingestType}
                        onChange={(e) => setIngestType(e.target.value)}
                        className="bg-white border border-slate-200 rounded-lg px-2 py-2 text-[11px] outline-none focus:border-violet-500"
                      >
                        <option value="text">Text</option>
                        <option value="email">Email</option>
                        <option value="note">Note</option>
                      </select>
                    </div>
                    <input
                      type="text"
                      placeholder="Tags (comma-separated)"
                      value={ingestTags}
                      onChange={(e) => setIngestTags(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-violet-500"
                    />
                    <textarea
                      placeholder="Paste text to ingest..."
                      value={ingestText}
                      onChange={(e) => setIngestText(e.target.value)}
                      className="w-full h-28 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-violet-500 resize-none leading-relaxed"
                    />
                    <button
                      onClick={() =>
                        ingestContent({
                          content: ingestText,
                          type: ingestType,
                          metadata: {
                            title: ingestTitle || undefined,
                            tags: ingestTags
                              .split(",")
                              .map((t) => t.trim())
                              .filter(Boolean),
                            source: "manual",
                          },
                        })
                      }
                      className="w-full py-2 rounded-lg bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                      disabled={ingestLoading}
                    >
                      {ingestLoading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Sparkles size={14} />
                      )}
                      Ingest Text
                    </button>
                  </div>
                </div>
              </section>
              <section>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 block">
                  Knowledge Base
                </label>
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={knowledgeSearchInput}
                    onChange={(e) => setKnowledgeSearchInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        runKnowledgeSearch();
                      }
                    }}
                    placeholder="Search your ingested notes/emails..."
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-violet-500 transition-colors"
                  />
                  <button
                    onClick={() => runKnowledgeSearch()}
                    className="px-3 py-2 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 shadow-sm flex items-center gap-2"
                    disabled={knowledgeLoading}
                  >
                    {knowledgeLoading ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Sparkles size={14} />
                    )}
                    Search
                  </button>
                </div>
                {knowledgeQuery && (
                  <div className="text-[11px] text-slate-500">
                    Last query:{" "}
                    <span className="font-semibold text-slate-700">{knowledgeQuery}</span>
                  </div>
                )}
                <div>
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Top Matches
                  </div>
                  <div className="space-y-2">
                    {knowledgeContext.vectors?.length ? (
                      knowledgeContext.vectors.map((v, idx) => {
                        const meta = v.metadata || {};
                        const title =
                          meta.subject || meta.title || meta.type || `Match ${idx + 1}`;
                        const snippet = (v.content || "").slice(0, 180);
                        return (
                          <div
                            key={`${title}-${idx}`}
                            className="p-3 border border-slate-200 rounded-lg bg-slate-50"
                          >
                            <div className="text-[11px] font-semibold text-slate-700 mb-1">
                              [{idx + 1}] {title}
                            </div>
                            <div className="text-xs text-slate-600 leading-relaxed">
                              {snippet}
                              {v.content && v.content.length > 180 ? "..." : ""}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-xs text-slate-500">
                        No context yet. Search or send a message to auto-pull related docs.
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Graph Links
                  </div>
                  <div className="space-y-1">
                    {knowledgeContext.graph?.length ? (
                      knowledgeContext.graph.map((rel, idx) => (
                        <div
                          key={`${rel.subject}-${rel.object}-${idx}`}
                          className="text-xs text-slate-700"
                        >
                          {rel.subject}{" "}
                          <span className="text-violet-600 font-semibold">[{rel.predicate}]</span>{" "}
                          {rel.object}
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-500">No relationships found yet.</div>
                    )}
                  </div>
                </div>
              </div>
                </section>
              </>
            ) : (
              <section>
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 block">
                  Graph View
                </label>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={graphEntity}
                      onChange={(e) => setGraphEntity(e.target.value)}
                      placeholder="Entity (e.g., Project Alpha)"
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-violet-500"
                    />
                    <input
                      type="number"
                      min="10"
                      max="300"
                      value={graphLimit}
                      onChange={(e) => setGraphLimit(Math.min(300, Math.max(10, Number(e.target.value))))}
                      className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-2 py-2 text-xs outline-none focus:border-violet-500"
                    />
                    <button
                      onClick={() => fetchGraphPreview(graphEntity, graphLimit)}
                      className="px-3 py-2 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 shadow-sm flex items-center gap-2"
                      disabled={graphLoading}
                    >
                      {graphLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      Load
                    </button>
                    <button
                      onClick={onOpenGraphModal}
                      className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:text-violet-700 hover:border-violet-200"
                      title="Open full screen"
                    >
                      <Maximize2 size={16} />
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Shows up to {graphLimit} edges around the entity. Increase limit to pull more, but large graphs may be trimmed.
                  </p>
                  <GraphPreview
                    nodes={graphData?.nodes || []}
                    edges={graphData?.edges || []}
                    loading={graphLoading}
                  />
                  {graphData?.moreAvailable && (
                    <button
                      onClick={() => fetchGraphPreview(graphEntity, Math.min(300, graphLimit + 50))}
                      className="w-full py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
                      disabled={graphLoading}
                    >
                      Load more
                    </button>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      );
    };

export default function App() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [showPersonaPanel, setShowPersonaPanel] = useState(true);
  const [showThreadList, setShowThreadList] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState("persona");
  const [activeModel, setActiveModel] = useState("phi3");
  const [availableModels, setAvailableModels] = useState(["phi3", "phi3:mini"]);
  const [flash, setFlash] = useState(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [userName, setUserName] = useState("You");
  const [userEmail, setUserEmail] = useState("");
  const [defaultTone, setDefaultTone] = useState("default");
  const [activeTab, setActiveTab] = useState("chat"); // 'chat' | 'email'

  const [currentPersona, setCurrentPersona] = useState(PERSONAS[0]);
  const [customTraits, setCustomTraits] = useState(PERSONAS[0].traits);
  const [integrations, setIntegrations] = useState({
    calendar: true,
    email: false,
    drive: false,
  });
  const [contextInputs, setContextInputs] = useState({ link: "", goal: "" });
  const [knowledgeContext, setKnowledgeContext] = useState({
    vectors: [],
    graph: [],
  });
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeSearchInput, setKnowledgeSearchInput] = useState("");
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [ingestLoading, setIngestLoading] = useState(false);
  const [ingestText, setIngestText] = useState("");
  const [ingestTitle, setIngestTitle] = useState("");
  const [ingestTags, setIngestTags] = useState("");
  const [ingestType, setIngestType] = useState("text");
  const [graphEntity, setGraphEntity] = useState("");
  const [graphLimit, setGraphLimit] = useState(100);
  const [graphData, setGraphData] = useState({ nodes: [], edges: [], moreAvailable: false });
  const [graphLoading, setGraphLoading] = useState(false);
  const [showGraphModal, setShowGraphModal] = useState(false);

  const messagesEndRef = useRef(null);
  const personaInstruction = getPersonaInstructionText(currentPersona.id);

  // Initial Message
  useEffect(() => {
    setMessages([
      {
        id: 1,
        role: "ai",
        content: [
          "Hi, I'm Kvasir—your communication strategist.",
          `Ready to help with drafting, coaching, or roleplay. Model: ${activeModel} (PoeticMayhem).`,
          "",
          "What you can do:",
          "• Draft a reply or rewrite your message in a new tone.",
          "• Summarize or respond to threads in the Email app (left sidebar).",
          "• Fine-tune warmth/assertiveness on the right panel.",
          "",
          "Fast start:",
          "1) Pick a persona on the right to set the voice.",
          "2) Tell me your goal + who you're talking to.",
          "3) Paste context, or open Email to auto-load threads.",
          "",
          "Need a quick check? Visit http://localhost:3030/api/tags to see available models.",
        ].join("\n"),
      },
    ]);
  }, [activeModel]);

  useEffect(() => {
    const detectModels = async () => {
      const endpoints = [
        `${API_BASE}/api/tags`,
        `${FALLBACK_OLLAMA}/api/tags`,
      ];

      for (const url of endpoints) {
        try {
          const resp = await fetch(url);
          if (!resp.ok) continue;
          const data = await resp.json();
          const names = (data?.models || []).map((m) => m.name).filter(Boolean);
          if (!names.length) continue;

          setAvailableModels(names);

          // Prefer a lighter/standard phi3 if available, otherwise keep current or pick first.
          const preferred =
            names.find((n) => n === "phi3" || n === "phi3:latest") ||
            names.find((n) => n.startsWith("phi3")) ||
            names[0];

          if (!names.includes(activeModel)) {
            setActiveModel(preferred);
          }
          return;
        } catch (e) {
          // ignore and try next endpoint (likely CORS or server down)
        }
      }

      setFlash({
        id: Date.now(),
        text: "Could not reach Ollama. Start the proxy with `npm start` or allow CORS (OLLAMA_ORIGINS).",
        type: "error",
      });
    };
    detectModels();
  }, [activeModel]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, chatLoading]);

  const handleIntegrationToggle = (key) => {
    setIntegrations((prev) => ({ ...prev, [key]: !prev[key] }));
    if (key === "email") {
      setFlash({
        id: Date.now(),
        text: "Email integration toggled. Configure IMAP env vars and open the Email app.",
        type: "info",
      });
    } else {
      setFlash({
        id: Date.now(),
        text: "Integrations are UI-only until backend connectors are configured.",
        type: "info",
      });
    }
  };

  const handleSendMessage = async (overrideText = null) => {
    const textToSend = overrideText || inputValue;
    if (!textToSend.trim()) return;

    const userMsg = { id: Date.now(), role: "user", content: textToSend };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue("");
    setChatLoading(true);

    try {
      // 1. Generate System Instructions
      const systemPrompt = generateSystemPrompt(
        currentPersona,
        customTraits,
        integrations,
        contextInputs
      );

      // 2. Format History for Ollama ('ai' -> 'assistant')
      const conversationHistory = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "ai" ? "assistant" : "user",
          content: m.content,
        }));

      const payloadMessages = [
        ...conversationHistory,
        { role: "user", content: textToSend },
      ];

      let aiText = "";
      let usedKnowledge = false;

      try {
        const knowledgeResp = await fetch(`${API_BASE}/api/knowledge/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: payloadMessages,
            persona: currentPersona.name,
            goal: contextInputs.goal,
            k: 5,
            query: textToSend,
            model: activeModel || "phi3",
          }),
        });

        if (!knowledgeResp.ok) {
          const errText = await knowledgeResp.text();
          throw new Error(errText || "Knowledge API Error");
        }

        const data = await knowledgeResp.json();
        aiText =
          data.answer || data.message?.content || data.content || "No response content.";
        setKnowledgeContext(data.context || { vectors: [], graph: [] });
        setKnowledgeQuery(data.query || textToSend);
        usedKnowledge = true;
      } catch (knowledgeError) {
        setKnowledgeContext({ vectors: [], graph: [] });
        setKnowledgeQuery("");
        setFlash({
          id: Date.now(),
          text: "Knowledge API unavailable; falling back to direct chat.",
          type: "error",
        });

        const response = await fetch(`${API_BASE}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemPrompt,
            messages: payloadMessages,
            model: activeModel || "phi3",
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(errText || "LLM API Error");
        }

        const data = await response.json();
        aiText =
          data.message?.content || data.content || "No response content.";
      }

      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, role: "ai", content: aiText, usedKnowledge },
      ]);
    } catch (error) {
      console.error(error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: "ai",
          content: `Error: Could not reach API. Start the proxy (npm start) and ensure Ollama is running on 11434.`,
          isError: true,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleQuickAction = (action) => {
    let prompt = "";
    if (action === "soften")
      prompt =
        "Rewrite my last message (or this situation) to be warmer, kinder, and more diplomatic. Remove any aggression.";
    if (action === "witty")
      prompt =
        "Add some wit and charm to this. Make it engaging and playful without being unprofessional.";
    if (action === "assertive")
      prompt =
        "Rewrite this to be firm and non-negotiable. I need to set a boundary. Remove the 'sorry's.";

    handleSendMessage(prompt);
  };

  const runKnowledgeSearch = async (queryOverride = "") => {
    const term = (queryOverride || knowledgeSearchInput || "").trim();
    if (!term) return;

    setKnowledgeLoading(true);
    try {
      const searchResp = await fetch(
        `${API_BASE}/api/knowledge/search?q=${encodeURIComponent(term)}&k=4`
      );
      if (searchResp.ok) {
        const searchData = await searchResp.json();
        setKnowledgeContext((prev) => ({
          ...prev,
          vectors: searchData.results || [],
        }));
        setKnowledgeQuery(searchData.query || term);
      }

      const graphResp = await fetch(
        `${API_BASE}/api/knowledge/graph?entity=${encodeURIComponent(term)}`
      );
      if (graphResp.ok) {
        const graphData = await graphResp.json();
        setKnowledgeContext((prev) => ({
          ...prev,
          graph: graphData.relations || [],
        }));
      }
    } catch (err) {
      setFlash({
        id: Date.now(),
        text: "Could not reach knowledge API. Is the Python service running on 8000?",
        type: "error",
      });
    } finally {
      setKnowledgeLoading(false);
    }
  };

  const ingestContent = async ({ content, metadata = {}, type = "text" }) => {
    if (!content || !content.trim()) {
      setFlash({ id: Date.now(), text: "Add content to ingest.", type: "error" });
      return;
    }
    setIngestLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/knowledge/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, metadata, type }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      setFlash({ id: Date.now(), text: "Ingested successfully.", type: "info" });
      setIngestText("");
      setIngestTitle("");
      setIngestTags("");
      setIngestType("text");
    } catch (err) {
      setFlash({
        id: Date.now(),
        text: `Ingest failed: ${err?.message || err}`,
        type: "error",
      });
    } finally {
      setIngestLoading(false);
    }
  };

  const ingestFile = async (file) => {
    if (!file) return;
    setIngestLoading(true);
    try {
      const text = await file.text();
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const isEmail = ext === "eml" || ext === "mbox";
      await ingestContent({
        content: text,
        type: isEmail ? "email" : "text",
        metadata: {
          filename: file.name,
          ext,
          source: "upload",
        },
      });
    } catch (err) {
      setFlash({
        id: Date.now(),
        text: `File ingest failed: ${err?.message || err}`,
        type: "error",
      });
      setIngestLoading(false);
    }
  };

  const fetchGraphPreview = async (entity, limit = graphLimit) => {
    const term = (entity || graphEntity || "").trim();
    if (!term) {
      setFlash({ id: Date.now(), text: "Enter an entity to view the graph.", type: "error" });
      return;
    }
    setGraphLoading(true);
    try {
      const params = new URLSearchParams({
        entity: term,
        limit: String(limit),
      });
      const resp = await fetch(`${API_BASE}/api/knowledge/graph-preview?${params.toString()}`);
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setGraphData({
        nodes: data.nodes || [],
        edges: data.edges || [],
        moreAvailable: Boolean(data.moreAvailable),
      });
      setGraphEntity(term);
      setGraphLimit(limit);
    } catch (err) {
      setFlash({
        id: Date.now(),
        text: `Graph fetch failed: ${err?.message || err}`,
        type: "error",
      });
    } finally {
      setGraphLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden selection:bg-violet-100 selection:text-violet-900">
      {flash && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-white border border-slate-200 shadow-lg px-4 py-2 rounded-lg text-sm text-slate-700 flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span>{flash.text}</span>
          <button
            onClick={() => setFlash(null)}
            className="text-slate-400 hover:text-slate-600 text-xs"
          >
            Dismiss
          </button>
        </div>
      )}
      {/* --- LEFT SIDEBAR (History) --- */}
      {showThreadList && (
        <div className="w-[280px] bg-white border-r border-slate-200 flex flex-col hidden lg:flex z-20 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)]">
          <div className="p-5">
            <div className="flex items-center gap-2.5 font-bold text-xl text-slate-900 tracking-tight">
              <div className="bg-violet-600 text-white p-1.5 rounded-lg">
                <MessageCircle size={20} className="fill-current" />
              </div>
              Kvasir
            </div>
            <button
              onClick={() =>
                setMessages([
                  { id: 1, role: "ai", content: `Session reset. Ready.` },
                ])
              }
              className="mt-6 w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white py-2.5 px-4 rounded-xl text-sm font-medium transition-all shadow-sm hover:shadow active:scale-[0.98]"
            >
              <Plus size={18} />
              New Chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
            <div className="px-3 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Apps
            </div>
            <button
              onClick={() => setActiveTab("chat")}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium truncate flex items-center gap-2 transition-colors ${
                activeTab === "chat"
                  ? "bg-violet-50 text-violet-700"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <MessageCircle size={16} /> Conversation
            </button>
            <button
              onClick={() => setActiveTab("email")}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium truncate flex items-center gap-2 transition-colors ${
                activeTab === "email"
                  ? "bg-violet-50 text-violet-700"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Mail size={16} /> Email
            </button>

            <div className="mt-6 px-3 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Recent
            </div>
            <button className="w-full text-left px-3 py-2.5 rounded-lg text-sm bg-violet-50 text-violet-700 font-medium truncate">
              Current Session
            </button>
          </div>
        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors relative">
            <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
              {userName
                .split(" ")
                .map((w) => w[0])
                .join("")
                .slice(0, 2)
                .toUpperCase() || "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">
                {userName || "You"}
              </p>
              <p className="text-[11px] text-slate-500 truncate">
                {userEmail || "Set email"}
              </p>
            </div>
            <button
              onClick={() => setShowProfileMenu((v) => !v)}
              className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600"
              aria-label="Profile settings"
            >
              <Settings size={16} />
            </button>
            {showProfileMenu && (
              <div className="fixed left-4 bottom-20 w-72 bg-white border border-slate-200 rounded-lg shadow-lg text-sm text-slate-700 p-3 space-y-2 z-50">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500">
                    Display name
                  </label>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    className="w-full border border-slate-200 rounded px-2 py-1 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500">
                    Email (used for sending)
                  </label>
                  <input
                    type="email"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    className="w-full border border-slate-200 rounded px-2 py-1 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500">
                    Default tone
                  </label>
                  <select
                    value={defaultTone}
                    onChange={(e) => setDefaultTone(e.target.value)}
                    className="w-full border border-slate-200 rounded px-2 py-1 text-sm"
                  >
                    <option value="default">Default</option>
                    <option value="concise">Concise</option>
                    <option value="detailed">Detailed</option>
                    <option value="formal">Formal</option>
                    <option value="casual">Casual</option>
                    <option value="assertive">Assertive</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showThreadList}
                    onChange={() => setShowThreadList((v) => !v)}
                    className="w-3 h-3"
                  />
                  <span className="text-[11px] text-slate-600">
                    Show thread list
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={showPersonaPanel}
                    onChange={() => setShowPersonaPanel((v) => !v)}
                    className="w-3 h-3"
                  />
                  <span className="text-[11px] text-slate-600">
                    Show coach panel
                  </span>
                </div>
                <button
                  onClick={() => setShowProfileMenu(false)}
                  className="w-full mt-1 text-center px-3 py-1.5 rounded bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
        </div>
      )}

      {/* --- CENTER --- */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50 relative">
        {activeTab === "chat" ? (
          <ChatPanel
            currentPersona={currentPersona}
            activeModel={activeModel}
            availableModels={availableModels}
            setActiveModel={setActiveModel}
            showPersonaPanel={showPersonaPanel}
            onTogglePersonaPanel={() => setShowPersonaPanel((v) => !v)}
            messages={messages}
            chatLoading={chatLoading}
            messagesEndRef={messagesEndRef}
            inputValue={inputValue}
            setInputValue={setInputValue}
            handleSendMessage={handleSendMessage}
            handleQuickAction={handleQuickAction}
          />
        ) : (
          <EmailPanel
            apiBase={API_BASE}
            fallbackOllama={FALLBACK_OLLAMA}
            persona={currentPersona}
            personaInstruction={personaInstruction}
            activeModel={activeModel}
            showCoachPanel={showPersonaPanel}
            onToggleCoachPanel={() => setShowPersonaPanel((v) => !v)}
            defaultTone={defaultTone}
            defaultFrom={userEmail}
            onFlash={setFlash}
          />
        )}
      </div>

      {/* --- RIGHT PANEL (Controls) --- */}
      <PersonaPanel
        showPersonaPanel={showPersonaPanel}
        rightPanelTab={rightPanelTab}
        setRightPanelTab={setRightPanelTab}
        currentPersona={currentPersona}
        setCurrentPersona={setCurrentPersona}
        customTraits={customTraits}
        setCustomTraits={setCustomTraits}
        integrations={integrations}
        handleIntegrationToggle={handleIntegrationToggle}
        contextInputs={contextInputs}
        setContextInputs={setContextInputs}
        knowledgeContext={knowledgeContext}
        knowledgeSearchInput={knowledgeSearchInput}
        setKnowledgeSearchInput={setKnowledgeSearchInput}
        knowledgeLoading={knowledgeLoading}
        runKnowledgeSearch={runKnowledgeSearch}
        knowledgeQuery={knowledgeQuery}
        setShowPersonaPanel={setShowPersonaPanel}
        ingestText={ingestText}
        setIngestText={setIngestText}
        ingestTitle={ingestTitle}
        setIngestTitle={setIngestTitle}
        ingestTags={ingestTags}
        setIngestTags={setIngestTags}
        ingestType={ingestType}
        setIngestType={setIngestType}
        ingestLoading={ingestLoading}
        ingestFile={ingestFile}
        ingestContent={ingestContent}
        graphEntity={graphEntity}
        setGraphEntity={setGraphEntity}
        graphLimit={graphLimit}
        setGraphLimit={setGraphLimit}
        graphData={graphData}
        graphLoading={graphLoading}
        fetchGraphPreview={fetchGraphPreview}
        onOpenGraphModal={() => setShowGraphModal(true)}
      />
      <GraphModal
        open={showGraphModal}
        onClose={() => setShowGraphModal(false)}
        graphData={graphData}
        graphEntity={graphEntity}
      />
    </div>
  );
}
