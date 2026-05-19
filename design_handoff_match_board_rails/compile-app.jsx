// Compile — main app + screen router

const COMPILE_TWEAKS = /*EDITMODE-BEGIN*/{
  "screen": "board",
  "boardLayout": "rails"
}/*EDITMODE-END*/;

function CompileApp() {
  const [t, setTweak] = useTweaks(COMPILE_TWEAKS);
  const [screen, setScreen] = React.useState(t.screen || 'board');

  // sync tweak → state and vice versa
  React.useEffect(() => { setScreen(t.screen); }, [t.screen]);

  const go = (s) => {
    setScreen(s);
    setTweak('screen', s);
  };

  return (
    <Stage>
      {/* top nav */}
      <div className="cp-topnav">
        <button className={screen === 'board' ? 'active' : ''} onClick={() => go('board')}>
          ◉ Match
        </button>
        <button className={screen === 'draft' ? 'active' : ''} onClick={() => go('draft')}>
          ✚ Draft
        </button>
      </div>

      {screen === 'board' && t.boardLayout === 'rails' && <BoardScreenRails />}
      {screen === 'board' && t.boardLayout !== 'rails' && <BoardScreen />}
      {screen === 'draft' && <DraftScreen />}

      <TweaksPanel title="Tweaks">
        <TweakSection title="Screen">
          <TweakRadio
            label="View"
            value={t.screen}
            onChange={(v) => go(v)}
            options={[
              { value: 'board', label: 'Match' },
              { value: 'draft', label: 'Draft' },
            ]}
          />
        </TweakSection>
        <TweakSection title="Board layout">
          <TweakRadio
            label="Layout"
            value={t.boardLayout || 'rails'}
            onChange={(v) => setTweak('boardLayout', v)}
            options={[
              { value: 'classic', label: 'Classic' },
              { value: 'rails',   label: 'Rails' },
            ]}
          />
        </TweakSection>
        <TweakSection title="Notes" subtitle="Hi-fi pass — main game board + draft">
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
            <p style={{ margin: '4px 0' }}>· Holographic cards with element-tinted glow & sheen</p>
            <p style={{ margin: '4px 0' }}>· Compiled lanes marked w/ ✓ tag + hatched bar (still playable)</p>
            <p style={{ margin: '4px 0' }}>· Hand cards: straight upright, 188×268, readable effect text</p>
            <p style={{ margin: '4px 0' }}>· Draft mirrors board: opp top / pool middle / you bottom</p>
          </div>
        </TweakSection>
      </TweaksPanel>
    </Stage>
  );
}

ReactDOM.createRoot(document.getElementById('compile-root')).render(<CompileApp />);
