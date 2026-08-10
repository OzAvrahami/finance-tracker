import { useContext, useEffect, useState } from 'react';
import { CreditCard, ShoppingBasket, Tags } from 'lucide-react';
import { GlassCard, Tab, TabList, TabPanel, Tabs } from '../../components/ui';
import { PageHeaderContext } from '../../context/PageHeaderContext';
import CategoriesTab from './CategoriesTab';
import PaymentSourcesTab from './PaymentSourcesTab';
import ShoppingSettingsTab from './ShoppingSettingsTab';
import './Settings.css';

const TABS = [
  { key: 'categories', label: 'קטגוריות', icon: <Tags size={16} aria-hidden="true" /> },
  { key: 'payment-sources', label: 'אמצעי תשלום', icon: <CreditCard size={16} aria-hidden="true" /> },
  { key: 'shopping', label: 'הגדרות קניות', icon: <ShoppingBasket size={16} aria-hidden="true" /> },
];

const Settings = () => {
  const { setPageHeader } = useContext(PageHeaderContext);
  const [activeTab, setActiveTab] = useState('categories');

  useEffect(() => {
    setPageHeader({
      title: 'הגדרות',
      subtitle: 'קטגוריות, אמצעי תשלום והגדרות קניות',
    });
  }, [setPageHeader]);

  return (
    <div className="settings-page" dir="rtl">
      <GlassCard className="settings-shell" padding="0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="settings-tabs">
          <TabList aria-label="אזורי הגדרות" className="settings-tabs__list">
            {TABS.map(({ key, label, icon }) => (
              <Tab key={key} value={key} className="settings-tabs__tab">
                {icon}
                {label}
              </Tab>
            ))}
          </TabList>

          <TabPanel value="categories" className="settings-tabs__panel">
            {activeTab === 'categories' && <CategoriesTab />}
          </TabPanel>
          <TabPanel value="payment-sources" className="settings-tabs__panel">
            {activeTab === 'payment-sources' && <PaymentSourcesTab />}
          </TabPanel>
          <TabPanel value="shopping" className="settings-tabs__panel">
            {activeTab === 'shopping' && <ShoppingSettingsTab />}
          </TabPanel>
        </Tabs>
      </GlassCard>
    </div>
  );
};

export default Settings;
