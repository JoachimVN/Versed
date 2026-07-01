/** Medal emoji for top-3 ranks, plain number otherwise. */
export function RankBadge({ rank }: Readonly<{ rank: number }>) {
  if (rank === 1) return <span className="text-xl">🥇</span>;
  if (rank === 2) return <span className="text-xl">🥈</span>;
  if (rank === 3) return <span className="text-xl">🥉</span>;
  return <span className="text-white/60 font-semibold">{rank}.</span>;
}