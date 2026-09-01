"use client";

import { useState, useRef, useEffect } from "react";
import { SkeletonText } from "@/components/ui/skeleton";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function ChatbotWidget({ requestId, styleNumber }: { requestId?: string; styleNumber?: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hello! I'm your costing assistant. Ask me about cost breakdowns, margins, historical data, or pending requests. Type 'help' for more options." }
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function send() {
    if (!input.trim() || busy) return;
    const userMessage = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, requestId, styleNumber })
      });
      const data = await res.json();
      const response = data.ok ? data.response : "Sorry, I couldn't process that request.";
      setMessages((prev) => [...prev, { role: "assistant", content: response }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Connection error. Please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        className="chatbot-fab"
        onClick={() => setOpen(true)}
        title="Open AI Assistant"
        aria-label="Open AI Assistant"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="chatbot-window">
      <div className="chatbot-header">
        <strong>Costing Assistant</strong>
        <button className="chatbot-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
      </div>
      <div className="chatbot-messages" ref={scrollRef}>
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`}>
            <pre className="chat-content">{msg.content}</pre>
          </div>
        ))}
        {busy ? (
          <div className="chat-message assistant">
            <div style={{ width: "100%" }}>
              <SkeletonText />
              <p className="eyebrow" style={{ marginTop: 6 }}><span className="spinner" /> Thinking...</p>
            </div>
          </div>
        ) : null}
      </div>
      <div className="chatbot-input">
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="Ask about costs, margins, history..."
          disabled={busy}
        />
        <button className="button small-btn" onClick={send} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
