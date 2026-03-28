import { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Loader2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const API_BASE = 'http://localhost:8000/api';

export default function Chatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'bot', text: string }[]>([
    { role: 'bot', text: 'Hi! I am your AI Cyber Assistant. Is there anything I can help you with?.' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen, isLoading]);

  const sendMessage = async () => {
    if (!input.trim() || isTyping) return;
    const userText = input.trim();
    const historyPayload = messages.map(m => ({ role: m.role, text: m.text }));
    
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setInput('');
    setIsLoading(true);
    setIsTyping(true);

    const token = localStorage.getItem('token');
    
    setMessages(prev => [...prev, { role: 'bot', text: '' }]);
    const botMsgIndex = messages.length + 1;

    setTimeout(async () => {
      try {
        const response = await fetch(`${API_BASE}/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ message: userText, history: historyPayload })
        });

        if (!response.body) throw new Error("No response body");
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const tokenText = line.substring(6).replace(/<br>/g, '\n');
              setMessages(prev => {
                const newMessages = [...prev];
                newMessages[botMsgIndex] = {
                  ...newMessages[botMsgIndex],
                  text: newMessages[botMsgIndex].text + tokenText
                };
                return newMessages;
              });
            }
          }
        }
      } catch (e: any) {
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[botMsgIndex] = { role: 'bot', text: "Network error or offline backend." };
          return newMessages;
        });
      } finally {
        setIsLoading(false);
        setIsTyping(false);
      }
    }, 1500);
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {isOpen && (
        <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-80 h-96 mb-4 overflow-hidden flex flex-col animate-in slide-in-from-bottom-5">
          <div className="bg-indigo-600/20 border-b border-indigo-500/20 p-4 flex justify-between items-center">
            <h4 className="font-bold flex items-center gap-2 text-indigo-100">
              <MessageSquare className="w-4 h-4" /> Analyst ChatBot
            </h4>
            <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 p-4 overflow-y-auto space-y-4 text-sm bg-slate-900/50">
            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === 'user' ? "justify-end" : "justify-start")}>
                <div className={cn("px-4 py-2 rounded-2xl max-w-[85%] leading-relaxed",
                  m.role === 'user'
                    ? "bg-indigo-600 text-white rounded-tr-sm"
                    : "bg-slate-800 text-slate-200 border border-slate-700/50 rounded-tl-sm"
                )}>
                  <div className="flex-1">
                    {m.text === "" && m.role === 'bot' ? (
                       <div className="flex gap-1 items-center h-5 mt-1">
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                          <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                       </div>
                    ) : (
                      m.text.split('\n').map((line, lidx) => (
                        <span key={lidx}>{line}<br/></span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="px-4 py-3 bg-slate-800/80 border border-slate-700/50 rounded-2xl rounded-tl-sm flex items-center gap-2 text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" /> AI is resolving context...
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div className="p-3 border-t border-slate-800 bg-slate-900 flex gap-2">
            <input 
               type="text" 
               value={input} 
               onChange={(e) => setInput(e.target.value)}
               onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
               placeholder={isTyping ? "AI is typing..." : "Ask a question..."}
               disabled={isTyping}
               className="flex-1 bg-slate-800 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-500 border border-slate-700 text-sm disabled:opacity-50"
            />
            <button 
              onClick={sendMessage} 
              disabled={isTyping || !input.trim()}
              className="bg-indigo-600 p-2 rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-50"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      )}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 bg-indigo-600 hover:bg-indigo-500 rounded-full flex items-center justify-center shadow-[0_0_20px_rgba(79,70,229,0.4)] transition-all hover:scale-110 active:scale-95 text-white"
      >
        {isOpen ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
      </button>
    </div>
  );
}
