import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function BackButton({ zIndex = 2 }: Readonly<{ zIndex?: number }>) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate('/')}
      className="absolute top-5 left-5 flex items-center gap-1.5 transition-all duration-200"
      style={{ background: 'none', border: 'none', padding: '6px 2px', zIndex, color: 'rgba(255,255,255,0.6)' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.95)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)'; }}
    >
      <ChevronLeft className="w-5 h-5" strokeWidth={1.5} />
      <span style={{ fontSize: '0.875rem', fontWeight: 400 }}>Back</span>
    </button>
  );
}
