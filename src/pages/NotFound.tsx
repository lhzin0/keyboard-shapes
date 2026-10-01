import { Link } from 'react-router-dom';
import ui from '../components/ui.module.css';
import { useDocumentTitle } from '../hooks';
import styles from './Pages.module.css';

export function NotFound({ what = 'page' }: { what?: string }) {
  useDocumentTitle('Not found');
  return (
    <div className={styles['page']}>
      <div className={styles['empty']}>
        <h1 style={{ fontSize: 22 }}>This {what} does not exist</h1>
        <p>It may have been renamed or never imported.</p>
        <div className={ui['row']}>
          <Link to="/" className={ui['btn']}>Home</Link>
          <Link to="/search" className={ui['btn']}>Search the catalog</Link>
        </div>
      </div>
    </div>
  );
}

export default NotFound;
