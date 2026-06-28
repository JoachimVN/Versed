import { useNavigate } from 'react-router-dom';
import { APP_NAME, BACKEND_URL } from '../config';

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt={APP_NAME} className="mx-auto h-16 w-auto" />
        <p className="mt-2 text-white/60 text-lg">Music quiz for everyone in the room</p>
      </div>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button
          onClick={() => (window.location.href = `${BACKEND_URL}/api/auth/spotify`)}
          className="w-full py-4 rounded-2xl bg-[#1DB954] text-white font-bold text-xl hover:bg-[#1ed760] active:scale-95 transition-all shadow-lg"
        >
          Host a game
        </button>
        <button
          onClick={() => navigate('/play')}
          className="w-full py-4 rounded-2xl bg-white/10 text-white font-bold text-xl hover:bg-white/20 active:scale-95 transition-all"
        >
          Join a game
        </button>
      </div>

      <p className="text-white/30 text-sm text-center max-w-xs">
        Hosting requires a Spotify Premium account
      </p>
    </div>
  );
}
