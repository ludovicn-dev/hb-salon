// Thèmes proposés dans les Réglages, dans l'ordre des vignettes (le thème par défaut en tête). Les couleurs
// vivent en CSS : Élégance dans styles.css (:root, base des jetons que les autres thèmes ne redonnent pas),
// les autres dans themes.css, un bloc [data-theme="…"] chacun. Le thème par défaut, Élégance, est posé
// d'office sur <html data-theme> dans index.html : il vaut dès le premier affichage, sans choix gardé.
export const DEFAULT_THEME = 'elegance';
export const BASE_THEME = 'elegance';

export const THEMES = [
  { id: 'elegance', name: 'Élégance' },
  { id: 'barbier', name: 'Barbier' },
  { id: 'jour', name: 'Élégance jour' },
  { id: 'ivoire', name: 'Ivoire & laiton' },
  { id: 'barbierjour', name: 'Barbier jour' },
  { id: 'porcelaine', name: 'Bleu porcelaine' },
  { id: 'ardoise', name: 'Ardoise & cuivre' },
  { id: 'editorial', name: 'Éditorial' },
  { id: 'lagon', name: 'Lagon' },
  { id: 'artdeco', name: 'Art déco' },
  { id: 'atelier', name: 'Atelier' },
];
