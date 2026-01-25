import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';
import AddTransaction from './pages/AddTransaction';

function App() {
  return (
    <div>
      <Navbar /> {/* מופיע מעל כל הדפים */}
      <div className="container" style={{ padding: '20px' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/add" element={<AddTransaction />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;