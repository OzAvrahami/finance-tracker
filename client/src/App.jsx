import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Import from './pages/Import';
import Transactions from './pages/Transactions';
import AddTransaction from './pages/AddTransaction';
import LegoCollection from './pages/LegoCollection';


function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/add" element={<AddTransaction />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/lego" element={<LegoCollection />} />

          <Route path="/import" element={<Import />} />
          <Route path="/edit-transaction/:id" element={<AddTransaction />} />
        </Route>
      </Routes>

    </BrowserRouter>

  );
}

export default App;