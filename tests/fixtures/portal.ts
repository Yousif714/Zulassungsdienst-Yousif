/** Kopierte Admin-Seite des Portals (Freitext, Tab-getrennt). */
export const portalListText = [
  'Mitglieder',
  'Name\tE-Mail\tBeigetreten',
  'Ayşe Öztürk\tAYSE@example.de\t01.09.2026',
  'Murat Demir\tmurat@example.de\t15.08.2026',
  'Nina Hahn',
  'nina@example.de',
  'Paula Neu <neu@example.de>',
  'team@nexusnetzwerk.de',
  'Murat Demir\tMurat@Example.de\t15.08.2026',
  'Bearbeiten',
].join('\n');

/** CSV mit Semikolon und Anführungszeichen. */
export const portalListCsv = [
  'Name;E-Mail',
  '"Öztürk, Ayşe";ayse@example.de',
  'Lena Neu;lena.neu@example.de',
  ';ohne-name@example.de',
  'Kein Mail;',
].join('\n');
