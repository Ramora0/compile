// Compile — polished shared components

const COMPILE_ELEMENTS = [
  { id: 'fire',    name: 'FIRE',    tagline: 'Burn at both ends.' },
  { id: 'water',   name: 'WATER',   tagline: 'Wash away and renew.' },
  { id: 'light',   name: 'LIGHT',   tagline: 'Burn away the dark.' },
  { id: 'life',    name: 'LIFE',    tagline: 'Bring about new growth.' },
  { id: 'plague',  name: 'PLAGUE',  tagline: 'Slow death from within.' },
  { id: 'psychic', name: 'PSYCHIC', tagline: 'Know your foe\'s mind.' },
  { id: 'metal',   name: 'METAL',   tagline: 'Reinforce and deflect.' },
  { id: 'void',    name: 'VOID',    tagline: 'Erase. Skip. Vanish.' },
  { id: 'speed',   name: 'SPEED',   tagline: 'Play extra. Cycle fast.' },
  { id: 'death',   name: 'DEATH',   tagline: 'Sacrifice for power.' },
  { id: 'spirit',  name: 'SPIRIT',  tagline: 'Restore and persist.' },
  { id: 'gravity', name: 'GRAVITY', tagline: 'Pull and rearrange.' },
];

// =========================================================
// Stage — scales 1920×1200 canvas to viewport
// =========================================================
function Stage({ children }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const onResize = () => {
      const W = window.innerWidth, H = window.innerHeight;
      const sx = W / 1920;
      const sy = H / 1200;
      const s = Math.min(sx, sy);
      ref.current?.style.setProperty('--cp-scale', s.toString());
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return (
    <div className="cp-stage cp-scanlines" ref={ref}>
      <div className="cp-canvas">
        {children}
      </div>
    </div>
  );
}

// =========================================================
// Card — holographic hand / inspect card
// =========================================================
function Card({ el, num, faceDown, effect, line, tier = 'B', size = 'hand', className = '', style }) {
  if (faceDown) {
    return <div className={`cp-card facedown ${size === 'field' ? 'field' : ''} ${className}`} style={style} />;
  }
  const elClass = `el-${el}`;
  return (
    <div className={`cp-card ${size === 'field' ? 'field' : ''} ${elClass} ${className}`} style={style}>
      <div className="cp-card-inner">
        <div className="cp-card-head">
          <div className="cp-card-el">{el}</div>
          <div className="cp-card-num">{num}</div>
        </div>
        <div className="cp-card-art" />
        {effect && size === 'hand' && (
          <div className="cp-card-effect">{effect}</div>
        )}
        <div className="cp-card-foot">
          <span>TIER {tier}</span>
          <span>{line ? `→ L${line}` : 'PROTOCOL'}</span>
        </div>
      </div>
    </div>
  );
}

// =========================================================
// Sigil — small element marker pip
// =========================================================
function Sigil({ el, size = 'md' }) {
  const cls = size === 'big' ? 'cp-sigil big' : size === 'xl' ? 'cp-sigil xl' : 'cp-sigil';
  const glyphMap = {
    fire: '▲', water: '◇', light: '◯', life: '✚', plague: '※',
    psychic: '◬', metal: '◈', void: '⬢', speed: '⌁', death: '✕',
    spirit: '◊', gravity: '◉',
  };
  return <span className={`${cls} el-${el}`}>{glyphMap[el] || '◆'}</span>;
}

// =========================================================
// CompileBar — fill bar that goes 0–10, glows, marks compiled
// =========================================================
function CompileBar({ el, value, max = 10, compiled = false }) {
  return (
    <div className={`cp-bar el-${el} ${compiled ? 'compiled' : ''}`}>
      <i style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </div>
  );
}

// =========================================================
// ElementName — name + sigil unit
// =========================================================
function ElementName({ el, size = 'sm' }) {
  const fontSize = size === 'lg' ? 18 : size === 'md' ? 14 : 12;
  return (
    <div className="row gap-2 middle" style={{ alignItems: 'center' }}>
      <Sigil el={el} size={size === 'lg' ? 'big' : 'md'} />
      <span className="mono" style={{
        fontSize,
        fontWeight: 700,
        letterSpacing: '0.18em',
        color: `var(--${el === 'void' ? 'void-el' : el})`,
      }}>{el.toUpperCase()}</span>
    </div>
  );
}

// =========================================================
// CompiledTag — small "compiled" pill on lane header
// =========================================================
function CompiledTag({ el }) {
  return (
    <span className={`cp-compiled-tag el-${el}`}>
      <span style={{ fontSize: 11 }}>✓</span> Compiled
    </span>
  );
}

// =========================================================
// FlatCardStack — stacked cards with vertical offset
//   from: 'top' (opp; falling down) or 'bottom' (you; rising up)
// =========================================================
function FlatCardStack({ cards, from = 'bottom', spacing = 36, size = 'field' }) {
  return (
    <div style={{ position: 'relative', width: 124, height: '100%' }}>
      {cards.map((c, i) => {
        const isLast = i === cards.length - 1;
        const offset = i * spacing;
        return (
          <div key={i} style={{
            position: 'absolute',
            left: 0,
            ...(from === 'top'
              ? { top: offset, transform: 'rotate(180deg)' }
              : { bottom: offset }),
            zIndex: isLast ? cards.length + 1 : i,
            filter: isLast ? 'none' : 'brightness(0.85)',
          }}>
            <Card el={c.el} num={c.num} faceDown={c.faceDown} effect={c.effect} size={size} line={c.line} />
          </div>
        );
      })}
    </div>
  );
}

// =========================================================
// OppHandStrip — abstract row of face-down cards
// =========================================================
function OppHandStrip({ count = 5, width = 320 }) {
  return (
    <div style={{ position: 'relative', width, height: 84 }}>
      {Array.from({ length: count }).map((_, i) => {
        const step = (width - 60) / Math.max(1, count - 1);
        return (
          <div key={i} className="cp-card facedown" style={{
            position: 'absolute',
            left: i * step,
            top: 0,
            width: 60, height: 84,
            transform: `rotate(180deg)`,
            borderRadius: 6,
          }} />
        );
      })}
    </div>
  );
}

// =========================================================
// DeckPile — visual deck stack with count badge
// =========================================================
function DeckPile({ count = 6, label = 'DECK', faceUp = false, el }) {
  const visible = Math.min(count, 5);
  return (
    <div style={{ position: 'relative', width: 124, height: 174 + (visible - 1) * 3 }}>
      {Array.from({ length: visible }).map((_, i) => (
        <div key={i} className={`cp-card facedown field`} style={{
          position: 'absolute',
          left: i * 1.5, top: i * 3,
        }} />
      ))}
      <div className="mono" style={{
        position: 'absolute',
        bottom: -22, left: 0, right: 0,
        textAlign: 'center',
        fontSize: 10, letterSpacing: '0.16em',
        color: 'var(--ink-faint)',
      }}>
        {label} · {count}
      </div>
    </div>
  );
}

// =========================================================
// DiscardPile — single-card slot showing top of discard
// =========================================================
function DiscardPile({ count = 0, label = 'DISCARD', topCard = null }) {
  return (
    <div style={{ position: 'relative', width: 124, height: 174 }}>
      {topCard ? (
        <Card {...topCard} size="field" />
      ) : (
        <div style={{
          width: 124, height: 174,
          border: '1.5px dashed var(--line-2)',
          borderRadius: 8,
          background: 'rgba(255,255,255,0.015)',
          display: 'grid',
          placeItems: 'center',
        }}>
          <span className="mono" style={{ fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.18em' }}>EMPTY</span>
        </div>
      )}
      <div className="mono" style={{
        position: 'absolute',
        bottom: -22, left: 0, right: 0,
        textAlign: 'center',
        fontSize: 10, letterSpacing: '0.16em',
        color: 'var(--ink-faint)',
      }}>
        {label} · {count}
      </div>
    </div>
  );
}

// =========================================================
// PlayerNameplate — player portrait + name + status
// =========================================================
function PlayerNameplate({ name, mmr, status, statusTone = 'active', portrait, align = 'left' }) {
  const toneColor = {
    active: 'var(--purple-400)',
    waiting: 'var(--ink-faint)',
    thinking: 'var(--light)',
  }[statusTone];

  return (
    <div className="row gap-3 middle" style={{ flexDirection: align === 'right' ? 'row-reverse' : 'row' }}>
      <div style={{
        width: 56, height: 56,
        borderRadius: 999,
        border: `1.5px solid ${align === 'right' ? 'var(--purple-400)' : 'var(--line-3)'}`,
        background: `linear-gradient(135deg, rgba(var(--purple-glow), 0.3), transparent)`,
        boxShadow: align === 'right' ? `0 0 18px rgba(var(--purple-glow), 0.4)` : 'none',
        display: 'grid', placeItems: 'center',
        fontSize: 22,
        fontFamily: 'JetBrains Mono, monospace',
        color: align === 'right' ? 'var(--purple-300)' : 'var(--ink-dim)',
      }}>
        {portrait || (align === 'right' ? '◉' : '◎')}
      </div>
      <div className="col" style={{ alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
        <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '0.02em' }}>{name}</div>
        <div className="mono" style={{ fontSize: 10, color: toneColor, letterSpacing: '0.14em', marginTop: 4 }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 999,
            background: toneColor, boxShadow: `0 0 8px ${toneColor}`, marginRight: 6,
            verticalAlign: 'middle',
          }} />
          {status}
        </div>
        <div className="mono" style={{ fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.12em', marginTop: 2 }}>
          {mmr} MMR · DIV III
        </div>
      </div>
    </div>
  );
}

Object.assign(window, {
  COMPILE_ELEMENTS, Stage, Card, Sigil, CompileBar, ElementName, CompiledTag,
  FlatCardStack, OppHandStrip, DeckPile, DiscardPile, PlayerNameplate,
});
