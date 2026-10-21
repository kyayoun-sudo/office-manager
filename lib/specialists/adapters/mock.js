export async function invoke({ capability }) {
  return { data: { message: 'Réponse simulée : aucune pièce client analysée.', capability }, confidence: 0.5,
    sources: [], limitations: ['Simulation uniquement ; aucune valeur probante.'], simulated: true };
}
