// Prüft die Kontraste der Design-Tokens aus src/app/globals.css nach WCAG 2.x.
// Aufruf: node scripts/contrast.mjs  → Tabelle, Exit-Code 1 bei einem Verstoß.
// Kleine Schrift braucht 4,5:1, große (≥ 24 px oder ≥ 18,66 px fett) 3:1,
// Symbole, Schalter und Fokusring (Nicht-Text) 3:1.

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Farbe `fg` mit Deckkraft `a` über `bg` (beide RGB-Arrays). */
const over = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const WHITE = hex('#ffffff');
const L = {
  bg: hex('#f2f2f7'), elevated: hex('#ffffff'), bar: hex('#f9f9f9'), barAlpha: 1,
  label2: [[60, 60, 67], 0.78], gray: hex('#6c6c70'), tint: hex('#0062c4'), tintGraphic: hex('#007aff'), tintFill: hex('#006edb'),
  red: hex('#c4000f'), orange: hex('#b02e00'), demoFg: hex('#9a3c00'), green: hex('#1a6e30'),
};
const D = {
  bg: hex('#000000'), elevated: hex('#1c1c1e'), bar: hex('#161617'), barAlpha: 1,
  label2: [[235, 235, 245], 0.6], gray: hex('#aeaeb2'), tint: hex('#4da3ff'), tintGraphic: hex('#0a84ff'), tintFill: hex('#006edb'),
  red: hex('#ff6961'), orange: hex('#ffb340'), demoFg: hex('#ffb340'), green: hex('#30db5b'),
};
const fill = (t, base) => over([120, 120, 128], t === L ? 0.12 : 0.24, base);

const rows = [];
const check = (name, fg, bg, min = 4.5) => rows.push({ name, ratio: ratio(fg, bg), min });

for (const [mode, t] of [['hell', L], ['dunkel', D]]) {
  const surfaces = { bg: t.bg, elevated: t.elevated, 'fill/elevated': fill(t, t.elevated), 'fill/bg': fill(t, t.bg) };
  for (const [sn, s] of Object.entries(surfaces)) {
    check(`${mode}: label-2 auf ${sn}`, over(t.label2[0], t.label2[1], s), s);
    for (const k of ['tint', 'red', 'orange', 'green']) check(`${mode}: ${k} auf ${sn}`, t[k], s);
    check(`${mode}: tint-graphic (Symbol/Fokusring) auf ${sn}`, t.tintGraphic, s, 3);
  }
  // Tab-Leiste: halbtransparent; schlimmster Fall = blaue Fläche (tint-fill) dahinter.
  for (const [behind, c] of [['bg', t.bg], ['tint-fill', t.tintFill]]) {
    const bar = over(t.bar, t.barAlpha, c);
    check(`${mode}: Tab inaktiv (gray, 10px) auf Leiste über ${behind}`, t.gray, bar);
    check(`${mode}: Tab aktiv (tint, 10px) auf Leiste über ${behind}`, t.tint, bar);
    check(`${mode}: Tab-Symbol aktiv (tint-graphic) auf Leiste über ${behind}`, t.tintGraphic, bar, 3);
  }
  check(`${mode}: Weiß auf tint-fill (Primärknopf, aktive Seitenleiste, eigene Blase, Assistenten-Knopf)`, WHITE, t.tintFill);
  check(`${mode}: Blasen-Uhrzeit (Weiß 0,95) auf tint-fill`, over(WHITE, 0.95, t.tintFill), t.tintFill);
  check(`${mode}: tint-fill-Fläche (Knopf) gegen bg`, t.tintFill, t.bg, 3);
  // iMessage: Blase des Gegenübers (systemGray5 hell / systemGray4 dunkel), Zeitstempel, Wisch-Aktion „Später“
  const imsgIn = hex(t === L ? '#e9e9eb' : '#3a3a3c');
  check(`${mode}: label auf Blase (eingehend)`, t === L ? hex('#000000') : WHITE, imsgIn);
  check(`${mode}: label-2 (Tipp-Punkte) auf Blase (eingehend)`, over(t.label2[0], t.label2[1], imsgIn), imsgIn, 3);
  check(`${mode}: Weiß auf indigo (Wisch-Aktion „Später“)`, WHITE, hex(t === L ? '#5856d6' : '#5e5ce6'));
  check(`${mode}: Demo-Etikett im Primärknopf (Weiß auf Schwarz 0,2 über tint-fill)`, WHITE, over(hex('#000000'), 0.2, t.tintFill));
  for (const [sn, s] of [['elevated', t.elevated], ['bg', t.bg]]) {
    check(`${mode}: Demo-Etikett (demo-fg auf orange 14 %) über ${sn}`, t.demoFg, over(t.orange, 0.14, s));
  }
}

// Wallet-Karten: weiße Schrift, Glanz rgba(255,255,255,.1) oben rechts (über der Verlaufsmitte).
const CARDS = { NEXUS: ['#2b2d6e', '#4a3db8', '#5a45cc'], Zulassungsdienst: ['#0a4a4d', '#0b6159', '#0d6c60'] };
for (const [name, stops] of Object.entries(CARDS)) {
  const spots = { Anfang: hex(stops[0]), 'Mitte + Glanz': over(WHITE, 0.1, hex(stops[1])), Ende: hex(stops[2]) };
  for (const [sn, s] of Object.entries(spots)) {
    check(`Karte ${name} @${sn}: Bezeichnung (Weiß 0,9, 13px)`, over(WHITE, 0.9, s), s);
    check(`Karte ${name} @${sn}: Kopf (Weiß 0,92, 15px fett)`, over(WHITE, 0.92, s), s);
    check(`Karte ${name} @${sn}: Betrag veraltet (Weiß 0,6, 34px fett, groß)`, over(WHITE, 0.6, s), s, 3);
    check(`Karte ${name} @${sn}: Überfällig-Pille (Weiß auf Schwarz 0,2)`, WHITE, over(hex('#000000'), 0.2, s));
    const notice = over(hex('#000000'), 0.22, s);
    check(`Karte ${name} @${sn}: Datenstand-Quellen (Weiß 0,9 auf Schwarz 0,22)`, over(WHITE, 0.9, notice), notice);
  }
}

// Kontaktbild (Initialen „NA“, 26px fett = große Schrift) auf grauem Verlauf
for (const stop of ['#7c8190', '#626673']) check(`Kontaktbild @${stop}: Weiß (26px fett)`, WHITE, hex(stop), 3);
let failed = 0;
for (const r of rows) {
  const ok = r.ratio >= r.min;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${r.ratio.toFixed(2).padStart(5)}:1 (min ${r.min}) ${r.name}`);
}
console.log(`\n${rows.length - failed}/${rows.length} Paare erfüllen WCAG AA.`);
process.exit(failed ? 1 : 0);
