// Compile — polished DRAFT screen
// 1920×1200 canvas

function DraftScreen() {
  // ─── draft state (mocked: snake 1-2-2-1, currently P1's step 3, picked LIFE, holding PLAGUE) ───
  const state = {
    step: 3,
    timer: '0:18',
    yourTurn: true,
    you:  { name: 'YOU · NULL_07',  picks: ['psychic', 'life'] },           // lane 1 + lane 2 placed
    opp:  { name: 'keiko_',         picks: ['fire', 'water'] },              // lane 1 + lane 2 placed
    holding: 'plague',                                                       // currently being dragged
    targetLane: 3,                                                           // where it would go
    yourLanes: [
      { idx: 1, el: 'psychic', status: 'locked' },
      { idx: 2, el: 'life',    status: 'placed' },
      { idx: 3, el: null,      status: 'target' },
    ],
    oppLanes: [
      { idx: 1, el: 'fire',  status: 'locked' },
      { idx: 2, el: 'water', status: 'locked' },
      { idx: 3, el: null,    status: 'empty' },
    ],
    snake: [
      { who: 'YOU', picks: 1, list: ['PSYCHIC'],         status: 'done' },
      { who: 'OPP', picks: 2, list: ['FIRE', 'WATER'],   status: 'done' },
      { who: 'YOU', picks: 2, list: ['LIFE', '?'],       status: 'active' },
      { who: 'OPP', picks: 1, list: ['?'],               status: 'next' },
    ],
  };

  const takenByYou = new Set(state.you.picks);
  const takenByOpp = new Set(state.opp.picks);

  const PAD = 60;
  const RAIL_W = 360;
  const POOL_W = 1920 - PAD * 2 - RAIL_W - 24;

  // ──────────────────── header ────────────────────
  const Header = () => (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, height: 90,
      padding: `0 ${PAD}px`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      borderBottom: '1px solid var(--line-1)',
      background: 'linear-gradient(180deg, rgba(13,11,34,0.5), transparent)',
    }}>
      <div className="col gap-1">
        <div className="disp" style={{
          fontSize: 26, fontWeight: 700, lineHeight: 1,
          letterSpacing: '-0.01em',
        }}>
          Build your board
          <span style={{ color: 'var(--purple-400)', marginLeft: 8 }}>·</span>
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--ink-faint)', letterSpacing: '0.16em' }}>
          DRAG A PROTOCOL FROM THE POOL TO ONE OF YOUR LANES
        </div>
      </div>

      <div className="row gap-4 middle" style={{ alignItems: 'center' }}>
        <span className="cp-chip">Step {state.step} / 4</span>
        <span className="cp-chip active">
          <span className="dot" /> Your pick · {state.timer}
        </span>
      </div>

      <div className="row gap-4 middle" style={{ alignItems: 'center' }}>
        <PlayerNameplate name="keiko_" mmr={1791} status="Waiting" statusTone="waiting" portrait="◎" />
        <span className="disp" style={{ fontSize: 18, color: 'var(--ink-faint)', fontWeight: 500 }}>vs</span>
        <PlayerNameplate name={state.you.name} mmr={1842} status="Picking" statusTone="active" portrait="◉" align="right" />
      </div>
    </div>
  );

  // ──────────────────── lane slot (top or bottom) ────────────────────
  const LaneSlot = ({ side, lane }) => {
    const isOpp = side === 'opp';
    const e = lane.el ? COMPILE_ELEMENTS.find(x => x.id === lane.el) : null;
    const isTarget = lane.status === 'target';
    const isPlaced = lane.status === 'placed';
    const isLocked = lane.status === 'locked';

    if (!e) {
      // empty / target
      const targetEl = isTarget ? COMPILE_ELEMENTS.find(x => x.id === state.holding) : null;
      return (
        <div className={`cp-panel el-${state.holding} ${isTarget ? 'cp-drop-active' : ''}`} style={{
          position: 'relative',
          padding: 24,
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          alignItems: 'center',
          borderStyle: 'dashed',
          borderColor: isTarget ? 'var(--purple-400)' : 'var(--line-2)',
          background: isTarget ? 'rgba(var(--purple-glow), 0.06)' : 'rgba(245,243,255,0.012)',
          minHeight: 0,
        }}>
          <div className="mono" style={{
            position: 'absolute', top: 12,
            [isOpp ? 'left' : 'right']: 14,
            fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.22em',
          }}>{isOpp ? 'OPP' : 'YOU'} · LANE {lane.idx}</div>

          {isTarget ? (
            <>
              <Sigil el={state.holding} size="xl" />
              <div className="disp" style={{
                fontSize: 22, fontWeight: 700, color: 'var(--purple-300)',
                marginTop: 14, letterSpacing: '0.02em',
              }}>Drop here</div>
              <div className="mono" style={{
                fontSize: 10, color: 'var(--purple-400)', letterSpacing: '0.18em', marginTop: 6,
              }}>{state.holding.toUpperCase()} → LANE {lane.idx}</div>
            </>
          ) : (
            <>
              <div style={{
                width: 56, height: 56, borderRadius: 999,
                border: '1.5px dashed var(--line-3)',
                display: 'grid', placeItems: 'center',
                color: 'var(--ink-faint)',
                fontSize: 22, fontFamily: 'JetBrains Mono, monospace',
              }}>·</div>
              <div className="disp" style={{
                fontSize: 18, color: 'var(--ink-faint)',
                marginTop: 12, letterSpacing: '0.04em',
              }}>Empty lane</div>
              <div className="mono" style={{
                fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.16em', marginTop: 6,
              }}>AWAITING PICK</div>
            </>
          )}
        </div>
      );
    }

    return (
      <div className={`cp-panel el-${e.id}`} style={{
        position: 'relative',
        padding: 22,
        background: `linear-gradient(${isOpp ? 180 : 0}deg, rgba(var(--el-rgb), 0.18), rgba(var(--el-rgb), 0.02))`,
        borderColor: 'var(--el-color)',
        boxShadow: `0 0 0 1px var(--el-color) inset, 0 0 28px rgba(var(--el-rgb), 0.2)`,
        display: 'flex', flexDirection: 'column',
        minHeight: 0,
      }}>
        <div className="row between middle" style={{ alignItems: 'flex-start' }}>
          <div className="mono" style={{
            fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.22em',
          }}>{isOpp ? 'OPP' : 'YOU'} · LANE {lane.idx}</div>
          <span className="mono" style={{
            fontSize: 9, letterSpacing: '0.18em',
            color: isPlaced ? 'var(--purple-300)' : 'var(--el-color)',
          }}>
            ● {isPlaced ? 'JUST PLACED' : 'LOCKED'}
          </span>
        </div>

        <div className="row gap-3 middle" style={{ alignItems: 'center', marginTop: 12 }}>
          <Sigil el={e.id} size="big" />
          <div className="col">
            <div className="disp" style={{
              fontSize: 28, fontWeight: 700, color: 'var(--el-color)',
              lineHeight: 1, letterSpacing: '-0.01em',
              textShadow: `0 0 18px rgba(var(--el-rgb), 0.5)`,
            }}>{e.name}</div>
            <div className="mono" style={{
              fontSize: 10, color: 'var(--ink-dim)', letterSpacing: '0.16em', marginTop: 6,
            }}>
              12 CARDS · TIER {e.id === 'psychic' || e.id === 'plague' || e.id === 'fire' ? 'A' : 'B'}
            </div>
          </div>
        </div>

        <div className="disp" style={{
          fontSize: 13, color: 'var(--ink-dim)', marginTop: 12, fontStyle: 'italic',
          lineHeight: 1.3,
        }}>"{e.tagline}"</div>

        {/* mini card preview */}
        <div className="row gap-1" style={{ marginTop: 'auto', paddingTop: 14, alignItems: 'flex-end' }}>
          {[1, 2, 3, 4].map(n => (
            <div key={n} style={{
              width: 30, height: 42,
              border: `1px solid rgba(var(--el-rgb), 0.4)`,
              borderRadius: 3,
              background:
                `linear-gradient(135deg, rgba(var(--el-rgb), 0.2), transparent),
                 repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.2) 2px 3px)`,
              position: 'relative',
            }}>
              <span className="mono" style={{
                position: 'absolute', top: 2, right: 3,
                fontSize: 9, color: 'var(--el-color)', fontWeight: 700,
              }}>{n}</span>
            </div>
          ))}
          <span className="mono" style={{
            fontSize: 9, color: 'var(--ink-faint)',
            letterSpacing: '0.12em', marginLeft: 6, marginBottom: 2,
          }}>+ 8 more</span>
        </div>
      </div>
    );
  };

  // ──────────────────── pool tile ────────────────────
  const PoolTile = ({ el }) => {
    const taken = takenByYou.has(el.id) ? 'you' : takenByOpp.has(el.id) ? 'opp' : null;
    const isDragging = el.id === state.holding;
    return (
      <div className={`cp-panel el-${el.id} ${isDragging ? 'cp-floating' : ''}`} style={{
        position: 'relative',
        padding: '14px 16px',
        background: isDragging
          ? `linear-gradient(135deg, rgba(var(--el-rgb), 0.25), rgba(var(--el-rgb), 0.08))`
          : `linear-gradient(180deg, rgba(var(--el-rgb), ${taken ? 0.04 : 0.10}), rgba(var(--el-rgb), 0.01))`,
        borderColor: taken ? 'var(--line-2)' : 'var(--el-color)',
        boxShadow: isDragging
          ? `0 16px 36px rgba(var(--el-rgb), 0.45), 0 0 0 2px var(--el-color)`
          : taken ? 'none' : `0 0 12px rgba(var(--el-rgb), 0.18)`,
        opacity: taken ? 0.4 : 1,
        cursor: taken ? 'not-allowed' : 'grab',
        overflow: 'hidden',
      }}>
        {taken && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'repeating-linear-gradient(135deg, transparent 0 6px, rgba(245,243,255,0.04) 6px 7px)',
            pointerEvents: 'none',
          }} />
        )}

        <div className="row between middle" style={{ alignItems: 'center' }}>
          <ElementName el={el.id} size="md" />
          {taken && (
            <span className="mono" style={{
              fontSize: 8, letterSpacing: '0.18em',
              color: taken === 'you' ? 'var(--purple-300)' : 'var(--fire)',
              fontWeight: 700,
            }}>
              {taken === 'you' ? '● YOURS' : '● OPP'}
            </span>
          )}
          {isDragging && (
            <span className="mono" style={{
              fontSize: 8, letterSpacing: '0.18em', color: 'var(--el-color)', fontWeight: 700,
            }}>● HOLDING</span>
          )}
        </div>

        <div className="disp" style={{
          fontSize: 13, color: 'var(--ink-dim)', marginTop: 10, fontStyle: 'italic',
          lineHeight: 1.3, minHeight: 32,
        }}>"{el.tagline}"</div>

        <div className="row between middle" style={{ alignItems: 'center', marginTop: 10 }}>
          <span className="mono" style={{
            fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.16em',
          }}>
            12 CARDS · TIER {el.id === 'psychic' || el.id === 'plague' || el.id === 'fire' ? 'A' : 'B'}
          </span>
          {!taken && !isDragging && (
            <span className="mono" style={{
              fontSize: 9, color: 'var(--el-color)', letterSpacing: '0.16em', fontWeight: 700,
            }}>DRAG ↓</span>
          )}
        </div>
      </div>
    );
  };

  // ──────────────────── right rail: snake timeline + holding + actions ────────────────────
  const RightRail = () => {
    const e = COMPILE_ELEMENTS.find(x => x.id === state.holding);
    return (
      <div style={{
        position: 'absolute', top: 110, right: PAD,
        width: RAIL_W, height: 1200 - 110 - 60,
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        {/* snake timeline */}
        <div className="cp-panel" style={{ padding: 18 }}>
          <div className="row between middle" style={{ alignItems: 'center', marginBottom: 14 }}>
            <span className="cp-panel-title">Draft Order · 1·2·2·1</span>
            <span className="mono" style={{ fontSize: 9, color: 'var(--purple-300)', letterSpacing: '0.18em' }}>
              STEP {state.step} / 4
            </span>
          </div>

          <div className="col gap-1">
            {state.snake.map((s, i) => {
              const isActive = s.status === 'active';
              const isDone = s.status === 'done';
              const isNext = s.status === 'next';
              return (
                <div key={i} className="row gap-3 middle" style={{
                  alignItems: 'center',
                  padding: '10px 12px',
                  borderRadius: 4,
                  border: `1px solid ${isActive ? 'var(--purple-400)' : 'transparent'}`,
                  background: isActive ? 'rgba(var(--purple-glow), 0.1)' : 'transparent',
                  opacity: isNext ? 0.4 : 1,
                  borderBottom: !isActive && i < 3 ? '1px dashed var(--line-2)' : undefined,
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 4,
                    display: 'grid', placeItems: 'center',
                    background: s.who === 'YOU' ? 'rgba(var(--purple-glow), 0.2)' : 'rgba(245,243,255,0.04)',
                    border: `1px solid ${s.who === 'YOU' ? 'var(--purple-400)' : 'var(--line-2)'}`,
                    color: s.who === 'YOU' ? 'var(--purple-300)' : 'var(--ink-dim)',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
                  }}>{s.who === 'YOU' ? 'P1' : 'P2'}</div>

                  <div className="col grow">
                    <div className="mono" style={{
                      fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.12em',
                    }}>
                      {s.who} · PICK {s.picks}
                      {isDone && <span style={{ color: 'var(--life)', marginLeft: 8 }}>✓ DONE</span>}
                      {isActive && <span style={{ color: 'var(--purple-300)', marginLeft: 8 }}>• NOW</span>}
                    </div>
                    <div className="disp" style={{
                      fontSize: 13, color: isDone ? 'var(--ink-dim)' : 'var(--ink)',
                      marginTop: 2,
                    }}>
                      {s.list.join(' · ')}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* holding now */}
        <div className={`cp-panel el-${state.holding}`} style={{
          padding: 18,
          background: `linear-gradient(135deg, rgba(var(--el-rgb), 0.20), rgba(var(--el-rgb), 0.04))`,
          borderColor: 'var(--el-color)',
          boxShadow: `0 0 0 1px var(--el-color) inset, 0 0 30px rgba(var(--el-rgb), 0.35)`,
        }}>
          <div className="row between middle" style={{ alignItems: 'center', marginBottom: 14 }}>
            <span className="cp-panel-title" style={{ color: 'var(--el-color)' }}>● Holding</span>
            <span className="mono" style={{ fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.16em' }}>
              DROP IN LANE
            </span>
          </div>
          <div className="row gap-3 middle" style={{ alignItems: 'center' }}>
            <Sigil el={state.holding} size="xl" />
            <div className="col">
              <div className="disp" style={{
                fontSize: 30, fontWeight: 700, color: 'var(--el-color)',
                lineHeight: 1, letterSpacing: '-0.01em',
                textShadow: `0 0 16px rgba(var(--el-rgb), 0.5)`,
              }}>{e.name}</div>
              <div className="disp" style={{
                fontSize: 13, color: 'var(--ink-dim)', marginTop: 6, fontStyle: 'italic',
              }}>"{e.tagline}"</div>
            </div>
          </div>
          <div style={{
            marginTop: 14, paddingTop: 12,
            borderTop: '1px dashed rgba(var(--el-rgb), 0.3)',
          }}>
            <div className="mono" style={{
              fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.14em',
            }}>KEYWORDS</div>
            <div className="row gap-1" style={{ marginTop: 6, flexWrap: 'wrap' }}>
              {['FORCE DISCARD', 'DECAY', 'COVER TRIGGER'].map(k => (
                <span key={k} className="cp-chip" style={{ color: 'var(--el-color)', borderColor: 'rgba(var(--el-rgb), 0.4)' }}>{k}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="grow" />

        {/* actions */}
        <div className="col gap-2">
          <button className="cp-btn ghost" style={{ justifyContent: 'center', width: '100%' }}>↶ Undo last pick</button>
          <button className="cp-btn primary" style={{ justifyContent: 'center', width: '100%', padding: '14px' }}>
            Lock build ▶
          </button>
        </div>
      </div>
    );
  };

  // ──────────────────── divider with label ────────────────────
  const Divider = ({ label, accent }) => (
    <div style={{
      position: 'absolute', left: PAD, width: POOL_W,
      height: 20,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        position: 'absolute', left: 0, right: 0, top: '50%',
        borderTop: '1px dashed var(--line-2)',
      }} />
      <span className="cp-panel" style={{
        padding: '4px 14px',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 9, letterSpacing: '0.26em',
        color: accent ? 'var(--purple-300)' : 'var(--ink-faint)',
        borderColor: accent ? 'var(--purple-400)' : 'var(--line-2)',
        textTransform: 'uppercase',
        borderRadius: 999,
      }}>{label}</span>
    </div>
  );

  return (
    <>
      <Header />

      {/* OPP'S 3 LANES (TOP) */}
      <div style={{
        position: 'absolute', top: 120, left: PAD, width: POOL_W, height: 220,
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 22,
      }}>
        {state.oppLanes.map(l => <LaneSlot key={l.idx} side="opp" lane={l} />)}
      </div>

      {/* divider */}
      <div style={{ position: 'absolute', top: 358, left: 0, right: 0 }}>
        <Divider label="Element Pool · 12 Protocols · Drag to assign" />
      </div>

      {/* POOL — 12 ELEMENTS · 6×2 */}
      <div style={{
        position: 'absolute', top: 392, left: PAD, width: POOL_W, height: 320,
        display: 'grid',
        gridTemplateColumns: 'repeat(6, 1fr)',
        gridTemplateRows: 'repeat(2, 1fr)',
        gap: 14,
      }}>
        {COMPILE_ELEMENTS.map(el => <PoolTile key={el.id} el={el} />)}
      </div>

      {/* drag arrow showing pool→lane motion */}
      <svg style={{
        position: 'absolute', left: PAD, top: 392,
        width: POOL_W, height: 460, pointerEvents: 'none',
      }}>
        <defs>
          <marker id="drag-head" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--plague)" />
          </marker>
        </defs>
        <path d={`M ${(POOL_W / 6) * 4.5} 80 C ${(POOL_W / 6) * 4.5 + 60} 220, ${POOL_W * 0.85} 320, ${POOL_W * 0.83} 420`}
          fill="none" stroke="var(--plague)" strokeWidth="2" strokeDasharray="4 5"
          markerEnd="url(#drag-head)"
          style={{ filter: 'drop-shadow(0 0 6px rgba(163, 230, 53, 0.6))' }} />
      </svg>

      {/* divider */}
      <div style={{ position: 'absolute', top: 730, left: 0, right: 0 }}>
        <Divider label="Your Lanes · Drop Here" accent />
      </div>

      {/* YOUR 3 LANES (BOTTOM) */}
      <div style={{
        position: 'absolute', top: 762, left: PAD, width: POOL_W, height: 280,
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 22,
      }}>
        {state.yourLanes.map(l => <LaneSlot key={l.idx} side="you" lane={l} />)}
      </div>

      <RightRail />

      {/* footer note */}
      <div style={{
        position: 'absolute', bottom: 20, left: PAD,
        width: POOL_W,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div className="mono" style={{
          fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.16em',
        }}>
          AFTER LOCK · DECKS BUILD AUTOMATICALLY · 12 CARDS PER PROTOCOL · 36 CARDS TOTAL
        </div>
        <div className="row gap-2 middle" style={{ alignItems: 'center' }}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.16em' }}>
            LANE ORDER MATTERS — LANE 2 PLAYS FIRST EACH ROUND
          </span>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { DraftScreen });
