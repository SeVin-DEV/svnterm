import { useEffect, useRef, useState, useCallback } from "react";
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

type ConnectionStatus = "disconnected" | "connecting" | "connected";
type MobileTab = "terminal" | "chat";

interface WsMessage { type: "data" | "status" | "error"; data?: string; }

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  disconnected: "bg-muted-foreground",
  connecting: "bg-yellow-500 animate-pulse",
  connected: "bg-primary",
};

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
