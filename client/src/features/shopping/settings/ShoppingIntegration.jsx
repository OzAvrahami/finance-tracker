import { useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../../../context/AuthContext';
import { useAuth } from '../../../context/auth-context';
import Login from '../../../pages/Login';
import { Alert, SecondaryButton } from '../../../components/ui';
import ShoppingCatalogAdmin from './ShoppingCatalogAdmin';
import { createHttpCatalogApi } from '../services/httpCatalogApi';

function AuthenticatedCatalog() {
  const { user, loading, authError, retryAuth }=useAuth();
  const [adapter]=useState(()=>createHttpCatalogApi());
  if(authError)return <Alert variant="error">{authError}<SecondaryButton onClick={retryAuth}>ניסיון חוזר</SecondaryButton></Alert>;
  if(loading)return <p role="status">בודק התחברות…</p>;
  if(!user)return <Login />;
  return <ShoppingCatalogAdmin adapter={adapter} />;
}
export default function ShoppingIntegration() {
  return <AuthProvider><BrowserRouter><AuthenticatedCatalog /></BrowserRouter></AuthProvider>;
}
