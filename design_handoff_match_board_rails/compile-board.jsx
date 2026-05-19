// Compile — polished BOARD screen
// 1920×1200 canvas, dark cyberpunk treatment

function BoardScreen() {
  // ──────────── match state (mocked) ────────────
  const state = {
    turn: 6,
    yourMove: true,
    timer: '0:38',
    you:  { name: 'YOU · NULL_07',  mmr: 1842, hand: 5, deck: 11, disc: 3, compiled: 1 },
    opp:  { name: 'keiko_',         mmr: 1791, hand: 5, deck: 3,  disc: 4, compiled: 2 },
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

  const PAD = 60;
  const RAIL_W = 360;
  const BOARD_W = 1920 - PAD * 2 - RAIL_W - 24;

  // ───────── header / scoreboard ─────────
  const Header = () => (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: 90,
      padding: `0 ${PAD}px`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      borderBottom: '1px solid var(--line-1)',
      background: 'linear-gradient(180deg, rgba(13,11,34,0.5), transparent)',
    }}>
      <PlayerNameplate
        name={state.opp.name} mmr={state.opp.mmr}
        status={`Thinking · ${state.timer}`} statusTone="thinking"
        portrait="◎"
      />

      <div className="row gap-4 middle" style={{ alignItems: 'center' }}>
        <span className="cp-chip">Turn {state.turn} · BO1</span>

        {/* score capsule */}
        <div className="cp-panel cp-cut" style={{ padding: '12px 22px' }}>
          <div className="row gap-4 middle" style={{ alignItems: 'center' }}>
            <div className="col" style={{ alignItems: 'center', minWidth: 56 }}>
              <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--ink-faint)' }}>KEIKO</span>
              <span className="disp" style={{
                fontSize: 38, fontWeight: 700, lineHeight: 0.9,
                color: 'var(--fire)', textShadow: '0 0 18px rgba(var(--fire-rgb), 0.6)',
                marginTop: 2,
              }}>{state.opp.compiled}</span>
            </div>
            <div className="col" style={{ alignItems: 'center' }}>
              <span className="mono" style={{ fontSize: 8, color: 'var(--ink-faint)', letterSpacing: '0.24em' }}>COMPILED</span>
              <span className="mono" style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 4 }}>—</span>
              <span className="mono" style={{ fontSize: 8, color: 'var(--ink-faint)', letterSpacing: '0.24em', marginTop: 4 }}>FIRST TO 3</span>
            </div>
            <div className="col" style={{ alignItems: 'center', minWidth: 56 }}>
              <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--purple-300)' }}>YOU</span>
              <span className="disp" style={{
                fontSize: 38, fontWeight: 700, lineHeight: 0.9,
                color: 'var(--purple-400)', textShadow: '0 0 18px rgba(var(--purple-glow), 0.65)',
                marginTop: 2,
              }}>{state.you.compiled}</span>
            </div>
          </div>
        </div>

        <span className="cp-chip active">
          <span className="dot" /> Your move
        </span>
      </div>

      <PlayerNameplate
        name={state.you.name} mmr={state.you.mmr}
        status="Active · Plan your move" statusTone="active"
        portrait="◉" align="right"
      />
    </div>
  );

  // ───────── opp deck/discard strip + hand abstract ─────────
  const OppZone = () => (
    <div style={{ position: 'absolute', top: 110, left: 0, right: 0, height: 116,
      padding: `0 ${PAD}px`,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>

      {/* left: opp deck + discard mini */}
      <div className="row gap-4 middle">
        <div className="col gap-1" style={{ alignItems: 'center' }}>
          <div style={{
            width: 80, height: 100,
            border: '1px solid var(--line-2)',
            background: 'rgba(245,243,255,0.02)',
            borderRadius: 6,
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', inset: 6,
              background: 'repeating-linear-gradient(45deg, rgba(var(--purple-glow), 0.18) 0 4px, transparent 4px 8px)',
              borderRadius: 4,
            }} />
            <span className="mono" style={{
              position: 'absolute', top: 6, left: 8,
              fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.14em',
            }}>DECK</span>
            <span className="disp" style={{
              position: 'absolute', bottom: 4, right: 8,
              fontSize: 22, fontWeight: 700, color: 'var(--ink)',
            }}>{state.opp.deck}</span>
          </div>
        </div>
        <div className="col gap-1" style={{ alignItems: 'center' }}>
          <div style={{
            width: 80, height: 100,
            border: '1px dashed var(--line-2)',
            background: 'rgba(245,243,255,0.015)',
            borderRadius: 6,
            position: 'relative',
          }}>
            <span className="mono" style={{
              position: 'absolute', top: 6, left: 8,
              fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.14em',
            }}>DISC</span>
            <span className="disp" style={{
              position: 'absolute', bottom: 4, right: 8,
              fontSize: 22, fontWeight: 700, color: 'var(--ink)',
            }}>{state.opp.disc}</span>
          </div>
        </div>
      </div>

      {/* center: opp hand abstract */}
      <div className="col gap-2" style={{ alignItems: 'center' }}>
        <OppHandStrip count={state.opp.hand} width={360} />
        <span className="mono" style={{ fontSize: 10, letterSpacing: '0.2em', color: 'var(--ink-faint)' }}>
          OPP HAND · {state.opp.hand}
        </span>
      </div>

      {/* right: spacer matching log column width */}
      <div style={{ width: RAIL_W + 24 }} />
    </div>
  );

  // ───────── 3 LANES ─────────
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
      }}>
        {/* opp header */}
        <div className={`el-${lane.opp.el} ${oppCompiled ? 'cp-lane-compiled' : ''}`} style={{
          padding: '14px 18px',
          borderBottom: `1px solid rgba(var(--el-rgb), ${oppCompiled ? 0.4 : 0.2})`,
        }}>
          <div className="row between middle" style={{ alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.2em' }}>
              OPP · LANE {lane.n}
            </span>
            {oppCompiled && <CompiledTag el={lane.opp.el} />}
          </div>
          <div className="row between middle" style={{ alignItems: 'center', marginTop: 8 }}>
            <ElementName el={lane.opp.el} size="md" />
            <span className="mono" style={{
              fontSize: 14, fontWeight: 700,
              color: `var(--${lane.opp.el === 'void' ? 'void-el' : lane.opp.el})`,
            }}>
              {lane.opp.compile}<span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>/10</span>
            </span>
          </div>
          <div style={{ marginTop: 8 }}>
            <CompileBar el={lane.opp.el} value={lane.opp.compile} compiled={oppCompiled} />
          </div>
        </div>

        {/* opp cards (stacking down) */}
        <div style={{ flex: 1, position: 'relative', padding: '16px 0' }}>
          <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)' }}>
            {lane.opp.cards.map((c, i) => (
              <div key={i} style={{
                position: 'absolute', left: -62, top: i * 38,
                transform: 'rotate(180deg)',
                zIndex: i,
                filter: i === lane.opp.cards.length - 1 ? 'none' : 'brightness(0.85)',
              }}>
                <Card el={c.el} num={c.num} faceDown={c.faceDown} size="field" />
              </div>
            ))}
          </div>
        </div>

        {/* line divider */}
        <div style={{
          position: 'relative',
          height: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 5,
        }}>
          <div style={{ position: 'absolute', left: 14, right: 14, top: '50%',
            borderTop: '1px dashed var(--line-3)' }} />
          <span className="mono" style={{
            background: 'var(--void-2)',
            padding: '4px 16px',
            fontSize: 9, letterSpacing: '0.28em', color: 'var(--ink-faint)',
            border: '1px solid var(--line-2)',
            borderRadius: 999,
          }}>LINE  ·  {lane.n.toString().padStart(2, '0')}</span>
        </div>

        {/* your cards (stacking up) */}
        <div style={{ flex: 1, position: 'relative', padding: '16px 0' }}>
          <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)' }}>
            {lane.you.cards.map((c, i) => (
              <div key={i} style={{
                position: 'absolute', left: -62, bottom: i * 38,
                zIndex: i,
                filter: i === lane.you.cards.length - 1 ? 'none' : 'brightness(0.85)',
              }}>
                <Card el={c.el} num={c.num} faceDown={c.faceDown} size="field" />
              </div>
            ))}
          </div>
        </div>

        {/* your header */}
        <div className={`el-${lane.you.el} ${youCompiled ? 'cp-lane-compiled bottom' : ''}`} style={{
          padding: '14px 18px',
          borderTop: `1px solid rgba(var(--el-rgb), ${youCompiled ? 0.4 : 0.2})`,
        }}>
          <CompileBar el={lane.you.el} value={lane.you.compile} compiled={youCompiled} />
          <div className="row between middle" style={{ alignItems: 'center', marginTop: 10 }}>
            <ElementName el={lane.you.el} size="md" />
            <span className="mono" style={{
              fontSize: 14, fontWeight: 700,
              color: `var(--${lane.you.el === 'void' ? 'void-el' : lane.you.el})`,
            }}>
              {lane.you.compile}<span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>/10</span>
            </span>
          </div>
          <div className="row between middle" style={{ alignItems: 'center', marginTop: 8 }}>
            <span className="mono" style={{ fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.2em' }}>
              YOU · LANE {lane.n}
            </span>
            {youCompiled && <CompiledTag el={lane.you.el} />}
          </div>
        </div>
      </div>
    );
  };

  // ───────── action log sidebar ─────────
  const LogSidebar = () => {
    const toneColor = (tone) => {
      if (tone === 'dim') return 'var(--ink-faint)';
      return `var(--${tone === 'void' ? 'void-el' : tone})`;
    };
    return (
      <div className="cp-panel" style={{
        position: 'absolute', top: 110, right: PAD,
        width: RAIL_W, height: 1200 - 110 - 290 - 18,
        padding: 18,
        display: 'flex', flexDirection: 'column',
      }}>
        <div className="row between middle" style={{ alignItems: 'center', marginBottom: 14 }}>
          <span className="cp-panel-title">Action Log</span>
          <div className="row gap-1">
            <button className="cp-btn ghost" style={{ padding: '4px 10px', fontSize: 9 }}>ALL</button>
            <button className="cp-btn ghost" style={{ padding: '4px 10px', fontSize: 9 }}>MINE</button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <div style={{
            position: 'absolute',
            inset: 0,
            maskImage: 'linear-gradient(180deg, black 80%, transparent)',
          }}>
            {state.log.map((l, i) => (
              <div key={i} className="row gap-2" style={{
                padding: '6px 8px',
                background: i === 0 ? 'rgba(var(--purple-glow), 0.08)' : 'transparent',
                borderLeft: i === 0 ? '2px solid var(--purple-400)' : '2px solid transparent',
                opacity: 1 - Math.min(0.5, i * 0.04),
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11,
                alignItems: 'baseline',
                borderRadius: 2,
              }}>
                <span style={{ color: 'var(--ink-faint)', width: 36, fontSize: 9, letterSpacing: '0.08em' }}>{l.t}</span>
                <span style={{
                  width: 48, fontSize: 9, letterSpacing: '0.12em',
                  color: l.who === 'YOU' ? 'var(--purple-400)' : 'var(--ink-dim)',
                  fontWeight: 700,
                }}>{l.who}</span>
                <span style={{
                  color: toneColor(l.tone), flex: 1, fontSize: 11,
                  fontWeight: l.bold ? 700 : 400,
                }}>{l.txt}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mono" style={{
          fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.18em',
          marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--line-2)',
          textTransform: 'uppercase',
        }}>
          Line 2 fully resolved · 1 lane until victory
        </div>
      </div>
    );
  };

  // ───────── bottom: deck / hand / discard / end turn ─────────
  const BottomZone = () => (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0, height: 290,
      borderTop: '1px solid var(--line-2)',
      background: 'linear-gradient(0deg, rgba(13,11,34,0.7), transparent)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      padding: `0 ${PAD}px 32px`,
    }}>
      {/* deck */}
      <div className="col gap-2" style={{ alignItems: 'center', paddingBottom: 22 }}>
        <DeckPile count={state.you.deck} label="DECK" />
      </div>

      {/* hand — straight upright, evenly spaced */}
      <div style={{
        position: 'relative',
        width: 5 * 188 + 4 * 18,
        height: 268,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        gap: 18,
      }}>
        {state.hand.map((c, i) => {
          const hovered = i === 2;
          return (
            <div key={i} style={{
              transform: `translateY(${hovered ? -28 : 0}px)`,
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
                  background: 'rgba(var(--purple-glow), 0.2)',
                  whiteSpace: 'nowrap',
                }}>
                  <span className="dot" /> HOLDING
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* right: discard + end turn */}
      <div className="col gap-3" style={{ alignItems: 'center', paddingBottom: 22 }}>
        <DiscardPile count={state.you.disc} label="DISCARD" topCard={{ el: 'plague', num: 2 }} />
        <button className="cp-btn primary" style={{ padding: '14px 28px', fontSize: 12, marginTop: 8 }}>
          End turn ▶
        </button>
      </div>
    </div>
  );

  // ───────── compose ─────────
  return (
    <>
      <Header />
      <OppZone />

      {/* lanes */}
      <div style={{
        position: 'absolute',
        top: 240, left: PAD,
        width: BOARD_W,
        height: 1200 - 240 - 290 - 18,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 24,
      }}>
        {state.lanes.map(lane => <Lane key={lane.n} lane={lane} />)}
      </div>

      <LogSidebar />
      <BottomZone />
    </>
  );
}

Object.assign(window, { BoardScreen });
