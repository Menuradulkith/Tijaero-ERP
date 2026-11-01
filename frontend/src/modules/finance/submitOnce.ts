/**
 * Ignore a second click on a Save / action button while the first request is
 * still running. `disabled={m.isPending}` alone is not enough: a double-click
 * fires both clicks before React re-renders the button as disabled.
 */
type Mutation<TVars> = {
  mutate: (vars: TVars, options?: { onSettled?: () => void }) => void;
  isPending: boolean;
};

const inFlight = new Set<string>();

export function submitOnce<TVars = void>(key: string, mutation: Mutation<TVars>, vars?: TVars): void {
  if (inFlight.has(key) || mutation.isPending) return;
  inFlight.add(key);
  mutation.mutate(vars as TVars, { onSettled: () => inFlight.delete(key) });
}
