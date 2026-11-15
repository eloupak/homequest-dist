/* Name shown in the header next to the game title: the child whose game is open (the name of the child in the catalog, like the child switch;
 * the hero's own name stays inside the game). The admin on the Parent tab has no child: "Rodič". Empty when the child is unknown. */
export const PARENT_NAME = "Rodič";

export function headerName(cat, kidId, tab, isAdmin, heroName) {
  if (isAdmin && tab === "parent") return PARENT_NAME;
  if (heroName) return heroName;                          // #129: under the logo the hero's name (the child's name until there is a hero)
  const kid = ((cat && cat.kids) || []).find((k) => k.id === kidId);
  return (kid && kid.name) || "";
}
