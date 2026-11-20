/**
 * Logo SPIE (fichier fourni par SPIE, `public/logo-spie.png`, précaché pour le hors ligne). Le logo n'est jamais
 * recoloré : sur le bleu nuit de la barre d'en-tête, il est posé dans un cartouche blanc (`cartouche`).
 * `className` fixe la hauteur (ex. `h-6`) ; la largeur suit les proportions (640 × 276).
 */
export function LogoSpie({ className = "h-8", cartouche = false }: { className?: string; cartouche?: boolean }) {
  const img = (
    <img src="/logo-spie.png" alt="SPIE" width={640} height={276} className={`w-auto ${className}`} draggable={false} />
  );
  if (!cartouche) return img;
  return <span className="inline-flex items-center rounded-lg bg-white px-2.5 py-1.5">{img}</span>;
}
