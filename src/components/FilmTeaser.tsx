import './product-film.css';

export function FilmTeaser({ onPlay }: { onPlay: () => void }) {
  return (
    <section className="film-teaser" aria-labelledby="film-teaser-title">
      <div className="film-teaser__eyebrow"><span /> THE PITWALL STORY</div>
      <h2 id="film-teaser-title">Your idea.<br />The next update.</h2>
      <p>A game shaped by the people who play it.<br />See how feedback becomes something real.</p>
      <button className="film-teaser__preview" type="button" onClick={onPlay} aria-label="Watch the Pitwall story, 48-second product film">
        <img src="/film/pitwall-poster.jpg" alt="A sculpted racing circuit illuminated in red and mint" width="1280" height="720" />
        <span className="film-teaser__shade" />
        <span className="film-teaser__play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m9 5 11 7-11 7Z" /></svg></span>
        <span className="film-teaser__watch">WATCH THE FILM <span>00:48 ↗</span></span>
      </button>
      <div className="film-teaser__footer"><span>PLAYER IDEAS. REAL IMPACT.</span><span>01 — THE INTRODUCTION</span></div>
    </section>
  );
}
