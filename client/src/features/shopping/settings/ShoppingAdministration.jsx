import { useState } from 'react';
import ShoppingCatalogAdmin from './ShoppingCatalogAdmin';
import { createHttpCatalogApi } from '../services/httpCatalogApi';

export default function ShoppingAdministration() {
  const [adapter] = useState(() => createHttpCatalogApi({ mode: 'production' }));
  return <ShoppingCatalogAdmin adapter={adapter} />;
}
