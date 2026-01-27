import { Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';
import AddTransaction from './pages/AddTransaction';
import LegoCollection from './pages/LegoCollection';

function App() {
  return (
    <div>
      <Navbar />
      <div className="container" style={{ padding: '20px' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/add" element={<AddTransaction />} />
          <Route path="/lego" element={<LegoCollection />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;