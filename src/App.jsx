import { useState, useRef, useEffect } from 'react'

const API = "https://ai-second-brain-pjfz.onrender.com/"

// ── tiny helpers ──────────────────────────────────────────────
const api = async (path, opts = {}) => {
  const res = await fetch(API + path, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

const authHeaders = (token) => ({
  Authorization: "Bearer " + token,
  "Content-Type": "application/json",
})

// ── uid for sessions ──────────────────────────────────────────
const makeId = () => Math.random().toString(36).slice(2, 10)

export default function App() {
  // auth
  const [token, setToken]     = useState(() => localStorage.getItem("token") || "")
  const [authMode, setAuthMode] = useState("login")   // "login" | "register"
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [authError, setAuthError] = useState("")
  const [authLoading, setAuthLoading] = useState(false)

  // notes
  const [note, setNote]         = useState("")
  const [noteStatus, setNoteStatus] = useState("")   // "" | "saving" | "saved" | "error"

  // chat
  const [sessions, setSessions]     = useState(() => {
    try { return JSON.parse(localStorage.getItem("sessions") || "[]") } catch { return [] }
  })
  const [activeSession, setActiveSession] = useState(() => localStorage.getItem("activeSession") || "")
  const [messages, setMessages]     = useState([])
  const [question, setQuestion]     = useState("")
  const [asking, setAsking]         = useState(false)
  const [chatError, setChatError]   = useState("")

  const chatEndRef  = useRef(null)
  const inputRef    = useRef(null)
  const noteRef     = useRef(null)

  // ── persist ───────────────────────────────────────────────
  useEffect(() => {
    if (token) localStorage.setItem("token", token)
    else localStorage.removeItem("token")
  }, [token])

  useEffect(() => {
    localStorage.setItem("sessions", JSON.stringify(sessions))
  }, [sessions])

  useEffect(() => {
    localStorage.setItem("activeSession", activeSession)
  }, [activeSession])

  // auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // init a default session on first login
  useEffect(() => {
    if (token && sessions.length === 0) {
      const id = makeId()
      const s = [{ id, name: "Session 1" }]
      setSessions(s)
      setActiveSession(id)
    }
    if (token && sessions.length > 0 && !activeSession) {
      setActiveSession(sessions[0].id)
    }
  }, [token])

  // ── auth ──────────────────────────────────────────────────
  const handleAuth = async () => {
    if (!username.trim() || !password.trim()) return
    setAuthLoading(true)
    setAuthError("")
    try {
      if (authMode === "register") {
        await api("/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        })
        setAuthMode("login")
        setAuthError("Registered! Now log in.")
      } else {
        const form = new URLSearchParams()
        form.append("username", username)
        form.append("password", password)
        const data = await api("/login", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
        })
        setToken(data.access_token)
        setUsername("")
        setPassword("")
      }
    } catch (e) {
      setAuthError(e.message)
    } finally {
      setAuthLoading(false)
    }
  }

  const logout = () => {
    setToken("")
    setMessages([])
    setSessions([])
    setActiveSession("")
    localStorage.clear()
  }

  // ── notes ─────────────────────────────────────────────────
  const addNote = async () => {
    if (!note.trim()) return
    setNoteStatus("saving")
    try {
      await api("/add-note", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ content: note }),
      })
      setNote("")
      setNoteStatus("saved")
      setTimeout(() => setNoteStatus(""), 2000)
    } catch (e) {
      setNoteStatus("error")
      setTimeout(() => setNoteStatus(""), 3000)
    }
  }

  // ── sessions ──────────────────────────────────────────────
  const newSession = () => {
    const id = makeId()
    const n = sessions.length + 1
    setSessions(prev => [...prev, { id, name: `Session ${n}` }])
    setActiveSession(id)
    setMessages([])
  }

  const deleteSession = async (sid) => {
    try {
      await api(`/history/${sid}`, {
        method: "DELETE",
        headers: authHeaders(token),
      })
    } catch (_) {}
    const remaining = sessions.filter(s => s.id !== sid)
    setSessions(remaining)
    if (activeSession === sid) {
      setActiveSession(remaining[0]?.id || "")
      setMessages([])
    }
  }

  const renameSession = (sid, name) => {
    setSessions(prev => prev.map(s => s.id === sid ? { ...s, name } : s))
  }

  const switchSession = (sid) => {
    setActiveSession(sid)
    setMessages([])
    setChatError("")
  }

  // ── ask question ───────────────────────────────────────────
  const onNoteKey = (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    addNote()
  }
}
const onKey = (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()

    if (!asking && question.trim() && activeSession) {
      ask()
    }
  }
}
  const ask = async () => {
  if (!question.trim() || asking || !activeSession) return

  const q = question.trim()
  setQuestion("")
  setChatError("")
  setAsking(true)

  // 1. add user message
  setMessages(prev => [...prev, { role: "user", text: q }])

  try {
    const res = await fetch(API + "/ask", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({
        session_id: activeSession,
        question: q
      })
    })

    const reader = res.body.getReader()
    const decoder = new TextDecoder()

    let aiText = ""

    // 2. add empty AI message
    setMessages(prev => [...prev, { role: "ai", text: "" }])

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      aiText += chunk

      // 3. update last message live
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1].text = aiText
        return updated
      })
    }

  } catch (e) {
    setChatError(e.message)
    setMessages(prev => [...prev, { role: "error", text: e.message }])
  } finally {
    setAsking(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }
}

  // ── auth screen ───────────────────────────────────────────
  if (!token) return (
    <div style={s.page}>
      <style>{css}</style>
      <div style={s.authWrap}>
        <div style={s.authCard}>
          <div style={s.logo}>🧠</div>
          <h1 style={s.authTitle}>AI Second Brain</h1>
          <p style={s.authSub}>Your personal knowledge assistant</p>

          <div style={s.tabs}>
            {["login","register"].map(m => (
              <button key={m} style={{...s.tab, ...(authMode===m ? s.tabActive : {})}}
                onClick={() => { setAuthMode(m); setAuthError("") }}>
                {m.charAt(0).toUpperCase()+m.slice(1)}
              </button>
            ))}
          </div>

          <input
            style={s.input}
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAuth()}
            autoFocus
          />
          <input
            style={s.input}
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAuth()}
          />

          {authError && (
            <p style={{...s.msg, color: authError.startsWith("Registered") ? "#00E5A0" : "#FF6B6B"}}>{authError}</p>
          )}

          <button style={s.btnPrimary} onClick={handleAuth} disabled={authLoading} className="btn-primary">
            {authLoading ? <span className="spinner" /> : (authMode === "login" ? "Sign In" : "Create Account")}
          </button>
        </div>
      </div>
    </div>
  )

  // ── app screen ────────────────────────────────────────────
  const activeSessionName = sessions.find(s => s.id === activeSession)?.name || "Chat"

  return (
    <div style={s.page}>
      <style>{css}</style>

      {/* ── sidebar ── */}
      <aside style={s.sidebar}>
        <div style={s.sideTop}>
          <div style={s.brand}>🧠 <span style={s.brandText}>Second Brain</span></div>

          {/* Note input */}
          <div style={s.sideSection}>
            <p style={s.sideLabel}>ADD NOTE</p>
            <div style={s.noteWrap}>
              <textarea
                ref={noteRef}
                style={s.noteArea}
                placeholder={"Write a note...\nCtrl+Enter to save"}
                value={note}
                onChange={e => setNote(e.target.value)}
                onKeyDown={onNoteKey}
                rows={3}
              />
              <button style={{...s.noteBtn,
                ...(noteStatus==="saved" ? {background:"#00E5A0",color:"#0a0e1a"} :
                    noteStatus==="error"  ? {background:"#FF6B6B",color:"#fff"} : {})
              }} onClick={addNote} className="btn-note">
                {noteStatus === "saving" ? <span className="spinner-sm"/> :
                 noteStatus === "saved"  ? "✓ Saved" :
                 noteStatus === "error"  ? "✗ Error" : "Save Note"}
              </button>
            </div>
          </div>

          {/* Sessions */}
          <div style={s.sideSection}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <p style={{...s.sideLabel,marginBottom:0}}>SESSIONS</p>
              <button style={s.newSessionBtn} onClick={newSession} title="New session">＋</button>
            </div>
            <div style={s.sessionList}>
              {sessions.map(sess => (
                <SessionRow
                  key={sess.id}
                  sess={sess}
                  active={sess.id === activeSession}
                  onSwitch={() => switchSession(sess.id)}
                  onRename={(name) => renameSession(sess.id, name)}
                  onDelete={() => deleteSession(sess.id)}
                />
              ))}
            </div>
          </div>
        </div>

        <button style={s.logoutBtn} onClick={logout}>Sign Out</button>
      </aside>

      {/* ── main chat ── */}
      <main style={s.main}>
        <div style={s.chatHeader}>
          <span style={s.chatTitle}>{activeSessionName}</span>
          <span style={s.chatHint}>Enter to send · Shift+Enter for newline</span>
        </div>

        <div style={s.chatBody}>
          {messages.length === 0 && (
            <div style={s.empty}>
              <div style={s.emptyIcon}>💬</div>
              <p style={s.emptyText}>Ask anything from your notes</p>
              <p style={s.emptyHint}>Add notes on the left, then ask questions here</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} />
          ))}

          {asking && messages[messages.length - 1]?.role !== "ai" && <TypingIndicator />}
          <div ref={chatEndRef} />
        </div>

        <div style={s.inputRow}>
          <textarea
            ref={inputRef}
            style={s.chatInput}
            placeholder={activeSession ? "Ask something..." : "Create a session first →"}
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={onKey}
            disabled={asking || !activeSession}
            rows={1}
            className="chat-input"
          />
          <button
            style={{...s.sendBtn, ...(asking || !question.trim() ? s.sendDisabled : {})}}
            onClick={ask}
            disabled={asking || !question.trim() || !activeSession}
            className="send-btn"
          >
            {asking ? <span className="spinner-sm" style={{borderTopColor:"#fff"}}/> : "↑"}
          </button>
        </div>
      </main>
    </div>
  )
}

// ── sub-components ────────────────────────────────────────────

function SessionRow({ sess, active, onSwitch, onRename, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(sess.name)

  const save = () => { onRename(val || sess.name); setEditing(false) }

  return (
    <div style={{...s.sessRow, ...(active ? s.sessActive : {})}} onClick={onSwitch}>
      {editing ? (
        <input
          style={s.sessInput}
          value={val}
          autoFocus
          onChange={e => setVal(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if(e.key==="Enter") save(); e.stopPropagation() }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span style={s.sessName}>{sess.name}</span>
      )}
      <div style={s.sessActions}>
        <button style={s.iconBtn} title="Rename"
          onClick={e => { e.stopPropagation(); setEditing(true) }}>✎</button>
        <button style={{...s.iconBtn, color:"#FF6B6B"}} title="Delete"
          onClick={e => { e.stopPropagation(); onDelete() }}>✕</button>
      </div>
    </div>
  )
}

function MessageBubble({ msg }) {
  const isUser = msg.role === "user"
  const isErr  = msg.role === "error"
  return (
    <div style={{...s.bubbleWrap, justifyContent: isUser ? "flex-end" : "flex-start"}}
      className="bubble-wrap">
      {!isUser && <div style={s.avatar}>{isErr ? "⚠" : "🧠"}</div>}
      <div style={{
        ...s.bubble,
        ...(isUser ? s.bubbleUser : isErr ? s.bubbleErr : s.bubbleAI),
      }} className="bubble">
        <p style={s.bubbleText}>{msg.text}</p>
        {msg.eval && (
          <div style={s.evalRow}>
            <span style={s.evalPill}>
              {msg.eval.retrieval_count} notes · avg {msg.eval.avg_score}
            </span>
          </div>
        )}
      </div>
      {isUser && <div style={s.avatarUser}>You</div>}
    </div>
  )
}

function TypingIndicator() {
  return (
    <div style={{...s.bubbleWrap, justifyContent:"flex-start"}}>
      <div style={s.avatar}>🧠</div>
      <div style={{...s.bubble,...s.bubbleAI,padding:"12px 16px"}}>
        <div className="typing">
          <span/><span/><span/>
        </div>
      </div>
    </div>
  )
}

// ── styles ────────────────────────────────────────────────────
const s = {
  page: {
    display: "flex",
    height: "100vh",
    background: "#080c18",
    fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
    color: "#e8eaf6",
    overflow: "hidden",
  },
  // auth
  authWrap: {
    flex: 1, display:"flex", alignItems:"center", justifyContent:"center",
    background: "radial-gradient(ellipse at 50% 0%, #1a2040 0%, #080c18 70%)",
  },
  authCard: {
    width: 380, background: "#0f1424", borderRadius: 20,
    padding: "40px 36px", border: "1px solid #1e2540",
    boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
    display:"flex", flexDirection:"column", gap:14,
  },
  logo: { fontSize:40, textAlign:"center" },
  authTitle: { margin:0, fontSize:24, fontWeight:700, textAlign:"center", color:"#e8eaf6" },
  authSub: { margin:0, fontSize:13, color:"#5a6280", textAlign:"center" },
  tabs: { display:"flex", background:"#151a2e", borderRadius:10, padding:3 },
  tab: {
    flex:1, padding:"8px 0", background:"transparent", border:"none",
    color:"#5a6280", cursor:"pointer", borderRadius:8, fontSize:14, fontWeight:500,
    transition:"all .2s",
  },
  tabActive: { background:"#1e2a4a", color:"#7eb3ff" },
  input: {
    padding:"12px 16px", background:"#151a2e", border:"1px solid #1e2540",
    borderRadius:10, color:"#e8eaf6", fontSize:14, outline:"none",
    transition:"border .2s",
  },
  msg: { fontSize:13, textAlign:"center", margin:0 },
  btnPrimary: {
    padding:"13px", background:"linear-gradient(135deg,#4f8ef7,#7b5cf5)",
    border:"none", borderRadius:10, color:"#fff", fontSize:15, fontWeight:600,
    cursor:"pointer", marginTop:4, transition:"opacity .2s, transform .1s",
  },
  // sidebar
  sidebar: {
    width: 260, background:"#0a0e1a", borderRight:"1px solid #12172a",
    display:"flex", flexDirection:"column", flexShrink:0,
    padding:"20px 14px",
  },
  sideTop: { flex:1, display:"flex", flexDirection:"column", gap:20, overflow:"auto" },
  brand: { display:"flex", alignItems:"center", gap:8, padding:"0 4px 8px", borderBottom:"1px solid #12172a" },
  brandText: { fontSize:15, fontWeight:700, color:"#7eb3ff" },
  sideSection: {},
  sideLabel: { fontSize:10, fontWeight:700, color:"#3a4060", letterSpacing:"1.5px", marginBottom:8 },
  noteWrap: { display:"flex", flexDirection:"column", gap:6 },
  noteArea: {
    background:"#0f1424", border:"1px solid #1e2540", borderRadius:10,
    color:"#e8eaf6", fontSize:13, padding:"10px 12px", resize:"none",
    outline:"none", fontFamily:"inherit", lineHeight:1.5,
  },
  noteBtn: {
    padding:"9px", background:"#1e2a4a", border:"none", borderRadius:8,
    color:"#7eb3ff", fontSize:13, fontWeight:600, cursor:"pointer",
    transition:"all .2s",
  },
  sessionList: { display:"flex", flexDirection:"column", gap:4, maxHeight:280, overflowY:"auto" },
  newSessionBtn: {
    background:"#1e2a4a", border:"none", borderRadius:6, color:"#7eb3ff",
    fontSize:16, cursor:"pointer", width:24, height:24, lineHeight:"24px",
    textAlign:"center", padding:0,
  },
  sessRow: {
    display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"8px 10px", borderRadius:8, cursor:"pointer",
    border:"1px solid transparent", transition:"all .15s",
    background:"transparent",
  },
  sessActive: { background:"#0f1b30", border:"1px solid #1e3a5f" },
  sessName: { fontSize:13, color:"#a8b4d0", flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  sessInput: {
    flex:1, background:"transparent", border:"none", borderBottom:"1px solid #4f8ef7",
    color:"#e8eaf6", fontSize:13, outline:"none", padding:"2px 0",
  },
  sessActions: { display:"flex", gap:4, opacity:0, transition:"opacity .15s" },
  iconBtn: {
    background:"none", border:"none", color:"#5a6280", cursor:"pointer",
    fontSize:12, padding:"2px 4px", borderRadius:4,
  },
  logoutBtn: {
    marginTop:"auto", padding:"10px", background:"transparent",
    border:"1px solid #1e2540", borderRadius:8, color:"#5a6280",
    cursor:"pointer", fontSize:13, transition:"all .2s",
  },
  // main
  main: {
    flex:1, display:"flex", flexDirection:"column", overflow:"hidden",
  },
  chatHeader: {
    display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"16px 24px", borderBottom:"1px solid #12172a",
    background:"#080c18",
  },
  chatTitle: { fontSize:16, fontWeight:600, color:"#c8d0e8" },
  chatHint: { fontSize:12, color:"#2a3050" },
  chatBody: {
    flex:1, overflowY:"auto", padding:"24px 20px",
    display:"flex", flexDirection:"column", gap:16,
  },
  empty: {
    flex:1, display:"flex", flexDirection:"column", alignItems:"center",
    justifyContent:"center", gap:8, margin:"auto",
  },
  emptyIcon: { fontSize:48, opacity:.3 },
  emptyText: { fontSize:16, color:"#3a4060", fontWeight:600, margin:0 },
  emptyHint: { fontSize:13, color:"#2a3050", margin:0 },
  // message bubbles
  bubbleWrap: {
    display:"flex", alignItems:"flex-end", gap:10,
  },
  avatar: {
    width:32, height:32, borderRadius:"50%",
    background:"#0f1b30", display:"flex", alignItems:"center",
    justifyContent:"center", fontSize:16, flexShrink:0,
    border:"1px solid #1e2540",
  },
  avatarUser: {
    fontSize:11, color:"#5a6280", flexShrink:0, alignSelf:"flex-end", paddingBottom:6,
  },
  bubble: {
    maxWidth:"72%", borderRadius:16, padding:"12px 16px",
    lineHeight:1.6, wordBreak:"break-word",
  },
  bubbleUser: {
    background:"linear-gradient(135deg,#1e3a6e,#1e2a5a)",
    borderBottomRightRadius:4, border:"1px solid #2a4080",
  },
  bubbleAI: {
    background:"#0f1424",
    borderBottomLeftRadius:4, border:"1px solid #1e2540",
  },
  bubbleErr: {
    background:"#2a0f0f", border:"1px solid #5a1a1a",
    borderBottomLeftRadius:4,
  },
  bubbleText: { margin:0, fontSize:14, color:"#d8e0f0" },
  evalRow: { marginTop:8, display:"flex" },
  evalPill: {
    fontSize:11, color:"#4f7ab0", background:"#0a1628",
    borderRadius:20, padding:"2px 10px", border:"1px solid #1a2f50",
  },
  // input row
  inputRow: {
    display:"flex", gap:10, padding:"16px 20px",
    borderTop:"1px solid #12172a", background:"#080c18",
    alignItems:"flex-end",
  },
  chatInput: {
    flex:1, background:"#0f1424", border:"1px solid #1e2540",
    borderRadius:12, color:"#e8eaf6", fontSize:14, padding:"12px 16px",
    outline:"none", fontFamily:"inherit", resize:"none", lineHeight:1.5,
    maxHeight:120, overflowY:"auto",
  },
  sendBtn: {
    width:44, height:44, borderRadius:12, border:"none",
    background:"linear-gradient(135deg,#4f8ef7,#7b5cf5)",
    color:"#fff", fontSize:20, cursor:"pointer", flexShrink:0,
    display:"flex", alignItems:"center", justifyContent:"center",
    transition:"opacity .2s, transform .1s",
  },
  sendDisabled: { opacity:.35, cursor:"default" },
}

// ── CSS for hover states & animations ─────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');

  * { box-sizing: border-box; }
  body { margin: 0; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #1e2540; border-radius: 4px; }

  .btn-primary:hover:not(:disabled) { opacity: .88; transform: translateY(-1px); }
  .btn-primary:disabled { opacity: .5; cursor: not-allowed; }

  .btn-note:hover { background: #253356 !important; }

  .send-btn:hover:not(:disabled) { transform: scale(1.06); }

  /* session row hover reveals actions */
  [class=""] aside div div div:hover .sessActions,
  div:hover > div[style*="opacity: 0"] { opacity: 1 !important; }

  /* hacky but works — reveal icons on sess row hover */
  div:hover > div > button { opacity: 1 !important; }

  .bubble-wrap:hover .bubble { border-color: #253050 !important; }

  .chat-input:focus {
    border-color: #2a4080 !important;
    box-shadow: 0 0 0 3px rgba(79,142,247,0.08);
  }

  input:focus {
    border-color: #4f8ef7 !important;
    box-shadow: 0 0 0 3px rgba(79,142,247,0.1);
    outline: none;
  }
  textarea:focus { outline: none; border-color: #2a4080 !important; }

  /* typing dots */
  .typing { display: flex; gap: 5px; align-items: center; height: 18px; }
  .typing span {
    width: 7px; height: 7px; background: #4f8ef7;
    border-radius: 50%; display: inline-block;
    animation: bounce 1.2s infinite ease-in-out;
  }
  .typing span:nth-child(2) { animation-delay: 0.2s; background: #7b5cf5; }
  .typing span:nth-child(3) { animation-delay: 0.4s; background: #00d4ff; }
  @keyframes bounce {
    0%,80%,100% { transform: translateY(0); opacity:.5 }
    40%          { transform: translateY(-6px); opacity:1 }
  }

  /* spinner */
  .spinner {
    display: inline-block; width: 18px; height: 18px;
    border: 2px solid rgba(255,255,255,.3);
    border-top-color: #fff; border-radius: 50%;
    animation: spin .7s linear infinite;
  }
  .spinner-sm {
    display: inline-block; width: 14px; height: 14px;
    border: 2px solid rgba(255,255,255,.2);
    border-top-color: #aaa; border-radius: 50%;
    animation: spin .7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* bubble entrance */
  .bubble { animation: fadeUp .2s ease; }
  @keyframes fadeUp {
    from { opacity:0; transform: translateY(8px); }
    to   { opacity:1; transform: translateY(0); }
  }

  /* session row icons on hover */
  div:hover > div[style*="opacity"] { opacity: 1 !important; }
`