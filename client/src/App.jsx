import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Import from './pages/Import';
import Transactions from './pages/Transactions';
import AddTransaction from './pages/AddTransaction';
import LegoCollection from './pages/LegoCollection';
import Loans from './pages/Loans';
import Login from './pages/Login';
import ProtectedRoute from './components/ProtectedRoute';


function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route path="/" element={<Dashboard />} />
          <Route path="/add" element={<AddTransaction />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/lego" element={<LegoCollection />} />
          <Route path="/loans" element={<Loans /> } />
          <Route path="/import" element={<Import />} />
          <Route path="/edit-transaction/:id" element={<AddTransaction />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
