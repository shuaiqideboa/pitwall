import type { Player, TyreRequest } from '../game/engine';
import { COMPOUNDS, type Compound, TYRES } from '../game/tyres';

/** A tyre seen side-on: black rubber, compound-colored sidewall band, letter. */
export function TyreIcon({ compound, size = 20, worn = false }: { compound: Compound; size?: number; worn?: boolean }) {
  const t = TYRES[compound];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      role="img"
      aria-label={`${t.name} tyre${worn ? ', worn' : ''}`}
      style={{ opacity: worn ? 0.55 : 1, flex: 'none' }}
    >
      <circle cx="20" cy="20" r="19" fill="#0B0B0E" />
      <circle cx="20" cy="20" r="13.5" fill="none" stroke={t.color} strokeWidth="3.5" strokeDasharray={worn ? '5 3' : undefined} />
      <circle cx="20" cy="20" r="8.5" fill="#2F323A" />
      <text
        x="20"
        y="20"
        dy="0.36em"
        textAnchor="middle"
        fontFamily="Barlow Condensed, sans-serif"
        fontWeight="800"
        fontSize="12"
        fill="#F3F0E8"
      >
        {t.letter}
      </text>
    </svg>
  );
}

const HEADINGS: Record<TyreRequest['reason'], (name: string) => string> = {
  grid: (n) => `${n}: choose your starting tyres`,
  'pit-stop': (n) => `${n} is in the box: choose new tyres`,
  'red-flag': (n) => `Red flag! ${n}: change tyres for the restart?`,
};

const NOTES: Record<TyreRequest['reason'], string> = {
  grid: 'Every car must box at least once. A car that hasn’t is called in on its final lap.',
  'pit-stop': 'Green flag: you leave the box next turn. Under the Safety Car the stop is quick and you keep driving.',
  'red-flag': 'The race is suspended. A tyre change under the red flag counts as your stop.',
};

interface TyrePickerProps {
  request: TyreRequest;
  player: Player;
  /** null keeps the current set (red flag only). */
  onChoose: (c: Compound | null) => void;
}

export function TyrePicker({ request, player, onChoose }: TyrePickerProps) {
  const redFlag = request.reason === 'red-flag';
  return (
    <div className={`picker ${redFlag ? 'picker--red' : ''}`} role="dialog" aria-modal="true" aria-labelledby="picker-title">
      <div className="picker__head">
        <span className="picker__dot" style={{ background: player.color }} />
        <h2 id="picker-title" className="picker__title">
          {HEADINGS[request.reason](player.name)}
        </h2>
      </div>
      <div className="picker__options">
        {COMPOUNDS.map((c) => {
          const t = TYRES[c];
          return (
            <button key={c} type="button" className="tyre-option" onClick={() => onChoose(c)}>
              <TyreIcon compound={c} size={52} />
              <span className="tyre-option__name">{t.name}</span>
              <span className="tyre-option__faces" aria-label={`Die faces ${t.faces.join(', ')}`}>
                {t.faces.map((f, i) => (
                  <span key={i} style={{ borderColor: t.color }}>
                    {f}
                  </span>
                ))}
              </span>
              <span className="tyre-option__blurb">{t.blurb}</span>
              {t.wornFaces && <span className="tyre-option__worn">Worn: {t.wornFaces.join(' ')}</span>}
            </button>
          );
        })}
      </div>
      <div className="picker__foot">
        <span>{NOTES[request.reason]}</span>
        {redFlag && player.tyre && (
          <button type="button" className="picker__cancel" onClick={() => onChoose(null)}>
            Keep {TYRES[player.tyre].name}s
          </button>
        )}
      </div>
    </div>
  );
}
