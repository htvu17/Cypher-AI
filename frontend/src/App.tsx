import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, 
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar 
} from 'recharts';
import { ShieldCheck, Lock, Activity, ArrowLeft, AlertTriangle, User, ChevronRight, CheckCircle2, X, Loader2 } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import Chatbot from './components/Chatbot';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

axios.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const API_BASE = 'http://localhost:8000/api';

const QUESTIONS = [
  { id: 1, domain: "Access Control", text: "Do employees use Multi-Factor Authentication (MFA) when logging into email, banking, or critical software?", options: [{ text: "Yes, for all critical systems", score: 0 }, { text: "Yes, but only for email", score: 3.3 }, { text: "Only for administrators", score: 6.7 }, { text: "No", score: 10 }] },
  { id: 2, domain: "Access Control", text: "How does your organization manage password security?", options: [{ text: "Strong policy enforced + password manager", score: 0 }, { text: "Strong policy but no manager", score: 3.3 }, { text: "Basic password requirements", score: 6.7 }, { text: "No password policy, passwords shared", score: 10 }] },
  { id: 3, domain: "Access Control", text: "How do you manage user access when employees join, change roles, or leave?", options: [{ text: "Automated system with HR integration", score: 0 }, { text: "Manual process tracked in spreadsheet", score: 3.3 }, { text: "Informal, often delayed", score: 6.7 }, { text: "No process", score: 10 }] },
  { id: 4, domain: "Data Protection", text: "How is sensitive data (customer info, financials) protected?", options: [{ text: "Encrypted with strict access controls", score: 0 }, { text: "Encrypted but access is open", score: 3.3 }, { text: "Stored on shared drives without encryption", score: 6.7 }, { text: "Unencrypted on individual devices", score: 10 }] },
  { id: 5, domain: "Data Protection", text: "Do you have a data backup strategy?", options: [{ text: "Automated, tested, offsite/cloud", score: 0 }, { text: "Automated but not tested", score: 3.3 }, { text: "Manual backups", score: 6.7 }, { text: "No backups", score: 10 }] },
  { id: 6, domain: "Human Security", text: "How do you train employees on cybersecurity?", options: [{ text: "Regular training with phishing simulations", score: 0 }, { text: "Annual training only", score: 3.3 }, { text: "New hire training only", score: 6.7 }, { text: "No training", score: 10 }] },
  { id: 7, domain: "Endpoint Security", text: "Do you use antivirus or endpoint protection on company devices?", options: [{ text: "Managed EDR with 24/7 monitoring", score: 0 }, { text: "Basic antivirus installed", score: 3.3 }, { text: "Free versions only", score: 6.7 }, { text: "None", score: 10 }] },
  { id: 8, domain: "Endpoint Security", text: "How do you manage software updates and patches?", options: [{ text: "Automated patching with testing", score: 0 }, { text: "Automated but may disrupt work", score: 3.3 }, { text: "Manual, when remembered", score: 6.7 }, { text: "Updates disabled or delayed", score: 10 }] },
  { id: 9, domain: "Incident Response", text: "Do you have a documented incident response plan?", options: [{ text: "Written, tested, and updated", score: 0 }, { text: "Written but never tested", score: 3.3 }, { text: "Informal plan", score: 6.7 }, { text: "No plan", score: 10 }] },
  { id: 10, domain: "Incident Response", text: "Do you monitor systems for suspicious activity?", options: [{ text: "24/7 monitoring with alerts", score: 0 }, { text: "Periodic log reviews", score: 3.3 }, { text: "Only when issues arise", score: 6.7 }, { text: "No monitoring", score: 10 }] },
];

const LOADING_PHRASES = [
  "Analyzing Access Control...",
  "Cross-referencing Industry Protocols...",
  "Validating Encryption Standards...",
  "Generating Strategic Action Plan...",
  "Finalizing Recommendations..."
];

export default function App() {
  const [view, setView] = useState<'LOGIN' | 'DASHBOARD' | 'QUESTIONNAIRE' | 'LOADING' | 'RESULTS' | 'ACTION_PLAN'>('LOGIN');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [answers, setAnswers] = useState<Record<number, {score: number, text: string}>>({});
  const [industry, setIndustry] = useState('Technology');
  const [currentResult, setCurrentResult] = useState<any>(null);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [actionPlanText, setActionPlanText] = useState<string | null>(null);
  const [isPlanLoading, setIsPlanLoading] = useState(false);
  const [loadingText, setLoadingText] = useState(LOADING_PHRASES[0]);

  useEffect(() => {
    let pollInterval: any;
    let textInterval: any;

    if (view === 'LOADING' && currentResult?.assessment_id) {
      let phraseIdx = 0;
      setLoadingText(LOADING_PHRASES[0]);
      
      textInterval = setInterval(() => {
        phraseIdx = (phraseIdx + 1) % LOADING_PHRASES.length;
        setLoadingText(LOADING_PHRASES[phraseIdx]);
      }, 3000);

      pollInterval = setInterval(async () => {
        try {
          const res = await axios.get(`${API_BASE}/assessment-status/${currentResult.assessment_id}`);
          if (res.data.status === 'COMPLETED') {
            clearInterval(pollInterval);
            clearInterval(textInterval);
            setCurrentResult(res.data);
            fetchDashboard(); // refresh history
            setView('RESULTS');
          }
        } catch (e: any) {
          if (e.response?.status === 401) {
            clearInterval(pollInterval);
            clearInterval(textInterval);
            handleLogout();
          }
        }
      }, 3000);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
      if (textInterval) clearInterval(textInterval);
    };
  }, [view, currentResult]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('username');
    if (token && savedUser) {
      setUsername(savedUser);
      fetchDashboard();
      setView('DASHBOARD');
    }
  }, []);

  const fetchDashboard = async () => {
    try {
      const res = await axios.get(`${API_BASE}/dashboard`);
      setHistory(res.data.history);
    } catch (e: any) {
      if (e.response?.status === 401) handleLogout();
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_BASE}/login`, { username, password });
      if (res.data.status === 'success') {
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('username', res.data.username);
        fetchDashboard();
        setView('DASHBOARD');
      }
    } catch (e) {
      alert("Login failed! (Try any non-empty username/password combo for demo)");
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    setUsername('');
    setPassword('');
    setHistory([]);
    setAnswers({});
    setCurrentResult(null);
    setActionPlanText(null);
    setView('LOGIN');
  };

  const submitAssessment = async () => {
    if (Object.keys(answers).length < 10) {
      alert("Please answer all 10 questions.");
      return;
    }
    const payload = {
      industry,
      answers: Object.entries(answers).map(([id, val]) => ({ question_id: parseInt(id), score: val.score, text: val.text }))
    };
    try {
      const res = await axios.post(`${API_BASE}/assessment`, payload);
      // Wait for the async backend background tasks!
      setCurrentResult({ assessment_id: res.data.assessment_id });
      setView('LOADING');
    } catch (e: any) {
      if (e.response?.status === 401) handleLogout();
      else alert("Error submitting assessment. Check server logs!");
    }
  };

  const fetchAssessmentResults = async (assessmentId: number) => {
    setView('LOADING');
    try {
      const res = await axios.get(`${API_BASE}/assessment/${assessmentId}`);
      setCurrentResult(res.data);
      setView('RESULTS');
    } catch (e: any) {
      if (e.response?.status === 401) handleLogout();
      else {
        alert("Failed to fetch assessment details.");
        setView('DASHBOARD');
      }
    }
  };

  const fetchActionPlan = async (assessmentId: number) => {
    setView('ACTION_PLAN');
    setIsPlanLoading(true);
    setActionPlanText(null);
    try {
      const res = await axios.get(`${API_BASE}/action-plan/${assessmentId}`);
      setActionPlanText(res.data.action_plan);
    } catch (e: any) {
      if (e.response?.status === 401) handleLogout();
      else setActionPlanText("Failed to load action plan.");
    } finally {
      setIsPlanLoading(false);
    }
  };
  return (
    <div className="min-h-screen text-slate-100 font-sans selection:bg-indigo-500/30">
      
      {/* --- HEADER --- */}
      {view !== 'LOGIN' && (
        <header className="fixed top-0 w-full z-40 glass border-b border-indigo-500/20">
          <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-lg">
                <ShieldCheck className="w-6 h-6 text-indigo-400" />
              </div>
              <span className="font-bold text-xl tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-300">
                Cypher AI CyberSecurity Assessment Tool
              </span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-slate-300">
                <User className="w-4 h-4" />
                {username}
              </div>
              <button 
                onClick={handleLogout}
                className="text-sm font-medium hover:text-red-400 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </header>
      )}

      {/* --- MAIN CONTENT AREA --- */}
      <main className={cn("pt-24 pb-12 px-6 max-w-6xl mx-auto", view === 'LOGIN' && "pt-0 flex items-center justify-center min-h-screen")}>
        
        {/* VIEW: LOGIN */}
        {view === 'LOGIN' && (
          <div className="glass-panel p-8 rounded-2xl w-full max-w-md shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-32 bg-indigo-500/10 rounded-full blur-3xl -z-10 group-hover:bg-indigo-500/20 transition-all duration-700"></div>
            
            <div className="flex justify-center mb-6">
              <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-4 rounded-xl shadow-lg ring-1 ring-white/20">
                <Lock className="w-10 h-10 text-white" />
              </div>
            </div>
            <h2 className="text-3xl font-bold text-center mb-2">Welcome Back</h2>
            <p className="text-slate-400 text-center mb-8">Secure your SME infrastructure</p>
            
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-sm font-medium mb-2 text-slate-300">Username</label>
                <input 
                  type="text" required value={username} onChange={e => setUsername(e.target.value)}
                  className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  placeholder="admin"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2 text-slate-300">Password</label>
                <input 
                  type="password" required value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  placeholder="••••••••"
                />
              </div>
              <button type="submit" className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-indigo-500/25 transition-all active:scale-[0.98]">
                Secure Login
              </button>
            </form>
          </div>
        )}

        {/* VIEW: DASHBOARD */}
        {view === 'DASHBOARD' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold mb-2">Historical Insights & Dashboard</h1>
                <p className="text-slate-400">Review your past risk assessments and overall security trajectory.</p>
              </div>
              <button 
                onClick={() => { setAnswers({}); setView('QUESTIONNAIRE'); }}
                className="flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-bold px-6 py-3 rounded-xl shadow-lg shadow-emerald-500/25 transition-all"
              >
                <Activity className="w-5 h-5" /> Start Questionnaire
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Stats Card */}
              <div className="glass-panel p-6 rounded-2xl flex flex-col justify-center relative overflow-hidden">
                <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-indigo-500/20 blur-3xl rounded-full pointer-events-none"></div>
                <h3 className="text-slate-400 font-medium mb-1">Total Risk Scans</h3>
                <div className="text-5xl font-black text-white">{history.length}</div>
                <p className="text-sm text-indigo-300 mt-2 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> Actively monitoring
                </p>
              </div>

              {/* Chart spanning 2 cols */}
              <div className="glass-panel p-6 rounded-2xl lg:col-span-2 flex flex-col h-80 relative overflow-hidden">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-indigo-400" /> Overall Risk Trendline
                </h3>
                {history.length > 0 ? (
                  <div className="flex-1 w-full min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={history.map((h, i) => ({ name: `Scan ${i+1}`, score: h.overall_score }))} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                        <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickMargin={10} />
                        <YAxis domain={[0, 100]} stroke="#94a3b8" fontSize={12} tickFormatter={(val) => `${val}%`} />
                        <RechartsTooltip cursor={{fill: 'rgba(255,255,255,0.05)'}} contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '8px' }} formatter={(val) => [`${val}%`, 'Risk Score']} />
                        <Line type="monotone" dataKey="score" stroke="#818cf8" strokeWidth={3} dot={{ fill: '#818cf8', r: 4, strokeWidth: 0 }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-slate-500 font-medium">
                    No historical scans available.
                  </div>
                )}
              </div>
            </div>

            {/* Past Recommendations Table */}
            <div className="glass-panel p-6 rounded-2xl overflow-hidden">
              <h3 className="text-xl font-bold mb-4">Past Assessments History</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 text-slate-400 text-sm">
                      <th className="pb-3 px-4">ID</th>
                      <th className="pb-3 px-4">Overall Score</th>
                      <th className="pb-3 px-4">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.slice().reverse().map((item) => (
                      <tr key={item.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-4 px-4 font-medium text-slate-300">{item.id}</td>
                        <td className={cn("py-4 px-4 font-bold tracking-wide", item.overall_score < 33 ? "text-emerald-400" : item.overall_score < 66 ? "text-amber-400" : "text-red-400")}>
                          {item.overall_score.toFixed(1)} <span className="text-xs text-slate-500 font-normal">/ 100% Risk</span>
                        </td>
                        <td className="py-4 px-4 flex items-center gap-3">
                          <button onClick={() => fetchAssessmentResults(item.id)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-300 text-sm font-medium transition-colors">
                            Results
                          </button>
                          <button onClick={() => fetchActionPlan(item.id)} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg text-sm shadow cursor-pointer transition-colors whitespace-nowrap">
                            Targeted Action Plan
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {history.length === 0 && <p className="text-center text-slate-500 py-6">No history available.</p>}
              </div>
            </div>
          </div>
        )}

        {/* VIEW: QUESTIONNAIRE */}
        {view === 'QUESTIONNAIRE' && (
          <div className="max-w-3xl mx-auto animate-in fade-in zoom-in-95 duration-500">
            <button 
              onClick={() => setView('DASHBOARD')}
              className="flex items-center gap-2 text-indigo-400 hover:text-indigo-300 font-medium mb-6 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Return to Dashboard
            </button>
            
            <div className="mb-8">
              <h2 className="text-3xl font-black mb-2">Cypher AI CyberSecurity Assessment Tool</h2>
              <p className="text-slate-400 mb-6">Rate your current infrastructure honestly from 1 (Non-existent) to 10 (Fully mature). The AI will process these discreetly.</p>
              <div className="glass-panel p-6 rounded-2xl border border-indigo-500/20">
                <label className="block text-sm font-bold text-slate-300 mb-3">Primary Industry Profile</label>
                <select 
                  value={industry} 
                  onChange={e => setIndustry(e.target.value)}
                  className="w-full bg-slate-800/80 border border-slate-600 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white"
                >
                  <option value="Retail & Services">Retail & Services</option>
                  <option value="Manufacturing">Manufacturing</option>
                  <option value="Hospital">Hospital</option>
                  <option value="Finance">Finance</option>
                  <option value="Technology">Technology</option>
                </select>
              </div>
            </div>

            <div className="space-y-6 mb-10">
              {QUESTIONS.map((q, idx) => (
                <div key={q.id} className="glass-panel p-6 rounded-2xl hover:bg-white/[0.03] transition-colors border border-transparent hover:border-indigo-500/20">
                  <h3 className="text-lg font-medium mb-4 flex gap-3">
                    <span className="text-indigo-400 bg-indigo-500/10 px-2 rounded font-bold h-fit shrink-0">Q{idx+1}</span>
                    {q.text}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                    {q.options.map((opt: any) => (
                      <button 
                        key={opt.text}
                        onClick={() => setAnswers(prev => ({...prev, [q.id]: {score: opt.score, text: opt.text}}))}
                        className={cn(
                          "relative p-4 rounded-xl text-left border transition-all duration-300 overflow-hidden",
                          answers[q.id]?.text === opt.text
                            ? "bg-indigo-600/20 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.2)]"
                            : "bg-slate-800/50 border-slate-700/50 hover:border-slate-500/50 hover:bg-slate-800"
                        )}
                      >
                        <div className={cn(
                          "absolute top-0 left-0 w-1.5 h-full opacity-70",
                          opt.score === 0 ? "bg-emerald-500/80" : opt.score === 3.3 ? "bg-amber-400/80" : opt.score === 6.7 ? "bg-orange-500/80" : "bg-red-500/80"
                        )}></div>
                        <div className="flex items-center gap-3 pl-2">
                          <div className={cn(
                            "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0",
                            answers[q.id]?.text === opt.text ? "border-indigo-400" : "border-slate-500"
                          )}>
                            {answers[q.id]?.text === opt.text && <div className="w-2.5 h-2.5 bg-indigo-400 rounded-full" />}
                          </div>
                          <span className="text-slate-300 text-sm font-medium">{opt.text}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="glass p-6 rounded-2xl sticky bottom-6 border border-white/10 shadow-2xl flex justify-between items-center z-30">
              <div className="text-sm text-slate-300 font-medium">
                Answered: <span className="text-indigo-400 text-lg">{Object.keys(answers).length}</span> / 10
              </div>
              <button 
                onClick={submitAssessment}
                className={cn(
                  "px-8 py-3 rounded-xl font-bold shadow-lg transition-all",
                  Object.keys(answers).length === 10
                    ? "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white transform hover:-translate-y-1 shadow-indigo-500/25"
                    : "bg-slate-700 text-slate-400 cursor-not-allowed"
                )}
              >
                Analyze & Score
              </button>
            </div>
          </div>
        )}

        {/* VIEW: LOADING */}
        {view === 'LOADING' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] animate-in fade-in duration-700">
            <div className="relative">
              <div className="w-24 h-24 border-8 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <ShieldCheck className="w-8 h-8 text-indigo-400 animate-pulse" />
              </div>
            </div>
            <h2 className="text-3xl font-black mt-8 text-white">{loadingText}</h2>
            <p className="text-slate-400 mt-2 font-medium">Please wait while the AI computes your scores.</p>
            
            {/* Tailwind CSS Skeleton Loaders mapping to the future layout */}
            <div className="w-full max-w-4xl mt-16 space-y-6 opacity-30">
               <div className="flex gap-4 items-center">
                  <div className="w-16 h-16 rounded-2xl bg-slate-800 animate-pulse"></div>
                  <div className="flex-1 space-y-3">
                     <div className="h-4 bg-slate-800 rounded w-3/4 animate-pulse"></div>
                     <div className="h-4 bg-slate-800 rounded w-1/2 animate-pulse"></div>
                  </div>
               </div>
               <div className="h-40 bg-slate-800 rounded-2xl animate-pulse"></div>
            </div>
          </div>
        )}

        {/* VIEW: RESULTS */}
        {view === 'RESULTS' && currentResult && (
          <div className="max-w-5xl mx-auto animate-in fade-in duration-700 slide-in-from-bottom-6">
             <button 
              onClick={() => setView('DASHBOARD')}
              className="flex items-center gap-2 text-indigo-400 hover:text-indigo-300 font-medium mb-6 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Return Home
            </button>

            <div className="text-center mb-10">
              <h2 className="text-4xl font-black bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-teal-400 to-blue-500 mb-2">
                Assessment Complete
              </h2>
              <p className="text-slate-400 text-lg max-w-2xl mx-auto">
                Our AI Math Engine has processed your inputs. Review your comprehensive security breakdown below. Click any domain card for AI recommendations.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Overall Score */}
              <div className="glass-panel p-8 rounded-3xl flex flex-col items-center justify-center relative overflow-hidden text-center col-span-1 border border-indigo-500/20">
                <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/10 to-transparent pointer-events-none"></div>
                <div className="text-sm font-bold tracking-widest text-indigo-400 uppercase mb-4">Overall Risk Level</div>
                <div className={cn("text-8xl font-black tracking-tighter mb-4 drop-shadow-2xl", currentResult.overall_score < 33 ? "text-emerald-400" : currentResult.overall_score < 66 ? "text-amber-400" : "text-red-400")}>
                  {currentResult.overall_score.toFixed(1)}
                </div>
                <div className="text-slate-400 font-medium">Risk Percentage %</div>
              </div>

              {/* Radar Chart Strengths/Weaknesses */}
              <div className="glass-panel p-6 rounded-3xl col-span-1 lg:col-span-2 flex items-center justify-center min-h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="70%" data={
                    Object.entries(currentResult.domain_scores).map(([domain, score]) => ({ domain, score }))
                  }>
                    <PolarGrid stroke="rgba(255,255,255,0.1)" />
                    <PolarAngleAxis dataKey="domain" stroke="#94a3b8" fontSize={12} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} stroke="rgba(255,255,255,0.1)" />
                    <Radar name="Security Posture" dataKey="score" stroke="#818cf8" fill="#6366f1" fillOpacity={0.4} />
                    <RechartsTooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Interactive Domain Scores */}
            <div className="mt-12">
              <h3 className="text-2xl font-bold mb-6">Domain Deep-Dive</h3>
              <p className="text-slate-400 mb-6 font-medium bg-slate-800/50 p-3 rounded-lg border border-slate-700/50 inline-flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" /> Interactive Element: Click a domain score to read the AI vulnerability analysis.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(currentResult.domain_scores).map(([domain, score]: [string, any]) => (
                  <button 
                    key={domain}
                    onClick={() => setSelectedDomain(domain)}
                    className="glass-panel p-5 rounded-2xl text-left hover:-translate-y-1 transition-transform border border-white/5 hover:border-indigo-500/40 group relative overflow-hidden"
                  >
                    <div className={cn(
                      "absolute top-0 right-0 w-2 h-full",
                      score < 33 ? "bg-emerald-500" : score < 66 ? "bg-amber-500" : "bg-red-500"
                    )}></div>
                    <div className="text-slate-400 text-sm font-semibold mb-2">{domain}</div>
                    <div className="text-3xl font-black">{parseFloat(score).toFixed(1)}%</div>
                    <div className="text-xs text-indigo-300 opacity-0 group-hover:opacity-100 transition-opacity mt-2 flex items-center gap-1 mt-2">
                      View AI Analysis <ChevronRight className="w-4 h-4" />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* CALL TO ACTION */}
            <div className="mt-16 glass-panel border border-indigo-500/30 p-10 rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 shadow-2xl relative overflow-hidden flex flex-col items-center justify-center text-center">
              <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
              <Activity className="w-16 h-16 text-indigo-400 mb-6 drop-shadow-[0_0_15px_rgba(99,102,241,0.5)]" />
              <h3 className="text-3xl font-black text-white mb-4 relative z-10">Ready to secure your {currentResult.industry || industry} business?</h3>
              <p className="text-indigo-200 mb-8 max-w-xl mx-auto relative z-10 text-lg">
                Your AI analysis reveals actionable areas of reinforcement tailored to your sector. Don't wait for a breach to discover them.
              </p>
              <button 
                onClick={() => fetchActionPlan(currentResult.id || currentResult.assessment_id)}
                disabled={isPlanLoading}
                className="relative z-10 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 text-white font-bold text-lg px-8 py-4 rounded-full shadow-[0_0_20px_rgba(99,102,241,0.4)] transition-all hover:scale-105 hover:shadow-[0_0_30px_rgba(99,102,241,0.6)] flex items-center gap-3"
              >
                {isPlanLoading ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Generating Strategy...</>
                ) : (
                  "View Detailed Action Plan"
                )}
              </button>
            </div>
          </div>
        )}

      </main>

      {/* --- MODAL FOR AI RECOMMENDATIONS --- */}
      {selectedDomain && currentResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setSelectedDomain(null)}></div>
          <div className="glass-panel border border-indigo-500/30 p-8 rounded-2xl w-full max-w-lg z-10 animate-in fade-in zoom-in-95 relative shadow-2xl">
            <button onClick={() => setSelectedDomain(null)} className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-colors">
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-indigo-500/20 rounded-lg">
                <Activity className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="text-2xl font-bold">{selectedDomain} Profile</h3>
            </div>
            
            <div className="bg-slate-900/60 p-5 rounded-xl border border-slate-700/50 mb-6">
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-2 font-semibold">AI Calculated Risk Penalty</div>
              <div className={cn("text-4xl font-black", currentResult.domain_scores[selectedDomain] < 33 ? "text-emerald-400" : currentResult.domain_scores[selectedDomain] < 66 ? "text-amber-400" : "text-red-400")}>
                {parseFloat(currentResult.domain_scores[selectedDomain]).toFixed(1)} <span className="text-lg text-slate-500">% Severity</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-semibold text-indigo-300">Generated Recommendation:</div>
              <p className="text-slate-300 leading-relaxed text-[15px]">
                {currentResult.recommendations?.[selectedDomain] || "Based on the algorithms, standard upkeep is adequate but continuous monitoring is advised."}
              </p>
            </div>
          </div>
        </div>
      )}

        {/* VIEW: ACTION PLAN */}
        {view === 'ACTION_PLAN' && (
          <div className="max-w-4xl mx-auto animate-in fade-in duration-500">
            <button 
              onClick={() => setView('DASHBOARD')}
              className="flex items-center gap-2 text-indigo-400 hover:text-indigo-300 font-medium mb-6 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Return Home
            </button>
            
            <div className="glass-panel p-8 md:p-12 rounded-3xl border border-indigo-500/20 shadow-2xl relative overflow-hidden">
               <div className="absolute top-0 right-0 p-32 bg-indigo-500/5 rounded-full blur-3xl -z-10"></div>
               <h2 className="text-4xl font-black mb-8 bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-teal-400 to-blue-500">
                 Strategic Action Plan
               </h2>
               
               {isPlanLoading ? (
                 <div className="flex flex-col items-center justify-center py-20 text-indigo-300">
                    <Activity className="w-10 h-10 animate-pulse mb-4" />
                    <p className="font-medium text-lg text-slate-300">AI is formulating your targeted strategy...</p>
                 </div>
               ) : (
                 <div className="prose prose-invert prose-indigo max-w-none prose-h2:text-2xl prose-h2:mt-10 mb-4 prose-h3:text-xl prose-li:text-slate-300 prose-p:text-slate-300">
                   {actionPlanText?.split('\n').map((line, idx) => {
                      if (line.startsWith('## ')) return <h2 key={idx} className="font-bold">{line.replace('## ', '')}</h2>;
                      if (line.startsWith('### ')) return <h3 key={idx} className="font-bold mt-4 mb-2">{line.replace('### ', '')}</h3>;
                      if (line.startsWith('- ')) return <li key={idx} className="ml-4 list-disc">{line.replace('- ', '')}</li>;
                      if (line.startsWith('**')) return <p key={idx} className="font-semibold text-white mt-4">{line.replace(/\*\*/g, '')}</p>;
                      return line.trim() ? <p key={idx} className="mb-2">{line.replace(/\*\*/g, '')}</p> : <br key={idx}/>;
                   })}
                 </div>
               )}
            </div>
          </div>
        )}

      {/* --- AI CHATBOT PERSISTENT FLOATER --- */}
      {view !== 'LOGIN' && <Chatbot />}

    </div>
  );
}
