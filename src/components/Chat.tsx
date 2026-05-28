"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  content: "你好，有什么可以帮你的吗？",
};

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 流式回复结束后自动 focus 输入框
  useEffect(() => {
    if (!streaming) {
      inputRef.current?.focus();
    }
  }, [streaming]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: trimmed,
    };

    const assistantId = (Date.now() + 1).toString();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setStreaming(true);

    try {
      const apiMessages = [...messages, userMsg]
        .filter((m) => m.id !== "welcome" || messages.length === 1)
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });

      if (!response.ok) throw new Error("API error");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine.startsWith("data: ")) continue;

          const data = trimmedLine.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantId
                    ? { ...msg, content: msg.content + parsed.content }
                    : msg
                )
              );
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantId
            ? { ...msg, content: "抱歉，出了点问题，请稍后重试。" }
            : msg
        )
      );
    } finally {
      setStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto w-full px-5">
      {/* Header */}
      <header className="flex-none pt-8 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-[#d4c8b8] flex items-center justify-center">
            <span className="text-white text-xs font-medium">拾</span>
          </div>
          <div>
            <h1 className="text-[15px] font-medium text-[#4a4a4a]">小拾光</h1>
            <p className="text-[11px] text-[#b0a69b]">原创设计饰品</p>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-2 space-y-4">
        <AnimatePresence>
          {messages.map((msg, i) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="w-6 h-6 rounded-full bg-[#e8e1d5] flex items-center justify-center shrink-0 mr-2 mt-0.5">
                  <span className="text-[#b0a69b] text-[10px] font-medium">拾</span>
                </div>
              )}

              <div
                className={`max-w-[80%] px-4 py-2.5 text-[15px] leading-relaxed ${
                  msg.role === "user"
                    ? "bg-[#ede5d9] text-[#4a4a4a] rounded-2xl rounded-tr-md"
                    : "bg-white text-[#5a5a5a] rounded-2xl rounded-tl-md"
                }`}
              >
                <p>
                  {msg.content}
                  {streaming &&
                    i === messages.length - 1 &&
                    msg.role === "assistant" && (
                      <span className="inline-block w-[1px] h-4 bg-[#b0a69b] ml-0.5 align-text-bottom animate-pulse" />
                    )}
                </p>
              </div>
            </motion.div>
          ))}

          {/* Typing indicator */}
          {streaming &&
            messages[messages.length - 1]?.role === "assistant" &&
            messages[messages.length - 1]?.content === "" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-1.5 pl-8 py-1"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#d4c8b8] animate-pulse" />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-[#d4c8b8] animate-pulse"
                  style={{ animationDelay: "0.15s" }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-[#d4c8b8] animate-pulse"
                  style={{ animationDelay: "0.3s" }}
                />
              </motion.div>
            )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div className="flex-none py-4">
        <div className="flex items-center gap-2 bg-white rounded-full px-5 py-2.5 shadow-sm border border-[#e8e1d5]">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息…"
            className="flex-1 bg-transparent text-[15px] text-[#4a4a4a] placeholder-[#c4bdb2]
                       focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className="text-sm text-[#b0a69b] hover:text-[#8a7e6e] transition-colors
                       disabled:opacity-30 disabled:cursor-default shrink-0"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
