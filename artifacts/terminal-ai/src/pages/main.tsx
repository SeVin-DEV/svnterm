import { useEffect, useRef, useState, useCallback, Fragment } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import {
  useListSshConnections, useListSnippets, useGetChatHistory,
  useSendChatMessage, useClearChatHistory, getGetChatHistoryQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Send, Trash2, PlayCircle, Plug, Power, Bot, User, Terminal as TerminalIcon,
  Cpu, Square, Loader2, ChevronRight, Mic, MicOff, Volume2,
  Phone, PhoneOff, Brain, CloudUpload,
} from "lucide-react";
import { MemoryPanel } from "@/components/memory-panel";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";
type MobileTab = "terminal" | "chat";

interface WsMessage { type: "data" | "status" | "error"; data?: string; }

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  disconnected: "bg-muted-foreground",
  connecting: "bg-yellow-500 animate-pulse",
  reconnecting: "bg-orange-500 animate-pulse",
  connected: "bg-primary",
};

const RECONNECT_DELAYS = [2000, 4000, 8000, 16000, 30000];
const RECONNECT_MAX = RECONNECT_DELAYS.length;

const MOBILE_KEYS = [
  { label: "Tab", data: "\t" },
  { label: "Ctrl+C", data: "\x03" },
  { label: "Ctrl+D", data: "\x04" },
  { label: "Ctrl+Z", data: "\x1a" },
  { label: "Esc", data: "\x1b" },
  { label: "↑", data: "\x1b[A" },
  { label: "↓", data: "\x1b[B" },
  { label: "←", data: "\x1b[D" },
  { label: "→", data: "\x1b[C" },
  { label: "|", data: "|" },
  { label: "~", data: "~" },
  { label: "/", data: "/" },
  { label: "sudo", data: "sudo " },
];

const AGENT_COLLECT_DELAY_MS = 3500;
const AGENT_MAX_STEPS = 30;
const VOICE_SYSTEM_NOTE = "[VOICE MODE: Your spoken 'message' must be 1-3 natural conversational sentences max. Omit markdown and code from the 'message' field — put commands in the 'command' field as JSON.] ";

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[mGKH]/g, "");
}

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

export default function MainPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const termOutputRef = useRef<string>("");
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Agent refs
  const agentRunningRef = useRef(false);
  const agentStopRef = useRef(false);
  const agentStepRef = useRef(0);
  const agentTaskRef = useRef("");
  const termSnapshotRef = useRef<string>("");

  // Reconnect refs
  const manualDisconnectRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const lastConnIdRef = useRef<number | null>(null);
  const lastConnNameRef = useRef<string>("");

  // Voice refs
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const liveModeRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isListeningRef = useRef(false);
  const finalTranscriptRef = useRef("");
  const voiceSendingRef = useRef(false);

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [activeConnName, setActiveConnName] = useState<string>("");
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [selectedConnId, setSelectedConnId] = useState<string>("");
  const [chatInput, setChatInput] = useState("");
  const [mobileTab, setMobileTab] = useState<MobileTab>("terminal");
  const [isMobile, setIsMobile] = useState(false);

  // Agent state
  const [agentMode, setAgentMode] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentStep, setAgentStep] = useState(0);
  const [agentStatus, setAgentStatus] = useState<string>("");
  const [agentTrace, setAgentTrace] = useState<Array<{ step: number; command: string; output: string }>>([]);

  // Memory state
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [memoryNoteVisible, setMemoryNoteVisible] = useState(false);

  // Voice state
  const [liveMode, setLiveMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [voiceSending, setVoiceSending] = useState(false);

  const connections = useListSshConnections();
  const snippets = useListSnippets();
  const chatHistory = useGetChatHistory();
  const sendMessage = useSendChatMessage();
  const clearHistory = useClearChatHistory();

  // ── xterm init ────────────────────────────────────────────────
  useEffect(() => {
    if (!terminalRef.current) return;
    const term = new Terminal({
      theme: {
        background: "#0d1117", foreground: "#39d353", cursor: "#39d353",
        selectionBackground: "#264f78", black: "#0d1117", red: "#ff5555",
        green: "#39d353", yellow: "#f1fa8c", blue: "#6272a4",
        magenta: "#bd93f9", cyan: "#8be9fd", white: "#f8f8f2",
      },
      fontFamily: "'JetBrains Mono', 'Menlo', monospace",
      fontSize: 13, lineHeight: 1.4, cursorBlink: true, convertEol: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    setTimeout(() => { try { fitAddon.fit(); } catch { /* ignore */ } }, 80);

    term.writeln("\x1b[32mTerminal AI\x1b[0m — Ready to connect");
    term.writeln("\x1b[2mSelect a saved connection to SSH into your server\x1b[0m");
    term.writeln("");
    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "data", data }));
      }
    });
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      try { fitAddon.fit(); } catch { /* ignore */ }
      if (wsRef.current?.readyState === WebSocket.OPEN && term.cols && term.rows) {
        wsRef.current.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
      }
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      term.dispose();
      xtermRef.current = null;
    };
  }, []);

  // Refit terminal when switching back to terminal tab
  useEffect(() => {
    if (mobileTab === "terminal") {
      setTimeout(() => { try { fitAddonRef.current?.fit(); } catch { /* ignore */ } }, 80);
    }
  }, [mobileTab]);

  // ── SSH connect (with auto-reconnect) ─────────────────────────
  const connectWithId = useCallback((connId: number, connName: string, isReconnect = false) => {
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.onerror = null; wsRef.current.close(); wsRef.current = null; }

    lastConnIdRef.current = connId;
    lastConnNameRef.current = connName;
    if (!isReconnect) { manualDisconnectRef.current = false; reconnectAttemptsRef.current = 0; }

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/api/ssh/ws`);
    wsRef.current = ws;
    setStatus(isReconnect ? "reconnecting" : "connecting");

    ws.onopen = () => { ws.send(JSON.stringify({ type: "connect", connectionId: connId })); };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as WsMessage;
      if (msg.type === "data" && msg.data) {
        xtermRef.current?.write(msg.data);
        termOutputRef.current = (termOutputRef.current + msg.data).slice(-6000);
      } else if (msg.type === "status") {
        const s = msg.data as ConnectionStatus;
        setStatus(s);
        if (s === "connected") {
          reconnectAttemptsRef.current = 0;
          setActiveConnName(connName);
          if (isReconnect) {
            xtermRef.current?.writeln(`\x1b[32m✓ Reconnected to ${connName}\x1b[0m`);
          } else {
            xtermRef.current?.writeln(`\x1b[32m✓ Connected to ${connName}\x1b[0m`);
          }
        } else if (s === "disconnected") {
          setActiveConnName(""); agentStopRef.current = true;
          xtermRef.current?.writeln("\x1b[33m⚡ Disconnected\x1b[0m");
        }
      } else if (msg.type === "error" && msg.data) {
        xtermRef.current?.writeln(`\x1b[31m✗ ${msg.data}\x1b[0m`);
        setStatus("disconnected"); agentStopRef.current = true;
      }
    };

    const handleUnexpectedClose = () => {
      if (manualDisconnectRef.current) { setStatus("disconnected"); setActiveConnName(""); return; }
      const attempt = reconnectAttemptsRef.current;
      if (attempt >= RECONNECT_MAX) {
        setStatus("disconnected"); setActiveConnName("");
        xtermRef.current?.writeln("\x1b[31m✗ Auto-reconnect failed. Click SSH to reconnect manually.\x1b[0m");
        return;
      }
      const delay = RECONNECT_DELAYS[attempt];
      setStatus("reconnecting");
      setActiveConnName("");
      xtermRef.current?.writeln(`\x1b[33m⟳ Reconnecting in ${delay / 1000}s… (attempt ${attempt + 1}/${RECONNECT_MAX})\x1b[0m`);
      reconnectAttemptsRef.current = attempt + 1;
      reconnectTimerRef.current = setTimeout(() => { connectWithId(connId, connName, true); }, delay);
    };

    ws.onclose = handleUnexpectedClose;
    ws.onerror = () => { xtermRef.current?.writeln("\x1b[31m✗ WebSocket error\x1b[0m"); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconnect immediately when app returns from background (mobile OS kills WebSocket)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (lastConnIdRef.current === null) return;
      if (manualDisconnectRef.current) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      // Page came back to foreground with a dead socket — reconnect now
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      xtermRef.current?.writeln("\x1b[33m⟳ Reconnecting after background pause…\x1b[0m");
      connectWithId(lastConnIdRef.current, lastConnNameRef.current, true);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [connectWithId]);

  // Keepalive ping every 20s — prevents Cloudflare/nginx from timing out idle connections
  useEffect(() => {
    if (status !== "connected") return;
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 20000);
    return () => clearInterval(interval);
  }, [status]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatHistory.data, agentRunning, isListening, isSpeaking]);

  const connectSsh = useCallback(() => {
    if (!selectedConnId) return;
    const connId = parseInt(selectedConnId, 10);
    const conn = connections.data?.find(c => c.id === connId);
    if (!conn) return;
    setConnectDialogOpen(false);
    connectWithId(connId, conn.name, false);
  }, [selectedConnId, connections.data, connectWithId]);

  const disconnect = useCallback(() => {
    manualDisconnectRef.current = true;
    agentStopRef.current = true;
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    reconnectAttemptsRef.current = 0;
    if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.onerror = null; wsRef.current.send(JSON.stringify({ type: "disconnect" })); wsRef.current.close(); wsRef.current = null; }
    setStatus("disconnected"); setActiveConnName("");
  }, []);

  const sendToTerminal = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "data", data }));
    }
  }, []);

  const sendSnippet = useCallback((command: string) => { sendToTerminal(command + "\n"); }, [sendToTerminal]);

  // ── Normal chat ────────────────────────────────────────────────
  const handleSyncNow = useCallback(async () => {
    setSyncStatus("syncing");
    try {
      const res = await fetch("/api/memory/sync", { method: "POST" });
      if (res.ok) { setSyncStatus("synced"); setLastSynced(new Date()); }
      else { setSyncStatus("error"); }
    } catch { setSyncStatus("error"); }
  }, []);

  const handleSendChat = useCallback(async () => {
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    const forceMemory = /^(remember|don'?t forget|make a note|note that|please remember)\b/i.test(msg);
    setChatInput("");
    sendMessage.mutate(
      { data: { message: msg, terminalContext: termOutputRef.current.slice(-2000), forceMemory } },
      {
        onSuccess: (resp) => {
          queryClient.invalidateQueries({ queryKey: getGetChatHistoryQueryKey() });
          if (resp.memorySaved) { setMemoryNoteVisible(true); setTimeout(() => setMemoryNoteVisible(false), 3000); }
          if (resp.synced) { setSyncStatus("synced"); setLastSynced(new Date()); }
        },
        onError: (err: Error) => {
          toast({ title: "Chat error", description: err.message, variant: "destructive" });
          queryClient.invalidateQueries({ queryKey: getGetChatHistoryQueryKey() });
        },
      }
    );
    queryClient.invalidateQueries({ queryKey: getGetChatHistoryQueryKey() });
  }, [chatInput, sendMessage, queryClient, toast]);

  // ── Voice: stop TTS audio ──────────────────────────────────────
  const stopTtsAudio = useCallback(() => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.src = "";
      ttsAudioRef.current = null;
    }
    isSpeakingRef.current = false;
    setIsSpeaking(false);
  }, []);

  // ── Voice: speak (server-side TTS → Audio element) ─────────────
  const speakText = useCallback((text: string, onDone?: () => void) => {
    stopTtsAudio();
    const clean = stripAnsi(text).replace(/[*_`#]/g, "").trim();
    if (!clean) { onDone?.(); return; }

    isSpeakingRef.current = true;
    setIsSpeaking(true);

    // Watchdog: fallback if fetch or playback hangs (~70 ms/char + 10s buffer)
    const estimatedMs = Math.max(5000, clean.length * 70);
    let finished = false;
    const watchdog = setTimeout(() => finish(), estimatedMs + 10000);

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      onDone?.();
    };

    fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, voice: "nova" }),
    })
      .then((res) => {
        if (!res.ok) { finish(); return; }
        return res.blob();
      })
      .then((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        ttsAudioRef.current = audio;
        audio.onended = () => { URL.revokeObjectURL(url); ttsAudioRef.current = null; finish(); };
        audio.onerror = () => { URL.revokeObjectURL(url); ttsAudioRef.current = null; finish(); };
        audio.play().catch(finish);
      })
      .catch(finish);
  }, [stopTtsAudio]);

  // ── Voice: listen ──────────────────────────────────────────────
  const startListening = useCallback(() => {
    if (isListeningRef.current || isSpeakingRef.current || voiceSendingRef.current) return;
    if (!liveModeRef.current) return;
    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;
    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";
      finalTranscriptRef.current = "";
      recognition.onstart = () => { isListeningRef.current = true; setIsListening(true); setInterimTranscript(""); };
      recognition.onresult = (event) => {
        let interim = "", final = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) final += t; else interim += t;
        }
        if (final) finalTranscriptRef.current += " " + final;
        setInterimTranscript((finalTranscriptRef.current + " " + interim).trim());
      };
      recognition.onend = () => {
        isListeningRef.current = false; setIsListening(false);
        const transcript = finalTranscriptRef.current.trim();
        finalTranscriptRef.current = ""; setInterimTranscript("");
        if (transcript && liveModeRef.current) {
          voiceSendingRef.current = true; setVoiceSending(true);
          sendMessage.mutate(
            { data: { message: VOICE_SYSTEM_NOTE + transcript, terminalContext: termOutputRef.current.slice(-2000) } },
            {
              onSuccess: (resp) => {
                queryClient.invalidateQueries({ queryKey: getGetChatHistoryQueryKey() });
                voiceSendingRef.current = false; setVoiceSending(false);
                if (!liveModeRef.current) return;
                if (resp.message) {
                  speakText(resp.message, () => { if (liveModeRef.current) startListening(); });
                } else {
                  setTimeout(startListening, 500);
                }
              },
              onError: (err: Error) => {
                toast({ title: "Voice error", description: err.message, variant: "destructive" });
                queryClient.invalidateQueries({ queryKey: getGetChatHistoryQueryKey() });
                voiceSendingRef.current = false; setVoiceSending(false);
                if (liveModeRef.current) setTimeout(startListening, 1000);
              },
            }
          );
        } else if (liveModeRef.current && !isSpeakingRef.current && !voiceSendingRef.current) {
          setTimeout(startListening, 300);
        }
      };
      recognition.onerror = (event) => {
        if (event.error === "not-allowed") {
          toast({ title: "Microphone blocked", description: "Allow microphone access and try again.", variant: "destructive" });
          liveModeRef.current = false; setLiveMode(false);
        }
        isListeningRef.current = false; setIsListening(false);
      };
      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      isListeningRef.current = false; setIsListening(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendMessage, queryClient, toast, speakText]);

  const stopListening = useCallback(() => {
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    recognitionRef.current = null;
    isListeningRef.current = false; setIsListening(false);
    finalTranscriptRef.current = ""; setInterimTranscript("");
  }, []);

  const toggleLiveMode = useCallback(() => {
    const API = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!API) {
      toast({ title: "Not supported", description: "Speech recognition requires Chrome or Edge.", variant: "destructive" });
      return;
    }
    if (liveModeRef.current) {
      liveModeRef.current = false; setLiveMode(false);
      stopListening(); stopTtsAudio();
      voiceSendingRef.current = false; setVoiceSending(false);
    } else {
      if (agentRunning) return;
      liveModeRef.current = true; setLiveMode(true);
      if (isMobile) setMobileTab("chat");
      setTimeout(startListening, 300);
    }
  }, [agentRunning, isMobile, startListening, stopListening, stopTtsAudio, toast]);

  useEffect(() => {
    return () => { liveModeRef.current = false; stopListening(); stopTtsAudio(); };
  }, [stopListening, stopTtsAudio]);

  // ── Agent loop ────────────────────────────────────────────────
  const runAgentStep = useCallback(async (message: string, task: string, step: number, isFirstStep: boolean): Promise<void> => {
    if (agentStopRef.current) { setAgentRunning(false); agentRunningRef.current = false; setAgentStatus("Stopped"); return; }
    if (step > AGENT_MAX_STEPS) {
      xtermRef.current?.writeln("\x1b[33m[Agent] Max steps reached.\x1b[0m");
      setAgentRunning(false); agentRunningRef.current = false;
      setAgentStatus(`Done — ${AGENT_MAX_STEPS} steps`);
      queryClient.invalidateQueries({ queryKey: getGetChatHistoryQueryKey() }); return;
    }
    agentStepRef.current = step; setAgentStep(step); setAgentStatus(`Step ${step} — thinking...`);
    if (!isFirstStep) xtermRef.current?.writeln(`\x1b[36m[Agent step ${step}]\x1b[0m`);
    return new Promise<void>((resolve) => {
      sendMessage.mutate(
        { data: { message, terminalContext: termOutputRef.current.slice(-3000), agentMode: true, agentTask: task, agentStep: step } },
        {
          onSuccess: async (resp) => {
            queryClient.invalidateQueries({ queryKey: getGetChatHistoryQueryKey() });
            if (agentStopRef.current) { setAgentRunning(false); agentRunningRef.current = false; setAgentStatus("Stopped"); resolve(); return; }
            if (resp.done || !resp.command) {
              xtermRef.current?.writeln("\x1b[32m[Agent] Task complete.\x1b[0m");
              setAgentRunning(false); agentRunningRef.current = false; setAgentStatus("Done"); resolve(); return;
            }
            setAgentStatus(`Step ${step} — running: ${resp.command}`);
            xtermRef.current?.writeln(`\x1b[36m[Agent]\x1b[0m \x1b[33m$ ${resp.command}\x1b[0m`);
            termSnapshotRef.current = termOutputRef.current;
            sendToTerminal(resp.command + "\n");
            await new Promise(r => setTimeout(r, AGENT_COLLECT_DELAY_MS));
            if (agentStopRef.current) { setAgentRunning(false); agentRunningRef.current = false; setAgentStatus("Stopped"); resolve(); return; }
            const newOutput = termOutputRef.current.slice(termSnapshotRef.current.length) || termOutputRef.current.slice(-2000);
            setAgentTrace(prev => [...prev, { step, command: resp.command!, output: stripAnsi(newOutput).slice(0, 1200).trim() }]);
            await runAgentStep(`Command ran: ${resp.command}\n\nOutput:\n${newOutput}\n\nContinue working on the task.`, task, step + 1, false);
            resolve();
          },
          onError: (err: Error) => {
            toast({ title: "Agent error", description: err.message, variant: "destructive" });
            queryClient.invalidateQueries({ queryKey: getGetChatHistoryQueryKey() });
            setAgentRunning(false); agentRunningRef.current = false; setAgentStatus("Error"); resolve();
          },
        }
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendMessage, queryClient, sendToTerminal, toast]);

  const handleStartAgent = useCallback(async () => {
    const task = chatInput.trim();
    if (!task || agentRunningRef.current) return;
    setChatInput(""); agentRunningRef.current = true; agentStopRef.current = false;
    agentStepRef.current = 1; agentTaskRef.current = task;
    setAgentTrace([]);
    setAgentRunning(true); setAgentStep(1); setAgentStatus("Starting...");
    if (isMobile) setMobileTab("chat");
    xtermRef.current?.writeln(`\x1b[35m[Agent]\x1b[0m Task: ${task}`);
    await runAgentStep(`I have assigned you the following task to complete autonomously on this SSH server:\n\n${task}\n\nBegin now. What is your first command?`, task, 1, true);
  }, [chatInput, isMobile, runAgentStep]);

  const stopAgent = useCallback(() => {
    agentStopRef.current = true; setAgentRunning(false); agentRunningRef.current = false;
    setAgentStatus("Stopped by user");
    xtermRef.current?.writeln("\x1b[33m[Agent] Stopped by user.\x1b[0m");
  }, []);

  const handleClearHistory = () => {
    clearHistory.mutate(undefined, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetChatHistoryQueryKey() }) });
  };

  const isInternalAgentMsg = (c: string) => c.startsWith("I have assigned you") || c.startsWith("Command ran:");
  const isVoiceSystemMsg = (c: string) => c.startsWith("[VOICE MODE:");
  const getDisplayContent = (c: string) => isVoiceSystemMsg(c) ? c.replace(/^\[VOICE MODE:[^\]]*\]\s*/, "") : c;

  const activeMode = liveMode ? "live" : agentMode ? "agent" : "chat";

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="main-page">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-border bg-card shrink-0">
        {/* Status dot + label */}
        <div className={cn("w-2.5 h-2.5 rounded-full shrink-0 transition-colors", STATUS_COLORS[status])} data-testid="status-indicator" />
        <span className="text-xs font-mono text-muted-foreground truncate flex-1 min-w-0" data-testid="text-connection-status">
          {status === "connected" ? activeConnName : status === "connecting" ? "Connecting…" : status === "reconnecting" ? `Reconnecting… (${reconnectAttemptsRef.current}/${RECONNECT_MAX})` : "Disconnected"}
        </span>

        {/* Agent running badge (always visible on mobile) */}
        {agentRunning && (
          <span className="hidden sm:inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-primary/20 text-primary border border-primary/30 rounded font-mono shrink-0">
            <Loader2 className="w-2.5 h-2.5 animate-spin" /> step {agentStep}
          </span>
        )}
        {agentRunning && isMobile && (
          <span className="sm:hidden inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-primary/20 text-primary border border-primary/30 rounded font-mono shrink-0">
            <Loader2 className="w-2.5 h-2.5 animate-spin" /> {agentStep}
          </span>
        )}

        {/* Snippet picker — desktop only, when connected */}
        {status === "connected" && (snippets.data?.length ?? 0) > 0 && !agentRunning && !liveMode && (
          <div className="hidden md:block">
            <Select onValueChange={(v) => { const s = snippets.data?.find(x => String(x.id) === v); if (s) sendSnippet(s.command); }}>
              <SelectTrigger className="h-8 text-xs w-36 border-border">
                <SelectValue placeholder="Run snippet..." />
              </SelectTrigger>
              <SelectContent>
                {snippets.data?.map(s => (
                  <SelectItem key={s.id} value={String(s.id)} className="text-xs font-mono">{s.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {status === "connected" ? (
          <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5 border-border shrink-0" onClick={disconnect} data-testid="button-disconnect">
            <Power className="w-3.5 h-3.5" /><span className="hidden sm:inline">Disconnect</span>
          </Button>
        ) : (
          <Button size="sm" className="h-9 text-xs gap-1.5 shrink-0" onClick={() => setConnectDialogOpen(true)} data-testid="button-connect">
            <Plug className="w-3.5 h-3.5" /><span className="hidden sm:inline">Connect</span><span className="sm:hidden">SSH</span>
          </Button>
        )}
      </div>

      {/* ── Mobile tab switcher ── */}
      <div className="md:hidden flex shrink-0 border-b border-border bg-card">
        <button
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors border-b-2",
            mobileTab === "terminal" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
          )}
          onClick={() => setMobileTab("terminal")}
          data-testid="mobile-tab-terminal"
        >
          <TerminalIcon className="w-4 h-4" /> Terminal
        </button>
        <button
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors border-b-2 relative",
            mobileTab === "chat" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
          )}
          onClick={() => setMobileTab("chat")}
          data-testid="mobile-tab-chat"
        >
          {liveMode ? <Phone className="w-4 h-4" /> : agentMode ? <Cpu className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
          {liveMode ? "Live" : agentMode ? "Agent" : "AI Chat"}
          {/* Notification dot when agent/live is active and on terminal tab */}
          {(agentRunning || liveMode) && mobileTab === "terminal" && (
            <span className="absolute top-2 right-6 w-2 h-2 rounded-full bg-primary animate-pulse" />
          )}
        </button>
      </div>

      {/* ── Main workspace ── */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Terminal panel ── */}
        <div className={cn(
          "flex flex-col overflow-hidden",
          "md:flex-1 md:border-r md:border-border",
          isMobile ? (mobileTab === "terminal" ? "flex-1 w-full" : "hidden") : "flex-1 border-r border-border"
        )}>
          <div
            ref={terminalRef}
            className="flex-1 overflow-hidden"
            style={{ background: "#0d1117" }}
            data-testid="terminal-container"
          />

          {/* Mobile keyboard bar */}
          {status === "connected" && (mobileTab === "terminal" || !isMobile) && (
            <div className="flex overflow-x-auto gap-1 p-1.5 border-t border-border bg-card shrink-0" data-testid="mobile-keyboard">
              {MOBILE_KEYS.map((k) => (
                <button
                  key={k.label}
                  className="shrink-0 px-2.5 h-10 rounded bg-secondary text-secondary-foreground text-xs font-mono hover:bg-accent hover:text-accent-foreground active:scale-95 transition-all"
                  onClick={() => sendToTerminal(k.data)}
                  data-testid={`key-${k.label.replace(/[^a-z0-9]/gi, "")}`}
                >
                  {k.label}
                </button>
              ))}
              {isMobile && (snippets.data?.length ?? 0) > 0 && !agentRunning && (
                <Select onValueChange={(v) => { const s = snippets.data?.find(x => String(x.id) === v); if (s) sendSnippet(s.command); }}>
                  <SelectTrigger className="h-10 text-xs w-28 border-border shrink-0 font-mono">
                    <SelectValue placeholder="Snippets" />
                  </SelectTrigger>
                  <SelectContent>
                    {snippets.data?.map(s => (
                      <SelectItem key={s.id} value={String(s.id)} className="text-xs font-mono">{s.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
        </div>

        {/* ── AI Chat panel ── */}
        <div className={cn(
          "flex flex-col overflow-hidden",
          isMobile ? (mobileTab === "chat" ? "flex-1 w-full" : "hidden") : "w-80 shrink-0"
        )}>
          {/* Chat panel header */}
          <div className="flex items-center justify-between px-3 h-11 border-b border-border bg-card shrink-0">
            <div className="flex items-center gap-2">
              {activeMode === "live"
                ? (isListening ? <Mic className="w-4 h-4 text-red-400 animate-pulse" /> : isSpeaking ? <Volume2 className="w-4 h-4 text-primary animate-pulse" /> : <Phone className="w-4 h-4 text-primary" />)
                : activeMode === "agent" ? <Cpu className="w-4 h-4 text-primary" />
                : <Bot className="w-4 h-4 text-primary" />}
              <span className="text-sm font-medium text-foreground">
                {activeMode === "live" ? "Live Mode" : activeMode === "agent" ? "Agent Mode" : "AI Chat"}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant={liveMode ? "default" : "ghost"} size="sm"
                className={cn("h-8 px-2.5 text-xs gap-1 font-mono transition-all",
                  liveMode ? "bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30" : "text-muted-foreground hover:text-foreground")}
                onClick={toggleLiveMode} disabled={agentRunning} data-testid="button-toggle-live-mode" title="Live voice mode"
              >
                {liveMode ? <PhoneOff className="w-3.5 h-3.5" /> : <Phone className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">Live</span>
              </Button>
              <Button
                variant={agentMode ? "default" : "ghost"} size="sm"
                className={cn("h-8 px-2.5 text-xs gap-1 font-mono transition-all",
                  agentMode ? "bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30" : "text-muted-foreground hover:text-foreground")}
                onClick={() => { if (!agentRunning && !liveMode) setAgentMode(!agentMode); }}
                disabled={agentRunning || liveMode} data-testid="button-toggle-agent-mode"
              >
                <Cpu className="w-3.5 h-3.5" /><span className="hidden sm:inline">Agent</span>
              </Button>
              <Button
                variant="ghost" size="icon" className="h-8 w-8 relative"
                onClick={() => setMemoryOpen(true)} title="AI Memory & Sessions"
                data-testid="button-memory-panel"
              >
                <Brain className="w-3.5 h-3.5" />
                {syncStatus === "syncing" && <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />}
                {memoryNoteVisible && <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-primary" />}
              </Button>
              {!agentRunning && !liveMode && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleClearHistory} title="Clear history">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* Live mode status strip */}
          {liveMode && (
            <div className={cn(
              "px-3 py-2 border-b border-border shrink-0 flex items-center justify-between gap-2 transition-colors",
              isListening ? "bg-red-500/10" : isSpeaking ? "bg-primary/10" : voiceSending ? "bg-yellow-500/10" : "bg-card"
            )}>
              <div className="flex items-center gap-2 min-w-0">
                {isListening ? (
                  <><div className="relative shrink-0"><Mic className="w-4 h-4 text-red-400" /><span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-400 animate-ping" /></div>
                    <span className="text-xs text-red-400 font-mono truncate">{interimTranscript || "Listening..."}</span></>
                ) : isSpeaking ? (
                  <><Volume2 className="w-4 h-4 text-primary shrink-0 animate-pulse" /><span className="text-xs text-primary font-mono">AI speaking...</span></>
                ) : voiceSending ? (
                  <><Loader2 className="w-4 h-4 text-yellow-400 shrink-0 animate-spin" /><span className="text-xs text-yellow-400 font-mono">Thinking...</span></>
                ) : (
                  <><MicOff className="w-4 h-4 text-muted-foreground shrink-0" /><span className="text-xs text-muted-foreground font-mono">Waiting...</span></>
                )}
              </div>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 shrink-0 gap-1" onClick={toggleLiveMode}>
                <PhoneOff className="w-3 h-3" /> End
              </Button>
            </div>
          )}

          {/* Agent status strip */}
          {agentRunning && (
            <div className="px-3 py-2 border-b border-border bg-primary/5 shrink-0 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                <span className="text-xs text-primary font-mono truncate">{agentStatus}</span>
              </div>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 shrink-0 gap-1" onClick={stopAgent}>
                <Square className="w-3 h-3" /> Stop
              </Button>
            </div>
          )}

          {/* Mode info banners */}
          {agentMode && !agentRunning && !liveMode && (
            <div className="px-3 py-2 border-b border-border bg-primary/5 shrink-0">
              <p className="text-xs text-primary/80 leading-relaxed">Assign a task — the AI runs commands autonomously (up to {AGENT_MAX_STEPS} steps).</p>
            </div>
          )}
          {liveMode && !isListening && !isSpeaking && !voiceSending && (
            <div className="px-3 py-2 border-b border-border bg-red-500/5 shrink-0">
              <p className="text-xs text-red-400/80 leading-relaxed">Just speak — AI responds out loud. Commands appear here for one-tap running.</p>
            </div>
          )}

          {/* ── Messages (scrollable) ── */}
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0" data-testid="chat-messages">
            {!chatHistory.data?.length && !liveMode && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-8">
                {agentMode
                  ? <><Cpu className="w-10 h-10 text-muted-foreground opacity-20" /><p className="text-sm text-muted-foreground leading-relaxed">Assign a task and the AI will run through it autonomously.</p></>
                  : <><Bot className="w-10 h-10 text-muted-foreground opacity-20" /><p className="text-sm text-muted-foreground leading-relaxed">Ask me anything. I can see your terminal output and run commands.</p></>}
              </div>
            )}
            {!chatHistory.data?.length && liveMode && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3 py-8">
                <div className="relative">
                  <Phone className="w-12 h-12 text-red-400 opacity-60" />
                  {isListening && <span className="absolute inset-0 rounded-full border-2 border-red-400 animate-ping opacity-30" />}
                </div>
                <p className="text-sm text-muted-foreground">{isListening ? "Listening — speak now" : "Live mode active. Start speaking."}</p>
              </div>
            )}

            {(() => {
              let agentMsgIdx = 0;
              return chatHistory.data?.map((msg) => {
                if (isInternalAgentMsg(msg.content) && msg.role === "user") return null;
                const display = getDisplayContent(msg.content);
                const bubble = (
                  <div className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")} data-testid={`chat-message-${msg.id}`}>
                    {msg.role === "assistant" && (
                      <div className="w-6 h-6 rounded bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                        <Bot className="w-3.5 h-3.5 text-primary" />
                      </div>
                    )}
                    <div className={cn(
                      "max-w-[85%] rounded-xl px-3 py-2.5 text-sm",
                      msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border border-border text-foreground"
                    )}>
                      <p className="whitespace-pre-wrap leading-relaxed">{display}</p>
                      {msg.command && !agentRunning && (
                        <div className="mt-2 space-y-1.5">
                          <code className="block font-mono text-xs bg-black/30 rounded-lg px-2.5 py-1.5 text-primary/90 break-all">
                            {msg.command}
                          </code>
                          {status === "connected" && (
                            <button
                              className="w-full h-9 flex items-center justify-center gap-1.5 rounded-lg border border-primary/30 text-primary text-xs font-medium hover:bg-primary/10 active:bg-primary/20 transition-colors"
                              onClick={() => sendSnippet(msg.command!)}
                              data-testid={`button-run-command-${msg.id}`}
                            >
                              <PlayCircle className="w-3.5 h-3.5" /> Run in terminal
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    {msg.role === "user" && (
                      <div className="w-6 h-6 rounded bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                        <User className="w-3.5 h-3.5 text-secondary-foreground" />
                      </div>
                    )}
                  </div>
                );

                if (msg.role === "assistant" && msg.command && agentTrace.length > 0) {
                  const trace = agentTrace[agentMsgIdx++];
                  return (
                    <Fragment key={msg.id}>
                      {bubble}
                      {trace && (
                        <div className="flex gap-2 justify-start">
                          <div className="w-6 h-6 rounded bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center shrink-0 mt-0.5">
                            <TerminalIcon className="w-3 h-3 text-yellow-500/70" />
                          </div>
                          <div className="max-w-[90%] rounded-xl border border-yellow-500/15 bg-black/50 overflow-hidden text-xs font-mono">
                            <div className="px-2.5 py-1 border-b border-yellow-500/10 flex items-center gap-2">
                              <span className="text-yellow-400/70">$</span>
                              <span className="text-yellow-300/90 break-all">{trace.command}</span>
                              <span className="ml-auto text-muted-foreground/40 text-[10px] shrink-0">step {trace.step}</span>
                            </div>
                            {trace.output && (
                              <pre className="px-2.5 py-2 text-primary/70 whitespace-pre-wrap break-all leading-relaxed max-h-48 overflow-y-auto">
                                {trace.output}
                              </pre>
                            )}
                          </div>
                        </div>
                      )}
                    </Fragment>
                  );
                }

                return <Fragment key={msg.id}>{bubble}</Fragment>;
              });
            })()}

            {sendMessage.isPending && (
              <div className="flex gap-2 justify-start">
                <div className="w-6 h-6 rounded bg-primary/20 flex items-center justify-center shrink-0">
                  {agentRunning ? <Cpu className="w-3.5 h-3.5 text-primary" /> : <Bot className="w-3.5 h-3.5 text-primary" />}
                </div>
                <div className="bg-card border border-card-border rounded-xl px-3 py-2.5">
                  <div className="flex gap-1 items-center h-4">
                    <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}

            {/* Live interim transcript */}
            {liveMode && interimTranscript && (
              <div className="flex gap-2 justify-end">
                <div className="max-w-[85%] rounded-xl px-3 py-2.5 text-sm bg-red-500/20 border border-red-500/30 text-red-300 italic">
                  {interimTranscript}
                </div>
                <div className="w-6 h-6 rounded bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                  <Mic className="w-3.5 h-3.5 text-red-400 animate-pulse" />
                </div>
              </div>
            )}
          </div>

          {/* ── Chat input (text mode) ── */}
          {!liveMode && (
            <div className="shrink-0 p-3 border-t border-border bg-card" data-testid="chat-input-area">
              {status === "connected" && !agentMode && (
                <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" /> Terminal context included
                </p>
              )}
              {agentMode && status !== "connected" && (
                <p className="text-xs text-destructive/80 mb-2 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive inline-block" /> Connect to a server first
                </p>
              )}
              <div className="flex gap-2">
                <Textarea
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (agentMode && !agentRunning) handleStartAgent();
                      else if (!agentMode) handleSendChat();
                    }
                  }}
                  placeholder={agentRunning ? "Agent is running..." : agentMode ? "Assign a task to the agent..." : "Ask the AI..."}
                  disabled={agentRunning}
                  className="text-sm resize-none min-h-[52px] max-h-32 bg-background border-border disabled:opacity-60"
                  data-testid="input-chat"
                />
                {agentMode ? (
                  agentRunning
                    ? <Button size="icon" variant="destructive" className="h-[52px] w-12 shrink-0" onClick={stopAgent}><Square className="w-4 h-4" /></Button>
                    : <Button size="icon" className="h-[52px] w-12 shrink-0 bg-primary/80 hover:bg-primary" onClick={handleStartAgent} disabled={!chatInput.trim() || status !== "connected"} data-testid="button-start-agent"><ChevronRight className="w-4 h-4" /></Button>
                ) : (
                  <Button size="icon" className="h-[52px] w-12 shrink-0" onClick={handleSendChat} disabled={sendMessage.isPending || !chatInput.trim()} data-testid="button-send-chat"><Send className="w-4 h-4" /></Button>
                )}
              </div>
            </div>
          )}

          {/* ── Live mode push-to-talk ── */}
          {liveMode && (
            <div className="shrink-0 p-3 border-t border-border bg-card" data-testid="live-mode-footer">
              <button
                className={cn(
                  "w-full h-16 rounded-xl flex items-center justify-center gap-3 text-sm font-medium transition-all border",
                  isListening ? "bg-red-500/20 border-red-500/40 text-red-400" :
                  isSpeaking ? "bg-primary/10 border-primary/30 text-primary" :
                  "bg-card border-border text-muted-foreground hover:bg-secondary active:bg-secondary/80"
                )}
                onClick={() => {
                  if (isSpeaking) { stopTtsAudio(); setTimeout(startListening, 200); }
                  else if (!isListening && !voiceSending) startListening();
                }}
                data-testid="button-push-to-talk"
              >
                {isListening ? <><Mic className="w-6 h-6 animate-pulse" /> Listening — speak now</>
                  : isSpeaking ? <><Volume2 className="w-6 h-6 animate-pulse" /> AI speaking — tap to interrupt</>
                  : voiceSending ? <><Loader2 className="w-6 h-6 animate-spin" /> Thinking...</>
                  : <><Mic className="w-6 h-6 opacity-50" /> Tap to speak</>}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Memory Panel ── */}
      <MemoryPanel
        open={memoryOpen}
        onClose={() => setMemoryOpen(false)}
        onSyncNow={handleSyncNow}
        syncStatus={syncStatus}
        lastSynced={lastSynced}
      />

      {/* ── Connect dialog ── */}
      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent className="bg-card border-card-border max-w-sm mx-4">
          <DialogHeader><DialogTitle className="font-mono">Connect to Server</DialogTitle></DialogHeader>
          {!connections.data?.length ? (
            <div className="text-sm text-muted-foreground text-center py-4">No saved connections. Go to Servers to add one.</div>
          ) : (
            <>
              <Select value={selectedConnId} onValueChange={setSelectedConnId}>
                <SelectTrigger className="font-mono h-11" data-testid="select-connection">
                  <SelectValue placeholder="Select a server..." />
                </SelectTrigger>
                <SelectContent>
                  {connections.data.map(c => (
                    <SelectItem key={c.id} value={String(c.id)} className="font-mono">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{c.username}@{c.host}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-11" onClick={() => setConnectDialogOpen(false)}>Cancel</Button>
                <Button className="flex-1 h-11" onClick={connectSsh} disabled={!selectedConnId} data-testid="button-confirm-connect">
                  <Plug className="w-4 h-4 mr-1.5" /> Connect
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
