import { Link } from 'react-router-dom';

const Navbar = () => {
  return (
    <nav style={{ 
      padding: '15px 40px', 
      backgroundColor: '#1a1a2e', 
      color: 'white',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
      direction: 'rtl'
    }}>
      <div style={{ display: 'flex', gap: '30px' }}>
        <Link to="/" style={navLinkStyle}>דף הבית</Link>
        <Link to="/add" style={navLinkStyle}>הוספת הוצאה</Link>
        <Link to="/lego" style={navLinkStyle}>אוסף לגו</Link>
      </div>
      <div style={{ color: '#4cc9f0', fontWeight: 'bold', fontSize: '1.2rem' }}>
        Finance & Lego Tracker
      </div>
    </nav>
  );
};

const navLinkStyle = {
  color: 'white',
  textDecoration: 'none',
  fontSize: '1.1rem',
  transition: 'color 0.3s'
};

export default Navbar;