import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';

/**
 * React Router keeps the scroll position across navigations, which on this site
 * means landing halfway down a fresh page. Reset on every path change, but leave
 * in-page anchors (#csaladfa, #tonight) alone.
 */
export const ScrollToTop = (): null => {
  const {pathname, hash} = useLocation();

  useEffect(() => {
    if (hash) {
      const target = document.querySelector(hash);
      if (target) {
        target.scrollIntoView({behavior: 'smooth', block: 'start'});
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);

  return null;
};
