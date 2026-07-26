import { useMemo, useId } from 'react';
import { Check, Copy } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { APP_NAME } from '../../config';

const QR_SIZE = 148;

export function GradientQRCode({ value, size, title }: Readonly<{ value: string; size: number; title: string }>) {
  const gradientId = useId();
  const qr = useMemo(() => {
    qrcode.stringToBytes = (s: string) => Array.from(new TextEncoder().encode(s));
    const nextQr = qrcode(0, 'H');
    nextQr.addData(value);
    nextQr.make();
    return nextQr;
  }, [value]);
  const moduleCount = qr.getModuleCount();
  const modules = [];

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!qr.isDark(row, col)) continue;
      modules.push(
        <rect
          key={`${row}-${col}`}
          x={col}
          y={row}
          width="1"
          height="1"
        />
      );
    }
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${moduleCount} ${moduleCount}`} role="img" aria-label={title}>
      <title>{title}</title>
      <defs>
        <linearGradient id={gradientId} x1="0" y1={moduleCount} x2={moduleCount} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00b8ad" />
          <stop offset="48%" stopColor="#116d92" />
          <stop offset="100%" stopColor="#b115e6" />
        </linearGradient>
      </defs>
      <rect width={moduleCount} height={moduleCount} fill="#ffffff" />
      <g fill={`url(#${gradientId})`} shapeRendering="crispEdges">{modules}</g>
    </svg>
  );
}

export function JoinCard({ pin, copied, copyInvite }: Readonly<{ pin: string; copied: boolean; copyInvite: () => void }>) {
  const searchParams = new URLSearchParams(globalThis.location.search);
  const isScreenshot = searchParams.has('v');
  const baseUrl = isScreenshot ? 'https://joavn.dev/versed' : `${globalThis.location.origin}${import.meta.env.BASE_URL}`.replace(/\/$/, '');
  const qrUrl = isScreenshot ? `https://joavn.dev/versed/play/${pin}` : `${globalThis.location.origin}${import.meta.env.BASE_URL}play/${pin}`;

  return (
    <div className="w-full max-w-md bg-white/5 rounded-2xl p-5">
      <div className="flex items-center gap-5">
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div>
            <p className="text-white/45 text-xs uppercase tracking-widest mb-0.5">Join at</p>
            <p className="text-white font-semibold text-base">
              {baseUrl}
            </p>
          </div>
          <div>
            <p className="text-white/45 text-xs uppercase tracking-widest mb-0.5">PIN</p>
            <p className="text-6xl font-black text-white tracking-widest leading-none select-text">{pin}</p>
          </div>
          <button
            type="button"
            onClick={copyInvite}
            className="flex items-center gap-2 text-white/45 text-xs hover:text-white/70 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy invite link'}
          </button>
        </div>
        <div
          className="relative shrink-0 rounded-2xl p-2.5 shadow-lg"
          style={{
            background: '#ffffff',
            boxShadow: '0 18px 45px rgba(0, 0, 0, 0.28), inset 0 0 0 1px rgba(255, 255, 255, 0.72)',
          }}
        >
          <GradientQRCode
            value={qrUrl}
            size={QR_SIZE}
            title={`Join ${APP_NAME} game ${pin}`}
          />
        </div>
      </div>
    </div>
  );
}
