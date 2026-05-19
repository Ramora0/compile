// Compile — BOARD screen, RAILS layout
// No top bar. Right rail mirrors opp/you (fight-card style). Left rail = log.
// Lane headers collapsed to a single 40px strip.

function BoardScreenRails() {
  // ──────────── match state (same shape as classic board) ────────────
  const state = {
    turn: 6,
    yourMove: true,
    timer: '0:38',
    you:  { name: 'NULL_07',  mmr: 1842, hand: 5, deck: 11, disc: 3, compiled: 1 },
    opp:  { name: 'keiko_',   mmr: 1791, hand: 5, deck: 3,  disc: 4, compiled: 2 },
    lanes: [
      {
        n: 1,
        you: { el: 'psychic', compile: 6, cards: [
          { el: 'psychic', num: 4 },
          { el: 'psychic', num: 2 },
        ]},
        opp: { el: 'water',   compile: 4, cards: [
          { el: 'water', num: 3 },
          { el: 'water', num: 1, faceDown: true },
        ]},
      },
      {
        n: 2,
        you: { el: 'life',    compile: 10, compiled: true, cards: [
          { el: 'life', num: 4 },
          { el: 'life', num: 3 },
          { el: 'life', num: 3 },
        ]},
        opp: { el: 'fire',    compile: 10, compiled: true, cards: [
          { el: 'fire', num: 2 },
          { el: 'fire', num: 2 },
          { el: 'fire', num: 4 },
          { el: 'fire', num: 2 },
        ]},
      },
      {
        n: 3,
        you: { el: 'plague',  compile: 4, cards: [
          { el: 'plague', num: 4 },
          { el: 'plague', num: 1, faceDown: true },
        ]},
        opp: { el: 'light',   compile: 10, compiled: true, cards: [
          { el: 'light', num: 3 },
          { el: 'light', num: 4 },
          { el: 'light', num: 3 },
        ]},
      },
    ],
    hand: [
      { el: 'psychic', num: 3, effect: 'Discard 1. Then peek at opponent\'s hand.', tier: 'A' },
      { el: 'life',    num: 2, effect: 'Renew. Flip 1 of your face-down cards.', tier: 'B' },
      { el: 'life',    num: 4, effect: 'When this would be covered: first, draw 1.', tier: 'A' },
      { el: 'plague',  num: 1, effect: 'Force opponent to discard 1 card.', tier: 'B' },
      { el: 'plague',  num: 3, effect: 'Decay. Opponent\'s next play costs +1.', tier: 'A' },
    ],
    log: [
      { t: 'T6.1', who: 'YOU',   txt: 'play psychic-3 → L1',     tone: 'psychic' },
      { t: 'T5.3', who: 'KEIKO', txt: 'compile LIGHT → L3',      tone: 'light', bold: true },
      { t: 'T5.2', who: 'KEIKO', txt: 'play light-3 → L3',       tone: 'light' },
      { t: 'T5.1', who: 'KEIKO', txt: 'draw 2',                  tone: 'dim' },
      { t: 'T4.3', who: 'YOU',   txt: 'compile LIFE → L2',       tone: 'life', bold: true },
      { t: 'T4.2', who: 'YOU',   txt: 'play life-3 → L2',        tone: 'life' },
      { t: 'T4.1', who: 'KEIKO', txt: 'compile FIRE → L2',       tone: 'fire', bold: true },
      { t: 'T3.3', who: 'KEIKO', txt: 'play fire-4 → L2',        tone: 'fire' },
      { t: 'T3.2', who: 'YOU',   txt: 'play life-3 → L2',        tone: 'life' },
      { t: 'T3.1', who: 'YOU',   txt: 'play psychic-2 → L1',     tone: 'psychic' },
      { t: 'T2.3', who: 'KEIKO', txt: 'discard for FIRE effect', tone: 'dim' },
      { t: 'T2.2', who: 'KEIKO', txt: 'play fire-2 → L2',        tone: 'fire' },
      { t: 'T2.1', who: 'YOU',   txt: 'draw 2',                  tone: 'dim' },
    ],
  };

  // ───── layout constants ─────
  const PAD = 48;
  const LEFT_W = 240;
  const RIGHT_W = 320;
  const RAIL_GAP = 20;
  const TOP_OFFSET = 18;
  const BOTTOM_H = 282;
  const RAIL_H = 1200 - TOP_OFFSET - BOTTOM_H;
  const LANES_X = PAD + LEFT_W + RAIL_GAP;
  const LANES_W = 1920 - PAD * 2 - LEFT_W - RIGHT_W - RAIL_GAP * 2;
  const CARD_STACK_SPACING = 50;  // top ~third visible

  const [logExpanded, setLogExpanded] = React.useState(false);
  const LOG_H = 260;

  // =========================================================
  // Slim lane header — single ~44px strip
  // =========================================================
  const SlimLaneHeader = ({ side, half, compiled }) => {
    const el = half.el;
    const elColor = `var(--${el === 'void' ? 'void-el' : el})`;
    return (
      <div className={`el-${el} ${compiled ? (side === 'you' ? 'cp-lane-compiled bottom' : 'cp-lane-compiled') : ''}`} style={{
        height: 44,
        padding: '0 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderBottom: side === 'opp' ? `1px solid rgba(var(--el-rgb), ${compiled ? 0.4 : 0.18})` : 'none',
        borderTop: side === 'you' ? `1px solid rgba(var(--el-rgb), ${compiled ? 0.4 : 0.18})` : 'none',
        flexShrink: 0,
      }}>
        {/* element glyph + name */}
        <div className="row gap-2 middle" style={{ alignItems: 'center', minWidth: 110 }}>
          <Sigil el={el} />
          <span className="mono" style={{
            fontSize: 12, fontWeight: 700, letterSpacing: '0.18em',
            color: elColor,
          }}>{el.toUpperCase()}</span>
        </div>

        {/* compile bar takes remaining space */}
        <div style={{ flex: 1 }}>
          <CompileBar el={el} value={half.compile} compiled={compiled} />
        </div>

        {/* compile count */}
        <span className="mono" style={{
          fontSize: 14, fontWeight: 700,
          color: elColor,
          minWidth: 48,
          textAlign: 'right',
        }}>
          {half.compile}<span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>/10</span>
        </span>

        {/* compiled badge (inline) */}
        {compiled && (
          <span className="mono" style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '0.2em',
            color: elColor,
            padding: '3px 8px',
            border: `1px solid ${elColor}`,
            borderRadius: 4,
            background: `rgba(var(--el-rgb), 0.12)`,
            whiteSpace: 'nowrap',
          }}>✓ COMPILED</span>
        )}
      </div>
    );
  };

  // =========================================================
  // Lane component
  // =========================================================
  const Lane = ({ lane }) => {
    const youCompiled = lane.you.compiled;
    const oppCompiled = lane.opp.compiled;
    return (
      <div className="cp-panel" style={{
        position: 'relative',
        height: '100%',
        padding: 0,
        display: 'flex', flexDirection: 'column',
        borderColor: (youCompiled || oppCompiled) ? 'var(--line-3)' : 'var(--line-2)',
        overflow: 'hidden',
      }}>
        {/* OPP HEADER */}
        <SlimLaneHeader side="opp" half={lane.opp} compiled={oppCompiled} />

        {/* OPP CARDS — stack down from top */}
        <div style={{ flex: 1, position: 'relative' }}>
          <div style={{
            position: 'absolute',
            top: 18, left: '50%', transform: 'translateX(-50%)',
            width: 124,
          }}>
            {lane.opp.cards.map((c, i) => (
              <div key={i} style={{
                position: 'absolute',
                left: 0, top: i * CARD_STACK_SPACING,
                transform: 'rotate(180deg)',
                zIndex: i,
                filter: i === lane.opp.cards.length - 1 ? 'none' : 'brightness(0.85)',
              }}>
                <Card el={c.el} num={c.num} faceDown={c.faceDown} size="field" />
              </div>
            ))}
          </div>
        </div>

        {/* LINE DIVIDER */}
        <div style={{
          position: 'relative',
          height: 22,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          zIndex: 5,
        }}>
          <div style={{
            position: 'absolute', left: 14, right: 14, top: '50%',
            borderTop: '1px dashed var(--line-3)',
          }} />
          <span className="mono" style={{
            background: 'var(--void-2)',
            padding: '3px 14px',
            fontSize: 9, letterSpacing: '0.28em', color: 'var(--ink-faint)',
            border: '1px solid var(--line-2)',
            borderRadius: 999,
          }}>LINE · {lane.n.toString().padStart(2, '0')}</span>
        </div>

        {/* YOUR CARDS — stack up from bottom */}
        <div style={{ flex: 1, position: 'relative' }}>
          <div style={{
            position: 'absolute',
            bottom: 18, left: '50%', transform: 'translateX(-50%)',
            width: 124,
          }}>
            {lane.you.cards.map((c, i) => (
              <div key={i} style={{
                position: 'absolute',
                left: 0, bottom: i * CARD_STACK_SPACING,
                zIndex: i,
                filter: i === lane.you.cards.length - 1 ? 'none' : 'brightness(0.85)',
              }}>
                <Card el={c.el} num={c.num} faceDown={c.faceDown} size="field" />
              </div>
            ))}
          </div>
        </div>

        {/* YOU HEADER */}
        <SlimLaneHeader side="you" half={lane.you} compiled={youCompiled} />
      </div>
    );
  };

  // =========================================================
  // Tiny deck/discard widget — card-back-ish with big count
  // =========================================================
  const ResourceTile = ({ label, count, kind = 'deck', faceDown = true, topCard = null }) => {
    return (
      <div className="col gap-1" style={{ alignItems: 'center', flex: 1 }}>
        <div style={{
          position: 'relative',
          width: 96, height: 134,
          borderRadius: 8,
          overflow: 'hidden',
          ...(kind === 'deck' ? {
            background:
              'repeating-linear-gradient(45deg, rgba(139,92,246,0.18) 0 6px, transparent 6px 12px),' +
              'radial-gradient(circle at 50% 40%, rgba(139,92,246,0.35), transparent 70%),' +
              'var(--void-3)',
            border: '1px solid var(--purple-500)',
            boxShadow: '0 0 0 1px var(--purple-500) inset, 0 4px 18px rgba(139,92,246,0.25)',
          } : {
            background: 'rgba(245,243,255,0.02)',
            border: '1px dashed var(--line-3)',
          }),
        }}>
          {/* count overlay */}
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(6,6,26,0.55)',
            backdropFilter: 'blur(2px)',
          }}>
            <span className="disp" style={{
              fontSize: 44, fontWeight: 700, lineHeight: 0.9,
              color: 'var(--ink)',
              textShadow: kind === 'deck' ? '0 0 16px rgba(139,92,246,0.6)' : 'none',
              letterSpacing: '-0.02em',
            }}>{count}</span>
          </div>
        </div>
        <span className="mono" style={{
          fontSize: 9, letterSpacing: '0.2em', color: 'var(--ink-faint)',
          marginTop: 4,
        }}>{label}</span>
      </div>
    );
  };

  // =========================================================
  // Opp hand backwards — face-down vertical strip
  // =========================================================
  const OppHandBackwards = ({ count = 5 }) => {
    const cardW = 38;
    const cardH = 56;
    const gap = 6;
    const totalW = count * cardW + (count - 1) * gap;
    return (
      <div className="col gap-2" style={{ alignItems: 'center' }}>
        <div style={{
          display: 'flex',
          gap,
          width: totalW,
          justifyContent: 'center',
        }}>
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="cp-card facedown" style={{
              width: cardW, height: cardH,
              transform: 'rotate(180deg)',
              borderRadius: 4,
              flexShrink: 0,
            }} />
          ))}
        </div>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--ink-faint)' }}>
          OPP HAND · {count}
        </span>
      </div>
    );
  };

  // =========================================================
  // RIGHT RAIL — mirror fight-card
  // =========================================================
  const RightRail = () => (
    <div style={{
      position: 'absolute',
      right: PAD, top: TOP_OFFSET,
      width: RIGHT_W, height: RAIL_H,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* ── OPP block ── */}
      <div className="cp-panel" style={{
        padding: '18px 20px 20px',
        display: 'flex', flexDirection: 'column',
        gap: 16,
      }}>
        {/* opp nameplate (inverted styling vs you) */}
        <div className="row gap-3 middle" style={{ alignItems: 'center' }}>
          <div style={{
            width: 44, height: 44,
            borderRadius: 999,
            border: '1.5px solid var(--line-3)',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.05), transparent)',
            display: 'grid', placeItems: 'center',
            fontSize: 18,
            fontFamily: 'JetBrains Mono, monospace',
            color: 'var(--ink-dim)',
            flexShrink: 0,
          }}>◎</div>
          <div className="col" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{state.opp.name}</div>
            <div className="mono" style={{
              fontSize: 9, color: 'var(--light)', letterSpacing: '0.14em', marginTop: 2,
            }}>
              <span style={{
                display: 'inline-block', width: 5, height: 5, borderRadius: 999,
                background: 'var(--light)', boxShadow: '0 0 6px var(--light)', marginRight: 5,
                verticalAlign: 'middle',
              }} />
              THINKING · {state.timer}
            </div>
            <div className="mono" style={{ fontSize: 8.5, color: 'var(--ink-faint)', letterSpacing: '0.12em', marginTop: 2 }}>
              {state.opp.mmr} MMR · DIV III
            </div>
          </div>
        </div>

        <OppHandBackwards count={state.opp.hand} />

        <div className="row gap-3" style={{ alignItems: 'flex-end' }}>
          <ResourceTile label="DECK"    count={state.opp.deck} kind="deck" />
          <ResourceTile label="DISCARD" count={state.opp.disc} kind="discard" />
        </div>
      </div>

      {/* ── TURN BAND (the middle divider) ── */}
      <div style={{
        position: 'relative',
        margin: '14px 0',
        padding: '16px 18px',
        background:
          'linear-gradient(180deg, rgba(139,92,246,0.10), rgba(139,92,246,0.04)),' +
          'rgba(13,11,34,0.7)',
        border: '1px solid var(--purple-500)',
        borderRadius: 8,
        boxShadow: '0 0 0 1px rgba(139,92,246,0.25) inset, 0 0 28px rgba(139,92,246,0.2)',
      }}>
        {/* turn label + bo1 */}
        <div className="row between middle" style={{ alignItems: 'center' }}>
          <span className="mono" style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--ink-faint)' }}>
            TURN {state.turn}
          </span>
          <span className="mono" style={{ fontSize: 9, letterSpacing: '0.24em', color: 'var(--ink-faint)' }}>
            BO1
          </span>
        </div>

        {/* score: KEIKO 2 — 1 YOU */}
        <div className="row gap-3 middle" style={{
          alignItems: 'center', justifyContent: 'center',
          marginTop: 10,
        }}>
          <div className="col" style={{ alignItems: 'center', flex: 1 }}>
            <span className="mono" style={{ fontSize: 8, letterSpacing: '0.22em', color: 'var(--ink-faint)' }}>KEIKO</span>
            <span className="disp" style={{
              fontSize: 52, fontWeight: 700, lineHeight: 0.9,
              color: 'var(--fire)',
              textShadow: '0 0 22px rgba(var(--fire-rgb), 0.6)',
              marginTop: 4,
              letterSpacing: '-0.04em',
            }}>{state.opp.compiled}</span>
          </div>
          <div className="col" style={{ alignItems: 'center', minWidth: 40 }}>
            <span className="mono" style={{ fontSize: 8, color: 'var(--ink-faint)', letterSpacing: '0.22em' }}>COMP</span>
            <span style={{ fontSize: 22, color: 'var(--ink-quiet)', marginTop: 6 }}>—</span>
            <span className="mono" style={{ fontSize: 8, color: 'var(--ink-faint)', letterSpacing: '0.22em', marginTop: 6 }}>TO 3</span>
          </div>
          <div className="col" style={{ alignItems: 'center', flex: 1 }}>
            <span className="mono" style={{ fontSize: 8, letterSpacing: '0.22em', color: 'var(--purple-300)' }}>YOU</span>
            <span className="disp" style={{
              fontSize: 52, fontWeight: 700, lineHeight: 0.9,
              color: 'var(--purple-400)',
              textShadow: '0 0 22px rgba(var(--purple-glow), 0.7)',
              marginTop: 4,
              letterSpacing: '-0.04em',
            }}>{state.you.compiled}</span>
          </div>
        </div>

        {/* status */}
        <div style={{
          marginTop: 12,
          padding: '8px 12px',
          background: 'rgba(139,92,246,0.18)',
          border: '1px solid var(--purple-400)',
          borderRadius: 6,
          textAlign: 'center',
        }}>
          <span className="mono" style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.22em',
            color: 'var(--purple-300)',
          }}>
            <span style={{
              display: 'inline-block', width: 6, height: 6, borderRadius: 999,
              background: 'var(--purple-300)', boxShadow: '0 0 8px var(--purple-300)',
              marginRight: 8, verticalAlign: 'middle',
            }} />
            YOUR MOVE
          </span>
        </div>
      </div>

      {/* ── YOU block ── */}
      <div className="cp-panel" style={{
        padding: '18px 20px 18px',
        display: 'flex', flexDirection: 'column',
        gap: 16,
        borderColor: 'var(--purple-500)',
        background:
          'linear-gradient(180deg, rgba(139,92,246,0.06), rgba(139,92,246,0.01)),' +
          'rgba(13,11,34,0.6)',
        boxShadow: '0 0 0 1px rgba(139,92,246,0.2) inset',
      }}>
        <div className="row gap-3" style={{ alignItems: 'flex-end' }}>
          <ResourceTile label="DECK"    count={state.you.deck} kind="deck" />
          <ResourceTile label="DISCARD" count={state.you.disc} kind="discard" />
        </div>

        {/* you nameplate */}
        <div className="row gap-3 middle" style={{ alignItems: 'center' }}>
          <div style={{
            width: 44, height: 44,
            borderRadius: 999,
            border: '1.5px solid var(--purple-400)',
            background: 'linear-gradient(135deg, rgba(139,92,246,0.4), transparent)',
            boxShadow: '0 0 14px rgba(139,92,246,0.4)',
            display: 'grid', placeItems: 'center',
            fontSize: 18,
            fontFamily: 'JetBrains Mono, monospace',
            color: 'var(--purple-300)',
            flexShrink: 0,
          }}>◉</div>
          <div className="col" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{state.you.name}</div>
            <div className="mono" style={{ fontSize: 8.5, color: 'var(--ink-faint)', letterSpacing: '0.12em', marginTop: 2 }}>
              {state.you.mmr} MMR · DIV III
            </div>
          </div>
          {/* hand count badge */}
          <div className="col" style={{ alignItems: 'flex-end' }}>
            <span className="mono" style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--ink-faint)' }}>HAND</span>
            <span className="disp" style={{ fontSize: 22, fontWeight: 700, color: 'var(--purple-300)', lineHeight: 1 }}>{state.you.hand}</span>
          </div>
        </div>

        <button className="cp-btn primary" style={{
          width: '100%',
          padding: '14px 0',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.24em',
        }}>
          END TURN ▶
        </button>
      </div>
    </div>
  );

  // =========================================================
  // LEFT RAIL — compact action log (top 4 + expand to overlay)
  // =========================================================
  const LeftRail = () => {
    const toneColor = (tone) => {
      if (tone === 'dim') return 'var(--ink-faint)';
      return `var(--${tone === 'void' ? 'void-el' : tone})`;
    };
    return (
      <div className="cp-panel" style={{
        position: 'absolute',
        left: PAD, top: TOP_OFFSET,
        width: LEFT_W, height: LOG_H,
        padding: 16,
        display: 'flex', flexDirection: 'column',
      }}>
        <div className="row between middle" style={{ alignItems: 'center', marginBottom: 10 }}>
          <span className="cp-panel-title">Action Log</span>
          <button
            className="cp-btn ghost"
            style={{ padding: '4px 10px', fontSize: 9 }}
            onClick={() => setLogExpanded(true)}
          >
            EXPAND ⇗
          </button>
        </div>

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', inset: 0,
            maskImage: 'linear-gradient(180deg, black 70%, transparent)',
          }}>
            {state.log.slice(0, 4).map((l, i) => (
              <div key={i} style={{
                padding: '5px 6px',
                background: i === 0 ? 'rgba(139,92,246,0.10)' : 'transparent',
                borderLeft: i === 0 ? '2px solid var(--purple-400)' : '2px solid transparent',
                opacity: 1 - Math.min(0.45, i * 0.08),
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11,
                borderRadius: 2,
                marginBottom: 2,
                display: 'flex', alignItems: 'baseline', gap: 6,
              }}>
                <span style={{ color: 'var(--ink-faint)', fontSize: 8.5, letterSpacing: '0.08em', width: 26, flexShrink: 0 }}>{l.t}</span>
                <span style={{
                  fontSize: 8.5, letterSpacing: '0.12em', fontWeight: 700,
                  color: l.who === 'YOU' ? 'var(--purple-400)' : 'var(--ink-dim)',
                  width: 36, flexShrink: 0,
                }}>{l.who}</span>
                <span style={{
                  color: toneColor(l.tone),
                  fontSize: 10.5,
                  fontWeight: l.bold ? 700 : 400,
                  flex: 1,
                  lineHeight: 1.25,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>{l.txt}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // =========================================================
  // LOG OVERLAY — full scrollable history
  // =========================================================
  const LogOverlay = () => {
    if (!logExpanded) return null;
    const toneColor = (tone) => {
      if (tone === 'dim') return 'var(--ink-faint)';
      return `var(--${tone === 'void' ? 'void-el' : tone})`;
    };
    return (
      <div
        onClick={() => setLogExpanded(false)}
        style={{
          position: 'absolute', inset: 0, zIndex: 100,
          background: 'rgba(6,6,26,0.78)',
          backdropFilter: 'blur(8px)',
          display: 'grid', placeItems: 'center',
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          className="cp-panel"
          style={{
            width: 620, maxHeight: 820,
            padding: 24,
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 0 0 1px var(--purple-500) inset, 0 20px 60px rgba(0,0,0,0.6)',
          }}
        >
          <div className="row between middle" style={{ alignItems: 'center', marginBottom: 16 }}>
            <span className="cp-panel-title" style={{ fontSize: 12 }}>Action Log · Full History</span>
            <button
              className="cp-btn"
              style={{ padding: '6px 14px', fontSize: 10 }}
              onClick={() => setLogExpanded(false)}
            >
              CLOSE ×
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {state.log.map((l, i) => (
              <div key={i} style={{
                padding: '8px 10px',
                background: i === 0 ? 'rgba(139,92,246,0.10)' : 'transparent',
                borderLeft: i === 0 ? '2px solid var(--purple-400)' : '2px solid transparent',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 12,
                borderRadius: 2,
                marginBottom: 3,
                display: 'flex', alignItems: 'baseline', gap: 10,
              }}>
                <span style={{ color: 'var(--ink-faint)', fontSize: 10, letterSpacing: '0.08em', width: 38, flexShrink: 0 }}>{l.t}</span>
                <span style={{
                  fontSize: 10, letterSpacing: '0.12em', fontWeight: 700,
                  color: l.who === 'YOU' ? 'var(--purple-400)' : 'var(--ink-dim)',
                  width: 52, flexShrink: 0,
                }}>{l.who}</span>
                <span style={{
                  color: toneColor(l.tone),
                  fontSize: 12,
                  fontWeight: l.bold ? 700 : 400,
                  flex: 1,
                }}>{l.txt}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // =========================================================
  // BOTTOM — your hand only
  // =========================================================
  const HandStrip = () => (
    <div style={{
      position: 'absolute',
      bottom: 0, left: 0, right: 0,
      height: BOTTOM_H,
      borderTop: '1px solid var(--line-2)',
      background: 'linear-gradient(0deg, rgba(13,11,34,0.7), transparent)',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      padding: '0 0 22px',
    }}>
      <div style={{
        position: 'relative',
        display: 'flex',
        gap: 18,
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}>
        {state.hand.map((c, i) => {
          const hovered = i === 2;
          return (
            <div key={i} style={{
              transform: `translateY(${hovered ? -30 : 0}px)`,
              zIndex: hovered ? 10 : 1,
              transition: 'transform 0.18s ease',
              position: 'relative',
            }}>
              <Card {...c} />
              {hovered && (
                <div className="cp-chip" style={{
                  position: 'absolute', top: -22, left: '50%',
                  transform: 'translateX(-50%)',
                  fontSize: 8, padding: '2px 8px',
                  color: 'var(--purple-300)',
                  borderColor: 'var(--purple-400)',
                  background: 'rgba(139,92,246,0.2)',
                  whiteSpace: 'nowrap',
                }}>
                  <span className="dot" /> HOLDING
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  // =========================================================
  // Compose
  // =========================================================
  return (
    <>
      <LeftRail />
      <LogOverlay />

      {/* lanes */}
      <div style={{
        position: 'absolute',
        top: TOP_OFFSET,
        left: LANES_X,
        width: LANES_W,
        height: RAIL_H,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 22,
      }}>
        {state.lanes.map(lane => <Lane key={lane.n} lane={lane} />)}
      </div>

      <RightRail />
      <HandStrip />
    </>
  );
}

Object.assign(window, { BoardScreenRails });
