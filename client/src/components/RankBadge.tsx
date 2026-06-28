import { Trophy, Medal, Award } from 'lucide-react';

/** Medal icon for top-3 ranks, plain number otherwise. */
export function RankBadge({ rank }: Readonly<{ rank: number }>) {
  if (rank === 1) return <Trophy className="w-5 h-5 text-amber-400" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-slate-300" />;
  if (rank === 3) return <Award className="w-5 h-5 text-amber-700" />;
  return <span className="text-white/60 font-semibold">{rank}.</span>;
}