import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabaseClient";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS & PURE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const WINNING_COMBOS = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];
const MAX_MARKS = 3;

function checkWinner(board) {
  for (const [a,b,c] of WINNING_COMBOS) {
    if (board[a] && board[b] && board[c] &&
        board[a].player === board[b].player &&
        board[a].player === board[c].player)
      return { player: board[a].player, line: [a,b,c] };
  }
  return null;
}

function getPlayerMoves(board, player) {
  return board
    .map((cell, i) => (cell?.player === player ? { i, age: cell.age } : null))
    .filter(Boolean)
    .sort((a, b) => a.age - b.age);
}

function applyMove(board, idx, player, moveCount) {
  const nb = board.map(c => c ? { ...c } : null);
  nb[idx] = { player, age: moveCount };
  const moves = getPlayerMoves(nb, player);
  let removed = null;
  if (moves.length > MAX_MARKS) { removed = moves[0].i; nb[removed] = null; }
  return [nb, removed];
}

function getEmptyCells(board) {
  return board.map((c, i) => (c ? null : i)).filter(i => i !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// AI
// ─────────────────────────────────────────────────────────────────────────────
function scoreBoard(board, aiPlayer, depth) {
  const result = checkWinner(board);
  if (!result) return 0;
  return result.player === aiPlayer ? 10 - depth : depth - 10;
}

function minimax(board, depth, isMax, aiPlayer, humanPlayer, mc, alpha, beta, maxDepth) {
  const score = scoreBoard(board, aiPlayer, depth);
  if (score !== 0 || depth >= maxDepth) return score;
  const empties = getEmptyCells(board);
  if (empties.length === 0) return 0;
  if (isMax) {
    let best = -Infinity;
    for (const idx of empties) {
      const [nb] = applyMove(board, idx, aiPlayer, mc + depth);
      const val = minimax(nb, depth+1, false, aiPlayer, humanPlayer, mc, alpha, beta, maxDepth);
      best = Math.max(best, val); alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const idx of empties) {
      const [nb] = applyMove(board, idx, humanPlayer, mc + depth);
      const val = minimax(nb, depth+1, true, aiPlayer, humanPlayer, mc, alpha, beta, maxDepth);
      best = Math.min(best, val); beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function getBotMove(board, aiPlayer, difficulty, mc) {
  const humanPlayer = aiPlayer === "X" ? "O" : "X";
  const empties = getEmptyCells(board);
  if (empties.length === 0) return null;

  // Random-move chance per difficulty (chance the bot just plays a random cell)
  // easy: very random, medium: somewhat, hard: noticeable slips, impossible: never
  const randomChance = {
    easy:       0.75,
    medium:     0.45,
    hard:       0.22,   // gives the player occasional openings
    impossible: 0,      // always optimal
  }[difficulty] ?? 0.45;

  if (randomChance > 0 && Math.random() < randomChance) {
    return empties[Math.floor(Math.random() * empties.length)];
  }

  // Search depth per difficulty — deeper = stronger/more foresight
  let maxDepth = {
    easy:       2,
    medium:     4,
    hard:       6,
    impossible: 10,
  }[difficulty] ?? 4;

  // Cap depth early ONLY for non-impossible, to keep them snappy.
  // Impossible always searches deep so it sees long-term forced wins
  // that hard/medium will miss — this is the real difference-maker.
  if (difficulty !== "impossible" && empties.length >= 8 && maxDepth > 6) maxDepth = 6;

  let bestVal = -Infinity, bestMove = empties[0];
  for (const idx of empties) {
    const [nb] = applyMove(board, idx, aiPlayer, mc);
    const val = minimax(nb, 1, false, aiPlayer, humanPlayer, mc, -Infinity, Infinity, maxDepth);
    if (val > bestVal) { bestVal = val; bestMove = idx; }
  }
  return bestMove;
}

// ─────────────────────────────────────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────────────────────────────────────
function getTheme(dark) {
  return dark ? {
    bg:        "#0f0f13",
    surface:   "#1a1a22",
    border:    "#2a2a35",
    text:      "#e8e8e8",
    textDim:   "#888",
    textFaint: "#555",
    hover:     "#23232e",
    menuBg:    "#16161e",
  } : {
    bg:        "#f0f0f0",
    surface:   "#ffffff",
    border:    "#c8c8d4",
    text:      "#0d0d14",
    textDim:   "#333",
    textFaint: "#666",
    hover:     "#e0e0ec",
    menuBg:    "#e4e4ec",
  };
}

const CLR = { X: "#ff6b6b", O: "#74b9ff" };

// ─────────────────────────────────────────────────────────────────────────────
// HAPTIC FEEDBACK
// ─────────────────────────────────────────────────────────────────────────────
function haptic(type = "light") {
  if (!window.navigator?.vibrate) return;
  if (type === "light")  navigator.vibrate(10);
  if (type === "medium") navigator.vibrate(25);
  if (type === "win")    navigator.vibrate([30, 50, 80]);
}

// ─────────────────────────────────────────────────────────────────────────────
// SOUND EFFECTS (Web Audio — "pa-ta" two-tone blip, Among Us vote style)
// ─────────────────────────────────────────────────────────────────────────────
let _audioCtx = null;
function getAudioCtx() {
  if (typeof window === "undefined") return null;
  if (!_audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    _audioCtx = new AC();
  }
  return _audioCtx;
}

// Play a single short tone with a soft attack/decay
function playTone(ctx, freq, startTime, duration, volume, type = "sine") {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  // soft, rounded envelope — like a UI button
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

// type: "place" | "vanish" | "win". volume 0..1
function playSfx(type, volume = 0.5) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume();
  const now = ctx.currentTime;
  const v = Math.max(0, Math.min(1, volume)) * 0.4;

  if (type === "place") {
    // soft rounded button "tock" — single warm note with a tiny pitch pop
    playTone(ctx, 440, now, 0.07, v, "sine");
    playTone(ctx, 660, now, 0.05, v * 0.5, "triangle");
  } else if (type === "vanish") {
    // softer, lower button release
    playTone(ctx, 330, now, 0.09, v, "sine");
    playTone(ctx, 247, now + 0.02, 0.07, v * 0.4, "triangle");
  } else if (type === "win") {
    // gentle rising 3-note chime
    playTone(ctx, 523, now,        0.12, v, "sine");   // C
    playTone(ctx, 659, now + 0.12, 0.12, v, "sine");   // E
    playTone(ctx, 784, now + 0.24, 0.20, v, "sine");   // G
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ABOUT MODAL
// ─────────────────────────────────────────────────────────────────────────────
function AboutModal({ dark, onClose, theme }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px",
        animation: "fadeIn 0.2s ease both",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: theme.menuBg,
          border: `1px solid ${theme.border}`,
          borderRadius: "20px",
          padding: "32px 28px",
          maxWidth: "340px", width: "100%",
          fontFamily: "'Courier New', monospace",
          animation: "screenIn 0.25s ease both",
        }}
      >
        {/* Mini board decoration */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px", marginBottom: "20px", width: "54px" }}>
          {["X","","O","","X","","O","","X"].map((v, i) => (
            <div key={i} style={{
              width: "16px", height: "16px", borderRadius: "3px",
              background: theme.surface, border: `1px solid ${theme.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "7px", fontWeight: "900",
              color: v === "X" ? CLR.X : CLR.O,
            }}>{v}</div>
          ))}
        </div>

        <div style={{ fontSize: "10px", letterSpacing: "0.35em", color: theme.textFaint, marginBottom: "4px" }}>INFINITE</div>
        <div style={{ fontSize: "26px", fontWeight: "900", color: theme.text, letterSpacing: "-0.02em", marginBottom: "4px" }}>Tic Tac Toe</div>
        <div style={{ fontSize: "11px", color: theme.textFaint, marginBottom: "24px" }}>Version 1.0.50</div>

        <div style={{ height: "1px", background: theme.border, marginBottom: "20px" }} />

        <div style={{ fontSize: "12px", color: theme.textDim, lineHeight: 1.7, marginBottom: "24px" }}>
          A modern twist on a classic — each player has just 3 marks on the board at a time. Strategy meets memory.
        </div>

        <div style={{ fontSize: "10px", letterSpacing: "0.2em", color: theme.textFaint, marginBottom: "4px" }}>DEVELOPED BY</div>
        <div style={{ fontSize: "16px", fontWeight: "800", color: theme.text, marginBottom: "20px" }}>Doorless Studios</div>

        <button
          onClick={onClose}
          style={{
            width: "100%", padding: "12px",
            background: "transparent",
            border: `2px solid ${theme.border}`,
            borderRadius: "12px",
            color: theme.textDim, fontSize: "12px",
            letterSpacing: "0.15em", textTransform: "uppercase",
            cursor: "pointer", fontFamily: "'Courier New', monospace",
            transition: "all 0.2s",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE "G" LOGO (official 4-color mark)
// ─────────────────────────────────────────────────────────────────────────────
function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/>
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH MODAL (login / sign up)
// Mirrors AboutModal's look: dim overlay, bordered card, Courier New.
// Handles email + password now. Social sign-in (Google, later Apple) plugs into
// the clearly-marked SOCIAL SIGN-IN section below — nothing else needs to change.
// ─────────────────────────────────────────────────────────────────────────────
function AuthModal({ dark, theme, onClose }) {
  const [mode, setMode]         = useState("login"); // "login" | "signup"
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [notice, setNotice]     = useState(""); // e.g. "check your email"

  const isSignup = mode === "signup";

  // Shared text-input style — matches the bordered, monospace look.
  const inputStyle = {
    width: "100%", boxSizing: "border-box",
    background: theme.surface,
    border: `1px solid ${theme.border}`,
    borderRadius: "10px",
    padding: "12px 14px",
    fontSize: "13px",
    color: theme.text,
    fontFamily: "'Courier New', monospace",
    outline: "none",
    transition: "border-color 0.2s",
    marginBottom: "10px",
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setNotice("");
    if (!supabase) { setError("Sign-in is temporarily unavailable."); return; }
    if (!email || !password) { setError("Enter an email and password."); return; }
    if (isSignup && password.length < 6) { setError("Password must be at least 6 characters."); return; }

    setLoading(true);
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) { setError(error.message); return; }
        // If email confirmation is ON, there's no session yet — tell the user.
        if (!data.session) {
          setNotice("Account created! Check your email to confirm, then log in.");
          setMode("login");
        } else {
          onClose(); // confirmation OFF → logged in immediately
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { setError(error.message); return; }
        onClose(); // onAuthStateChange updates the app; menu will show the account
      }
    } catch (err) {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── SOCIAL SIGN-IN ──────────────────────────────────────────────────────────
  // Google is live. Apple is intentionally disabled until an Apple Developer
  // account is set up — flip `enabled: true` (and configure Apple in Supabase)
  // and it appears automatically. No other code changes needed.
  const SOCIAL_PROVIDERS = [
    { id: "google", label: "Continue with Google", enabled: true },
    { id: "apple",  label: "Continue with Apple",  enabled: false },
  ];

  async function signInWithProvider(provider) {
    setError(""); setNotice("");
    if (!supabase) { setError("Sign-in is temporarily unavailable."); return; }
    // After Google approves, Supabase sends the user back to this same page.
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    // On success the browser redirects away, so we only reach here on error.
    if (error) setError(error.message);
  }

  // Tab button for switching between Log in / Sign up
  const tab = (label, value) => {
    const active = mode === value;
    return (
      <button
        type="button"
        onClick={() => { setMode(value); setError(""); setNotice(""); }}
        style={{
          flex: 1, padding: "9px",
          background: active ? (dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)") : "transparent",
          border: `2px solid ${active ? (dark ? "#666" : "#888") : theme.border}`,
          borderRadius: "10px",
          color: active ? theme.text : theme.textDim,
          fontSize: "12px", letterSpacing: "0.12em", textTransform: "uppercase",
          cursor: "pointer", fontFamily: "'Courier New', monospace",
          transition: "all 0.2s",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px",
        animation: "fadeIn 0.2s ease both",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: theme.menuBg,
          border: `1px solid ${theme.border}`,
          borderRadius: "20px",
          padding: "28px 24px",
          maxWidth: "340px", width: "100%",
          fontFamily: "'Courier New', monospace",
          animation: "screenIn 0.25s ease both",
        }}
      >
        <div style={{ fontSize: "10px", letterSpacing: "0.35em", color: theme.textFaint, marginBottom: "4px" }}>ACCOUNT</div>
        <div style={{ fontSize: "22px", fontWeight: "900", color: theme.text, letterSpacing: "-0.02em", marginBottom: "6px" }}>
          {isSignup ? "Create account" : "Welcome back"}
        </div>
        <div style={{ fontSize: "11px", color: theme.textFaint, marginBottom: "20px", lineHeight: 1.6 }}>
          {isSignup ? "Sign up to save your stats across devices." : "Log in to sync your saved stats."}
        </div>

        {/* Log in / Sign up tabs */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "18px" }}>
          {tab("Log in", "login")}
          {tab("Sign up", "signup")}
        </div>

        <form onSubmit={handleSubmit}>
          <input
            type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="Email" autoComplete="email"
            style={inputStyle}
            onFocus={e => e.currentTarget.style.borderColor = CLR.O}
            onBlur={e => e.currentTarget.style.borderColor = theme.border}
          />
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Password" autoComplete={isSignup ? "new-password" : "current-password"}
            style={{ ...inputStyle, marginBottom: "6px" }}
            onFocus={e => e.currentTarget.style.borderColor = CLR.O}
            onBlur={e => e.currentTarget.style.borderColor = theme.border}
          />

          {error && (
            <div style={{ fontSize: "11px", color: CLR.X, lineHeight: 1.5, margin: "6px 2px 4px" }}>{error}</div>
          )}
          {notice && (
            <div style={{ fontSize: "11px", color: CLR.O, lineHeight: 1.5, margin: "6px 2px 4px" }}>{notice}</div>
          )}

          <button
            type="submit" disabled={loading}
            style={{
              width: "100%", marginTop: "12px", padding: "13px",
              background: dark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.07)",
              border: `2px solid ${dark ? "#666" : "#888"}`,
              borderRadius: "12px",
              color: theme.text, fontSize: "13px", fontWeight: "700",
              letterSpacing: "0.15em", textTransform: "uppercase",
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.6 : 1,
              fontFamily: "'Courier New', monospace",
              transition: "all 0.2s",
            }}
          >
            {loading ? "…" : isSignup ? "Sign up" : "Log in"}
          </button>
        </form>

        {/* ── SOCIAL SIGN-IN ── */}
        {SOCIAL_PROVIDERS.some(p => p.enabled) && (
          <>
            {/* "or" divider */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "18px 0 14px" }}>
              <div style={{ flex: 1, height: "1px", background: theme.border }} />
              <span style={{ fontSize: "10px", letterSpacing: "0.2em", color: theme.textFaint }}>OR</span>
              <div style={{ flex: 1, height: "1px", background: theme.border }} />
            </div>

            {SOCIAL_PROVIDERS.filter(p => p.enabled).map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => signInWithProvider(p.id)}
                style={{
                  width: "100%", marginBottom: "8px", padding: "12px",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: "12px",
                  color: theme.text, fontSize: "13px",
                  letterSpacing: "0.06em",
                  cursor: "pointer", fontFamily: "'Courier New', monospace",
                  transition: "all 0.2s",
                }}
                onMouseEnter={e => e.currentTarget.style.background = theme.hover}
                onMouseLeave={e => e.currentTarget.style.background = theme.surface}
              >
                {p.id === "google" && <GoogleGlyph />}
                {p.id === "apple"  && <span style={{ fontSize: "15px" }}></span>}
                {p.label}
              </button>
            ))}
          </>
        )}

        <button
          type="button" onClick={onClose}
          style={{
            width: "100%", marginTop: "12px", padding: "10px",
            background: "transparent",
            border: "none",
            color: theme.textFaint, fontSize: "11px",
            letterSpacing: "0.1em", textTransform: "uppercase",
            cursor: "pointer", fontFamily: "'Courier New', monospace",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MENU COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function Menu({ dark, onToggleDark, haptics, onToggleHaptics, sfxVolume, onSfxVolume, theme, user, onOpenAuth, onLogout }) {
  const [open, setOpen] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const menuRow = (emoji, label, right, onClick) => (
    <div
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px", cursor: "pointer", transition: "background 0.15s",
        fontFamily: "'Courier New', monospace",
      }}
      onMouseEnter={e => e.currentTarget.style.background = dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ fontSize: "15px" }}>{emoji}</span>
        <span style={{ fontSize: "13px", color: theme.text }}>{label}</span>
      </div>
      {right}
    </div>
  );

  const pill = (active) => (
    <div style={{
      width: "36px", height: "20px", borderRadius: "10px",
      background: active ? "#4a4a60" : (dark ? "#333" : "#b0b0c4"),
      position: "relative", transition: "background 0.2s", flexShrink: 0,
    }}>
      <div style={{
        position: "absolute", top: "3px",
        left: active ? "19px" : "3px",
        width: "14px", height: "14px", borderRadius: "50%",
        background: active ? "#aaa" : "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        transition: "left 0.2s",
      }} />
    </div>
  );

  const sectionLabel = (text) => (
    <div style={{ padding: "10px 16px 4px", fontSize: "9px", letterSpacing: "0.25em", color: theme.textFaint, textTransform: "uppercase", fontFamily: "'Courier New', monospace" }}>
      {text}
    </div>
  );

  const divider = () => <div style={{ height: "1px", background: theme.border, margin: "4px 12px" }} />;

  return (
    <>
      <div ref={menuRef} style={{ position: "relative", zIndex: 100 }}>
        {/* Hamburger */}
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            background: open ? (dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.07)") : "transparent",
            border: `2px solid ${open ? (dark ? "#555" : "#bbb") : "transparent"}`,
            borderRadius: "8px", cursor: "pointer",
            padding: "6px 8px", display: "flex", flexDirection: "column", gap: "4px",
            transition: "all 0.2s",
          }}
          aria-label="Menu"
        >
          {[0,1,2].map(i => (
            <div key={i} style={{
              width: "18px", height: "2px", background: theme.textDim,
              borderRadius: "2px", transition: "all 0.2s",
              transform: open
                ? i === 0 ? "translateY(6px) rotate(45deg)"
                : i === 2 ? "translateY(-6px) rotate(-45deg)"
                : "scaleX(0)"
                : "none",
              opacity: open && i === 1 ? 0 : 1,
            }} />
          ))}
        </button>

        {/* Dropdown */}
        {open && (
          <div style={{
            position: "absolute", top: "calc(100% + 8px)", right: 0,
            background: theme.menuBg, border: `1px solid ${theme.border}`,
            borderRadius: "12px", minWidth: "220px",
            boxShadow: dark ? "0 8px 32px rgba(0,0,0,0.5)" : "0 8px 32px rgba(0,0,0,0.12)",
            overflow: "hidden", animation: "fadeSlideDown 0.15s ease",
          }}>
            {/* Account */}
            {sectionLabel("Account")}
            {user ? (
              <>
                <div style={{ padding: "6px 16px 8px", fontFamily: "'Courier New', monospace" }}>
                  <div style={{ fontSize: "9px", letterSpacing: "0.15em", color: theme.textFaint, textTransform: "uppercase", marginBottom: "2px" }}>
                    Signed in as
                  </div>
                  <div style={{ fontSize: "12px", color: theme.text, wordBreak: "break-all", lineHeight: 1.4 }}>
                    {user.email}
                  </div>
                </div>
                {menuRow("🚪", "Log out", null, () => { setOpen(false); onLogout(); })}
              </>
            ) : (
              menuRow("👤", "Sign up / Log in", null, () => { setOpen(false); onOpenAuth(); })
            )}

            {divider()}
            {sectionLabel("Settings")}
            {menuRow(dark ? "🌙" : "☀️", dark ? "Dark mode" : "Light mode", pill(dark), onToggleDark)}
            {menuRow("📳", "Haptic feedback", pill(haptics), onToggleHaptics)}

            {/* SFX volume slider */}
            <div style={{ padding: "10px 16px 12px", fontFamily: "'Courier New', monospace" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span style={{ fontSize: "15px" }}>{sfxVolume === 0 ? "🔇" : "🔊"}</span>
                  <span style={{ fontSize: "13px", color: theme.text }}>Sound FX</span>
                </div>
                <span style={{ fontSize: "11px", color: theme.textFaint }}>{Math.round(sfxVolume * 100)}%</span>
              </div>
              <input
                type="range" min="0" max="100" value={Math.round(sfxVolume * 100)}
                onChange={e => {
                  const v = Number(e.target.value) / 100;
                  onSfxVolume(v);
                }}
                onMouseUp={() => sfxVolume > 0 && playSfx("place", sfxVolume)}
                onTouchEnd={() => sfxVolume > 0 && playSfx("place", sfxVolume)}
                style={{
                  width: "100%",
                  accentColor: CLR.O,
                  cursor: "pointer",
                }}
              />
            </div>

            {divider()}
            {sectionLabel("Info")}
            {menuRow("ℹ️", "About", null, () => { setShowAbout(true); setOpen(false); })}
            <div style={{ height: "8px" }} />
          </div>
        )}
      </div>

      {/* About modal */}
      {showAbout && <AboutModal dark={dark} onClose={() => setShowAbout(false)} theme={theme} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BUTTON STYLE
// ─────────────────────────────────────────────────────────────────────────────
function mkBtn(active, theme) {
  return {
    background: active ? (theme.bg === "#0f0f13" ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.07)") : "transparent",
    border: `2px solid ${active ? (theme.bg === "#0f0f13" ? "#666" : "#bbb") : theme.border}`,
    borderRadius: "10px",
    color: active ? theme.text : theme.textDim,
    padding: "10px 20px",
    fontSize: "13px",
    letterSpacing: "0.12em",
    cursor: "pointer",
    fontFamily: "'Courier New', monospace",
    textTransform: "uppercase",
    transition: "all 0.2s",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HOME SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function HomeScreen({ onStart, dark, onToggleDark, haptics, onToggleHaptics, sfxVolume, onSfxVolume, user, onLogout }) {
  const [mode, setMode] = useState(null);
  const [difficulty, setDifficulty] = useState("medium");
  const [authOpen, setAuthOpen] = useState(false);
  const theme = getTheme(dark);

  const difficultyInfo = {
    easy:       { emoji: "😌", desc: "Great for beginners" },
    medium:     { emoji: "🤔", desc: "A decent challenge" },
    hard:       { emoji: "😈", desc: "A serious challenge" },
    impossible: { emoji: "💀", desc: "You cannot win" },
  };

  return (
    <div style={{
      height: "100%", background: theme.bg, color: theme.text,
      fontFamily: "'Courier New', monospace",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      position: "relative",
    }}>
      {/* Menu */}
      <div style={{ position: "absolute", top: "16px", right: "16px", zIndex: 10 }}>
        <Menu dark={dark} onToggleDark={onToggleDark} haptics={haptics} onToggleHaptics={onToggleHaptics} sfxVolume={sfxVolume} onSfxVolume={onSfxVolume} theme={theme} user={user} onOpenAuth={() => setAuthOpen(true)} onLogout={onLogout} />
      </div>

      {/* Hero */}
      <div style={{
        background: "transparent",
        padding: "32px 24px 20px",
        textAlign: "center",
        borderBottom: `1px solid ${theme.border}`,
        flexShrink: 0,
      }}>
        {/* Decorative mini board */}
        <div style={{ display: "inline-grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px", marginBottom: "12px" }}>
          {DEMO_TILES.map((v, i) => (
            <div key={i} style={{
              width: "18px", height: "18px", borderRadius: "4px",
              background: theme.surface, border: `1px solid ${theme.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "9px", fontWeight: "900",
              color: v === "X" ? CLR.X : CLR.O,
            }}>{v}</div>
          ))}
        </div>

        <div style={{ fontSize: "10px", letterSpacing: "0.4em", color: theme.textDim, marginBottom: "6px" }}>
          INFINITE
        </div>
        <h1 style={{
          fontSize: "clamp(36px, 9vw, 60px)", fontWeight: "900",
          margin: "0", letterSpacing: "-0.03em", color: theme.text,
          lineHeight: 1,
        }}>
          Tic Tac Toe
        </h1>
      </div>

      {/* Content — scrollable middle */}
      <div style={{ flex: 1, padding: "20px 20px 8px", display: "flex", flexDirection: "column", alignItems: "center", maxWidth: "420px", margin: "0 auto", width: "100%", boxSizing: "border-box", overflowY: "auto", minHeight: 0 }}>

        {/* Subtle sign-in hint — only when logged out, never blocks play */}
        {!user && (
          <button
            onClick={() => setAuthOpen(true)}
            style={{
              alignSelf: "center", marginBottom: "16px",
              background: "transparent", border: "none",
              color: theme.textFaint, fontSize: "11px",
              letterSpacing: "0.06em", cursor: "pointer",
              fontFamily: "'Courier New', monospace",
              transition: "color 0.2s",
            }}
            onMouseEnter={e => e.currentTarget.style.color = theme.textDim}
            onMouseLeave={e => e.currentTarget.style.color = theme.textFaint}
          >
            Sign in to save your stats →
          </button>
        )}

        {/* Mode label */}
        <div style={{ alignSelf: "flex-start", fontSize: "11px", letterSpacing: "0.2em", color: theme.textDim, marginBottom: "10px", textTransform: "uppercase", fontWeight: "700" }}>
          Choose a mode
        </div>

        {/* Mode cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%", marginBottom: "16px" }}>
          {[
            { id: "versus", emoji: "👥", title: "Versus", sub: "Pass & play with a friend", accent: "#a78bfa" },
            { id: "bot",    emoji: "🤖", title: "vs Bot", sub: "Challenge the AI",  accent: "#34d399" },
          ].map(({ id, emoji, title, sub, accent }) => {
            const selected = mode === id;
            return (
              <button key={id} onClick={() => setMode(id)} style={{
                width: "100%",
                background: selected ? (dark ? `${accent}18` : `${accent}22`) : theme.surface,
                border: `2px solid ${selected ? accent : theme.border}`,
                borderRadius: "14px", padding: "12px 16px",
                cursor: "pointer", textAlign: "left", transition: "all 0.2s",
                display: "flex", alignItems: "center", gap: "14px",
              }}>
                <div style={{
                  width: "40px", height: "40px", borderRadius: "12px", flexShrink: 0,
                  background: selected ? `${accent}30` : (dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"),
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "20px", transition: "background 0.2s",
                }}>{emoji}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "15px", fontWeight: "800", color: selected ? accent : theme.text, marginBottom: "1px", fontFamily: "'Courier New', monospace" }}>{title}</div>
                  <div style={{ fontSize: "11px", color: theme.textDim, lineHeight: 1.4, fontFamily: "'Courier New', monospace" }}>{sub}</div>
                </div>
                <div style={{
                  width: "20px", height: "20px", borderRadius: "50%", flexShrink: 0,
                  background: selected ? accent : "transparent",
                  border: `2px solid ${selected ? accent : theme.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.2s",
                }}>
                  {selected && <div style={{ color: "#fff", fontSize: "11px", fontWeight: "900" }}>✓</div>}
                </div>
              </button>
            );
          })}
        </div>

        {/* Difficulty — expands when bot selected */}
        <div style={{
          width: "100%",
          maxHeight: mode === "bot" ? "400px" : "0px",
          overflow: "hidden",
          transition: "max-height 0.35s ease",
        }}>
          <div style={{ fontSize: "11px", letterSpacing: "0.2em", color: theme.textDim, marginBottom: "8px", textTransform: "uppercase", fontWeight: "700" }}>
            Difficulty
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {["easy","medium","hard","impossible"].map(d => {
              const selected = difficulty === d;
              const { emoji, desc } = difficultyInfo[d];
              return (
                <button key={d} onClick={() => setDifficulty(d)} style={{
                  width: "100%",
                  background: selected ? (dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)") : "transparent",
                  border: `2px solid ${selected ? (dark ? "#666" : "#888") : theme.border}`,
                  borderRadius: "10px", padding: "9px 14px",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: "10px",
                  transition: "all 0.15s", fontFamily: "'Courier New', monospace",
                }}>
                  <span style={{ fontSize: "16px" }}>{emoji}</span>
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <span style={{ fontSize: "13px", fontWeight: "700", color: theme.text, textTransform: "capitalize" }}>{d}</span>
                    <span style={{ fontSize: "11px", color: theme.textDim, marginLeft: "8px" }}>{desc}</span>
                  </div>
                  {selected && <div style={{ fontSize: "13px", color: theme.textDim }}>✓</div>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Play button — pinned at bottom */}
      <div style={{ flexShrink: 0, padding: "12px 20px 20px", maxWidth: "420px", margin: "0 auto", width: "100%", boxSizing: "border-box", borderTop: `1px solid ${theme.border}` }}>
        <button
          onClick={() => mode && onStart({ mode, difficulty })}
          style={{
            width: "100%",
            background: mode
              ? (mode === "versus" ? "linear-gradient(135deg, #a78bfa, #818cf8)" : "linear-gradient(135deg, #34d399, #059669)")
              : (dark ? "#1f1f28" : "#ddd"),
            border: "none", borderRadius: "14px",
            color: mode ? "#fff" : theme.textFaint,
            padding: "16px", fontSize: "15px", fontWeight: "900",
            letterSpacing: "0.15em", cursor: mode ? "pointer" : "default",
            fontFamily: "'Courier New', monospace", textTransform: "uppercase",
            transition: "all 0.3s",
            boxShadow: mode ? (dark ? "0 8px 24px rgba(0,0,0,0.4)" : "0 8px 24px rgba(0,0,0,0.15)") : "none",
          }}
        >
          {mode ? `Play ${mode === "versus" ? "Versus" : "vs Bot"} →` : "Select a mode"}
        </button>
      </div>

      {/* Login / sign up modal */}
      {authOpen && <AuthModal dark={dark} theme={theme} onClose={() => setAuthOpen(false)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function GameScreen({ config, onHome, dark, onToggleDark, haptics, onToggleHaptics, sfxVolume, onSfxVolume }) {
  const { mode, difficulty } = config;
  const isBot = mode === "bot";
  const BOT = "O", HUMAN = "X";
  const theme = getTheme(dark);
  const btn = (active) => mkBtn(active, theme);

  const [board, setBoard]             = useState(Array(9).fill(null));
  const [turn, setTurn]               = useState("X");
  const [moveCount, setMoveCount]     = useState(0);
  const [winner, setWinner]           = useState(null);
  const [winLine, setWinLine]         = useState(null);
  const [scores, setScores]           = useState({ X: 0, O: 0 });
  const [vanishIdx, setVanishIdx]     = useState(null);
  const [botThinking, setBotThinking] = useState(false);

  const stateRef = useRef({ board, moveCount });
  useEffect(() => { stateRef.current = { board, moveCount }; }, [board, moveCount]);

  function doMove(currentBoard, idx, player, mc) {
    const [newBoard, removed] = applyMove(currentBoard, idx, player, mc + 1);
    if (haptics) haptic(removed !== null ? "medium" : "light");
    if (sfxVolume > 0) playSfx(removed !== null ? "vanish" : "place", sfxVolume);
    if (removed !== null) { setVanishIdx(removed); setTimeout(() => setVanishIdx(null), 450); }
    const result = checkWinner(newBoard);
    if (result) {
      if (haptics) haptic("win");
      if (sfxVolume > 0) setTimeout(() => playSfx("win", sfxVolume), 120);
      setWinner(result.player); setWinLine(result.line); setScores(s => ({ ...s, [result.player]: s[result.player] + 1 }));
    }
    setBoard(newBoard); setMoveCount(mc + 1); setTurn(player === "X" ? "O" : "X");
    return result;
  }

  function handleClick(idx) {
    if (winner || board[idx] || botThinking) return;
    if (isBot && turn === BOT) return;
    doMove(board, idx, turn, moveCount);
  }

  useEffect(() => {
    if (!isBot || turn !== BOT || winner) return;
    setBotThinking(true);
    const delay = difficulty === "impossible" ? 750 : difficulty === "hard" ? 650 : difficulty === "medium" ? 450 : 300;
    const timer = setTimeout(() => {
      const { board: b, moveCount: mc } = stateRef.current;
      const move = getBotMove(b, BOT, difficulty, mc);
      if (move !== null) doMove(b, move, BOT, mc);
      setBotThinking(false);
    }, delay);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, winner]);

  function reset() {
    setBoard(Array(9).fill(null)); setTurn("X"); setMoveCount(0);
    setWinner(null); setWinLine(null); setVanishIdx(null); setBotThinking(false);
  }

  const label = (p) => (!isBot ? p : p === HUMAN ? "You" : "Bot");

  function getFadedIdx(player) {
    const moves = getPlayerMoves(board, player);
    return moves.length === MAX_MARKS ? moves[0].i : null;
  }
  const xFaded = getFadedIdx("X");
  const oFaded = getFadedIdx("O");

  const statusMsg = () => {
    if (winner || botThinking) return null;
    const faded = turn === "X" ? xFaded : oFaded;
    if (faded !== null) return `placing removes ${label(turn) === "You" ? "your" : `${label(turn)}'s`} oldest mark`;
    return null;
  };

  // ── board grid ──
  const boardGrid = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
      {board.map((cell, idx) => {
        const isWin     = winLine?.includes(idx);
        const isFaded   = idx === xFaded || idx === oFaded;
        const isVanish  = idx === vanishIdx;
        const cellColor = cell?.player === "X" ? CLR.X : CLR.O;
        const clickable = !winner && !cell && !botThinking && !(isBot && turn === BOT);
        return (
          <button key={idx} onClick={() => handleClick(idx)} style={{
            width: "clamp(84px, 22vw, 108px)", height: "clamp(84px, 22vw, 108px)",
            background: isWin
              ? (cell?.player === "X" ? "rgba(255,107,107,0.13)" : "rgba(116,185,255,0.13)")
              : theme.surface,
            border: `2px solid ${isWin ? cellColor : theme.border}`,
            borderRadius: "12px",
            cursor: clickable ? "pointer" : "default",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "clamp(30px, 8vw, 44px)", fontWeight: "900",
            color: cell ? (isFaded ? `${cellColor}3a` : isWin ? cellColor : `${cellColor}cc`) : "transparent",
            transition: "background 0.15s, color 0.2s, transform 0.3s, opacity 0.3s, box-shadow 0.2s",
            transform: isVanish ? "scale(0.4)" : "scale(1)",
            opacity: isVanish ? 0 : 1,
            outline: "none",
            boxShadow: isWin ? `0 0 22px ${cellColor}44` : "none",
          }}
            onMouseEnter={e => { if (clickable) e.currentTarget.style.background = theme.hover; }}
            onMouseLeave={e => { if (!isWin) e.currentTarget.style.background = theme.surface; }}
          >
            {cell?.player ?? ""}
          </button>
        );
      })}
    </div>
  );

  // ── versus panel content ──
  const versusPanel = (p) => {
    const color = p === "X" ? CLR.X : CLR.O;
    const isActive = !winner && turn === p;
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{ fontSize: "34px", fontWeight: "900", color, transition: "opacity 0.3s" }}>{p}</div>
            <div style={{ fontSize: "34px", fontWeight: "900", color: theme.text }}>{scores[p]}</div>
          </div>
          <div style={{ fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: winner === p ? color : isActive ? theme.textDim : theme.textFaint, fontWeight: isActive || winner === p ? "700" : "400", transition: "color 0.3s" }}>
            {winner === p ? "🏆 wins!" : isActive ? "your turn" : "waiting"}
          </div>
        </div>
        {winner === p && (
          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
            <button onClick={reset}  style={{ ...btn(false), padding: "8px 18px", fontSize: "11px" }}>Play again</button>
            <button onClick={onHome} style={{ ...btn(false), padding: "8px 18px", fontSize: "11px" }}>Home</button>
          </div>
        )}
      </>
    );
  };

  // ════════════════════════════════
  // VERSUS — split 180° layout
  // ════════════════════════════════
  if (!isBot) return (
    <div style={{
      height: "100dvh", background: theme.bg, color: theme.text,
      fontFamily: "'Courier New', monospace",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Safe area top spacer — for status bar (shows for O who is rotated) */}
      <div style={{ height: "env(safe-area-inset-top)", background: theme.bg, flexShrink: 0 }} />

      {/* O — top, rotated 180° */}
      <div style={{
        width: "100%", padding: "16px 20px", boxSizing: "border-box",
        borderBottom: `1px solid ${theme.border}`,
        background: !winner && turn === "O" ? "rgba(116,185,255,0.05)" : "transparent",
        transition: "background 0.4s",
        transform: "rotate(180deg)",
        display: "flex", flexDirection: "column", alignItems: "flex-start",
        flexShrink: 0,
      }}>
        {versusPanel("O")}
      </div>

      {/* Board — centre, fills remaining space */}
      <div style={{
        flex: 1,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: "12px",
      }}>
        {boardGrid}
        <button onClick={onHome} style={{ ...btn(false), padding: "5px 16px", fontSize: "10px" }}>← Home</button>
      </div>

      {/* X — bottom, normal */}
      <div style={{
        width: "100%", padding: "16px 20px", boxSizing: "border-box",
        borderTop: `1px solid ${theme.border}`,
        background: !winner && turn === "X" ? "rgba(255,107,107,0.05)" : "transparent",
        transition: "background 0.4s",
        display: "flex", flexDirection: "column", alignItems: "flex-start",
        flexShrink: 0,
      }}>
        {versusPanel("X")}
      </div>

      {/* Safe area bottom spacer — for home indicator */}
      <div style={{ height: "env(safe-area-inset-bottom)", background: theme.bg, flexShrink: 0 }} />
    </div>
  );

  // ════════════════════════════════
  // BOT — centred layout
  // ════════════════════════════════
  return (
    <div style={{
      minHeight: "100dvh", background: theme.bg, color: theme.text,
      fontFamily: "'Courier New', monospace",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "24px",
      position: "relative",
    }}>
      {/* Scoreboard */}
      <div style={{ display: "flex", gap: "48px", marginBottom: "32px", alignItems: "center" }}>
        {["X","O"].map(p => (
          <div key={p} style={{ textAlign: "center", minWidth: "60px" }}>
            <div style={{ fontSize: "11px", letterSpacing: "0.2em", color: p === "X" ? CLR.X : CLR.O, transition: "opacity 0.3s", marginBottom: "2px" }}>
              {label(p).toUpperCase()}
            </div>
            <div style={{ fontSize: "32px", fontWeight: "900", lineHeight: 1, color: theme.text }}>{scores[p]}</div>
            <div style={{ fontSize: "8px", letterSpacing: "0.2em", color: theme.textFaint, marginTop: "3px", minHeight: "12px" }}>
              {!winner && turn === p ? (botThinking ? "THINKING…" : "YOUR TURN") : ""}
            </div>
          </div>
        ))}
      </div>

      {/* Board */}
      <div style={{ marginBottom: "28px" }}>{boardGrid}</div>

      {/* Status / win + buttons */}
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "14px" }}>
        {winner ? (
          <>
            <div style={{ fontSize: "clamp(18px, 4vw, 24px)", fontWeight: "900", color: winner === "X" ? CLR.X : CLR.O, letterSpacing: "0.05em" }}>
              {label(winner)} wins!
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={reset}  style={{ ...btn(false), padding: "10px 24px" }}>Play again</button>
              <button onClick={onHome} style={{ ...btn(false), padding: "10px 24px" }}>Home</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: "12px", color: theme.textDim, letterSpacing: "0.08em", minHeight: "18px" }}>
              {botThinking ? "bot is thinking…" : (statusMsg() ?? "\u00a0")}
            </div>
            <button onClick={onHome} style={{ ...btn(false), padding: "7px 20px", fontSize: "11px" }}>← Home</button>
          </>
        )}
      </div>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL STYLES
// ─────────────────────────────────────────────────────────────────────────────
const GLOBAL_STYLES = `
  @keyframes tileIn {
    from { opacity: 0; transform: scale(0.5) rotate(-10deg); }
    to   { opacity: 1; transform: scale(1)   rotate(0deg);  }
  }
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeIn  { from { opacity: 0; } to { opacity: 1; } }
  @keyframes screenIn {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeSlideDown {
    from { opacity: 0; transform: translateY(-6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes dotsIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`;

const DEMO_TILES = ["X","","O","","X","","O","","X"];

// ─────────────────────────────────────────────────────────────────────────────
// SPLASH SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function SplashScreen() {
  const [dotsCount, setDotsCount] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setDotsCount(d => (d % 3) + 1), 400);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{
      height: "100dvh", background: "#0f0f13",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: "'Courier New', monospace", gap: "28px",
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
        {DEMO_TILES.map((v, i) => (
          <div key={i} style={{
            width: "56px", height: "56px", borderRadius: "11px",
            background: "#1a1a22", border: "2px solid #2a2a35",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "24px", fontWeight: "900",
            color: v === "X" ? CLR.X : CLR.O,
            animation: `tileIn 0.38s cubic-bezier(0.34,1.56,0.64,1) ${i * 60}ms both`,
          }}>{v}</div>
        ))}
      </div>
      <div style={{ textAlign: "center", animation: "fadeInUp 0.5s ease 650ms both" }}>
        <div style={{ fontSize: "10px", letterSpacing: "0.4em", color: "#555", marginBottom: "6px" }}>INFINITE</div>
        <div style={{ fontSize: "26px", fontWeight: "900", color: "#fff", letterSpacing: "-0.02em" }}>Tic Tac Toe</div>
      </div>
      <div style={{ color: "#444", fontSize: "13px", letterSpacing: "0.2em", animation: "fadeInUp 0.5s ease 850ms both" }}>
        Loading{"·".repeat(dotsCount)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRE-GAME SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function PreGameScreen({ config, dark }) {
  const [dotsCount, setDotsCount] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setDotsCount(d => (d % 3) + 1), 350);
    return () => clearInterval(t);
  }, []);

  const label = config?.mode === "versus" ? "Versus" : `Bot · ${config?.difficulty}`;

  return (
    <div style={{
      height: "100dvh", background: dark ? "#0f0f13" : "#f0f0f0",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: "'Courier New', monospace", gap: "28px",
      animation: "fadeIn 0.2s ease both",
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
        {DEMO_TILES.map((v, i) => (
          <div key={i} style={{
            width: "56px", height: "56px", borderRadius: "11px",
            background: dark ? "#1a1a22" : "#fff",
            border: `2px solid ${dark ? "#2a2a35" : "#d0d0d8"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "24px", fontWeight: "900",
            color: v === "X" ? CLR.X : CLR.O,
            animation: `tileIn 0.38s cubic-bezier(0.34,1.56,0.64,1) ${i * 50}ms both`,
          }}>{v}</div>
        ))}
      </div>
      <div style={{ textAlign: "center", animation: "dotsIn 0.4s ease 550ms both" }}>
        <div style={{ fontSize: "10px", letterSpacing: "0.4em", color: dark ? "#555" : "#aaa", marginBottom: "6px" }}>STARTING</div>
        <div style={{ fontSize: "22px", fontWeight: "900", color: dark ? "#fff" : "#111", letterSpacing: "-0.01em" }}>{label}</div>
      </div>
      <div style={{ color: dark ? "#444" : "#bbb", fontSize: "18px", letterSpacing: "0.35em", animation: "dotsIn 0.4s ease 700ms both" }}>
        {"·".repeat(dotsCount)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("splash"); // splash | home | pregame | game
  const [config, setConfig] = useState(null);
  const [dark, setDark]     = useState(true);
  const [haptics, setHaptics] = useState(true);
  const [sfxVolume, setSfxVolume] = useState(0.5);
  const [user, setUser] = useState(null); // logged-in Supabase user, or null for guests
  const toggleDark = () => setDark(d => !d);
  const toggleHaptics = () => setHaptics(h => !h);

  // Auth: load any existing session, then listen for login/logout changes.
  // This runs once and keeps `user` in sync — guests simply stay null.
  useEffect(() => {
    if (!supabase) return; // auth unavailable (missing keys) — stay a guest, no crash
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleLogout = async () => { if (supabase) await supabase.auth.signOut(); };

  // Splash → home
  useEffect(() => {
    if (screen !== "splash") return;
    const t = setTimeout(() => setScreen("home"), 2200);
    return () => clearTimeout(t);
  }, [screen]);

  function handleStart(cfg) {
    setConfig(cfg);
    setScreen("pregame");
    setTimeout(() => setScreen("game"), 2000);
  }

  function handleHome() {
    setConfig(null);
    setScreen("home");
  }

  if (screen === "splash") return (
    <><style>{GLOBAL_STYLES}</style><SplashScreen /></>
  );

  if (screen === "pregame") return (
    <><style>{GLOBAL_STYLES}</style><PreGameScreen config={config} dark={dark} /></>
  );

  if (screen === "game" && config) return (
    <>
      <style>{GLOBAL_STYLES}</style>
      <div style={{ animation: "screenIn 0.4s ease both" }}>
        <GameScreen config={config} onHome={handleHome} dark={dark} onToggleDark={toggleDark} haptics={haptics} onToggleHaptics={toggleHaptics} sfxVolume={sfxVolume} onSfxVolume={setSfxVolume} />
      </div>
    </>
  );

  return (
    <>
      <style>{GLOBAL_STYLES}</style>
      <div style={{ animation: "screenIn 0.45s ease both" }}>
        <HomeScreen onStart={handleStart} dark={dark} onToggleDark={toggleDark} haptics={haptics} onToggleHaptics={toggleHaptics} sfxVolume={sfxVolume} onSfxVolume={setSfxVolume} user={user} onLogout={handleLogout} />
      </div>
    </>
  );
}
