import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Host from './pages/Host';
import Play from './pages/Play';
import Screenshot from './pages/Screenshot';

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/host" element={<Host />} />
        <Route path="/play" element={<Play />} />
        <Route path="/play/:pin" element={<Play />} />
        <Route path="/screenshot" element={<Screenshot />} />
      </Routes>
    </BrowserRouter>
  );
}
